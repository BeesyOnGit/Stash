/**
 * YouTube directly from the phone with youtubei.js (no server in between),
 * like NewPipe. The phone's own connection is rarely blocked, unlike public
 * Piped/Invidious instances.
 *
 * - Search: YouTube Music songs (clean titles, albums, square covers) plus
 *   videos, for music that was only ever uploaded as a video.
 * - Audio: the VISIONOS client, which currently returns full audio streams
 *   without a proof-of-origin token. We keep the original audio (AAC in M4A,
 *   Opus as fallback) — no re-encoding, so no quality loss.
 */
import Innertube, { Log, Platform } from 'youtubei.js/react-native';
import type { OnlineResult, ResolvedStream } from '../types';
import { fold, splitArtistTitle } from './http';

Log.setLevel(Log.Level.NONE);
// youtubei.js runs YouTube's player script to decipher stream URLs.
// eslint-disable-next-line no-new-func -- evaluating that script is the point
Platform.shim.eval = async data => new Function(data.output)();

/** Clients tried in order when resolving audio; the first with full streams wins. */
const AUDIO_CLIENTS = ['VISIONOS', 'IOS'] as const;

let session: Promise<Innertube> | null = null;

function getSession(): Promise<Innertube> {
  if (!session) {
    session = Innertube.create({ retrieve_player: true }).catch(e => {
      session = null; // retry on the next call
      throw e;
    });
  }
  return session;
}

/** YouTube Music thumbnails come with a size in the URL; ask for a big square one. */
function bigThumb(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/=w\d+-h\d+/, '=w544-h544');
}

const artistsOf = (list: Array<{ name: string }> | undefined) =>
  list?.map(a => a.name).join(', ') || null;

function toResult(
  item: any,
  title: string,
  artist: string | null,
): OnlineResult {
  const thumbs = [...(item.thumbnails ?? [])].sort(
    (a: any, b: any) => (b.width ?? 0) - (a.width ?? 0),
  );
  return {
    source: 'youtube' as const,
    sourceId: String(item.id),
    title,
    artist,
    album: item.album?.name ?? null,
    duration: item.duration?.seconds ?? null,
    thumbnailUrl: bigThumb(thumbs[0]?.url),
  };
}

/**
 * YouTube Music "songs" and "videos" together. Many songs (e.g. a lot of North
 * African, indie or older music) only exist as uploaded videos, so searching
 * songs alone misses them. Results whose title matches the query come first;
 * at equal match, official songs rank above videos.
 */
export async function innertubeSearch(query: string): Promise<OnlineResult[]> {
  const yt = await getSession();
  const [songRes, videoRes] = await Promise.allSettled([
    yt.music.search(query, { type: 'song' }),
    yt.music.search(query, { type: 'video' }),
  ]);
  if (songRes.status === 'rejected' && videoRes.status === 'rejected') {
    throw songRes.reason;
  }
  const songs = (
    songRes.status === 'fulfilled' ? songRes.value.songs?.contents ?? [] : []
  ) as any[];
  const videos = (
    videoRes.status === 'fulfilled' ? videoRes.value.videos?.contents ?? [] : []
  ) as any[];

  const results: Array<OnlineResult & { rank: number }> = [];
  const seen = new Set<string>();
  const words = fold(query).split(' ').filter(Boolean);
  const add = (r: OnlineResult, isVideo: boolean) => {
    const k = `${fold(r.title)}|${fold(r.artist ?? '')}`;
    if (seen.has(k)) return;
    seen.add(k);
    const title = fold(r.title);
    const all = fold(`${r.title} ${r.artist ?? ''}`);
    const inTitle = words.every(w => title.includes(w));
    const inAny = words.every(w => all.includes(w));
    results.push({
      ...r,
      rank: (inTitle ? 0 : inAny ? 2 : 4) + (isVideo ? 1 : 0),
    });
  };
  for (const s of songs.filter(x => x?.id)) {
    add(
      toResult(s, String(s.title ?? 'Unknown title'), artistsOf(s.artists)),
      false,
    );
  }
  for (const v of videos.filter(x => x?.id)) {
    const { title, artist } = splitArtistTitle(
      String(v.title ?? 'Unknown title'),
      artistsOf(v.authors ?? v.artists),
    );
    add(toResult(v, title, artist), true);
  }
  // Stable sort: YouTube's own order is kept within each rank.
  return results
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _rank, ...r }) => r);
}

/**
 * What YouTube Music plays after this song (its "up next" radio): related songs
 * by the same and other artists, the way YouTube recommends them.
 */
export async function innertubeUpNext(
  videoId: string,
): Promise<OnlineResult[]> {
  const yt = await getSession();
  const panel = await yt.music.getUpNext(videoId, true);
  return ((panel.contents ?? []) as any[])
    .filter(v => v?.video_id && v.video_id !== videoId)
    .map(v => {
      const thumbs = [...(v.thumbnail ?? [])].sort(
        (a: any, b: any) => (b.width ?? 0) - (a.width ?? 0),
      );
      return {
        source: 'youtube' as const,
        sourceId: String(v.video_id),
        title: String(v.title?.toString() ?? 'Unknown title'),
        artist: artistsOf(v.artists) ?? (v.author ? String(v.author) : null),
        album: v.album?.name ?? null,
        duration: v.duration?.seconds ?? null,
        thumbnailUrl: bigThumb(thumbs[0]?.url),
      };
    });
}

/** The YouTube video for a song from elsewhere (phone file, Jamendo), for its up-next radio. */
export async function innertubeFindVideo(
  title: string,
  artist: string | null,
): Promise<string | null> {
  const yt = await getSession();
  const res = await yt.music.search([title, artist].filter(Boolean).join(' '), {
    type: 'song',
  });
  const first = (res.songs?.contents ?? [])[0] as any;
  return first?.id ? String(first.id) : null;
}

export async function innertubeStream(
  videoId: string,
): Promise<ResolvedStream> {
  const yt = await getSession();
  let lastError: unknown = null;
  for (const client of AUDIO_CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      // M4A/AAC first: plays on Android and iOS and is a normal audio file once saved.
      let format;
      try {
        format = info.chooseFormat({
          type: 'audio',
          quality: 'best',
          format: 'mp4',
        });
      } catch {
        format = info.chooseFormat({
          type: 'audio',
          quality: 'best',
          format: 'any',
        });
      }
      const url = await format.decipher(yt.session.player);
      if (!url) throw new Error('No playable URL');
      return {
        url,
        mimeType: format.mime_type?.split(';')[0] ?? null,
        bitrate: format.bitrate,
        contentLength: format.content_length
          ? Number(format.content_length)
          : undefined,
        // googlevideo throttles one big request; ranged chunks download at full speed.
        chunked: true,
      };
    } catch (e) {
      lastError = e;
    }
  }
  // The session may be stale (e.g. the player script changed): start fresh next time.
  session = null;
  throw lastError instanceof Error
    ? lastError
    : new Error('YouTube stream unavailable');
}

/** YouTube Music's lyrics for a video (plain text) and their credit, e.g. "Source: LyricFind". */
export async function innertubeLyrics(
  videoId: string,
): Promise<{ text: string; credit: string | null } | null> {
  const yt = await getSession();
  try {
    const shelf = (await yt.music.getLyrics(videoId)) as any;
    const text = shelf?.description?.toString()?.trim();
    if (!text) return null;
    const credit = shelf?.footer?.toString()?.trim() || null;
    return { text, credit };
  } catch {
    return null; // no lyrics tab for this song
  }
}
