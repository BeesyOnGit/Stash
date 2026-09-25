import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAllTracks, getPlaylists, subscribeLibrary } from '../db/database';
import {
  getDownloadProgress,
  getDownloadsVersion,
  subscribeDownloads,
} from '../services/downloader';
import type { Playlist, Track } from '../types';
import { tr } from '../i18n';
import { PlayerService } from './PlayerService';

export const usePlayerState = () =>
  useSyncExternalStore(PlayerService.subscribe, PlayerService.getState);

export const useProgress = () =>
  useSyncExternalStore(
    PlayerService.subscribeProgress,
    PlayerService.getProgress,
  );

export const useCurrentTrack = () => {
  const { queue, index } = usePlayerState();
  return queue[index] ?? null;
};

/**
 * What's left on the sleep timer ("12 min", "40 s", "End of song"), in the
 * app's language, or null when off. To tell "end of song" apart, check
 * `usePlayerState().sleep` (it has `endOfSong` instead of `at`).
 */
export function useSleepLeft(): string | null {
  const { sleep } = usePlayerState();
  const [now, setNow] = useState(Date.now());
  const at = sleep && 'at' in sleep ? sleep.at : null;
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  if (!sleep) return null;
  if (!at) return tr('player.sleepEndOfSong');
  const s = Math.max(0, Math.round((at - now) / 1000));
  return s >= 60
    ? tr('player.sleepMinutes', { count: Math.ceil(s / 60) })
    : tr('player.sleepSeconds', { count: s });
}

/** 0..1 while the track is being downloaded, otherwise undefined. */
export const useDownloadProgress = (id: string | undefined) =>
  useSyncExternalStore(subscribeDownloads, () =>
    id ? getDownloadProgress(id) : undefined,
  );

/** Re-renders on any download progress change. */
export const useDownloads = () =>
  useSyncExternalStore(subscribeDownloads, getDownloadsVersion);

// ---- library: one shared, cached copy for every screen ----

interface LibrarySnapshot {
  tracks: Track[];
  byId: Map<string, Track>;
  playlists: Playlist[];
  loading: boolean;
}

let library: LibrarySnapshot = {
  tracks: [],
  byId: new Map(),
  playlists: [],
  loading: true,
};
const libListeners = new Set<() => void>();
let unsubDb: (() => void) | null = null;

async function reloadLibrary() {
  const [tracks, playlists] = await Promise.all([
    getAllTracks(),
    getPlaylists(),
  ]);
  const byId = new Map(tracks.map(t => [t.id, t]));
  library = { tracks, byId, playlists, loading: false };
  PlayerService.refreshFromLibrary(byId);
  libListeners.forEach(fn => fn());
}

function subscribeLib(fn: () => void) {
  libListeners.add(fn);
  if (!unsubDb) {
    unsubDb = subscribeLibrary(reloadLibrary);
    reloadLibrary();
  }
  return () => {
    libListeners.delete(fn);
  };
}

/** The same shared library, outside React (the car bridge). */
export const subscribeLibrarySnapshot = subscribeLib;
export const getLibrarySnapshot = () => library;

/** All library tracks (newest first) and playlists, kept fresh as the library changes. */
export const useLibrary = () =>
  useSyncExternalStore(subscribeLib, () => library);
