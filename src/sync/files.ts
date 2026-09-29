/**
 * Sync's files on the phone: after the data, each side gets the files it's
 * missing (songs, covers, karaoke recordings), matched by SHA-256. The phone
 * downloads from and uploads to the computer, resumably, under a foreground
 * service. Also: hashing new files, placing received ones, and removing the
 * files of songs deleted on the computer.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  localChange,
  notifyLibrary,
  onLocalChange,
  subscribeLibrary,
  syncClock,
  syncDb,
} from '../db/database';
import { tr } from '../i18n';
import { loadRecordings, PRIVATE_DIR, PUBLIC_DIR } from '../services/karaokeRecordings';
import { KEEP_DIR, downloadFolder, mayWritePublicMusic } from '../services/keep';
import { ARTWORK_DIR, MUSIC_DIR, removeFile, safeFileName } from '../services/paths';
import { applySyncedLanguage } from '../services/settings';
import {
  TransferMeter,
  baseName,
  fileArrived,
  fileTargets,
  hashPendingFiles,
  localFileFor,
  missingFiles,
  type ApplyResult,
  type FilesResponse,
  type TransferProgress,
} from './core';
import { SyncNative, onTransferProgress } from './native';

const { fs } = ReactNativeBlobUtil;

const cleanName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\n\r]/g, '_')
    .trim()
    .slice(0, 150);

async function freePath(dir: string, name: string): Promise<string> {
  const ext = name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '';
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const path = `${dir}/${i === 1 ? name : `${stem} (${i})${ext}`}`;
    if (!(await fs.exists(path))) return path;
  }
}

async function ensureDir(dir: string) {
  if (!(await fs.exists(dir))) await fs.mkdir(dir).catch(() => {});
}

/** Where a file from the computer goes, for everything waiting for it (null: nothing is). */
async function destinations(hash: string, name: string) {
  const t = await fileTargets(syncDb, hash);
  const ext = name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '';
  const placed = {
    audio: undefined as string | undefined,
    artworks: {} as Record<string, string>,
    recordings: {} as Record<string, string>,
  };
  const paths: string[] = [];
  if (t.tracks.length) {
    const track = t.tracks[0];
    // Saved songs keep stash's own naming ("youtube_<id>.m4a"), so a rescan knows them.
    const file =
      track.source === 'device'
        ? cleanName(name) ||
          cleanName(`${track.artist ? `${track.artist} - ` : ''}${track.title}${ext}`)
        : `${safeFileName(track.id)}${ext}`;
    const dir = await downloadFolder();
    placed.audio = await freePath(dir, file);
    paths.push(placed.audio);
  }
  for (const id of t.artworks) {
    placed.artworks[id] = `${ARTWORK_DIR}/${safeFileName(id)}-${Date.now()}${ext || '.jpg'}`;
    paths.push(placed.artworks[id]);
  }
  if (t.recordings.length) {
    const dir = (await mayWritePublicMusic()) ? PUBLIC_DIR : PRIVATE_DIR;
    await ensureDir(dir);
    for (const r of t.recordings) {
      placed.recordings[r.id] = await freePath(dir, cleanName(r.file_name || name));
      paths.push(placed.recordings[r.id]);
    }
  }
  return paths.length ? { placed, paths, recordings: t.recordings.length > 0 } : null;
}

/**
 * After the computer's changes are merged: files of songs and recordings
 * deleted there go too (only ones stash keeps: never the user's own music),
 * renamed recordings are renamed, and a newer language choice applies.
 */
export async function afterApply(r: ApplyResult) {
  for (const t of r.removedTracks) {
    const ours =
      t.file_path?.startsWith(`${KEEP_DIR}/`) || t.file_path?.startsWith(`${MUSIC_DIR}/`);
    if (ours) await removeFile(t.file_path).catch(() => {});
    await removeFile(t.artwork_path).catch(() => {});
  }
  for (const rec of r.removedRecordings) {
    if (rec.path.startsWith(`${PUBLIC_DIR}/`) || rec.path.startsWith(`${PRIVATE_DIR}/`)) {
      await removeFile(rec.path).catch(() => {});
    }
  }
  for (const rec of r.renamedRecordings) {
    const dest = `${rec.path.slice(0, rec.path.lastIndexOf('/'))}/${cleanName(rec.file_name)}`;
    if (dest === rec.path || (await fs.exists(dest))) continue;
    try {
      await fs.mv(rec.path, dest);
      await syncDb.run('UPDATE karaoke_recordings SET path = ? WHERE id = ?', [dest, rec.id]);
    } catch {}
  }
  if (r.removedRecordings.length || r.renamedRecordings.length) {
    loadRecordings().catch(() => {});
  }
  if (r.language) applySyncedLanguage(r.language);
}

// ---- transfers ----

export type Transfer = TransferProgress & { dir: 'send' | 'receive' };

/** "3 files left · about 2 min" */
export function transferText(p: TransferProgress): string {
  const files = tr('sync.filesLeft', { count: p.filesLeft });
  if (p.eta == null) return files;
  const time =
    p.eta < 60
      ? tr('sync.secondsLeft', { count: Math.max(1, p.eta) })
      : tr('sync.minutesLeft', { count: Math.ceil(p.eta / 60) });
  return `${files} · ${time}`;
}

/**
 * Gets the files this phone is missing and sends the ones the computer is
 * missing. Files that fail are tried again on the next sync (resuming).
 */
export async function transferFiles(
  computer: string,
  onProgress: (t: Transfer | null) => void,
): Promise<void> {
  const native = SyncNative;
  if (!native) return;
  const want = await missingFiles(syncDb);
  const res = JSON.parse(
    await native.request('/v1/files', JSON.stringify({ want })),
  ) as FilesResponse;
  const uploads: { hash: string; path: string; size: number }[] = [];
  for (const hash of res.want) {
    const path = await localFileFor(syncDb, hash);
    const stat = path ? await fs.stat(path).catch(() => null) : null;
    if (path && stat) uploads.push({ hash, path, size: Number(stat.size) });
  }
  const downloads = res.have;
  const count = downloads.length + uploads.length;
  if (!count) return;
  const bytes =
    downloads.reduce((n, f) => n + f.size, 0) + uploads.reduce((n, f) => n + f.size, 0);
  const meter = new TransferMeter(count, bytes);
  let dir: Transfer['dir'] = 'receive';
  const title = tr('sync.notifTitle', { name: computer });
  const report = () => {
    const p = meter.snapshot();
    onProgress({ ...p, dir });
    native.updateForeground(
      title,
      transferText(p),
      p.bytesTotal ? Math.round((p.bytesDone / p.bytesTotal) * 100) : 0,
    );
  };
  const batch = () => {
    const p = meter.snapshot();
    return [p.filesLeft, p.filesTotal, p.bytesDone, p.bytesTotal, p.eta ?? -1].join(',');
  };
  const stop = onTransferProgress(e => {
    meter.progress(e.done);
    report();
  });
  native.startForeground(title, transferText(meter.snapshot()));
  try {
    for (const f of downloads) {
      const where = await destinations(f.hash, f.name);
      if (!where) {
        meter.fileDone(f.size);
        continue;
      }
      try {
        await native.download(f.hash, where.paths[0], batch());
        for (const extra of where.paths.slice(1)) await fs.cp(where.paths[0], extra);
        await fileArrived(syncDb, f.hash, where.placed);
        if (where.placed.audio && !where.placed.audio.startsWith(MUSIC_DIR)) {
          fs.scanFile([{ path: where.placed.audio }]).catch(() => {});
        }
        notifyLibrary();
        if (where.recordings) loadRecordings().catch(() => {});
      } catch (e) {
        console.warn(`Receiving ${f.name} failed`, e);
      }
      meter.fileDone(f.size);
      report();
    }
    dir = 'send';
    for (const f of uploads) {
      try {
        await native.upload(f.hash, f.path, baseName(f.path), batch());
      } catch (e) {
        console.warn(`Sending ${f.path} failed`, e);
      }
      meter.fileDone(f.size);
      report();
    }
  } finally {
    stop();
    native.stopForeground();
    onProgress(null);
  }
}

// ---- hashing ----

let hashing = false;
let again = false;

/** Hashes whatever needs it, in the background (one run at a time). */
export function hashFiles() {
  if (hashing) {
    again = true;
    return;
  }
  hashing = true;
  (async () => {
    do {
      again = false;
      const saved = await hashPendingFiles(syncDb, syncClock, p =>
        fs.hash(p, 'sha256'),
      ).catch(e => (console.warn('Hashing files for sync failed', e), 0));
      if (saved) {
        notifyLibrary();
        localChange();
      }
    } while (again);
    hashing = false;
  })();
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** At startup, then a few seconds after the library changes. */
export function startHashing() {
  hashFiles();
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(hashFiles, 3000);
  };
  subscribeLibrary(later);
  onLocalChange(later);
}
