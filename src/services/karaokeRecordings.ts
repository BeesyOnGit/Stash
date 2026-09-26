/**
 * Saved karaoke performances (Saving tab → Karaoke recordings): listed by
 * song, played, renamed, deleted, shown in the file manager or shared.
 *
 * The files live in the phone's Music/Karaoke folder (the app's private
 * folder if it may not write there), so other apps see them too. Which song
 * each one was sung over is kept in the database; files found in the folder
 * that it doesn't know (e.g. after a reinstall) are added, matched to a song
 * by the title in their name.
 *
 * Native side (folder / share): karaoke/KaraokeModule.kt.
 */
import { NativeModules, Platform } from 'react-native';
import { getAudioDuration } from 'react-native-audio-api';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  addRecording,
  deleteRecordingRow,
  getAllTracks,
  getRecordings,
  setRecordingPath,
  type RecordingRow,
} from '../db/database';
import { fileUri } from './karaokePlayer';

export type Recording = RecordingRow;

const { fs } = ReactNativeBlobUtil;

const Native:
  | {
      openFolder(path: string): Promise<boolean>;
      share(path: string, title: string): Promise<void>;
    }
  | undefined =
  Platform.OS === 'android' ? NativeModules.StashKaraoke : undefined;

/** Where saved performances go: the phone's Music/Karaoke (private folder if not allowed). */
export const PUBLIC_DIR = `${fs.dirs.LegacyMusicDir}/Karaoke`;
export const PRIVATE_DIR = `${fs.dirs.DocumentDir}/karaoke-recordings`;

/** "Tuyo (karaoke) 2026-09-26 16.01.m4a", as saveMix names them. */
const NAME = /^(.*) \(karaoke\) (\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})/;

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

/** The name shown (and the file's name, without .m4a). */
export const recordingName = (r: Recording) =>
  r.path
    .split('/')
    .pop()!
    .replace(/\.[a-z0-9]+$/i, '');

export const isPublic = (r: Recording) => r.path.startsWith(PUBLIC_DIR);

/** Reads the list, forgets files that are gone and adds ones found in the folders. */
export async function loadRecordings(): Promise<void> {
  const rows = await getRecordings().catch(() => [] as Recording[]);
  const kept: Recording[] = [];
  for (const r of rows) {
    if (await fs.exists(r.path)) kept.push(r);
    else await deleteRecordingRow(r.id).catch(() => {});
  }
  const known = new Set(kept.map(r => r.path));
  const tracks = await getAllTracks().catch(() => []);
  for (const dir of [PUBLIC_DIR, PRIVATE_DIR]) {
    const files = await fs.ls(dir).catch(() => [] as string[]);
    for (const f of files) {
      const path = `${dir}/${f}`;
      if (!/\.m4a$/i.test(f) || known.has(path)) continue;
      const m = f.match(NAME);
      const title = m ? m[1] : f.replace(/\.[a-z0-9]+$/i, '');
      const track = m
        ? tracks.find(t => t.title.toLowerCase() === title.toLowerCase())
        : undefined;
      const stat = await fs.stat(path).catch(() => null);
      const row: Recording = {
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        trackId: track?.id ?? null,
        title: track?.title ?? title,
        artist: track?.artist ?? null,
        path,
        duration: await getAudioDuration(fileUri(path)).catch(() => null),
        sizeBytes: stat ? Number(stat.size) : null,
        createdAt: m
          ? new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]).getTime()
          : Number(stat?.lastModified ?? Date.now()),
      };
      await addRecording(row).catch(() => {});
      kept.push(row);
    }
  }
  set(kept.sort((a, b) => b.createdAt - a.createdAt));
}

/** A performance just saved by the karaoke screen. */
export async function addNewRecording(
  row: Omit<Recording, 'id' | 'createdAt' | 'sizeBytes'>,
): Promise<Recording> {
  const stat = await fs.stat(row.path).catch(() => null);
  const rec: Recording = {
    ...row,
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sizeBytes: stat ? Number(stat.size) : null,
    createdAt: Date.now(),
  };
  await addRecording(rec);
  set([rec, ...list.filter(r => r.path !== rec.path)]);
  return rec;
}

/** Characters no file name may have on Android (and a sane length). */
export const cleanFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\n\r]/g, '_')
    .trim()
    .slice(0, 120);

export class NameTakenError extends Error {}

/** Renames the file (same folder). */
export async function renameRecording(
  rec: Recording,
  name: string,
): Promise<void> {
  const clean = cleanFileName(name);
  if (!clean || clean === recordingName(rec)) return;
  const dir = rec.path.slice(0, rec.path.lastIndexOf('/'));
  const ext = rec.path.match(/\.[a-z0-9]+$/i)?.[0] ?? '.m4a';
  const next = `${dir}/${clean}${ext}`;
  if (await fs.exists(next)) throw new NameTakenError(clean);
  await fs.mv(rec.path, next);
  await setRecordingPath(rec.id, next);
  scan([rec.path, next]);
  set(list.map(r => (r.id === rec.id ? { ...r, path: next } : r)));
}

export async function deleteRecording(rec: Recording): Promise<void> {
  await fs.unlink(rec.path).catch(() => {});
  await deleteRecordingRow(rec.id);
  scan([rec.path]);
  set(list.filter(r => r.id !== rec.id));
}

/**
 * Opens the file manager where the recording is. Returns false when that
 * isn't possible (private folder, or no file manager answers).
 */
export async function showInFolder(rec: Recording): Promise<boolean> {
  if (!Native || !isPublic(rec)) return false;
  return Native.openFolder(rec.path).catch(() => false);
}

export async function shareRecording(rec: Recording): Promise<void> {
  await Native?.share(rec.path, recordingName(rec));
}

/** Tells music apps and the file manager about new, renamed or deleted files. */
function scan(paths: string[]) {
  fs.scanFile(paths.map(path => ({ path, mime: 'audio/mp4' }))).catch(() => {});
}
