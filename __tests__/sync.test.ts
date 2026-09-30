/**
 * Phone ↔ computer sync: the shared merge rules and SQL (src/sync/core),
 * run against real SQLite (node:sqlite) as two devices.
 */
import {
  HybridClock,
  applyChanges,
  collectChanges,
  compatibility,
  encodePairingQr,
  hlcMinus,
  isGenesis,
  mergeTombstone,
  mergeTrack,
  migrateSyncSchema,
  newestStamp,
  parsePairingQr,
  saveHash,
  tombstoneStatement,
  trackStamp,
  PROTOCOL_VERSION,
  type Scalar,
  type SqlDb,
  type TrackRow,
} from '../src/sync/core';

/* eslint-disable @typescript-eslint/no-var-requires */
declare const __dirname: string;
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, readdirSync } = require('fs');
const { join } = require('path');

let now = 1_750_000_000_000;
const tick = (ms = 1000) => (now += ms);

function memDb(): SqlDb {
  const d = new DatabaseSync(':memory:');
  const run = (sql: string, params: Scalar[] = []) => {
    d.prepare(sql).run(...params);
  };
  return {
    all: async (sql, params = []) => d.prepare(sql).all(...params),
    run: async (sql, params = []) => run(sql, params),
    batch: async statements => {
      d.exec('BEGIN');
      try {
        for (const [sql, params] of statements) run(sql, params);
        d.exec('COMMIT');
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** The tables as the apps created them before sync existed. */
const OLD_SCHEMA = [
  `CREATE TABLE tracks (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
    title TEXT NOT NULL, artist TEXT, album TEXT, duration REAL, file_path TEXT, artwork_path TEXT,
    remote_artwork_url TEXT, status TEXT NOT NULL, added_at INTEGER NOT NULL, genre TEXT,
    liked INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER, saved_at INTEGER, last_played_at INTEGER,
    play_count INTEGER NOT NULL DEFAULT 0, meta_checked_at INTEGER, source_title TEXT, source_artist TEXT)`,
  'CREATE TABLE playlists (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)',
  `CREATE TABLE playlist_tracks (playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id))`,
  `CREATE TABLE listens (track_id TEXT NOT NULL, day TEXT NOT NULL, hour INTEGER NOT NULL,
    seconds REAL NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, title TEXT, artist TEXT,
    PRIMARY KEY (track_id, day, hour))`,
  `CREATE TABLE lyrics (track_id TEXT PRIMARY KEY NOT NULL, plain TEXT, synced TEXT, source TEXT,
    checked_at INTEGER NOT NULL)`,
  `CREATE TABLE karaoke_recordings (id TEXT PRIMARY KEY NOT NULL, track_id TEXT, title TEXT NOT NULL,
    artist TEXT, path TEXT NOT NULL, duration REAL, size_bytes INTEGER, created_at INTEGER NOT NULL)`,
];

class Device {
  db = memDb();
  clock: HybridClock;
  /** The other device's changes: where the next pull starts. */
  cursor = '';
  /** Our own changes the other device has: where the next push starts. */
  pushed = '';
  constructor(readonly id: string) {
    this.clock = new HybridClock(id, () => now);
  }
  async init(before?: (db: SqlDb) => Promise<void>) {
    for (const s of OLD_SCHEMA) await this.db.run(s);
    await before?.(this.db);
    await migrateSyncSchema(this.db, this.id);
    this.clock.seed(await newestStamp(this.db));
    return this;
  }
  async addTrack(id: string, title: string, extra: Record<string, Scalar> = {}) {
    const h = this.clock.tick();
    const cols = { source: 'youtube', source_id: id, title, status: 'ready', added_at: now,
      file_path: `/music/${id}.m4a`, content_hash: `hash-${id}`, ...extra };
    await this.db.run(
      `INSERT INTO tracks (id, ${Object.keys(cols).join(', ')}, updated_at, updated_by)
       VALUES (?, ${Object.keys(cols).map(() => '?').join(', ')}, ?, ?)`,
      [id, ...Object.values(cols), h, this.id],
    );
  }
  async edit(id: string, patch: Record<string, Scalar>) {
    const s = trackStamp(Object.keys(patch), this.clock.tick());
    await this.db.run(
      `UPDATE tracks SET ${Object.keys(patch).map(k => `${k} = ?`).join(', ')}, ${s.sql} WHERE id = ?`,
      [...Object.values(patch), ...s.params, id],
    );
  }
  async deleteTrack(id: string) {
    await this.db.batch([
      ['DELETE FROM tracks WHERE id = ?', [id]],
      tombstoneStatement('tracks', id, this.clock.tick()),
    ]);
  }
  async listen(trackId: string, seconds: number) {
    const h = this.clock.tick();
    await this.db.run(
      `INSERT INTO listens (device_id, track_id, day, hour, seconds, plays, title, updated_at, updated_by)
       VALUES (?, ?, '2026-09-29', 10, ?, 1, 'x', ?, ?)
       ON CONFLICT(device_id, track_id, day, hour) DO UPDATE SET seconds = seconds + excluded.seconds,
         plays = plays + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [this.id, trackId, seconds, h, this.id],
    );
  }
  track = async (id: string) =>
    (await this.db.all('SELECT * FROM tracks WHERE id = ?', [id]))[0] ?? null;
  totalSeconds = async (trackId: string) =>
    Number(
      (await this.db.all('SELECT IFNULL(SUM(seconds), 0) AS s FROM listens WHERE track_id = ?', [trackId]))[0].s,
    );
}

/** One sync pass the way the phone runs it: push its pages, pull the computer's. */
async function sync(phone: Device, desktop: Device, limit = 800) {
  let pull = hlcMinus(phone.cursor, 5000);
  let push = hlcMinus(phone.pushed, 5000);
  for (let i = 0; i < 100; i++) {
    const out = await collectChanges(phone.db, push, desktop.id, [], limit);
    await applyChanges(desktop.db, desktop.clock, out.changes);
    if (out.cursor) push = out.cursor;
    const res = await collectChanges(desktop.db, pull, phone.id, [], limit);
    await applyChanges(phone.db, phone.clock, res.changes);
    if (res.cursor) pull = res.cursor;
    if (!out.more && !res.more) break;
  }
  if (pull > phone.cursor) phone.cursor = pull;
  if (push > phone.pushed) phone.pushed = push;
}

const pair = async () => [await new Device('phone0000').init(), await new Device('desk00000').init()];

describe('hybrid logical clock', () => {
  test('stamps sort in order and move past received ones', () => {
    let t = 1000_000;
    const a = new HybridClock('a', () => t);
    const h1 = a.tick();
    const h2 = a.tick();
    expect(h2 > h1).toBe(true);
    t -= 500; // the clock goes back
    expect(a.tick() > h2).toBe(true);
    const b = new HybridClock('b', () => t);
    b.receive(a.tick());
    expect(b.tick() > h2).toBe(true);
  });

  test('a stamp far in the future is not followed', () => {
    const a = new HybridClock('a', () => 1000_000);
    a.receive('9999999999999-000000-z');
    expect(a.tick().startsWith('0000001000000')).toBe(true);
  });
});

describe('merge rules', () => {
  const row = (fields: Partial<TrackRow>, at: string): TrackRow =>
    ({ id: 't', source: 'youtube', source_id: 't', title: 'A', liked: 0, play_count: 0,
       updated_at: at, updated_by: at.slice(21), field_hlc: null, ...fields }) as TrackRow;

  test('both sides edited different fields: both edits kept', () => {
    const base = '0001750000000000-000000-p';
    const local = row({ title: 'Mine', field_hlc: { title: '0001750000002000-000000-p' } }, '0001750000002000-000000-p');
    const remote = row({ artist: 'Theirs', field_hlc: { artist: '0001750000003000-000000-d' } }, '0001750000003000-000000-d');
    local.field_hlc = { ...local.field_hlc, artist: base };
    remote.field_hlc = { ...remote.field_hlc, title: base };
    const merged = mergeTrack(local, remote, null)!;
    expect(merged.title).toBe('Mine');
    expect(merged.artist).toBe('Theirs');
  });

  test('deleted vs edited: the newer stamp wins', () => {
    expect(mergeTombstone('0000000000002-000000-a', null, '0000000000001-000000-b').deleteRow).toBe(false);
    expect(mergeTombstone('0000000000001-000000-a', null, '0000000000002-000000-b').deleteRow).toBe(true);
    // A deleted song isn't brought back by an older edit, but is by a newer one.
    const edit = row({}, '0000000005000-000000-b');
    expect(mergeTrack(null, edit, '0000000006000-000000-a')).toBeNull();
    expect(mergeTrack(null, edit, '0000000004000-000000-a')).not.toBeNull();
  });

  test('play count only grows', () => {
    const local = row({ play_count: 9 }, '0000000009000-000000-p');
    const remote = row({ play_count: 3 }, '0000000010000-000000-d');
    expect(mergeTrack(local, remote, null)!.play_count).toBe(9);
  });

  test('two rows from before sync merge by value (liked on either side stays liked)', () => {
    const a = row({ liked: 1 }, '0000000000001-000001-p');
    const b = row({ liked: 0, genre: 'Jazz' }, '0000000000001-000007-d');
    expect(isGenesis(a.updated_at)).toBe(true);
    const onPhone = mergeTrack(a, b, null)!;
    const onDesktop = mergeTrack(b, a, null)!;
    expect(onPhone.liked).toBe(1);
    expect(onPhone.genre).toBe('Jazz');
    expect(onDesktop.liked).toBe(1);
    expect(onDesktop.genre).toBe('Jazz');
  });
});

describe('two devices', () => {
  test('both sides edited: they end up the same', async () => {
    const [phone, desk] = await pair();
    await phone.addTrack('yt1', 'Song');
    await sync(phone, desk);
    tick();
    await phone.edit('yt1', { title: 'Phone title', liked: 1 });
    tick();
    await desk.edit('yt1', { artist: 'Desk artist' });
    tick();
    await desk.edit('yt1', { title: 'Desk title' }); // newer than the phone's title
    await sync(phone, desk);
    const p = await phone.track('yt1');
    const d = await desk.track('yt1');
    expect(p.title).toBe('Desk title');
    expect(p.artist).toBe('Desk artist');
    expect(p.liked).toBe(1);
    for (const k of ['title', 'artist', 'liked', 'updated_at', 'field_hlc']) expect(d[k]).toEqual(p[k]);
    // The phone's file path stays its own; the computer waits for the file.
    expect(p.file_path).toBe('/music/yt1.m4a');
  });

  test('deleted on one side, edited later on the other: the edit wins', async () => {
    const [phone, desk] = await pair();
    await phone.addTrack('yt1', 'Song');
    await sync(phone, desk);
    tick();
    await phone.deleteTrack('yt1');
    tick();
    await desk.edit('yt1', { liked: 1 });
    await sync(phone, desk);
    expect((await phone.track('yt1'))?.liked).toBe(1);
    expect(await desk.track('yt1')).not.toBeNull();
  });

  test('edited, then deleted later: gone on both', async () => {
    const [phone, desk] = await pair();
    await phone.addTrack('yt1', 'Song');
    await sync(phone, desk);
    tick();
    await desk.edit('yt1', { liked: 1 });
    tick();
    await phone.deleteTrack('yt1');
    await sync(phone, desk);
    expect(await phone.track('yt1')).toBeNull();
    expect(await desk.track('yt1')).toBeNull();
  });

  test('a replayed sync never counts listening twice', async () => {
    const [phone, desk] = await pair();
    await phone.addTrack('yt1', 'Song');
    await phone.listen('yt1', 30);
    await desk.listen('yt1', 5);
    const page = await collectChanges(phone.db, '', desk.id);
    await applyChanges(desk.db, desk.clock, page.changes);
    const again = await applyChanges(desk.db, desk.clock, page.changes);
    expect(again.changed).toBe(0);
    expect(await desk.totalSeconds('yt1')).toBe(35);
    tick();
    await phone.listen('yt1', 10);
    await sync(phone, desk);
    await sync(phone, desk);
    expect(await desk.totalSeconds('yt1')).toBe(45);
    expect(await phone.totalSeconds('yt1')).toBe(45);
  });

  test('a playlist and its order travel as one', async () => {
    const [phone, desk] = await pair();
    for (const db of [phone.db]) {
      await db.run("INSERT INTO playlists (id, name, created_at, updated_at, updated_by) VALUES ('p1', 'Mix', 1, ?, ?)",
        [phone.clock.tick(), phone.id]);
      await db.run("INSERT INTO playlist_tracks VALUES ('p1', 'a', 0), ('p1', 'b', 1)");
    }
    await sync(phone, desk);
    tick();
    await desk.db.batch([
      ["UPDATE playlist_tracks SET position = 1 - position WHERE playlist_id = 'p1'", []],
      ["UPDATE playlists SET updated_at = ?, updated_by = ? WHERE id = 'p1'", [desk.clock.tick(), desk.id]],
    ]);
    await sync(phone, desk);
    const order = await phone.db.all("SELECT track_id FROM playlist_tracks WHERE playlist_id = 'p1' ORDER BY position");
    expect(order.map(r => r.track_id)).toEqual(['b', 'a']);
  });

  test('a big library arrives in pages', async () => {
    const [phone, desk] = await pair();
    for (let i = 0; i < 50; i++) await desk.addTrack(`t${i}`, `Song ${i}`);
    await sync(phone, desk, 7);
    const n = await phone.db.all('SELECT COUNT(*) AS n FROM tracks');
    expect(Number(n[0].n)).toBe(50);
    // Nothing new: the next pass sends nothing.
    const page = await collectChanges(desk.db, phone.cursor, phone.id);
    expect(page.cursor).toBeNull();
  });
});

describe('migration', () => {
  test('existing data is kept; listens gain the device', async () => {
    const dev = await new Device('dev000000').init(async db => {
      await db.run("INSERT INTO tracks (id, source, source_id, title, status, added_at, liked) VALUES ('x', 'youtube', 'x', 'X', 'ready', 1, 1)");
      await db.run("INSERT INTO listens VALUES ('x', '2026-01-01', 9, 60, 2, 'X', null)");
    });
    const t = await dev.track('x');
    expect(t.liked).toBe(1);
    expect(isGenesis(String(t.updated_at))).toBe(true);
    const l = await dev.db.all('SELECT * FROM listens');
    expect(l[0].device_id).toBe('dev000000');
    expect(l[0].seconds).toBe(60);
    // Running it again changes nothing.
    await migrateSyncSchema(dev.db, dev.id);
    expect((await dev.db.all('SELECT COUNT(*) AS n FROM listens'))[0].n).toBe(1);
  });

  test('a migration stopped half way is finished on the next start', async () => {
    const LISTENS_V1 = `CREATE TABLE listens (track_id TEXT NOT NULL, day TEXT NOT NULL,
      hour INTEGER NOT NULL, seconds REAL NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0,
      title TEXT, artist TEXT, PRIMARY KEY (track_id, day, hour))`;
    // Stopped after the copy, before the old table was dropped.
    const before = await new Device('dev000000').init(async db => {
      await db.run("INSERT INTO listens VALUES ('x', '2026-01-01', 9, 60, 2, 'X', null)");
      await db.run('CREATE TABLE listens_v2 (device_id TEXT)');
    });
    expect((await before.db.all('SELECT seconds FROM listens'))[0].seconds).toBe(60);
    // Stopped after the drop: the app recreated an empty old table at startup.
    const after = await new Device('dev000000').init(async db => {
      await db.run("INSERT INTO listens VALUES ('x', '2026-01-01', 9, 60, 2, 'X', null)");
      await migrateSyncSchema(db, 'dev000000');
      await db.run('ALTER TABLE listens RENAME TO listens_v2');
      await db.run(LISTENS_V1);
    });
    const l = await after.db.all('SELECT * FROM listens');
    expect(l[0].device_id).toBe('dev000000');
    expect(l[0].seconds).toBe(60);
    const v2 = await after.db.all("SELECT 1 FROM sqlite_master WHERE name = 'listens_v2'");
    expect(v2.length).toBe(0);
  });

  test('a scanned song gets the id of its audio, and everything follows', async () => {
    const dev = await new Device('dev000000').init();
    await dev.addTrack('device:/sdcard/a.mp3', 'A', { source: 'device', content_hash: null });
    await dev.listen('device:/sdcard/a.mp3', 20);
    await dev.db.run("INSERT INTO playlists (id, name, created_at, updated_at, updated_by) VALUES ('p', 'P', 1, ?, 'dev000000')", [dev.clock.tick()]);
    await dev.db.run("INSERT INTO playlist_tracks VALUES ('p', 'device:/sdcard/a.mp3', 0)");
    await saveHash(dev.db, dev.clock, { kind: 'audio', id: 'device:/sdcard/a.mp3', path: '/sdcard/a.mp3' }, 'abc');
    expect(await dev.track('device:/sdcard/a.mp3')).toBeNull();
    expect((await dev.track('device:abc')).file_path).toBe('/music/device:/sdcard/a.mp3.m4a');
    expect(await dev.totalSeconds('device:abc')).toBe(20);
    expect((await dev.db.all('SELECT track_id FROM playlist_tracks'))[0].track_id).toBe('device:abc');
    const tomb = await dev.db.all("SELECT id FROM deleted WHERE tbl = 'listens'");
    expect(tomb[0].id).toContain('device:/sdcard/a.mp3');
  });
});

describe('protocol', () => {
  test('pairing QR code round trip', () => {
    const info = { id: 'abc', name: 'My PC', hosts: ['192.168.1.4', '10.0.0.2'], port: 47893, code: '123456' };
    expect(parsePairingQr(encodePairingQr(info))).toEqual({ ...info, protocol: PROTOCOL_VERSION });
    expect(parsePairingQr('https://example.com')).toBeNull();
  });

  test('version mismatch is detected', () => {
    expect(compatibility(PROTOCOL_VERSION)).toBe('ok');
    expect(compatibility(PROTOCOL_VERSION + 1)).toBe('update-phone');
    expect(compatibility(PROTOCOL_VERSION - 1)).toBe('update-computer');
  });
});

test('the computer app has a byte-identical copy of the shared module', () => {
  const canonical = join(__dirname, '../src/sync/core');
  const copy = join(__dirname, '../desktop/src/core/sync/core');
  const files: string[] = readdirSync(canonical).sort();
  expect(readdirSync(copy).sort()).toEqual(files);
  for (const f of files) {
    const a = readFileSync(join(canonical, f));
    const b = readFileSync(join(copy, f));
    expect(b.equals(a)).toBe(true);
  }
});
