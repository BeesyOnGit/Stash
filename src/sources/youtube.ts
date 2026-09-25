/**
 * YouTube search + audio streams. Three backends (Settings → Sources):
 * - `device` (default): straight from the phone with youtubei.js (./innertube.ts).
 * - `piped` / `invidious`: through an open-source front-end API instance.
 *   Public instances go up and down; self-hosting one is the reliable option.
 */
import { getSettings } from '../services/settings';
import { tr } from '../i18n';
import type { OnlineResult, ResolvedStream } from '../types';
import { getJson, splitArtistTitle } from './http';
import { innertubeSearch, innertubeStream } from './innertube';
import type { MusicSource } from './types';

// ---------- Piped ----------

interface PipedSearch {
  items: Array<{
    type: string;
    url: string; // "/watch?v=ID"
    title: string;
    thumbnail: string;
    uploaderName: string | null;
    duration: number;
  }>;
}

interface PipedStreams {
  audioStreams: Array<{ url: string; mimeType: string; bitrate: number }>;
}

async function pipedSearch(base: string, q: string): Promise<OnlineResult[]> {
  const data = await getJson<PipedSearch>(
    `${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`,
  );
  return data.items
    .filter(i => i.type === 'stream' && i.url?.includes('v='))
    .map(i => {
      const { title, artist } = splitArtistTitle(i.title, i.uploaderName);
      return {
        source: 'youtube' as const,
        sourceId: i.url.split('v=')[1].split('&')[0],
        title,
        artist,
        album: null,
        duration: i.duration > 0 ? i.duration : null,
        thumbnailUrl: i.thumbnail ?? null,
      };
    });
}

async function pipedStream(base: string, id: string): Promise<ResolvedStream> {
  const data = await getJson<PipedStreams>(`${base}/streams/${id}`);
  const best = pickBestAudio(
    data.audioStreams.map(s => ({
      url: s.url,
      mimeType: s.mimeType,
      bitrate: s.bitrate,
    })),
  );
  if (!best) throw new Error(tr('system.noStream'));
  return best;
}

// ---------- Invidious ----------

interface InvidiousSearchItem {
  type: string;
  videoId: string;
  title: string;
  author: string | null;
  lengthSeconds: number;
  videoThumbnails?: Array<{ quality: string; url: string }>;
}

interface InvidiousVideo {
  adaptiveFormats: Array<{
    url: string;
    type: string;
    bitrate: string | number;
  }>;
}

async function invidiousSearch(
  base: string,
  q: string,
): Promise<OnlineResult[]> {
  const items = await getJson<InvidiousSearchItem[]>(
    `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  );
  return items
    .filter(i => i.type === 'video')
    .map(i => {
      const { title, artist } = splitArtistTitle(i.title, i.author);
      const thumb =
        i.videoThumbnails?.find(t => t.quality === 'high') ??
        i.videoThumbnails?.[0];
      return {
        source: 'youtube' as const,
        sourceId: i.videoId,
        title,
        artist,
        album: null,
        duration: i.lengthSeconds > 0 ? i.lengthSeconds : null,
        thumbnailUrl: thumb ? absolute(base, thumb.url) : null,
      };
    });
}

async function invidiousStream(
  base: string,
  id: string,
): Promise<ResolvedStream> {
  // local=true: the instance proxies the audio, avoiding googlevideo IP-locking/throttling.
  const data = await getJson<InvidiousVideo>(
    `${base}/api/v1/videos/${id}?local=true`,
  );
  const best = pickBestAudio(
    data.adaptiveFormats
      .filter(f => f.type.startsWith('audio/'))
      .map(f => ({
        url: absolute(base, f.url),
        mimeType: f.type.split(';')[0],
        bitrate: Number(f.bitrate) || 0,
      })),
  );
  if (!best) throw new Error(tr('system.noStream'));
  return best;
}

// ---------- shared ----------

const absolute = (base: string, url: string) =>
  url.startsWith('http')
    ? url
    : url.startsWith('//')
    ? `https:${url}`
    : `${base}${url}`;

/**
 * Prefer AAC in MP4 (m4a): plays on both Android and iOS and is a normal file
 * once saved. Opus/WebM only plays on Android, so it is the fallback.
 */
function pickBestAudio(
  streams: Array<{ url: string; mimeType: string; bitrate: number }>,
): ResolvedStream | null {
  if (!streams.length) return null;
  const byBitrate = [...streams].sort((a, b) => b.bitrate - a.bitrate);
  const m4a = byBitrate.find(s => s.mimeType.includes('mp4'));
  const best = m4a ?? byBitrate[0];
  return { url: best.url, mimeType: best.mimeType, bitrate: best.bitrate };
}

export const youtubeSource: MusicSource = {
  id: 'youtube',
  name: 'YouTube',
  isEnabled: () => {
    const { youtubeBackend, youtubeInstance } = getSettings();
    return youtubeBackend === 'device' || !!youtubeInstance;
  },
  search: q => {
    const { youtubeBackend, youtubeInstance } = getSettings();
    if (youtubeBackend === 'device') return innertubeSearch(q);
    return youtubeBackend === 'piped'
      ? pipedSearch(youtubeInstance, q)
      : invidiousSearch(youtubeInstance, q);
  },
  resolveStream: r => {
    const { youtubeBackend, youtubeInstance } = getSettings();
    if (youtubeBackend === 'device') return innertubeStream(r.sourceId);
    return youtubeBackend === 'piped'
      ? pipedStream(youtubeInstance, r.sourceId)
      : invidiousStream(youtubeInstance, r.sourceId);
  },
  // Piped/Invidious thumbnails are 16:9 video frames, so look up a real album
  // cover; YouTube Music search already returns square album art.
  get preferCoverLookup() {
    return getSettings().youtubeBackend !== 'device';
  },
};
