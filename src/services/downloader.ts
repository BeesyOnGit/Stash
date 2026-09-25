/**
 * Saves online tracks into the library. Started at the same moment playback of
 * the stream starts, so the first listen also downloads the song; next time it
 * plays from the phone.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  deleteTrackRow,
  getTrack,
  getTracksByStatus,
  updateTrack,
} from '../db/database';
import { ensureArtwork } from './artwork';
import type { ResolvedStream, Track } from '../types';
import { convertToM4a, needsConversion } from './convert';
import { KEEP_DIR, downloadFolder, keepAfterUninstall } from './keep';
import { MUSIC_DIR, removeFile, safeFileName } from './paths';
import { ensureWaveform } from './waveform';

type Task = ReturnType<ReturnType<typeof ReactNativeBlobUtil.config>['fetch']>;

/** A running download: the current HTTP request, and whether it was cancelled. */
interface Job {
  task: Task | null;
  cancelled: boolean;
}

/** Ranged chunk size for sources that throttle one big request (YouTube). */
const CHUNK_BYTES = 10 * 1024 * 1024;

const active = new Map<string, Job>();
const progress = new Map<string, number>();
const listeners = new Set<() => void>();
/** Bumped on every change so useSyncExternalStore sees a new snapshot. */
let version = 0;

export const subscribeDownloads = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => {
  version++;
  listeners.forEach(fn => fn());
};
export const getDownloadsVersion = () => version;

/** 0..1, or undefined when the track isn't downloading. */
export const getDownloadProgress = (id: string) => progress.get(id);
export const isDownloading = (id: string) => active.has(id);
export const getActiveDownloadIds = () => [...active.keys()];

type FinishedListener = (track: Track, ok: boolean) => void;
const finishedListeners = new Set<FinishedListener>();
/** Called once per download, when it completes or fails. */
export const onDownloadFinished = (fn: FinishedListener) => {
  finishedListeners.add(fn);
  return () => {
    finishedListeners.delete(fn);
  };
};

function extensionFor(mimeType: string | null, url: string): string {
  if (
    mimeType?.includes('mp4') ||
    mimeType?.includes('m4a') ||
    mimeType?.includes('aac')
  )
    return 'm4a';
  if (mimeType?.includes('mpeg') || mimeType?.includes('mp3')) return 'mp3';
  if (mimeType?.includes('webm')) return 'webm';
  if (mimeType?.includes('ogg') || mimeType?.includes('opus')) return 'ogg';
  const m = url.split('?')[0].match(/\.(\w{2,4})$/);
  return m ? m[1] : 'audio';
}

export async function downloadTrack(
  track: Track,
  stream: ResolvedStream,
): Promise<void> {
  if (active.has(track.id)) return;

  const name = safeFileName(track.id);
  const ext = extensionFor(stream.mimeType, stream.url);
  // Saved straight into Music/stash (kept if the app is uninstalled). Files
  // that are converted first (WebM, Ogg) wait in the private folder: the Music
  // folder only accepts finished audio files.
  const folder = await downloadFolder();
  let path = `${
    needsConversion(`x.${ext}`) ? MUSIC_DIR : folder
  }/${name}.${ext}`;
  // Chunks are appended from the private folder too.
  const part = `${MUSIC_DIR}/${name}.part`;
  const job: Job = { task: null, cancelled: false };
  active.set(track.id, job);
  progress.set(track.id, 0);
  emit();

  /** One HTTP GET into `dest`; reports bytes received. Returns the HTTP status. */
  const fetchTo = async (
    dest: string,
    headers: Record<string, string>,
    onBytes: (received: number, total: number) => void,
  ) => {
    if (job.cancelled) throw new Error('Cancelled');
    const task = ReactNativeBlobUtil.config({
      path: dest,
      overwrite: true,
    }).fetch('GET', stream.url, headers);
    job.task = task;
    task.progress({ interval: 300 }, (r, t) => onBytes(Number(r), Number(t)));
    const res = await task;
    return res.info().status;
  };
  const setProgress = (p: number) => {
    progress.set(track.id, Math.min(1, p));
    emit();
  };

  try {
    const headers = stream.headers ?? {};
    const total = stream.contentLength ?? 0;
    if (stream.chunked && total > 0) {
      // Ranged chunks appended into one file: full speed, and the saved file is
      // exactly the original audio stream (no re-encoding).
      for (let start = 0; start < total; start += CHUNK_BYTES) {
        const end = Math.min(total - 1, start + CHUNK_BYTES - 1);
        const status = await fetchTo(
          start === 0 ? path : part,
          { ...headers, Range: `bytes=${start}-${end}` },
          r => setProgress((start + r) / total),
        );
        if (status === 200) break; // server ignored the range and sent everything
        if (status !== 206) throw new Error(`Download failed (HTTP ${status})`);
        if (start > 0) {
          await ReactNativeBlobUtil.fs.appendFile(path, part, 'uri');
          await removeFile(part);
        }
      }
    } else {
      const status = await fetchTo(path, headers, (r, t) =>
        setProgress(t > 0 ? r / t : 0),
      );
      if (status >= 400) throw new Error(`Download failed (HTTP ${status})`);
    }
    // Opus/WebM or Ogg from YouTube's fallback → M4A like every other download.
    if (needsConversion(path)) {
      path = (await convertToM4a(path, folder)) ?? path;
    }
    // Anything still in the private folder (e.g. a conversion that failed) moves to Music/stash.
    path = await keepAfterUninstall(track, path);
    const stat = await ReactNativeBlobUtil.fs.stat(path).catch(() => null);
    await updateTrack(track.id, {
      filePath: path,
      status: 'ready',
      sizeBytes: stat ? Number(stat.size) : null,
      savedAt: Date.now(),
    });
    finishedListeners.forEach(fn => fn(track, true));
    ensureWaveform({ ...track, status: 'ready', filePath: path });
    // Details and cover are looked up when the download starts; if that
    // couldn't happen (offline, lookup failed), try again now it's saved.
    const saved = await getTrack(track.id);
    if (saved && (!saved.metaCheckedAt || !saved.artworkPath))
      ensureArtwork(saved, track.source !== 'jamendo').catch(() => {});
  } catch (e) {
    // Don't leave half files or "ghost" entries in the library; the song can simply be played again.
    await removeFile(path).catch(() => {});
    await removeFile(part).catch(() => {});
    await deleteTrackRow(track.id);
    console.warn(`Download of ${track.title} failed`, e);
    finishedListeners.forEach(fn => fn(track, false));
  } finally {
    active.delete(track.id);
    progress.delete(track.id);
    emit();
  }
}

export function cancelDownload(id: string) {
  const job = active.get(id);
  if (!job) return;
  job.cancelled = true;
  job.task?.cancel();
}

/** Downloads interrupted by the app being killed are dropped on the next start. */
export async function cleanupInterruptedDownloads(): Promise<void> {
  const interrupted = (await getTracksByStatus('downloading')).filter(
    t => !active.has(t.id),
  );
  if (!interrupted.length) return;
  // Half files can be in either folder (see downloadTrack).
  for (const dir of [MUSIC_DIR, KEEP_DIR]) {
    const files = await ReactNativeBlobUtil.fs
      .ls(dir)
      .catch(() => [] as string[]);
    for (const t of interrupted) {
      const prefix = `${safeFileName(t.id)}.`;
      for (const f of files.filter(name => name.startsWith(prefix))) {
        await removeFile(`${dir}/${f}`).catch(() => {});
      }
    }
  }
  for (const t of interrupted) await deleteTrackRow(t.id);
}
