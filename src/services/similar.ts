/**
 * "Similar songs", the way YouTube recommends them: the song's YouTube Music
 * "up next" radio (related songs by the same and other artists). Songs from that
 * radio that are already in the library play offline; the rest stream.
 *
 * Offline (or when YouTube can't be reached) it falls back to the library songs
 * that share the artist, album or genre.
 */
import { fold } from '../sources/http';
import { isOnline } from './network';
import { innertubeFindVideo, innertubeUpNext } from '../sources/innertube';
import { trackIdFor, type OnlineResult, type Track } from '../types';

export interface Similar {
  /** In the library, best first. */
  local: Track[];
  /** Not in the library yet (from YouTube). */
  online: OnlineResult[];
  /** True when based on YouTube's recommendations, false for the offline fallback. */
  fromYoutube: boolean;
}

const firstArtist = (a: string | null) =>
  fold((a ?? '').split(/,|&| feat/i)[0]);
const key = (title: string, artist: string | null) =>
  `${fold(title)}|${firstArtist(artist)}`;

function score(seed: Track, t: Track) {
  return (
    (firstArtist(t.artist) && firstArtist(t.artist) === firstArtist(seed.artist)
      ? 2
      : 0) +
    (t.album && fold(t.album) === fold(seed.album ?? '') ? 1 : 0) +
    (t.genre && fold(t.genre) === fold(seed.genre ?? '') ? 1 : 0)
  );
}

/** Library songs sharing the artist, album or genre (instant, works offline). */
export function similarInLibrary(
  seed: Track,
  library: Track[],
  limit = 8,
): Track[] {
  return library
    .filter(t => t.id !== seed.id && t.status === 'ready')
    .map(t => ({ t, s: score(seed, t) }))
    .filter(x => x.s > 0)
    .sort(
      (a, b) => b.s - a.s || (b.t.lastPlayedAt ?? 0) - (a.t.lastPlayedAt ?? 0),
    )
    .slice(0, limit)
    .map(x => x.t);
}

const radioCache = new Map<string, Promise<OnlineResult[]>>();

/** YouTube's up-next radio for a song (cached for the session). */
function youtubeRadio(seed: Track): Promise<OnlineResult[]> {
  let pending = radioCache.get(seed.id);
  if (!pending) {
    pending = (async () => {
      const videoId =
        seed.source === 'youtube'
          ? seed.sourceId
          : await innertubeFindVideo(seed.title, seed.artist);
      return videoId ? innertubeUpNext(videoId) : [];
    })();
    radioCache.set(seed.id, pending);
    // Don't keep a failure (e.g. offline) for the whole session.
    pending.catch(() => radioCache.delete(seed.id));
  }
  return pending;
}

export async function similarFor(
  seed: Track,
  library: Track[],
  { localLimit = 10, onlineLimit = 12 } = {},
): Promise<Similar> {
  const fallback = similarInLibrary(seed, library, localLimit);
  if (!isOnline()) return { local: fallback, online: [], fromYoutube: false };
  let radio: OnlineResult[];
  try {
    radio = await youtubeRadio(seed);
  } catch {
    return { local: fallback, online: [], fromYoutube: false };
  }
  if (!radio.length) return { local: fallback, online: [], fromYoutube: false };

  const ready = library.filter(t => t.status === 'ready' && t.id !== seed.id);
  const byId = new Map(ready.map(t => [t.id, t]));
  const byKey = new Map(ready.map(t => [key(t.title, t.artist), t]));
  const seedKey = key(seed.title, seed.artist);

  const local: Track[] = [];
  const online: OnlineResult[] = [];
  const seen = new Set<string>([seedKey]);
  for (const r of radio) {
    const k = key(r.title, r.artist);
    if (seen.has(k)) continue;
    seen.add(k);
    const mine = byId.get(trackIdFor(r.source, r.sourceId)) ?? byKey.get(k);
    if (mine) local.push(mine);
    else online.push(r);
  }
  // Top up with same-artist/genre songs from the library.
  for (const t of fallback) {
    if (local.length >= localLimit) break;
    if (!local.includes(t)) local.push(t);
  }
  return {
    local: local.slice(0, localLimit),
    online: online.slice(0, onlineLimit),
    fromYoutube: true,
  };
}
