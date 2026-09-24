/**
 * Finds music files already on the phone (Android) and adds them to the library.
 * iOS apps can't read the system music library's files, so on iOS the library
 * contains the songs downloaded by the app.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  deleteTrackRow,
  getDeviceTrackIds,
  getTrack,
  updateTrack,
  upsertTrack,
} from '../db/database';
import { trackIdFor, type Track } from '../types';
import { ensureArtwork } from './artwork';
import { KEEP_DIR, parseKeptFileName } from './keep';
import { innertubeVideoDetails } from '../sources/innertube';

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav|wma|amr)$/i;
const MAX_DEPTH = 6;

export async function requestAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const permission =
    Number(Platform.Version) >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(permission)) return true;
  const res = await PermissionsAndroid.request(permission, {
    title: 'Music on this phone',
    message:
      'Allow access to your audio files to play the music already on your phone.',
    buttonPositive: 'Allow',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

interface FoundFile {
  path: string;
  size: number;
}

async function walk(dir: string, depth: number, out: FoundFile[]) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await ReactNativeBlobUtil.fs.lstat(dir);
  } catch {
    return; // unreadable / missing folder
  }
  for (const e of entries) {
    if (e.filename.startsWith('.')) continue;
    if (e.type === 'directory') await walk(e.path, depth + 1, out);
    else if (AUDIO_EXT.test(e.filename) && Number(e.size) > 50_000)
      out.push({ path: e.path, size: Number(e.size) });
  }
}

/** "Artist - Title.mp3" → { artist, title }; otherwise the file name is the title. */
function parseFileName(path: string): { title: string; artist: string | null } {
  const base = path
    .split('/')
    .pop()!
    .replace(AUDIO_EXT, '')
    .replace(/_/g, ' ')
    .trim();
  const withoutTrackNo = base.replace(/^\d{1,3}\s*[.\-–]?\s+/, '');
  const m = withoutTrackNo.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m
    ? { artist: m[1].trim(), title: m[2].trim() }
    : { title: withoutTrackNo, artist: null };
}

export interface ScanResult {
  added: number;
  removed: number;
  total: number;
}

export async function scanDeviceMusic(): Promise<ScanResult> {
  if (Platform.OS !== 'android' || !(await requestAudioPermission())) {
    return { added: 0, removed: 0, total: 0 };
  }

  const { dirs } = ReactNativeBlobUtil.fs;
  const roots = [
    dirs.LegacyMusicDir,
    dirs.LegacyDownloadDir,
    '/storage/emulated/0/Audio',
  ];
  const files: FoundFile[] = [];
  for (const root of roots) await walk(root, 0, files);

  const known = await getDeviceTrackIds();
  const found = new Set<string>();
  const added: Track[] = [];
  const restored: Track[] = [];

  for (const { path, size } of files) {
    // A download kept in Music/stash (e.g. after reinstalling): the same song again.
    const kept = path.startsWith(KEEP_DIR)
      ? parseKeptFileName(path.split('/').pop() ?? '')
      : null;
    if (kept) {
      const keptId = trackIdFor(kept.source, kept.sourceId);
      if (await getTrack(keptId)) continue; // already in the library
      const track: Track = {
        id: keptId,
        source: kept.source,
        sourceId: kept.sourceId,
        title: kept.sourceId, // replaced by the real title right after (restoreDetails)
        artist: null,
        album: null,
        genre: null,
        duration: null,
        filePath: path,
        artworkPath: null,
        remoteArtworkUrl: null,
        status: 'ready',
        liked: false,
        sizeBytes: size,
        waveform: null,
        addedAt: Date.now(),
        savedAt: Date.now(),
        lastPlayedAt: null,
      };
      await upsertTrack(track);
      restored.push(track);
      continue;
    }
    const id = trackIdFor('device', path);
    found.add(id);
    if (known.has(id)) continue;
    const { title, artist } = parseFileName(path);
    const track: Track = {
      id,
      source: 'device',
      sourceId: path,
      title,
      artist,
      album: path.split('/').slice(-2, -1)[0] ?? null,
      genre: null,
      duration: null, // filled in the first time the song is played
      filePath: path,
      artworkPath: null,
      remoteArtworkUrl: null,
      status: 'ready',
      liked: false,
      sizeBytes: size,
      waveform: null,
      addedAt: Date.now(),
      savedAt: null,
      lastPlayedAt: null,
    };
    await upsertTrack(track);
    added.push(track);
  }

  let removed = 0;
  for (const id of known) {
    if (!found.has(id)) {
      await deleteTrackRow(id);
      removed++;
    }
  }

  // Covers (and restored songs' titles) are fetched in the background, one at a
  // time, so the scan result shows immediately.
  (async () => {
    for (const t of restored) await restoreDetails(t).catch(() => {});
    for (const t of added) {
      const fresh = await getTrack(t.id);
      if (fresh) await ensureArtwork(fresh, true);
    }
  })();

  return {
    added: added.length + restored.length,
    removed,
    total: found.size + restored.length,
  };
}

/** A song restored from Music/stash: its title, artist and cover, looked up online by id. */
async function restoreDetails(t: Track) {
  if (t.source === 'youtube') {
    const d = await innertubeVideoDetails(t.sourceId);
    if (d) {
      await updateTrack(t.id, {
        title: d.title,
        artist: d.artist,
        duration: d.duration,
        remoteArtworkUrl: d.thumbnailUrl,
      });
    }
  }
  const fresh = await getTrack(t.id);
  if (fresh) await ensureArtwork(fresh, true);
}
