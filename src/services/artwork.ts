/**
 * Album / single / song cover art.
 * - Online tracks: the source thumbnail, or (for YouTube) a real cover from the iTunes Search API.
 * - Device files: looked up on the iTunes Search API from the title/artist.
 * The image is always saved locally, so covers keep showing offline.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { updateTrack } from '../db/database';
import type { Track } from '../types';
import { getJson } from '../sources/http';
import { ARTWORK_DIR, safeFileName } from './paths';
import { getSettings } from './settings';

interface ItunesSearch {
  results: Array<{
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    primaryGenreName?: string;
    artworkUrl100?: string;
  }>;
}

export interface CoverMatch {
  url: string;
  album: string | null;
  artist: string | null;
  genre: string | null;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Finds a 600×600 cover for a song. Returns null when there is no confident match. */
export async function lookupCover(
  title: string,
  artist: string | null,
): Promise<CoverMatch | null> {
  const term = [artist, title].filter(Boolean).join(' ');
  if (!term) return null;
  try {
    const data = await getJson<ItunesSearch>(
      `https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(
        term,
      )}`,
      8000,
    );
    const wanted = normalize(title);
    // Prefer a result whose track name matches, so we don't show some random album.
    const hit =
      data.results.find(
        r => r.trackName && normalize(r.trackName).includes(wanted),
      ) ??
      (artist
        ? data.results.find(
            r => r.artistName && normalize(r.artistName) === normalize(artist),
          )
        : undefined);
    if (!hit?.artworkUrl100) return null;
    return {
      url: hit.artworkUrl100.replace('100x100bb', '600x600bb'),
      album: hit.collectionName ?? null,
      genre: hit.primaryGenreName ?? null,
      artist: hit.artistName ?? null,
    };
  } catch {
    return null;
  }
}

async function saveImage(trackId: string, url: string): Promise<string | null> {
  const path = `${ARTWORK_DIR}/${safeFileName(trackId)}.jpg`;
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
 * Makes sure a track has a locally saved cover, and fills in album and genre when found.
 * @param preferLookup use the looked-up cover over the source's (YouTube thumbnails are video frames)
 */
export async function ensureArtwork(
  track: Track,
  preferLookup: boolean,
): Promise<void> {
  if (track.artworkPath && track.genre) return;
  const { fetchCoverArt } = getSettings();

  let url = track.remoteArtworkUrl;
  let album = track.album;
  let genre = track.genre;
  if (fetchCoverArt) {
    const match = await lookupCover(track.title, track.artist);
    if (match) {
      if (preferLookup || !url) url = match.url;
      album = album ?? match.album;
      genre = genre ?? match.genre;
    }
  }

  const artworkPath =
    track.artworkPath ?? (url ? await saveImage(track.id, url) : null);
  await updateTrack(track.id, {
    artworkPath,
    remoteArtworkUrl: url,
    album,
    genre,
  });
}
