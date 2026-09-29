/**
 * Sync on top of the library database: schema migration, reading the changes
 * the other device hasn't seen, and applying its changes with the merge rules.
 * Both apps run the same SQL through a small adapter (op-sqlite on the phone,
 * tauri-plugin-sql on the computer).
 *
 * SHARED FILE: canonical copy in src/sync/core, byte-identical copy in
 * desktop/src/core/sync/core.
 */
import { hlcDevice, maxHlc, type HybridClock } from './hlc';
import { mergeRow, mergeTombstone, mergeTrack } from './merge';
import {
  RECORDING_FIELDS,
  TRACK_FIELDS,
  emptyChanges,
  listenKey,
  localTrackId,
  parseListenKey,
  type ChangeSet,
  type ListenRow,
  type LyricsRow,
  type PlaylistRow,
  type RecordingRow,
  type Scalar,
  type SettingRow,
  type SyncTable,
  type Tombstone,
  type TrackRow,
} from './model';
import { PAGE_SIZE } from './protocol';

export type Row = Record<string, Scalar>;
export type Statement = [string, Scalar[]];

export interface SqlDb {
  all(sql: string, params?: Scalar[]): Promise<Row[]>;
  run(sql: string, params?: Scalar[]): Promise<void>;
  /** Runs the statements in order (in one transaction where the driver can). */
  batch(statements: Statement[]): Promise<void>;
}

/** Tracks the app shows: a synced song waits hidden until its file arrives. */
export const VISIBLE_TRACK = "(file_path IS NOT NULL OR status != 'ready')";

// ---- migration ----

export async function migrateSyncSchema(db: SqlDb, deviceId: string) {
  const columns = async (t: string) =>
    new Set((await db.all(`PRAGMA table_info(${t})`)).map(r => r.name as string));
  const add = async (t: string, cols: [string, string][]) => {
    const have = await columns(t);
    for (const [c, type] of cols) {
      if (!have.has(c)) await db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`);
    }
  };
  const stamps: [string, string][] = [
    ['updated_at', 'TEXT'],
    ['updated_by', 'TEXT'],
  ];
  await add('tracks', [
    ['content_hash', 'TEXT'],
    ['artwork_hash', 'TEXT'],
    ['field_hlc', 'TEXT'],
    ...stamps,
  ]);
  await add('playlists', stamps);
  await add('lyrics', stamps);
  await add('karaoke_recordings', [
    ['content_hash', 'TEXT'],
    ['mode', 'TEXT'],
    ['file_name', 'TEXT'],
    ...stamps,
  ]);
  if (!(await columns('listens')).has('device_id')) {
    // The key gains the device: each device writes only its own rows.
    await db.batch([
      [
        `CREATE TABLE listens_v2 (
          device_id TEXT NOT NULL,
          track_id TEXT NOT NULL,
          day TEXT NOT NULL,
          hour INTEGER NOT NULL,
          seconds REAL NOT NULL DEFAULT 0,
          plays INTEGER NOT NULL DEFAULT 0,
          title TEXT,
          artist TEXT,
          updated_at TEXT,
          updated_by TEXT,
          PRIMARY KEY (device_id, track_id, day, hour)
        )`,
        [],
      ],
      [
        `INSERT INTO listens_v2 (device_id, track_id, day, hour, seconds, plays, title, artist)
         SELECT ?, track_id, day, hour, seconds, plays, title, artist FROM listens`,
        [deviceId],
      ],
      ['DROP TABLE listens', []],
      ['ALTER TABLE listens_v2 RENAME TO listens', []],
    ]);
  }
  await db.run(`CREATE TABLE IF NOT EXISTS deleted (
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    hlc TEXT NOT NULL,
    PRIMARY KEY (tbl, id)
  )`);
  const indexes: [string, string][] = [
    ['tracks', 'updated_at'],
    ['tracks', 'content_hash'],
    ['tracks', 'artwork_hash'],
    ['playlists', 'updated_at'],
    ['listens', 'updated_at'],
    ['lyrics', 'updated_at'],
    ['karaoke_recordings', 'updated_at'],
    ['deleted', 'hlc'],
  ];
  for (const [t, c] of indexes) {
    await db.run(`CREATE INDEX IF NOT EXISTS ${t}_${c} ON ${t} (${c})`);
  }
  // Rows from before sync get "genesis" stamps (time 1, unique per row).
  for (const t of ['tracks', 'playlists', 'listens', 'lyrics', 'karaoke_recordings']) {
    await db.run(
      `UPDATE ${t} SET updated_at = printf('%013d-%06x-%s', 1, rowid % 16777216, ?), updated_by = ?
       WHERE updated_at IS NULL`,
      [deviceId, deviceId],
    );
  }
  for (const r of await db.all(
    'SELECT id, path FROM karaoke_recordings WHERE file_name IS NULL',
  )) {
    await db.run('UPDATE karaoke_recordings SET file_name = ? WHERE id = ?', [
      baseName(String(r.path ?? '')),
      r.id,
    ]);
  }
}

/** The newest stamp stored anywhere (the clock continues after it). */
export async function newestStamp(db: SqlDb): Promise<string> {
  const rows = await db.all(
    `SELECT MAX(h) AS h FROM (
       SELECT MAX(updated_at) AS h FROM tracks UNION ALL
       SELECT MAX(updated_at) FROM playlists UNION ALL
       SELECT MAX(updated_at) FROM listens UNION ALL
       SELECT MAX(updated_at) FROM lyrics UNION ALL
       SELECT MAX(updated_at) FROM karaoke_recordings UNION ALL
       SELECT MAX(hlc) FROM deleted)`,
  );
  return (rows[0]?.h as string) ?? '';
}

// ---- helpers for the apps' own writes ----

const deviceOf = hlcDevice;

/**
 * SET clause for a local edit of some track columns: the row's stamp and
 * each edited field's own stamp. (Other fields keep theirs: field_hlc is
 * filled in from the old updated_at the first time.)
 */
export function trackStamp(
  columns: string[],
  hlc: string,
): { sql: string; params: Scalar[] } {
  const synced = columns.filter(c => (TRACK_FIELDS as readonly string[]).includes(c));
  const full = `json_object(${TRACK_FIELDS.map(f => `'${f}', updated_at`).join(', ')})`;
  const sets = synced.map(c => `'$.${c}', ?`).join(', ');
  return {
    sql: `updated_at = ?, updated_by = ?, field_hlc = ${
      synced.length ? `json_set(COALESCE(field_hlc, ${full}), ${sets})` : 'field_hlc'
    }`,
    params: [hlc, deviceOf(hlc), ...synced.map(() => hlc)],
  };
}

export const isSyncedTrackColumn = (c: string) =>
  (TRACK_FIELDS as readonly string[]).includes(c);

export const tombstoneStatement = (tbl: SyncTable, id: string, hlc: string): Statement => [
  `INSERT INTO deleted (tbl, id, hlc) VALUES (?, ?, ?)
   ON CONFLICT(tbl, id) DO UPDATE SET hlc = excluded.hlc WHERE excluded.hlc > deleted.hlc`,
  [tbl, id, hlc],
];

export const bumpPlaylistStatement = (id: string, hlc: string): Statement => [
  'UPDATE playlists SET updated_at = ?, updated_by = ? WHERE id = ?',
  [hlc, deviceOf(hlc), id],
];

/** Every playlist holding the track gets a new stamp (its song list changes). */
export async function bumpPlaylistsOf(
  db: SqlDb,
  clock: HybridClock,
  trackId: string,
): Promise<Statement[]> {
  const rows = await db.all(
    'SELECT DISTINCT playlist_id FROM playlist_tracks WHERE track_id = ?',
    [trackId],
  );
  return rows.map(r => bumpPlaylistStatement(r.playlist_id as string, clock.tick()));
}

// ---- reading changes for the other device ----

const q = (n: number) => Array(n).fill('?').join(', ');

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function parseFieldHlc(v: Scalar): TrackRow['field_hlc'] {
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function toTrackRow(r: Row): TrackRow {
  const out = { id: r.id as string } as TrackRow;
  for (const f of TRACK_FIELDS) (out as Record<string, Scalar>)[f] = r[f] ?? null;
  out.updated_at = r.updated_at as string;
  out.updated_by = r.updated_by as string;
  out.field_hlc = parseFieldHlc(r.field_hlc);
  return out;
}

const TRACK_COLUMNS = `id, ${TRACK_FIELDS.join(', ')}, updated_at, updated_by, field_hlc`;
const RECORDING_COLUMNS = `id, ${RECORDING_FIELDS.join(', ')}, updated_at, updated_by`;
const LISTEN_COLUMNS =
  'device_id, track_id, day, hour, seconds, plays, title, artist, updated_at, updated_by';
const LYRICS_COLUMNS =
  'track_id, plain, synced, source, checked_at, updated_at, updated_by';

export interface ChangePage {
  changes: ChangeSet;
  /** Resume after this stamp (null: nothing new). */
  cursor: string | null;
  more: boolean;
}

/**
 * Changes since `since` that the other device (`peer`) didn't write itself,
 * one page at a time. `settings` are the synced settings as they are now.
 */
export async function collectChanges(
  db: SqlDb,
  since: string,
  peer: string,
  settings: SettingRow[] = [],
  limit = PAGE_SIZE,
): Promise<ChangePage> {
  const page = async (sql: string) =>
    db.all(`${sql} AND updated_at > ? AND updated_by != ? ORDER BY updated_at LIMIT ?`, [
      since,
      peer,
      limit,
    ]);
  const tracks = (
    await page(
      `SELECT ${TRACK_COLUMNS} FROM tracks WHERE content_hash IS NOT NULL AND status = 'ready'`,
    )
  ).map(toTrackRow);
  const playlistRows = await page(
    'SELECT id, name, created_at, updated_at, updated_by FROM playlists WHERE 1',
  );
  const listens = (await page(`SELECT ${LISTEN_COLUMNS} FROM listens WHERE 1`)).map(
    r => ({ ...r, hour: Number(r.hour), seconds: Number(r.seconds), plays: Number(r.plays) }) as unknown as ListenRow,
  );
  const lyrics = (await page(`SELECT ${LYRICS_COLUMNS} FROM lyrics WHERE 1`)) as unknown as LyricsRow[];
  const recordings = (await page(
    `SELECT ${RECORDING_COLUMNS} FROM karaoke_recordings WHERE content_hash IS NOT NULL`,
  )) as unknown as RecordingRow[];
  const deleted = (
    await db.all(
      'SELECT tbl, id, hlc FROM deleted WHERE hlc > ? AND substr(hlc, 22) != ? ORDER BY hlc LIMIT ?',
      [since, peer, limit],
    )
  ).map(r => ({ tbl: r.tbl, id: r.id, hlc: r.hlc }) as Tombstone);

  const stampOf = (r: { updated_at?: string; hlc?: string }) => (r.updated_at ?? r.hlc)!;
  const parts: { updated_at?: string; hlc?: string }[][] = [
    tracks,
    playlistRows as never,
    listens,
    lyrics,
    recordings,
    deleted,
  ];
  // A page ends at the earliest last stamp among the tables that were cut
  // short; everything up to it is complete (stamps are unique per table).
  let cursor: string | null = null;
  let more = false;
  for (const rows of parts) {
    if (rows.length >= limit) {
      more = true;
      const last = stampOf(rows[rows.length - 1]);
      if (cursor === null || last < cursor) cursor = last;
    }
  }
  const keep = <T extends { updated_at?: string; hlc?: string }>(rows: T[]) =>
    cursor === null ? rows : rows.filter(r => stampOf(r) <= cursor!);

  const changes = emptyChanges();
  changes.tracks = keep(tracks);
  const lists = keep(playlistRows as unknown as { updated_at: string }[]) as unknown as Row[];
  if (lists.length) {
    const items: Row[] = [];
    for (const ids of chunks(lists.map(l => l.id as string), 400)) {
      items.push(
        ...(await db.all(
          `SELECT playlist_id, track_id FROM playlist_tracks WHERE playlist_id IN (${q(ids.length)}) ORDER BY position`,
          ids,
        )),
      );
    }
    changes.playlists = lists.map(l => ({
      id: l.id as string,
      name: l.name as string,
      created_at: Number(l.created_at),
      tracks: items.filter(i => i.playlist_id === l.id).map(i => i.track_id as string),
      updated_at: l.updated_at as string,
      updated_by: l.updated_by as string,
    }));
  }
  changes.listens = keep(listens);
  changes.lyrics = keep(lyrics);
  changes.recordings = keep(recordings);
  changes.deleted = keep(deleted);
  changes.settings = settings.filter(
    s =>
      s.updated_at > since &&
      deviceOf(s.updated_at) !== peer &&
      (cursor === null || s.updated_at <= cursor),
  );
  if (!more) {
    const all = [...parts.flat().map(stampOf), ...changes.settings.map(s => s.updated_at)];
    cursor = all.length ? maxHlc(...all) : null;
  }
  return { changes, cursor, more };
}

// ---- applying the other device's changes ----

export interface ApplyResult {
  /** Rows written or removed. */
  changed: number;
  /** Songs deleted on the other device: their local files (the app removes the ones it manages). */
  removedTracks: { id: string; source: string; file_path: string | null; artwork_path: string | null }[];
  removedRecordings: { id: string; path: string }[];
  /** Recordings renamed on the other device: the local file to rename. */
  renamedRecordings: { id: string; path: string; file_name: string }[];
  /** The language, when the other device's choice is newer. */
  language: SettingRow | null;
}

async function stampsByKey(
  db: SqlDb,
  table: string,
  keyCol: string,
  keys: string[],
  extra = '',
): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (const part of chunks([...new Set(keys)], 400)) {
    for (const r of await db.all(
      `SELECT * FROM ${table} WHERE ${keyCol} IN (${q(part.length)})${extra}`,
      part,
    )) {
      out.set(String(r[keyCol]), r);
    }
  }
  return out;
}

async function tombstonesFor(db: SqlDb, tbl: SyncTable, ids: string[]) {
  const out = new Map<string, string>();
  for (const part of chunks([...new Set(ids)], 400)) {
    for (const r of await db.all(
      `SELECT id, hlc FROM deleted WHERE tbl = ? AND id IN (${q(part.length)})`,
      [tbl, ...part],
    )) {
      out.set(r.id as string, r.hlc as string);
    }
  }
  return out;
}

async function listenStamps(db: SqlDb, keys: string[]) {
  const out = new Map<string, string>();
  const parsed = keys.map(parseListenKey).filter(x => !!x);
  for (const part of chunks(parsed, 200)) {
    const rows = await db.all(
      `SELECT device_id, track_id, day, hour, updated_at FROM listens
       WHERE (device_id, track_id, day, hour) IN (VALUES ${part.map(() => '(?, ?, ?, ?)').join(', ')})`,
      part.flatMap(k => [k.device_id, k.track_id, k.day, k.hour]),
    );
    for (const r of rows) {
      out.set(
        listenKey({
          device_id: r.device_id as string,
          track_id: r.track_id as string,
          day: r.day as string,
          hour: Number(r.hour),
        }),
        r.updated_at as string,
      );
    }
  }
  return out;
}

const untombstone = (tbl: SyncTable, id: string): Statement => [
  'DELETE FROM deleted WHERE tbl = ? AND id = ?',
  [tbl, id],
];

function upsertTrackStatement(t: TrackRow): Statement {
  const cols = [...TRACK_FIELDS, 'updated_at', 'updated_by', 'field_hlc'];
  return [
    `INSERT INTO tracks (id, status, file_path, ${cols.join(', ')})
     VALUES (?, 'ready', NULL, ${q(cols.length)})
     ON CONFLICT(id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`,
    [
      t.id,
      ...TRACK_FIELDS.map(f => t[f] ?? null),
      t.updated_at,
      t.updated_by,
      JSON.stringify(t.field_hlc ?? {}),
    ],
  ];
}

/**
 * Merges the other device's changes into the database. `language` is the
 * synced language as it is here now.
 */
export async function applyChanges(
  db: SqlDb,
  clock: HybridClock,
  cs: ChangeSet,
  language: SettingRow | null = null,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    changed: 0,
    removedTracks: [],
    removedRecordings: [],
    renamedRecordings: [],
    language: null,
  };
  const st: Statement[] = [];

  // Tracks.
  if (cs.tracks.length) {
    const ids = cs.tracks.map(t => t.id);
    const local = await stampsByKey(db, 'tracks', 'id', ids);
    const tombs = await tombstonesFor(db, 'tracks', ids);
    for (const remote of cs.tracks) {
      const raw = local.get(remote.id);
      const merged = mergeTrack(raw ? toTrackRow(raw) : null, remote, tombs.get(remote.id) ?? null);
      if (!merged) continue;
      st.push(upsertTrackStatement(merged));
      if (tombs.has(remote.id)) st.push(untombstone('tracks', remote.id));
      result.changed++;
    }
  }

  // Playlists (with their songs).
  if (cs.playlists.length) {
    const ids = cs.playlists.map(p => p.id);
    const local = await stampsByKey(db, 'playlists', 'id', ids);
    const tombs = await tombstonesFor(db, 'playlists', ids);
    for (const remote of cs.playlists) {
      const raw = local.get(remote.id);
      const mine = raw ? ({ updated_at: raw.updated_at as string } as PlaylistRow) : null;
      if (!mergeRow(mine, remote, tombs.get(remote.id) ?? null)) continue;
      st.push(
        [
          'INSERT OR REPLACE INTO playlists (id, name, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)',
          [remote.id, remote.name, remote.created_at, remote.updated_at, remote.updated_by],
        ],
        ['DELETE FROM playlist_tracks WHERE playlist_id = ?', [remote.id]],
        ...remote.tracks.map(
          (tid, i): Statement => [
            'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
            [remote.id, tid, i],
          ],
        ),
      );
      if (tombs.has(remote.id)) st.push(untombstone('playlists', remote.id));
      result.changed++;
    }
  }

  // Listens: each device's own rows, replaced by newer versions (never added up twice).
  if (cs.listens.length) {
    const keys = cs.listens.map(listenKey);
    const local = await listenStamps(db, keys);
    const tombs = await tombstonesFor(db, 'listens', keys);
    for (const remote of cs.listens) {
      const key = listenKey(remote);
      const at = local.get(key);
      const mine = at ? ({ updated_at: at } as ListenRow) : null;
      if (!mergeRow(mine, remote, tombs.get(key) ?? null)) continue;
      st.push([
        `INSERT OR REPLACE INTO listens (${LISTEN_COLUMNS}) VALUES (${q(10)})`,
        [
          remote.device_id,
          remote.track_id,
          remote.day,
          remote.hour,
          remote.seconds,
          remote.plays,
          remote.title,
          remote.artist,
          remote.updated_at,
          remote.updated_by,
        ],
      ]);
      if (tombs.has(key)) st.push(untombstone('listens', key));
      result.changed++;
    }
  }

  // Lyrics.
  if (cs.lyrics.length) {
    const ids = cs.lyrics.map(l => l.track_id);
    const local = await stampsByKey(db, 'lyrics', 'track_id', ids);
    const tombs = await tombstonesFor(db, 'lyrics', ids);
    for (const remote of cs.lyrics) {
      const raw = local.get(remote.track_id);
      const mine = raw ? ({ updated_at: raw.updated_at as string } as LyricsRow) : null;
      if (!mergeRow(mine, remote, tombs.get(remote.track_id) ?? null)) continue;
      st.push([
        `INSERT OR REPLACE INTO lyrics (${LYRICS_COLUMNS}) VALUES (${q(7)})`,
        [
          remote.track_id,
          remote.plain,
          remote.synced,
          remote.source,
          remote.checked_at,
          remote.updated_at,
          remote.updated_by,
        ],
      ]);
      if (tombs.has(remote.track_id)) st.push(untombstone('lyrics', remote.track_id));
      result.changed++;
    }
  }

  // Karaoke recordings (the file itself comes after).
  if (cs.recordings.length) {
    const ids = cs.recordings.map(r => r.id);
    const local = await stampsByKey(db, 'karaoke_recordings', 'id', ids);
    const tombs = await tombstonesFor(db, 'karaoke_recordings', ids);
    const cols = [...RECORDING_FIELDS, 'updated_at', 'updated_by'];
    for (const remote of cs.recordings) {
      const raw = local.get(remote.id);
      const mine = raw ? ({ updated_at: raw.updated_at as string } as RecordingRow) : null;
      if (!mergeRow(mine, remote, tombs.get(remote.id) ?? null)) continue;
      st.push([
        `INSERT INTO karaoke_recordings (id, path, ${cols.join(', ')}) VALUES (?, '', ${q(cols.length)})
         ON CONFLICT(id) DO UPDATE SET ${cols.map(c => `${c} = excluded.${c}`).join(', ')}`,
        [
          remote.id,
          ...RECORDING_FIELDS.map(f =>
            f === 'title' ? (remote.title ?? '') : f === 'created_at' ? (remote.created_at ?? 0) : remote[f],
          ),
          remote.updated_at,
          remote.updated_by,
        ],
      ]);
      const path = (raw?.path as string) || '';
      if (path && remote.file_name && baseName(path) !== remote.file_name) {
        result.renamedRecordings.push({ id: remote.id, path, file_name: String(remote.file_name) });
      }
      if (tombs.has(remote.id)) st.push(untombstone('karaoke_recordings', remote.id));
      result.changed++;
    }
  }

  // Deletions.
  const byTable = new Map<SyncTable, Tombstone[]>();
  for (const t of cs.deleted) {
    if (!byTable.has(t.tbl)) byTable.set(t.tbl, []);
    byTable.get(t.tbl)!.push(t);
  }
  for (const [tbl, list] of byTable) {
    const ids = list.map(t => t.id);
    const tombs = await tombstonesFor(db, tbl, ids);
    let local: Map<string, Row>;
    if (tbl === 'listens') {
      const stamps = await listenStamps(db, ids);
      local = new Map([...stamps].map(([k, v]) => [k, { updated_at: v }]));
    } else {
      local = await stampsByKey(db, tbl, tbl === 'lyrics' ? 'track_id' : 'id', ids);
    }
    for (const t of list) {
      const raw = local.get(t.id);
      const { deleteRow, storeTombstone } = mergeTombstone(
        (raw?.updated_at as string) ?? null,
        tombs.get(t.id) ?? null,
        t.hlc,
      );
      if (storeTombstone) st.push(tombstoneStatement(tbl, t.id, t.hlc));
      if (!deleteRow || !raw) continue;
      result.changed++;
      if (tbl === 'tracks') {
        result.removedTracks.push({
          id: t.id,
          source: raw.source as string,
          file_path: (raw.file_path as string) ?? null,
          artwork_path: (raw.artwork_path as string) ?? null,
        });
        st.push(
          ['DELETE FROM tracks WHERE id = ?', [t.id]],
          ['DELETE FROM playlist_tracks WHERE track_id = ?', [t.id]],
        );
      } else if (tbl === 'playlists') {
        st.push(
          ['DELETE FROM playlist_tracks WHERE playlist_id = ?', [t.id]],
          ['DELETE FROM playlists WHERE id = ?', [t.id]],
        );
      } else if (tbl === 'listens') {
        const k = parseListenKey(t.id)!;
        st.push([
          'DELETE FROM listens WHERE device_id = ? AND track_id = ? AND day = ? AND hour = ?',
          [k.device_id, k.track_id, k.day, k.hour],
        ]);
      } else if (tbl === 'lyrics') {
        st.push(['DELETE FROM lyrics WHERE track_id = ?', [t.id]]);
      } else {
        if (raw.path) result.removedRecordings.push({ id: t.id, path: raw.path as string });
        st.push(['DELETE FROM karaoke_recordings WHERE id = ?', [t.id]]);
      }
    }
  }

  // The language.
  for (const s of cs.settings) {
    if (s.key === 'language' && mergeRow(language, s, null)) {
      result.language = s;
      result.changed++;
    }
  }

  if (st.length) await db.batch(st);
  clock.receive(
    maxHlc(
      ...cs.tracks.map(r => r.updated_at),
      ...cs.playlists.map(r => r.updated_at),
      ...cs.listens.map(r => r.updated_at),
      ...cs.lyrics.map(r => r.updated_at),
      ...cs.recordings.map(r => r.updated_at),
      ...cs.settings.map(r => r.updated_at),
      ...cs.deleted.map(r => r.hlc),
    ),
  );
  return result;
}

// ---- content hashes and ids of scanned songs ----

export interface HashJob {
  kind: 'audio' | 'artwork' | 'recording';
  id: string;
  path: string;
}

/** Files whose SHA-256 isn't known yet (new songs, covers, recordings). */
export async function filesToHash(db: SqlDb, limit = 50): Promise<HashJob[]> {
  const audio = await db.all(
    `SELECT id, file_path AS path FROM tracks
     WHERE content_hash IS NULL AND status = 'ready' AND file_path IS NOT NULL LIMIT ?`,
    [limit],
  );
  const art = await db.all(
    'SELECT id, artwork_path AS path FROM tracks WHERE artwork_hash IS NULL AND artwork_path IS NOT NULL LIMIT ?',
    [limit],
  );
  const rec = await db.all(
    "SELECT id, path FROM karaoke_recordings WHERE content_hash IS NULL AND path != '' LIMIT ?",
    [limit],
  );
  const job = (kind: HashJob['kind']) => (r: Row): HashJob => ({
    kind,
    id: r.id as string,
    path: r.path as string,
  });
  return [...audio.map(job('audio')), ...art.map(job('artwork')), ...rec.map(job('recording'))];
}

/** Saves a hash worked out locally (a scanned song also gets its lasting id). */
export async function saveHash(db: SqlDb, clock: HybridClock, job: HashJob, hash: string) {
  if (job.kind === 'recording') {
    const h = clock.tick();
    await db.run(
      'UPDATE karaoke_recordings SET content_hash = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [hash, h, deviceOf(h), job.id],
    );
    return;
  }
  const col = job.kind === 'audio' ? 'content_hash' : 'artwork_hash';
  const rows = await db.all('SELECT source FROM tracks WHERE id = ?', [job.id]);
  if (!rows.length) return;
  if (job.kind === 'audio' && rows[0].source === 'device' && job.id !== localTrackId(hash)) {
    await rekeyTrack(db, clock, job.id, localTrackId(hash), hash);
    return;
  }
  const s = trackStamp([col], clock.tick());
  await db.run(`UPDATE tracks SET ${col} = ?, ${s.sql} WHERE id = ?`, [hash, ...s.params, job.id]);
}

/**
 * Hashes every file that needs it, a batch at a time (in the background, at
 * startup and after the library changes). Returns how many were saved.
 */
export async function hashPendingFiles(
  db: SqlDb,
  clock: HybridClock,
  sha256: (path: string) => Promise<string | null>,
): Promise<number> {
  const failed = new Set<string>();
  let saved = 0;
  for (;;) {
    const jobs = (await filesToHash(db, 200)).filter(
      j => !failed.has(`${j.kind}:${j.id}`),
    );
    if (!jobs.length) return saved;
    for (const job of jobs) {
      const hash = await sha256(job.path).catch(() => null);
      if (!hash) {
        failed.add(`${job.kind}:${job.id}`); // unreadable for now: next time
        continue;
      }
      await saveHash(db, clock, job, hash.toLowerCase());
      saved++;
    }
  }
}

/**
 * A scanned song moves from its old id (its path) to the id of its audio,
 * the same on every device; everything pointing at it follows.
 */
export async function rekeyTrack(
  db: SqlDb,
  clock: HybridClock,
  oldId: string,
  newId: string,
  hash: string,
) {
  const me = clock.deviceId;
  const st: Statement[] = [];
  const existing = await db.all('SELECT id FROM tracks WHERE id = ?', [newId]);
  const h = clock.tick();
  if (existing.length) {
    // The same audio is already here (e.g. synced from the other device): one song.
    const s = trackStamp(['liked', 'play_count'], h);
    st.push(
      [
        `UPDATE tracks SET
           file_path = COALESCE(file_path, (SELECT file_path FROM tracks WHERE id = ?)),
           artwork_path = COALESCE(artwork_path, (SELECT artwork_path FROM tracks WHERE id = ?)),
           liked = MAX(liked, IFNULL((SELECT liked FROM tracks WHERE id = ?), 0)),
           play_count = MAX(play_count, IFNULL((SELECT play_count FROM tracks WHERE id = ?), 0)),
           ${s.sql}
         WHERE id = ?`,
        [oldId, oldId, oldId, oldId, ...s.params, newId],
      ],
      ['DELETE FROM tracks WHERE id = ?', [oldId]],
    );
  } else {
    st.push([
      `UPDATE tracks SET id = ?, source_id = ?, content_hash = ?, updated_at = ?, updated_by = ?, field_hlc = NULL
       WHERE id = ?`,
      [newId, hash, hash, h, me, oldId],
    ]);
  }
  st.push(...(await bumpPlaylistsOf(db, clock, oldId)));
  st.push(
    ['UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?', [newId, oldId]],
    ['DELETE FROM playlist_tracks WHERE track_id = ?', [oldId]],
  );
  // This device's listening moves to the new id (the old rows are deleted everywhere).
  for (const r of await db.all(
    `SELECT ${LISTEN_COLUMNS} FROM listens WHERE track_id = ? AND device_id = ?`,
    [oldId, me],
  )) {
    const at = clock.tick();
    st.push(
      [
        `INSERT INTO listens (${LISTEN_COLUMNS}) VALUES (${q(10)})
         ON CONFLICT(device_id, track_id, day, hour) DO UPDATE SET
           seconds = seconds + excluded.seconds, plays = plays + excluded.plays,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [me, newId, r.day, r.hour, r.seconds, r.plays, r.title, r.artist, at, me],
      ],
      tombstoneStatement(
        'listens',
        listenKey({ device_id: me, track_id: oldId, day: r.day as string, hour: Number(r.hour) }),
        clock.tick(),
      ),
    );
  }
  st.push(['DELETE FROM listens WHERE track_id = ? AND device_id = ?', [oldId, me]]);
  const lyrics = await db.all('SELECT track_id FROM lyrics WHERE track_id = ?', [oldId]);
  if (lyrics.length) {
    const at = clock.tick();
    st.push(
      [
        `INSERT OR IGNORE INTO lyrics (${LYRICS_COLUMNS})
         SELECT ?, plain, synced, source, checked_at, ?, ? FROM lyrics WHERE track_id = ?`,
        [newId, at, me, oldId],
      ],
      ['DELETE FROM lyrics WHERE track_id = ?', [oldId]],
      tombstoneStatement('lyrics', oldId, clock.tick()),
    );
  }
  for (const r of await db.all('SELECT id FROM karaoke_recordings WHERE track_id = ?', [oldId])) {
    const at = clock.tick();
    st.push([
      'UPDATE karaoke_recordings SET track_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [newId, at, me, r.id],
    ]);
  }
  await db.batch(st);
}

// ---- files ----

/** Hashes of files this device should have but doesn't (yet). */
export async function missingFiles(db: SqlDb): Promise<string[]> {
  const rows = await db.all(
    `SELECT content_hash AS h FROM tracks WHERE content_hash IS NOT NULL AND file_path IS NULL AND status = 'ready'
     UNION SELECT artwork_hash FROM tracks WHERE artwork_hash IS NOT NULL AND artwork_path IS NULL
     UNION SELECT content_hash FROM karaoke_recordings WHERE content_hash IS NOT NULL AND path = ''`,
  );
  return rows.map(r => r.h as string).filter(Boolean);
}

/** The local file with this content, if there is one. */
export async function localFileFor(db: SqlDb, hash: string): Promise<string | null> {
  const rows = await db.all(
    `SELECT file_path AS p FROM tracks WHERE content_hash = ? AND file_path IS NOT NULL
     UNION ALL SELECT artwork_path FROM tracks WHERE artwork_hash = ? AND artwork_path IS NOT NULL
     UNION ALL SELECT path FROM karaoke_recordings WHERE content_hash = ? AND path != ''`,
    [hash, hash, hash],
  );
  return (rows[0]?.p as string) ?? null;
}

export interface FileTargets {
  /** Songs waiting for this audio. */
  tracks: { id: string; source: string; title: string; artist: string | null }[];
  /** Songs waiting for this cover. */
  artworks: string[];
  /** Recordings waiting for this file. */
  recordings: { id: string; file_name: string | null; title: string }[];
}

export async function fileTargets(db: SqlDb, hash: string): Promise<FileTargets> {
  const tracks = await db.all(
    "SELECT id, source, title, artist FROM tracks WHERE content_hash = ? AND file_path IS NULL AND status = 'ready'",
    [hash],
  );
  const artworks = await db.all(
    'SELECT id FROM tracks WHERE artwork_hash = ? AND artwork_path IS NULL',
    [hash],
  );
  const recordings = await db.all(
    "SELECT id, file_name, title FROM karaoke_recordings WHERE content_hash = ? AND path = ''",
    [hash],
  );
  return {
    tracks: tracks.map(r => ({
      id: r.id as string,
      source: r.source as string,
      title: r.title as string,
      artist: (r.artist as string) ?? null,
    })),
    artworks: artworks.map(r => r.id as string),
    recordings: recordings.map(r => ({
      id: r.id as string,
      file_name: (r.file_name as string) ?? null,
      title: r.title as string,
    })),
  };
}

/** A received file is in place: the songs / recordings waiting for it show up. */
export async function fileArrived(
  db: SqlDb,
  hash: string,
  placed: {
    audio?: string;
    /** Each song gets its own copy of a cover (album songs often share one). */
    artworks?: Record<string, string>;
    recordings?: Record<string, string>;
  },
) {
  const st: Statement[] = [];
  if (placed.audio) {
    st.push([
      "UPDATE tracks SET file_path = ? WHERE content_hash = ? AND file_path IS NULL AND status = 'ready'",
      [placed.audio, hash],
    ]);
  }
  for (const [id, path] of Object.entries(placed.artworks ?? {})) {
    st.push(['UPDATE tracks SET artwork_path = ? WHERE id = ? AND artwork_hash = ?', [path, id, hash]]);
  }
  for (const [id, path] of Object.entries(placed.recordings ?? {})) {
    st.push(['UPDATE karaoke_recordings SET path = ? WHERE id = ?', [path, id]]);
  }
  if (st.length) await db.batch(st);
}
