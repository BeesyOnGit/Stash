/** The huddle on the computer: ./core, with the computer's files, downloads and player. */
import { useSyncExternalStore } from 'react';
import { getTrack } from '../db/database';
import { tr } from '../i18n';
import { downloadTo, fileSrc, fs, getDirs, pathJoin } from '../native';
import { PlayerService } from '../player/PlayerService';
import { extensionFor } from '../services/downloader';
import { safeFileName } from '../services/paths';
import { sourceFor } from '../sources';
import type { OnlineResult, QueueItem, TrackSource } from '../types';
import { createHuddle, type SharedTrack } from './core';
import { HUDDLE_SERVER } from './server';

export * from './core';

const cacheDir = () => pathJoin(getDirs().cache, 'huddle');

function toItem(t: SharedTrack, path: string | null): QueueItem {
  return {
    id: t.key,
    source: t.source as TrackSource,
    sourceId: t.sourceId,
    title: t.title,
    artist: t.artist,
    album: t.album,
    genre: null,
    duration: t.duration,
    filePath: null,
    artworkPath: null,
    remoteArtworkUrl: t.artwork,
    // Not a library song: nothing about it is written to the library.
    status: 'streaming',
    liked: false,
    sizeBytes: null,
    waveform: null,
    addedAt: Date.now(),
    savedAt: null,
    lastPlayedAt: null,
    streamUrl: path ? fileSrc(path) : undefined,
  };
}

export const huddle = createHuddle({
  serverUrl: () => HUDDLE_SERVER,
  async cache(t, onProgress) {
    const saved = await getTrack(t.key);
    if (saved?.status === 'ready' && saved.filePath) return saved.filePath;
    await fs.mkdir(cacheDir()).catch(() => {});
    const name = pathJoin(cacheDir(), safeFileName(t.key));
    const progress = (r: number, total: number) => onProgress(total > 0 ? r / total : 0);
    const result: OnlineResult = {
      source: t.source as OnlineResult['source'],
      sourceId: t.sourceId,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      thumbnailUrl: t.artwork,
    };
    const stream = await sourceFor(result.source).resolveStream(result);
    const path = `${name}.${extensionFor(stream.mimeType, stream.url)}`;
    await downloadTo(stream.url, path, {
      headers: stream.headers,
      chunked: !!stream.chunked && !!stream.contentLength,
      total: stream.contentLength,
      onProgress: (r, total) => progress(r, total || stream.contentLength || 0),
    });
    return path;
  },
  clearCache: () => fs.remove(cacheDir()),
  player: {
    load: (items, index) =>
      PlayerService.huddleLoad(items.map(i => toItem(i.track, i.path)), index, tr('huddle.ctx')),
    play: () => PlayerService.localPlay(),
    pause: () => PlayerService.localPause(),
    seek: s => PlayerService.localSeek(s),
    position: () => PlayerService.getProgress().position,
    isPlaying: () => PlayerService.getState().isPlaying,
    setRemote: r => PlayerService.setRemote(r),
    stop: () => PlayerService.stop(),
  },
});

export const useHuddle = () => useSyncExternalStore(huddle.subscribe, huddle.getView);
