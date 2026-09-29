/**
 * The library (SQLite, through tauri-plugin-sql): the same tables as the phone
 * app, so the code around it is the same. `initDatabase()` runs once before
 * the app shows; settings are read into memory then, so reading one is instant.
 */
import Database from '@tauri-apps/plugin-sql';
import { tr } from '../i18n';
import { dayKey } from '../services/stats';
import {
  HybridClock,
  VISIBLE_TRACK,
  baseName,
  bumpPlaylistStatement,
  bumpPlaylistsOf,
  isSyncedTrackColumn,
  migrateSyncSchema,
  newestStamp,
  tombstoneStatement,
  trackStamp,
  type SqlDb,
  type Statement,
} from '../sync/core';
import type { Playlist, Track, TrackSource, TrackStatus } from '../types';

type Scalar = string | number | null;
type Row = Record<string, Scalar>;

let db: Database | null = null;
const settingsCache = new Map<string, string>();

const conn = () => {
  if (!db) throw new Error('initDatabase() first');
  return db;
};

/** Writes go one after another: SQLite allows one writer at a time. */
let writes: Promise<unknown> = Promise.resolve();
function write(sql: string, params: unknown[] = []) {
  const job = writes.then(() => conn().execute(sql, params));
  writes = job.catch(() => {});
  return job;
}
const select = <T = Row>(sql: string, params: unknown[] = []) =>
  conn().select<T[]>(sql, params);

/** Statements one after another (the plugin's pool can't hold a transaction across calls). */
async function batch(statements: Statement[]) {
  for (const [sql, params] of statements) await write(sql, params);
}

// ---- sync (src/core/sync): stamps on every change, deletions remembered ----

/** This install's id, made once (sync tells devices and their changes apart). */
let deviceId = '';
export const getDeviceId = () => deviceId;
export let syncClock = new HybridClock('');

/** The database for the shared sync code (core/sync/core/store). */
export const syncDb: SqlDb = {
  all: async (sql, params = []) => {
    await writes;
    return select(sql, params);
  },
  run: async (sql, params = []) => {
    await write(sql, params);
  },
  batch,
};

const localListeners = new Set<() => void>();
/** Called after every local change that should reach the other device. */
export const onLocalChange = (fn: () => void) => {
  localListeners.add(fn);
  return () => {
    localListeners.delete(fn);
  };
};
/** A local change made outside this file (the language). */
export const localChange = () => localListeners.forEach(fn => fn());
const changed = () => {
  notify();
  localChange();
};
/** The library changed from elsewhere (a sync, a received file): screens re-query. */
export const notifyLibrary = () => notify();

const stampRow = () => {
  const h = syncClock.tick();
  return [h, deviceId] as const;
};

export async function initDatabase() {
  if (db) return;
  db = await Database.load('sqlite:library.db');
  await db.execute('PRAGMA journal_mode = WAL');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration REAL,
      file_path TEXT,
      artwork_path TEXT,
      remote_artwork_url TEXT,
      status TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      genre TEXT,
      liked INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER,
      saved_at INTEGER,
      last_played_at INTEGER,
      play_count INTEGER NOT NULL DEFAULT 0,
      meta_checked_at INTEGER,
      source_title TEXT,
      source_artist TEXT
    )`);
  await db.execute(
    'CREATE INDEX IF NOT EXISTS tracks_title ON tracks (title COLLATE NOCASE)',
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
  );
  await db.execute(
    'CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)',
  );
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id)
    )`);
  // Listening time per song, day and hour (stats). Title and artist are kept
  // too, for songs that were only streamed and aren't in the library.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS listens (
      track_id TEXT NOT NULL,
      day TEXT NOT NULL,
      hour INTEGER NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      plays INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      artist TEXT,
      PRIMARY KEY (track_id, day, hour)
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lyrics (
      track_id TEXT PRIMARY KEY NOT NULL,
      plain TEXT,
      synced TEXT,
      source TEXT,
      checked_at INTEGER NOT NULL
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS karaoke_recordings (
      id TEXT PRIMARY KEY NOT NULL,
      track_id TEXT,
      title TEXT NOT NULL,
      artist TEXT,
      path TEXT NOT NULL,
      duration REAL,
      size_bytes INTEGER,
      created_at INTEGER NOT NULL,
      mode TEXT
    )`);
  for (const r of await select<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  )) {
    settingsCache.set(r.key, r.value);
  }
  deviceId = settingsCache.get('device_id') ?? '';
  if (!deviceId) {
    deviceId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    setSettingSync('device_id', deviceId);
  }
  syncClock = new HybridClock(deviceId);
  // Sync columns added to existing libraries (their data is kept).
  await migrateSyncSchema(syncDb, deviceId);
  syncClock.seed(await newestStamp(syncDb));
}

const toTrack = (r: Row): Track => ({
  id: r.id as string,
  source: r.source as TrackSource,
  sourceId: r.source_id as string,
  title: r.title as string,
  artist: (r.artist as string) ?? null,
  album: (r.album as string) ?? null,
  genre: (r.genre as string) ?? null,
  duration: (r.duration as number) ?? null,
  filePath: (r.file_path as string) ?? null,
  artworkPath: (r.artwork_path as string) ?? null,
  remoteArtworkUrl: (r.remote_artwork_url as string) ?? null,
  status: r.status as TrackStatus,
  liked: !!r.liked,
  sizeBytes: (r.size_bytes as number) ?? null,
  addedAt: Number(r.added_at),
  savedAt: r.saved_at == null ? null : Number(r.saved_at),
  lastPlayedAt: r.last_played_at == null ? null : Number(r.last_played_at),
  playCount: Number(r.play_count ?? 0),
  metaCheckedAt: r.meta_checked_at == null ? null : Number(r.meta_checked_at),
  sourceTitle: (r.source_title as string) ?? null,
  sourceArtist: (r.source_artist as string) ?? null,
  waveform: null,
});

// ---- change notifications (screens re-query when the library changes) ----

const listeners = new Set<() => void>();
export const subscribeLibrary = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
// Coalesced so a scan adding hundreds of files triggers one re-render, not hundreds.
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
const notify = () => {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach(fn => fn());
  }, 150);
};

// ---- tracks ----

export async function getAllTracks(): Promise<Track[]> {
  await writes;
  const rows = await select(
    `SELECT * FROM tracks WHERE ${VISIBLE_TRACK} ORDER BY added_at DESC, title COLLATE NOCASE`,
  );
  return rows.map(toTrack);
}

export async function getTrack(id: string): Promise<Track | null> {
  await writes;
  const rows = await select(
    `SELECT * FROM tracks WHERE id = ? AND ${VISIBLE_TRACK}`,
    [id],
  );
  return rows.length ? toTrack(rows[0]) : null;
}

/** Local search across title, artist, album and genre (ready tracks only). */
export async function searchLibrary(query: string): Promise<Track[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const where = words
    .map(
      () =>
        "(title || ' ' || IFNULL(artist,'') || ' ' || IFNULL(album,'') || ' ' || IFNULL(genre,'')) LIKE ?",
    )
    .join(' AND ');
  const rows = await select(
    `SELECT * FROM tracks WHERE status = 'ready' AND file_path IS NOT NULL AND ${where} ORDER BY title COLLATE NOCASE LIMIT 100`,
    words.map(w => `%${w}%`),
  );
  return rows.map(toTrack);
}

/** Synced columns an upsert of an existing song may change. */
const UPSERT_SYNCED = [
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'remote_artwork_url',
  'size_bytes',
];

export async function upsertTrack(t: Track): Promise<void> {
  await writes;
  // The song came from the other device and waits for its file: only this
  // computer's own columns change (its synced details stay as they are).
  const waiting = await select(
    "SELECT 1 AS x FROM tracks WHERE id = ? AND file_path IS NULL AND status = 'ready'",
    [t.id],
  );
  if (waiting.length) {
    await write('UPDATE tracks SET status = ?, file_path = ? WHERE id = ?', [
      t.status,
      t.filePath,
      t.id,
    ]);
    notify();
    return;
  }
  const [h, by] = stampRow();
  const s = trackStamp(UPSERT_SYNCED, h);
  await write(
    `INSERT INTO tracks (id, source, source_id, title, artist, album, genre, duration, file_path,
                         artwork_path, remote_artwork_url, status, liked, size_bytes,
                         added_at, saved_at, last_played_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, artist = excluded.artist, album = excluded.album,
       genre = IFNULL(excluded.genre, genre), duration = excluded.duration,
       file_path = excluded.file_path, artwork_path = IFNULL(excluded.artwork_path, artwork_path),
       remote_artwork_url = excluded.remote_artwork_url, status = excluded.status,
       size_bytes = IFNULL(excluded.size_bytes, size_bytes), ${s.sql}`,
    [
      t.id,
      t.source,
      t.sourceId,
      t.title,
      t.artist,
      t.album,
      t.genre,
      t.duration,
      t.filePath,
      t.artworkPath,
      t.remoteArtworkUrl,
      t.status,
      t.liked ? 1 : 0,
      t.sizeBytes,
      t.addedAt,
      t.savedAt,
      t.lastPlayedAt,
      h,
      by,
      ...s.params,
    ],
  );
  changed();
}

const COLUMNS: Record<string, string> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  genre: 'genre',
  duration: 'duration',
  filePath: 'file_path',
  artworkPath: 'artwork_path',
  remoteArtworkUrl: 'remote_artwork_url',
  status: 'status',
  liked: 'liked',
  sizeBytes: 'size_bytes',
  savedAt: 'saved_at',
  lastPlayedAt: 'last_played_at',
  metaCheckedAt: 'meta_checked_at',
  sourceTitle: 'source_title',
  sourceArtist: 'source_artist',
};

export async function updateTrack(
  id: string,
  patch: Partial<Omit<Track, 'id' | 'source' | 'sourceId' | 'addedAt'>>,
): Promise<void> {
  const keys = Object.keys(patch).filter(
    k => k in COLUMNS,
  ) as (keyof typeof patch)[];
  if (!keys.length) return;
  // Only synced columns get a new stamp (a file path is this computer's own).
  const cols = keys.map(k => COLUMNS[k]);
  const synced = cols.filter(isSyncedTrackColumn);
  const s = synced.length ? trackStamp(synced, syncClock.tick()) : null;
  await write(
    `UPDATE tracks SET ${cols.map(c => `${c} = ?`).join(', ')}${
      // A new cover: its hash is worked out again (sync/files).
      patch.artworkPath !== undefined ? ', artwork_hash = NULL' : ''
    }${s ? `, ${s.sql}` : ''} WHERE id = ?`,
    [
      ...keys.map(k => {
        const v = patch[k];
        return typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null);
      }),
      ...(s?.params ?? []),
      id,
    ],
  );
  if (s) changed();
  else notify();
}

export async function countPlay(id: string): Promise<void> {
  const s = trackStamp(['play_count'], syncClock.tick());
  await write(`UPDATE tracks SET play_count = play_count + 1, ${s.sql} WHERE id = ?`, [
    ...s.params,
    id,
  ]);
  changed();
}

/** Every song's details get looked up again (a better lookup came). */
export async function clearDetailChecks(): Promise<void> {
  await write('UPDATE tracks SET meta_checked_at = NULL');
}

/** Removes the song everywhere (the other device deletes it too). */
export async function deleteTrackRow(id: string): Promise<void> {
  await writes;
  await batch([
    ...(await bumpPlaylistsOf(syncDb, syncClock, id)),
    ['DELETE FROM tracks WHERE id = ?', [id]],
    ['DELETE FROM playlist_tracks WHERE track_id = ?', [id]],
    tombstoneStatement('tracks', id, syncClock.tick()),
  ]);
  changed();
}

/**
 * A download that failed or was interrupted: gone, unless the song came from
 * the other device (then it waits for its file from there again).
 */
export async function dropFailedDownload(id: string): Promise<void> {
  await writes;
  const rows = await select('SELECT content_hash FROM tracks WHERE id = ?', [id]);
  if (rows[0]?.content_hash) {
    await write("UPDATE tracks SET status = 'ready', file_path = NULL WHERE id = ?", [id]);
    notify();
  } else {
    await deleteTrackRow(id);
  }
}

export async function getTracksByStatus(status: TrackStatus): Promise<Track[]> {
  await writes;
  const rows = await select(
    `SELECT * FROM tracks WHERE status = ? AND ${VISIBLE_TRACK}`,
    [status],
  );
  return rows.map(toTrack);
}

/**
 * A file found on the computer for a song that came from the other device and
 * waits for its file: now it has one. Returns false if no song waits.
 */
export async function attachFile(id: string, path: string): Promise<boolean> {
  const res = await write(
    "UPDATE tracks SET file_path = ? WHERE id = ? AND file_path IS NULL AND status = 'ready'",
    [path, id],
  );
  if (res.rowsAffected) notify();
  return !!res.rowsAffected;
}

/** Songs from the computer's own folders, by file path. */
export async function getDeviceTrackPaths(): Promise<Map<string, string>> {
  await writes;
  const rows = await select(
    "SELECT id, file_path FROM tracks WHERE source = 'device' AND file_path IS NOT NULL",
  );
  return new Map(rows.map(r => [r.file_path as string, r.id as string]));
}

/** Bytes used by songs the app downloaded (what the storage limit applies to). */
export async function getDownloadedBytes(): Promise<number> {
  await writes;
  const rows = await select(
    "SELECT IFNULL(SUM(size_bytes), 0) AS total FROM tracks WHERE source != 'device' AND status = 'ready' AND file_path IS NOT NULL",
  );
  return Number(rows[0]?.total ?? 0);
}

// ---- playlists ----

export async function getPlaylists(): Promise<Playlist[]> {
  await writes;
  const lists = await select('SELECT * FROM playlists ORDER BY created_at');
  const items = await select(
    'SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position',
  );
  const byList = new Map<string, string[]>();
  for (const r of items) {
    const pid = r.playlist_id as string;
    if (!byList.has(pid)) byList.set(pid, []);
    byList.get(pid)!.push(r.track_id as string);
  }
  return lists.map(r => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: Number(r.created_at),
    trackIds: byList.get(r.id as string) ?? [],
  }));
}

export async function createPlaylist(
  name: string,
  trackIds: string[] = [],
): Promise<string> {
  // The device in the id: playlists made on both devices at once never clash.
  const id = `p${Date.now()}-${deviceId.slice(0, 6)}`;
  await write(
    'INSERT INTO playlists (id, name, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)',
    [id, name, Date.now(), ...stampRow()],
  );
  for (const [i, tid] of trackIds.entries()) {
    await write(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [id, tid, i],
    );
  }
  changed();
  return id;
}

export async function deletePlaylist(id: string): Promise<void> {
  await batch([
    ['DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]],
    ['DELETE FROM playlists WHERE id = ?', [id]],
    tombstoneStatement('playlists', id, syncClock.tick()),
  ]);
  changed();
}

/** A playlist's songs changed: the whole playlist syncs as one. */
const bumpPlaylist = (id: string) =>
  batch([bumpPlaylistStatement(id, syncClock.tick())]);

/** Adds the track to the playlist, or removes it if it's already there. Returns true if added. */
export async function togglePlaylistTrack(
  playlistId: string,
  trackId: string,
): Promise<boolean> {
  await writes;
  const has = await select(
    'SELECT 1 AS x FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId],
  );
  if (has.length) {
    await write(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [playlistId, trackId],
    );
    await bumpPlaylist(playlistId);
    changed();
    return false;
  }
  const pos = await select(
    'SELECT IFNULL(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId],
  );
  await write(
    'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    [playlistId, trackId, Number(pos[0]?.p ?? 0)],
  );
  await bumpPlaylist(playlistId);
  changed();
  return true;
}

/** Adds the tracks that aren't in the playlist yet, at the end. Returns how many were added. */
export async function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[],
): Promise<number> {
  await writes;
  const pos = await select(
    'SELECT IFNULL(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId],
  );
  let next = Number(pos[0]?.p ?? 0);
  let added = 0;
  for (const tid of trackIds) {
    const res = await write(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [playlistId, tid, next],
    );
    if (res.rowsAffected) {
      next++;
      added++;
    }
  }
  if (added) {
    await bumpPlaylist(playlistId);
    changed();
  }
  return added;
}

/**
 * Puts the playlist's songs in this order. Songs of the playlist that aren't
 * in `trackIds` (no longer in the library) keep their place at the end.
 */
export async function setPlaylistOrder(
  playlistId: string,
  trackIds: string[],
): Promise<void> {
  await writes;
  const rows = await select(
    'SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position',
    [playlistId],
  );
  const all = rows.map(r => r.track_id as string);
  const order = [
    ...trackIds.filter(id => all.includes(id)),
    ...all.filter(id => !trackIds.includes(id)),
  ];
  for (const [i, id] of order.entries()) {
    await write(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
      [i, playlistId, id],
    );
  }
  await bumpPlaylist(playlistId);
  changed();
}

// ---- listening stats ----

/** Adds listening time (and plays) to the song's row for this hour. */
export async function addListening(
  track: { id: string; title: string; artist: string | null },
  seconds: number,
  plays: number,
): Promise<void> {
  const now = new Date();
  // This computer's own row: the other device's listening stays in its own rows.
  await write(
    `INSERT INTO listens (device_id, track_id, day, hour, seconds, plays, title, artist, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, track_id, day, hour) DO UPDATE SET
       seconds = seconds + excluded.seconds, plays = plays + excluded.plays,
       title = excluded.title, artist = excluded.artist,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [
      deviceId,
      track.id,
      dayKey(now),
      now.getHours(),
      seconds,
      plays,
      track.title,
      track.artist,
      ...stampRow(),
    ],
  );
  localChange();
}

export interface ListenRow {
  trackId: string;
  day: string;
  hour: number;
  seconds: number;
  plays: number;
  title: string;
  artist: string | null;
  genre: string | null;
}

/**
 * Listening rows since a day (inclusive), with the library's current names.
 * Every device's rows are added up (each keeps its own, so nothing counts twice).
 */
export async function getListens(since: string | null): Promise<ListenRow[]> {
  await writes;
  const rows = await select(
    `SELECT l.track_id, l.day, l.hour, l.seconds, l.plays,
            COALESCE(t.title, l.title) AS title, COALESCE(t.artist, l.artist) AS artist,
            t.genre AS genre
     FROM (SELECT track_id, day, hour, SUM(seconds) AS seconds, SUM(plays) AS plays,
                  MAX(title) AS title, MAX(artist) AS artist
           FROM listens WHERE ? IS NULL OR day >= ?
           GROUP BY track_id, day, hour) l
     LEFT JOIN tracks t ON t.id = l.track_id`,
    [since, since],
  );
  return rows.map(r => ({
    trackId: r.track_id as string,
    day: r.day as string,
    hour: Number(r.hour),
    seconds: Number(r.seconds),
    plays: Number(r.plays),
    title: (r.title as string) ?? tr('system.unknownSong'),
    artist: (r.artist as string) ?? null,
    genre: (r.genre as string) ?? null,
  }));
}

/** Every day with some listening, oldest first (for streaks). */
export async function getListenDays(): Promise<string[]> {
  const rows = await select(
    'SELECT day FROM listens GROUP BY day HAVING SUM(seconds) > 0 ORDER BY day',
  );
  return rows.map(r => r.day as string);
}

// ---- settings (in memory, written through) ----

export function getSettingSync(key: string): string | null {
  return settingsCache.get(key) ?? null;
}

export function setSettingSync(key: string, value: string): void {
  settingsCache.set(key, value);
  write(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  ).catch(e => console.warn('Saving a setting failed', e));
}

// ---- lyrics ----

export interface LyricsRow {
  plain: string | null;
  /** LRC text ("[mm:ss.xx] line"), when timed lyrics were found. */
  synced: string | null;
  source: string | null;
  /** When they were looked up (also set when nothing was found). */
  checkedAt: number;
}

export async function getLyricsRow(trackId: string): Promise<LyricsRow | null> {
  await writes;
  const rows = await select('SELECT * FROM lyrics WHERE track_id = ?', [
    trackId,
  ]);
  const r = rows[0];
  if (!r) return null;
  return {
    plain: (r.plain as string) ?? null,
    synced: (r.synced as string) ?? null,
    source: (r.source as string) ?? null,
    checkedAt: Number(r.checked_at),
  };
}

export async function saveLyricsRow(
  trackId: string,
  row: LyricsRow,
): Promise<void> {
  await write(
    'INSERT OR REPLACE INTO lyrics (track_id, plain, synced, source, checked_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [trackId, row.plain, row.synced, row.source, row.checkedAt, ...stampRow()],
  );
  localChange();
}

// ---- karaoke recordings (services/karaokeRecordings) ----

export interface RecordingRow {
  id: string;
  /** The song it was sung over (null when it couldn't be told, e.g. a file found in the folder). */
  trackId: string | null;
  /** The song's title and artist when it was recorded. */
  title: string;
  artist: string | null;
  path: string;
  /** Seconds. */
  duration: number | null;
  sizeBytes: number | null;
  createdAt: number;
  /** How it was sung: over the instrumental or the song as it is (null: unknown, found in the folder). */
  mode: 'instrumental' | 'original' | null;
}

const toRecording = (r: Row): RecordingRow => ({
  id: r.id as string,
  trackId: (r.track_id as string) ?? null,
  title: r.title as string,
  artist: (r.artist as string) ?? null,
  path: r.path as string,
  duration: (r.duration as number) ?? null,
  sizeBytes: (r.size_bytes as number) ?? null,
  createdAt: Number(r.created_at),
  mode: (r.mode as RecordingRow['mode']) ?? null,
});

/** Recordings on this computer (ones from the other device show once their file is here). */
export async function getRecordings(): Promise<RecordingRow[]> {
  await writes;
  const rows = await select(
    "SELECT * FROM karaoke_recordings WHERE path != '' ORDER BY created_at DESC",
  );
  return rows.map(toRecording);
}

export async function addRecording(r: RecordingRow): Promise<void> {
  await write(
    'INSERT OR REPLACE INTO karaoke_recordings (id, track_id, title, artist, path, duration, size_bytes, created_at, mode, file_name, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      r.id,
      r.trackId,
      r.title,
      r.artist,
      r.path,
      r.duration,
      r.sizeBytes,
      r.createdAt,
      r.mode,
      baseName(r.path),
      ...stampRow(),
    ],
  );
  changed();
}

/** Renamed (the new name syncs; the path itself is this computer's own). */
export async function setRecordingPath(id: string, path: string) {
  await write(
    'UPDATE karaoke_recordings SET path = ?, file_name = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    [path, baseName(path), ...stampRow(), id],
  );
  changed();
}

export async function deleteRecordingRow(id: string): Promise<void> {
  await batch([
    ['DELETE FROM karaoke_recordings WHERE id = ?', [id]],
    tombstoneStatement('karaoke_recordings', id, syncClock.tick()),
  ]);
  changed();
}
