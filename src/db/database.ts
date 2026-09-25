import { open, type Scalar } from '@op-engineering/op-sqlite';
import type { Playlist, Track, TrackSource, TrackStatus } from '../types';

const db = open({ name: 'library.db' });

db.executeSync(`
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
    added_at INTEGER NOT NULL
  );
`);

// Columns added after the first version: add them to existing databases.
const MIGRATIONS: Array<[string, string]> = [
  ['genre', 'TEXT'],
  ['liked', 'INTEGER NOT NULL DEFAULT 0'],
  ['size_bytes', 'INTEGER'],
  ['saved_at', 'INTEGER'],
  ['last_played_at', 'INTEGER'],
  ['waveform', 'TEXT'],
  ['play_count', 'INTEGER NOT NULL DEFAULT 0'],
];
const existing = new Set(
  db.executeSync('PRAGMA table_info(tracks)').rows.map(r => r.name as string),
);
for (const [col, type] of MIGRATIONS) {
  if (!existing.has(col)) {
    db.executeSync(`ALTER TABLE tracks ADD COLUMN ${col} ${type}`);
  }
}

db.executeSync(
  'CREATE INDEX IF NOT EXISTS tracks_title ON tracks (title COLLATE NOCASE);',
);
db.executeSync(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`);
db.executeSync(`
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
db.executeSync(`
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id TEXT NOT NULL,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );
`);

// Lyrics per song id (library or stream-only), kept apart so loading the library stays light.
db.executeSync(`
  CREATE TABLE IF NOT EXISTS lyrics (
    track_id TEXT PRIMARY KEY NOT NULL,
    plain TEXT,
    synced TEXT,
    source TEXT,
    checked_at INTEGER NOT NULL
  );
`);

type Row = Record<string, Scalar>;

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
  addedAt: r.added_at as number,
  savedAt: (r.saved_at as number) ?? null,
  lastPlayedAt: (r.last_played_at as number) ?? null,
  playCount: (r.play_count as number) ?? 0,
  waveform: r.waveform ? (r.waveform as string).split(',').map(Number) : null,
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
  const res = await db.execute(
    'SELECT * FROM tracks ORDER BY added_at DESC, title COLLATE NOCASE',
  );
  return res.rows.map(toTrack);
}

export async function getTrack(id: string): Promise<Track | null> {
  const res = await db.execute('SELECT * FROM tracks WHERE id = ?', [id]);
  return res.rows.length ? toTrack(res.rows[0]) : null;
}

/** Local search across title, artist, album and genre (ready tracks only). */
export async function searchLibrary(query: string): Promise<Track[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // Every word must match one of the fields: "daft punk around" finds "Around the World — Daft Punk".
  const where = words
    .map(
      () =>
        "(title || ' ' || IFNULL(artist,'') || ' ' || IFNULL(album,'') || ' ' || IFNULL(genre,'')) LIKE ?",
    )
    .join(' AND ');
  const res = await db.execute(
    `SELECT * FROM tracks WHERE status = 'ready' AND ${where} ORDER BY title COLLATE NOCASE LIMIT 100`,
    words.map(w => `%${w}%`),
  );
  return res.rows.map(toTrack);
}

export async function upsertTrack(t: Track): Promise<void> {
  await db.execute(
    `INSERT INTO tracks (id, source, source_id, title, artist, album, genre, duration, file_path,
                         artwork_path, remote_artwork_url, status, liked, size_bytes,
                         added_at, saved_at, last_played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, artist = excluded.artist, album = excluded.album,
       genre = IFNULL(excluded.genre, genre), duration = excluded.duration,
       file_path = excluded.file_path, artwork_path = IFNULL(excluded.artwork_path, artwork_path),
       remote_artwork_url = excluded.remote_artwork_url, status = excluded.status,
       size_bytes = IFNULL(excluded.size_bytes, size_bytes)`,
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
    ],
  );
  notify();
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
  waveform: 'waveform',
};

export async function updateTrack(
  id: string,
  patch: Partial<Omit<Track, 'id' | 'source' | 'sourceId' | 'addedAt'>>,
): Promise<void> {
  const keys = Object.keys(patch).filter(
    k => k in COLUMNS,
  ) as (keyof typeof patch)[];
  if (!keys.length) return;
  await db.execute(
    `UPDATE tracks SET ${keys
      .map(k => `${COLUMNS[k]} = ?`)
      .join(', ')} WHERE id = ?`,
    [
      ...keys.map(k => {
        const v = patch[k];
        if (Array.isArray(v)) return v.join(','); // waveform
        return (typeof v === 'boolean' ? (v ? 1 : 0) : v ?? null) as Scalar;
      }),
      id,
    ],
  );
  notify();
}

export async function countPlay(id: string): Promise<void> {
  await db.execute(
    'UPDATE tracks SET play_count = play_count + 1 WHERE id = ?',
    [id],
  );
  notify();
}

export async function deleteTrackRow(id: string): Promise<void> {
  await db.execute('DELETE FROM tracks WHERE id = ?', [id]);
  await db.execute('DELETE FROM playlist_tracks WHERE track_id = ?', [id]);
  notify();
}

export async function getTracksByStatus(status: TrackStatus): Promise<Track[]> {
  const res = await db.execute('SELECT * FROM tracks WHERE status = ?', [
    status,
  ]);
  return res.rows.map(toTrack);
}

export async function getDeviceTrackIds(): Promise<Set<string>> {
  const res = await db.execute("SELECT id FROM tracks WHERE source = 'device'");
  return new Set(res.rows.map(r => r.id as string));
}

/** Bytes used by songs the app downloaded (what the storage limit applies to). */
export async function getDownloadedBytes(): Promise<number> {
  const res = await db.execute(
    "SELECT IFNULL(SUM(size_bytes), 0) AS total FROM tracks WHERE source != 'device' AND status = 'ready'",
  );
  return Number(res.rows[0]?.total ?? 0);
}

// ---- playlists ----

export async function getPlaylists(): Promise<Playlist[]> {
  const lists = await db.execute('SELECT * FROM playlists ORDER BY created_at');
  const items = await db.execute(
    'SELECT playlist_id, track_id FROM playlist_tracks ORDER BY position',
  );
  const byList = new Map<string, string[]>();
  for (const r of items.rows) {
    const pid = r.playlist_id as string;
    if (!byList.has(pid)) byList.set(pid, []);
    byList.get(pid)!.push(r.track_id as string);
  }
  return lists.rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    createdAt: r.created_at as number,
    trackIds: byList.get(r.id as string) ?? [],
  }));
}

export async function createPlaylist(
  name: string,
  trackIds: string[] = [],
): Promise<string> {
  const id = `p${Date.now()}`;
  await db.execute(
    'INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)',
    [id, name, Date.now()],
  );
  for (const [i, tid] of trackIds.entries()) {
    await db.execute(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [id, tid, i],
    );
  }
  notify();
  return id;
}

export async function deletePlaylist(id: string): Promise<void> {
  await db.execute('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]);
  await db.execute('DELETE FROM playlists WHERE id = ?', [id]);
  notify();
}

/** Adds the track to the playlist, or removes it if it's already there. Returns true if added. */
export async function togglePlaylistTrack(
  playlistId: string,
  trackId: string,
): Promise<boolean> {
  const has = await db.execute(
    'SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId],
  );
  if (has.rows.length) {
    await db.execute(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [playlistId, trackId],
    );
    notify();
    return false;
  }
  const pos = await db.execute(
    'SELECT IFNULL(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId],
  );
  await db.execute(
    'INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
    [playlistId, trackId, Number(pos.rows[0]?.p ?? 0)],
  );
  notify();
  return true;
}

/** Adds the tracks that aren't in the playlist yet, at the end. Returns how many were added. */
export async function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[],
): Promise<number> {
  const pos = await db.execute(
    'SELECT IFNULL(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId],
  );
  let next = Number(pos.rows[0]?.p ?? 0);
  let added = 0;
  for (const tid of trackIds) {
    const res = await db.execute(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [playlistId, tid, next],
    );
    if (res.rowsAffected) {
      next++;
      added++;
    }
  }
  if (added) notify();
  return added;
}

// ---- settings ----

export function getSettingSync(key: string): string | null {
  const res = db.executeSync('SELECT value FROM settings WHERE key = ?', [key]);
  return res.rows.length ? (res.rows[0].value as string) : null;
}

export function setSettingSync(key: string, value: string): void {
  db.executeSync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
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
  const res = await db.execute('SELECT * FROM lyrics WHERE track_id = ?', [
    trackId,
  ]);
  const r = res.rows[0];
  if (!r) return null;
  return {
    plain: (r.plain as string) ?? null,
    synced: (r.synced as string) ?? null,
    source: (r.source as string) ?? null,
    checkedAt: r.checked_at as number,
  };
}

export async function saveLyricsRow(
  trackId: string,
  row: LyricsRow,
): Promise<void> {
  await db.execute(
    'INSERT OR REPLACE INTO lyrics (track_id, plain, synced, source, checked_at) VALUES (?, ?, ?, ?, ?)',
    [trackId, row.plain, row.synced, row.source, row.checkedAt],
  );
}
