/**
 * Sync's files on the computer: hashing new songs, covers and recordings (so
 * they can be matched with the phone's), placing files received from the
 * phone, and removing the ones deleted there.
 *
 * Received songs go into Music/stash (under the name stash would have saved
 * them with), covers into the app's data, recordings into Music/Karaoke.
 */
import {
  localChange,
  notifyLibrary,
  onLocalChange,
  subscribeLibrary,
  syncClock,
  syncDb,
} from '../db/database';
import { baseName, dirName, fs, pathJoin, removeFile } from '../native';
import { loadRecordings } from '../services/karaokeRecordings';
import { artworkDir, karaokePublicDir, keepDir, safeFileName } from '../services/paths';
import { applySyncedLanguage } from '../services/settings';
import {
  fileArrived,
  fileTargets,
  hashPendingFiles,
  type ApplyResult,
} from './core';

const cleanName = (name: string) =>
  name.replace(/[\\/:*?"<>|\n\r]/g, '_').trim().slice(0, 150);

const samePlace = (path: string, dir: string) =>
  path.replace(/\\/g, '/').toLowerCase().startsWith(`${dir.replace(/\\/g, '/').toLowerCase()}/`);

/** `dir/name`, or `dir/name (2).ext` if that's taken. */
async function freePath(dir: string, name: string): Promise<string> {
  const ext = name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '';
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const path = pathJoin(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    if (!(await fs.exists(path))) return path;
  }
}

/** A file the phone sent (checked against its hash): into place, and the songs waiting for it show up. */
export async function placeReceivedFile(hash: string, tmp: string, name: string) {
  const t = await fileTargets(syncDb, hash);
  const ext = name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '';
  const dests: string[] = [];
  const placed = {
    audio: undefined as string | undefined,
    artworks: {} as Record<string, string>,
    recordings: {} as Record<string, string>,
  };
  if (t.tracks.length) {
    const track = t.tracks[0];
    // Saved songs keep stash's own naming ("youtube_<id>.m4a"), so a rescan knows them.
    const file =
      track.source === 'device'
        ? cleanName(name) || cleanName(`${track.artist ? `${track.artist} - ` : ''}${track.title}${ext}`)
        : `${safeFileName(track.id)}${ext}`;
    await fs.mkdir(keepDir()).catch(() => {});
    placed.audio = await freePath(keepDir(), file);
    dests.push(placed.audio);
  }
  for (const id of t.artworks) {
    placed.artworks[id] = pathJoin(artworkDir(), `${safeFileName(id)}-${Date.now()}${ext || '.jpg'}`);
    dests.push(placed.artworks[id]);
  }
  for (const r of t.recordings) {
    await fs.mkdir(karaokePublicDir()).catch(() => {});
    placed.recordings[r.id] = await freePath(karaokePublicDir(), cleanName(r.file_name || name));
    dests.push(placed.recordings[r.id]);
  }
  // Copies for all but the last place; the last one gets the file itself.
  for (const [i, dest] of dests.entries()) {
    if (i === dests.length - 1) await fs.rename(tmp, dest);
    else await fs.copy(tmp, dest);
  }
  if (!dests.length) await removeFile(tmp);
  await fileArrived(syncDb, hash, placed);
  notifyLibrary();
  if (t.recordings.length) loadRecordings().catch(() => {});
}

/**
 * After the phone's changes are merged: files of songs and recordings deleted
 * there go too (only ones stash keeps: never the user's own music), renamed
 * recordings are renamed, and a newer language choice applies.
 */
export async function afterApply(r: ApplyResult) {
  for (const t of r.removedTracks) {
    if (t.file_path && samePlace(t.file_path, keepDir())) await removeFile(t.file_path);
    await removeFile(t.artwork_path);
  }
  for (const rec of r.removedRecordings) {
    if (samePlace(rec.path, karaokePublicDir())) await removeFile(rec.path);
  }
  for (const rec of r.renamedRecordings) {
    const dest = pathJoin(dirName(rec.path), cleanName(rec.file_name));
    if (baseName(dest) === baseName(rec.path) || (await fs.exists(dest))) continue;
    await fs.rename(rec.path, dest).catch(() => {});
    await syncDb.run('UPDATE karaoke_recordings SET path = ? WHERE id = ?', [dest, rec.id]);
  }
  if (r.removedRecordings.length || r.renamedRecordings.length) {
    loadRecordings().catch(() => {});
  }
  if (r.language) applySyncedLanguage(r.language);
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
      const saved = await hashPendingFiles(syncDb, syncClock, p => fs.sha256(p)).catch(
        e => (console.warn('Hashing files for sync failed', e), 0),
      );
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
