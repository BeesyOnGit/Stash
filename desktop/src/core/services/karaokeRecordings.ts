/**
 * Saved karaoke performances (Saving → Karaoke recordings): listed by song,
 * played, renamed, deleted, shown in the file manager or shared (saved as a
 * copy anywhere).
 *
 * The files live in the computer's Music/Karaoke folder, so other apps see
 * them too. Which song each one was sung over is kept in the database; files
 * found in the folder that it doesn't know (e.g. after a reinstall) are added,
 * matched to a song by the title in their name.
 */
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  addRecording,
  deleteRecordingRow,
  getAllTracks,
  getRecordings,
  setRecordingPath,
  type RecordingRow,
} from '../db/database';
import { audioDuration, baseName, dirName, fs, pathJoin } from '../native';
import type { Track } from '../types';
import { instrumentalPath } from './karaoke';
import { karaokePublicDir } from './paths';

export type Recording = RecordingRow;

const AUDIO = /\.(wav|m4a|mp3|flac|ogg)$/i;
/** "Tuyo (karaoke) 2026-09-26 16.01.wav", the default name of a take. */
const NAME = /^(.*?)(?: — take \d+| \(karaoke\) (\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2}))/;

// ---- store ----

let list: Recording[] = [];
let loaded = false;
const listeners = new Set<() => void>();
function set(next: Recording[]) {
  list = next;
  listeners.forEach(fn => fn());
}
export function subscribeRecordings(fn: () => void) {
  listeners.add(fn);
  if (!loaded) {
    loaded = true;
    loadRecordings();
  }
  return () => {
    listeners.delete(fn);
  };
}
export const getRecordingList = () => list;

/** The name shown (and the file's name, without its extension). */
export const recordingName = (r: Recording) =>
  baseName(r.path).replace(/\.[a-z0-9]+$/i, '');

/** Reads the list, forgets files that are gone and adds ones found in the folder. */
export async function loadRecordings(): Promise<void> {
  const rows = await getRecordings().catch(() => [] as Recording[]);
  const kept: Recording[] = [];
  for (const r of rows) {
    if (await fs.exists(r.path)) kept.push(r);
    else await deleteRecordingRow(r.id).catch(() => {});
  }
  const known = new Set(kept.map(r => r.path));
  const tracks = await getAllTracks().catch(() => []);
  const files = await fs.list(karaokePublicDir()).catch(() => []);
  for (const f of files) {
    if (f.is_dir || !AUDIO.test(f.name) || known.has(f.path)) continue;
    const m = f.name.match(NAME);
    const title = (m ? m[1] : f.name.replace(/\.[a-z0-9]+$/i, '')).trim();
    const track = tracks.find(t => t.title.toLowerCase() === title.toLowerCase());
    const row: Recording = {
      id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trackId: track?.id ?? null,
      title: track?.title ?? title,
      artist: track?.artist ?? null,
      path: f.path,
      duration: await audioDuration(f.path).catch(() => null),
      sizeBytes: f.size,
      createdAt:
        m && m[2]
          ? new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]).getTime()
          : f.modified || Date.now(),
      mode: null,
    };
    await addRecording(row).catch(() => {});
    kept.push(row);
  }
  set(kept.sort((a, b) => b.createdAt - a.createdAt));
}

/** Characters no file name may have (and a sane length). */
export const cleanFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\n\r]/g, '_')
    .trim()
    .slice(0, 120);

export class NameTakenError extends Error {}

/** The next free file name in Music/Karaoke for `name`. */
async function freePath(name: string, ext = '.wav') {
  const dir = karaokePublicDir();
  await fs.mkdir(dir).catch(() => {});
  let out = pathJoin(dir, `${name}${ext}`);
  for (let n = 2; await fs.exists(out); n++) out = pathJoin(dir, `${name} (${n})${ext}`);
  return out;
}

/**
 * Mixes the voice onto the music and saves it in Music/Karaoke. `over`: the
 * instrumental, or the song as it is. `offsetMs`: how much of the start of the
 * recording to skip to line it up.
 */
export async function saveMix(
  track: Track,
  voicePath: string,
  offsetMs: number,
  voiceGain: number,
  over: 'instrumental' | 'original',
  name: string,
): Promise<Recording> {
  const music = over === 'original' ? track.filePath : instrumentalPath(track.id);
  if (!music || !(await fs.exists(music))) {
    throw new Error('The instrumental is not ready yet');
  }
  const out = await freePath(cleanFileName(name) || cleanFileName(track.title));
  const duration = await invoke<number>('karaoke_mix', {
    instrumental: music,
    voice: voicePath,
    output: out,
    offsetMs,
    voiceGain,
    musicGain: 1,
  });
  const stat = await fs.stat(out).catch(() => null);
  const rec: Recording = {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    path: out,
    duration,
    sizeBytes: stat?.size ?? null,
    createdAt: Date.now(),
    mode: over,
  };
  await addRecording(rec);
  set([rec, ...list.filter(r => r.path !== rec.path)]);
  return rec;
}

/** Renames the file (same folder). */
export async function renameRecording(rec: Recording, name: string): Promise<void> {
  const clean = cleanFileName(name);
  if (!clean || clean === recordingName(rec)) return;
  const ext = rec.path.match(/\.[a-z0-9]+$/i)?.[0] ?? '.wav';
  const next = pathJoin(dirName(rec.path), `${clean}${ext}`);
  if (await fs.exists(next)) throw new NameTakenError(clean);
  await fs.rename(rec.path, next);
  await setRecordingPath(rec.id, next);
  set(list.map(r => (r.id === rec.id ? { ...r, path: next } : r)));
}

export async function deleteRecording(rec: Recording): Promise<void> {
  await fs.remove(rec.path).catch(() => {});
  await deleteRecordingRow(rec.id);
  set(list.filter(r => r.id !== rec.id));
}

/** Opens the file manager at the recording (or at Music/Karaoke). */
export async function showInFolder(rec?: Recording): Promise<void> {
  if (rec) return revealItemInDir(rec.path);
  const dir = karaokePublicDir();
  await fs.mkdir(dir).catch(() => {});
  await openPath(dir);
}

/** "Share": save a copy wherever the user picks. Returns false if they cancelled. */
export async function shareRecording(rec: Recording): Promise<boolean> {
  const ext = rec.path.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'wav';
  const dest = await save({
    defaultPath: baseName(rec.path),
    filters: [{ name: 'Audio', extensions: [ext] }],
  });
  if (!dest) return false;
  await fs.copy(rec.path, dest);
  return true;
}
