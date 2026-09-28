/**
 * The native side (src-tauri): files, downloads, audio and the app's folders.
 * Everything the phone app did with react-native-blob-util goes through here.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  appCacheDir,
  appDataDir,
  audioDir,
  downloadDir,
  homeDir,
  join,
  sep,
} from '@tauri-apps/api/path';

// ---- folders ----

export interface Dirs {
  /** The computer's Music folder. */
  music: string;
  downloads: string | null;
  /** App-private data (library database, covers, instrumentals, the model). */
  data: string;
  cache: string;
  sep: string;
}

let dirs: Dirs | null = null;

/** Resolved once at startup (see initNative); the paths never change afterwards. */
export async function initNative(): Promise<Dirs> {
  if (dirs) return dirs;
  const data = await appDataDir();
  const music = await audioDir().catch(async () =>
    join(await homeDir(), 'Music'),
  );
  dirs = {
    music,
    downloads: await downloadDir().catch(() => null),
    data,
    cache: await appCacheDir(),
    sep: sep(),
  };
  return dirs;
}

export const getDirs = (): Dirs => {
  if (!dirs) throw new Error('initNative() first');
  return dirs;
};

/** Joins path parts with the system separator (synchronous, for already-resolved folders). */
export const pathJoin = (...parts: string[]) => {
  const s = getDirs().sep;
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(s);
};

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const dirName = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

/** A URL the web view can load a local file from (audio, images). */
export const fileSrc = (path: string) => convertFileSrc(path);

// ---- files ----

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export const fs = {
  exists: (path: string) => invoke<boolean>('fs_exists', { path }),
  remove: (path: string) => invoke<void>('fs_remove', { path }),
  mkdir: (path: string) => invoke<void>('fs_mkdir', { path }),
  list: (path: string) => invoke<Entry[]>('fs_list', { path }),
  stat: (path: string) =>
    invoke<{ size: number; modified: number; is_dir: boolean } | null>(
      'fs_stat',
      { path },
    ),
  rename: (from: string, to: string) => invoke<void>('fs_rename', { from, to }),
  copy: (from: string, to: string) => invoke<void>('fs_copy', { from, to }),
  readText: (path: string) => invoke<string | null>('fs_read_text', { path }),
  writeText: (path: string, text: string) =>
    invoke<void>('fs_write_text', { path, text }),
  writeBytes: (path: string, data: Uint8Array | ArrayBuffer) =>
    invoke<void>(
      'fs_write_bytes',
      data instanceof Uint8Array ? data : new Uint8Array(data),
      { headers: { 'x-path': encodeURIComponent(path) } },
    ),
  sha256: (path: string) => invoke<string>('fs_sha256', { path }),
};

/** Removes a file if it's there; never throws. */
export async function removeFile(path: string | null | undefined) {
  if (path) await fs.remove(path).catch(() => {});
}

export const scanAudio = (roots: string[], maxDepth = 6) =>
  invoke<{ path: string; size: number }[]>('scan_audio', { roots, maxDepth });

export const audioDuration = (path: string) =>
  invoke<number | null>('audio_duration', { path });

// ---- downloads ----

export interface DownloadOptions {
  headers?: Record<string, string>;
  /** In ranged chunks (YouTube throttles one big request); needs `total`. */
  chunked?: boolean;
  total?: number;
  onProgress?: (received: number, total: number) => void;
}

const progressFns = new Map<string, (received: number, total: number) => void>();
let progressListening: Promise<unknown> | null = null;

function listenProgress() {
  if (!progressListening) {
    progressListening = listen<{ id: string; received: number; total: number }>(
      'download-progress',
      e => progressFns.get(e.payload.id)?.(e.payload.received, e.payload.total),
    );
  }
  return progressListening;
}

let downloadSeq = 0;

/**
 * Downloads `url` into `dest` (via `dest.part`). Resolves with the size in
 * bytes; rejects on HTTP errors or cancel (see cancelDownloadJob).
 */
export async function downloadTo(
  url: string,
  dest: string,
  opts: DownloadOptions = {},
  id = `dl-${Date.now()}-${downloadSeq++}`,
): Promise<number> {
  if (opts.onProgress) {
    await listenProgress();
    progressFns.set(id, opts.onProgress);
  }
  try {
    return await invoke<number>('download_start', {
      id,
      url,
      dest,
      headers: opts.headers ?? null,
      chunked: opts.chunked ?? false,
      total: opts.total ?? null,
    });
  } finally {
    progressFns.delete(id);
  }
}

export const cancelDownloadJob = (id: string) =>
  invoke<void>('download_cancel', { id }).catch(() => {});

// ---- windows / app ----

export const showMainWindow = () => invoke<void>('show_main_window');
export const quitApp = () => invoke<void>('quit_app');
export const traySetPlaying = (
  playing: boolean,
  title: string | null,
  playLabel: string,
  pauseLabel: string,
) =>
  invoke<void>('tray_set_playing', {
    playing,
    title,
    playLabel,
    pauseLabel,
  }).catch(() => {});
