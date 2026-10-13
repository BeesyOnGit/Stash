/** The huddle on the phone: ./core, with the phone's files, downloads and player. */
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getTrack } from '../db/database';
import { tr } from '../i18n';
import { PlayerService } from '../player/PlayerService';
import { extensionFor, fetchStream } from '../services/downloader';
import { whileAway } from '../services/keepAlive';
import { safeFileName } from '../services/paths';
import { sourceFor } from '../sources';
import type { OnlineResult, QueueItem, TrackSource } from '../types';
import { createHuddle, type SharedTrack } from './core';
import { HUDDLE_SERVER } from './server';

export * from './core';

const { fs } = ReactNativeBlobUtil;
const CACHE_DIR = `${fs.dirs.CacheDir}/huddle`;

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
    streamUrl: path ? `file://${path}` : undefined,
  };
}

export const huddle = createHuddle({
  serverUrl: () => HUDDLE_SERVER,
  async cache(t, onProgress) {
    const saved = await getTrack(t.key);
    if (saved?.status === 'ready' && saved.filePath) return saved.filePath;
    if (!(await fs.exists(CACHE_DIR))) await fs.mkdir(CACHE_DIR);
    const name = `${CACHE_DIR}/${safeFileName(t.key)}`;
    const result: OnlineResult = {
      source: t.source as OnlineResult['source'],
      sourceId: t.sourceId,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      thumbnailUrl: t.artwork,
    };
    const stream = await whileAway(() => sourceFor(result.source).resolveStream(result));
    const path = `${name}.${extensionFor(stream.mimeType, stream.url)}`;
    await fetchStream(stream, path, `${name}.part`, onProgress);
    return path;
  },
  async clearCache() {
    if (await fs.exists(CACHE_DIR)) await fs.unlink(CACHE_DIR);
  },
  player: {
    load: (items, index) =>
      PlayerService.huddleLoad(
        items.map(i => toItem(i.track, i.path)),
        index,
        tr('huddle.ctx'),
      ),
    play: () => PlayerService.localPlay(),
    pause: () => PlayerService.localPause(),
    seek: s => PlayerService.localSeek(s),
    position: () => PlayerService.getProgress().position,
    isPlaying: () => PlayerService.getState().isPlaying,
    setRemote: r => PlayerService.setRemote(r),
    stop: () => PlayerService.stop(),
  },
});

export const useHuddle = () =>
  useSyncExternalStore(huddle.subscribe, huddle.getView);

// Android pauses JS timers in the background: keep them running while in a
// huddle, so the music stays in step and the next song is cached.
// ponytail: chained 60 s holds; a foreground service if Android starts killing them
let holding = false;
AppState.addEventListener('change', async s => {
  if (s === 'active' || holding) return;
  holding = true;
  while (AppState.currentState !== 'active' && huddle.getView().status !== 'idle') {
    await whileAway(() => new Promise<void>(r => setTimeout(r, 55_000)));
  }
  holding = false;
});
