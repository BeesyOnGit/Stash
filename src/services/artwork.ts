/**
 * A song's details and cover art, from the music catalogues (services/metadata):
 * - its official title and artist, instead of the video's or the file's name;
 * - album and genre;
 * - a real cover (for YouTube songs and phone files; other sources keep theirs
 *   unless they have none).
 * Looked up once per song. The cover is always saved on the phone, so it shows offline.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  clearDetailChecks,
  getAllTracks,
  getSettingSync,
  getTrack,
  setSettingSync,
  updateTrack,
} from '../db/database';
import type { Track } from '../types';
import { LOOKUP_REVISION, lookupArtistPicture, lookupSong } from './metadata';
import { isOnline, subscribeNetwork } from './network';
import { ARTWORK_DIR, removeFile, safeFileName } from './paths';
import { getSettings } from './settings';

async function saveImage(trackId: string, url: string): Promise<string | null> {
  // A new name each time: the image views cache by path, so a replaced cover
  // saved under the old name would keep showing the old one.
  const path = `${ARTWORK_DIR}/${safeFileName(trackId)}-${Date.now()}.jpg`;
  try {
    const res = await ReactNativeBlobUtil.config({ path }).fetch('GET', url);
    if (res.info().status >= 400) {
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * Looks the song up (once) and saves its cover on the phone.
 * @param preferLookup use the catalogue's cover over the source's (YouTube thumbnails are video frames)
 */
export async function ensureArtwork(
  track: Track,
  preferLookup: boolean,
): Promise<void> {
  const { fetchCoverArt } = getSettings();
  const lookUp = fetchCoverArt && !track.metaCheckedAt && isOnline();
  if (!lookUp && track.artworkPath) return;

  let { title, artist, album, genre } = track;
  // Always matched from what the song came with, so a wrong lookup can be undone.
  const sourceTitle = track.sourceTitle ?? track.title;
  const sourceArtist = track.sourceTitle ? track.sourceArtist : track.artist;
  let url = track.remoteArtworkUrl;
  let newCover = false;
  if (lookUp) {
    title = sourceTitle;
    artist = sourceArtist ?? null;
    const found = await lookupSong(sourceTitle, sourceArtist ?? null);
    if (found) {
      title = found.title;
      artist = found.artist;
      album = found.album ?? album;
      genre = found.genre ?? genre;
    }
    // No cover from the catalogues: the artist's picture rather than a video frame.
    const cover =
      found?.coverUrl ??
      (preferLookup
        ? await lookupArtistPicture(
            found?.title ?? title,
            found?.artist ?? artist,
          )
        : null);
    if (cover && (preferLookup || !url)) {
      newCover = cover !== url;
      url = cover;
    }
  }

  let artworkPath = track.artworkPath;
  if (url && (!artworkPath || newCover)) {
    const saved = await saveImage(track.id, url);
    if (saved) {
      if (artworkPath) await removeFile(artworkPath).catch(() => {});
      artworkPath = saved;
    }
  }
  await updateTrack(track.id, {
    title,
    artist,
    album,
    genre,
    artworkPath,
    remoteArtworkUrl: url,
    ...(lookUp ? { metaCheckedAt: Date.now(), sourceTitle, sourceArtist } : {}),
  });
}

let tidying = false;

/**
 * Songs saved before this existed (or while offline) get their details looked
 * up in the background, one at a time; again whenever the connection comes back.
 */
export function startDetailsLookup() {
  const run = async () => {
    if (tidying || !isOnline() || !getSettings().fetchCoverArt) return;
    tidying = true;
    try {
      if (Number(getSettingSync('lookupRevision') ?? 0) < LOOKUP_REVISION) {
        await clearDetailChecks();
        setSettingSync('lookupRevision', String(LOOKUP_REVISION));
      }
      const todo = (await getAllTracks()).filter(
        t => t.status === 'ready' && !t.metaCheckedAt,
      );
      for (const t of todo) {
        if (!isOnline()) break;
        const fresh = await getTrack(t.id);
        if (fresh && !fresh.metaCheckedAt)
          await ensureArtwork(fresh, fresh.source !== 'jamendo');
      }
    } finally {
      tidying = false;
    }
  };
  run().catch(() => {});
  return subscribeNetwork(() => {
    run().catch(() => {});
  });
}
