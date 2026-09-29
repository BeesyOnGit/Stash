/**
 * Finds music files already on the computer (the Music and Downloads folders)
 * and adds them to the library. Songs stash saved before, in Music/stash, come
 * back as the same songs (after a reinstall, or from another computer).
 */
import {
  attachFile,
  deleteTrackRow,
  getDeviceTrackPaths,
  getTrack,
  updateTrack,
  upsertTrack,
} from '../db/database';
import { baseName, getDirs, scanAudio } from '../native';
import { innertubeVideoDetails } from '../sources/innertube';
import { trackIdFor, type Track, type TrackSource } from '../types';
import { ensureArtwork } from './artwork';
import { keepDir } from './paths';

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav|wma|alac|aiff?)$/i;

/**
 * Kept files keep the name they were downloaded with, "youtube_<id>.m4a" or
 * "jamendo_<id>.mp3", which is enough to know which song a file is.
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

/** "Artist - Title.mp3" → { artist, title }; otherwise the file name is the title. */
function parseFileName(path: string): { title: string; artist: string | null } {
  const base = baseName(path).replace(AUDIO_EXT, '').replace(/_/g, ' ').trim();
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

const samePath = (a: string, b: string) =>
  a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

export async function scanDeviceMusic(): Promise<ScanResult> {
  const { music, downloads } = getDirs();
  const roots = [music, downloads].filter((x): x is string => !!x);
  const files = await scanAudio(roots);
  const keep = keepDir();
  const karaoke = `${music}/Karaoke`;

  // Songs already in the library, by path (their id comes from their audio once hashed).
  const known = await getDeviceTrackPaths();
  const found = new Set<string>();
  const added: Track[] = [];
  const restored: Track[] = [];

  for (const { path, size } of files) {
    const folder = path.replace(/[\\/][^\\/]*$/, '');
    // Karaoke takes are listed under Saving, not as songs.
    if (samePath(folder, karaoke)) continue;
    // A download kept in Music/stash: the same song again.
    const kept = samePath(folder, keep) ? parseKeptFileName(baseName(path)) : null;
    if (kept) {
      const keptId = trackIdFor(kept.source, kept.sourceId);
      if (await getTrack(keptId)) continue; // already in the library
      if (await attachFile(keptId, path)) continue; // synced, waiting for this file
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
    const knownId = known.get(path);
    if (knownId) {
      found.add(knownId);
      continue;
    }
    // Until its audio is hashed (sync/files), a new song's id is its path.
    const id = trackIdFor('device', path);
    found.add(id);
    const { title, artist } = parseFileName(path);
    const track: Track = {
      id,
      source: 'device',
      sourceId: path,
      title,
      artist,
      album: baseName(folder) || null,
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
  for (const id of known.values()) {
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
      if (fresh) await ensureArtwork(fresh, true).catch(() => {});
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
