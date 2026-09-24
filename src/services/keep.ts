/**
 * Downloads outlive the app: Android deletes an app's private folder when it's
 * uninstalled, so finished downloads are moved (same file name) to the phone's
 * public Music/stash folder. After a reinstall, Settings → Scan for music finds
 * them, and the name ("youtube_<id>.m4a") brings each one back as the same song,
 * its title and cover looked up again online, never downloaded twice.
 *
 * Downloading itself still happens in the private folder (partial files and
 * conversions); only the finished file moves.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getTracksByStatus, updateTrack } from '../db/database';
import type { Track, TrackSource } from '../types';
import { MUSIC_DIR } from './paths';

const { fs } = ReactNativeBlobUtil;

export const KEEP_DIR = `${fs.dirs.LegacyMusicDir}/stash`;

/**
 * Kept files keep the name they were downloaded with, "youtube_<id>.m4a" or
 * "jamendo_<id>.mp3" (safeFileName of the song id), which is enough to know
 * which song a file is after a reinstall.
 */
export function parseKeptFileName(fileName: string): {
  source: Exclude<TrackSource, 'device'>;
  sourceId: string;
} | null {
  const m = fileName.match(/^(youtube|jamendo)_(.+)\.[a-z0-9]+$/i);
  return m
    ? { source: m[1].toLowerCase() as 'youtube' | 'jamendo', sourceId: m[2] }
    : null;
}

/** Android 9 and 10 need the storage permission to write to Music; 11+ don't. */
async function mayWritePublicMusic(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Number(Platform.Version) >= 30) return true;
  const perm = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(perm)) return true;
  return (await PermissionsAndroid.request(perm)) === 'granted';
}

/**
 * Where new downloads are saved: Music/stash, or the private folder if the
 * phone won't let the app write there (storage permission refused on Android 9/10).
 */
export async function downloadFolder(): Promise<string> {
  if (await mayWritePublicMusic()) {
    try {
      if (!(await fs.exists(KEEP_DIR))) await fs.mkdir(KEEP_DIR);
      return KEEP_DIR;
    } catch {}
  }
  return MUSIC_DIR;
}

/**
 * Moves a finished download to Music/stash and returns its new path; returns the
 * old path if that isn't possible (the song still plays from there).
 */
export async function keepAfterUninstall(
  track: Track,
  path: string,
): Promise<string> {
  if (!path.startsWith(MUSIC_DIR) || !(await mayWritePublicMusic())) {
    return path;
  }
  // Same file name as before: only the folder changes.
  const dest = `${KEEP_DIR}/${path.split('/').pop()}`;
  try {
    if (!(await fs.exists(KEEP_DIR))) await fs.mkdir(KEEP_DIR);
    if (await fs.exists(dest)) await fs.unlink(dest); // a leftover copy
    await fs.cp(path, dest);
    const [from, to] = await Promise.all([fs.stat(path), fs.stat(dest)]);
    if (Number(from.size) !== Number(to.size))
      throw new Error('Copy incomplete');
    await fs.unlink(path);
    return dest;
  } catch (e) {
    console.warn(`Couldn't move ${track.title} to Music/stash`, e);
    await fs.unlink(dest).catch(() => {});
    return path;
  }
}

/** Once at startup: move downloads saved before this existed. */
export async function keepOldDownloads(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const old = (await getTracksByStatus('ready')).filter(
    t => t.source !== 'device' && t.filePath?.startsWith(MUSIC_DIR),
  );
  for (const t of old) {
    const path = await keepAfterUninstall(t, t.filePath!);
    if (path !== t.filePath) await updateTrack(t.id, { filePath: path });
  }
}
