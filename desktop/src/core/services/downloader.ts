/**
 * Saves online tracks into the library. Started at the same moment playback of
 * the stream starts, so the first listen also downloads the song; next time it
 * plays from the computer.
 *
 * Files go straight into Music/stash as "youtube_<id>.m4a" (the native side
 * writes `.part` until complete), so they outlive the app and a scan brings
 * them back after a reinstall.
 */
import {
  deleteTrackRow,
  getTrack,
  getTracksByStatus,
  updateTrack,
} from '../db/database';
import { cancelDownloadJob, downloadTo, fs, pathJoin } from '../native';
import type { ResolvedStream, Track } from '../types';
import { ensureArtwork } from './artwork';
import { keepDir, removeFile, safeFileName } from './paths';

const active = new Map<string, { cancelled: boolean }>();
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

const jobId = (trackId: string) => `song:${trackId}`;

export async function downloadTrack(
  track: Track,
  stream: ResolvedStream,
): Promise<void> {
  if (active.has(track.id)) return;
  const ext = extensionFor(stream.mimeType, stream.url);
  const path = pathJoin(keepDir(), `${safeFileName(track.id)}.${ext}`);
  const job = { cancelled: false };
  active.set(track.id, job);
  progress.set(track.id, 0);
  emit();

  try {
    const size = await downloadTo(
      stream.url,
      path,
      {
        headers: stream.headers,
        chunked: !!stream.chunked && !!stream.contentLength,
        total: stream.contentLength,
        onProgress: (received, total) => {
          const t = total || stream.contentLength || 0;
          progress.set(track.id, t > 0 ? Math.min(1, received / t) : 0);
          emit();
        },
      },
      jobId(track.id),
    );
    if (job.cancelled) throw new Error('Cancelled');
    await updateTrack(track.id, {
      filePath: path,
      status: 'ready',
      sizeBytes: size,
      savedAt: Date.now(),
    });
    finishedListeners.forEach(fn => fn(track, true));
    // Details and cover are looked up when the download starts; if that
    // couldn't happen (offline, lookup failed), try again now it's saved.
    const saved = await getTrack(track.id);
    if (saved && (!saved.metaCheckedAt || !saved.artworkPath))
      ensureArtwork(saved, track.source !== 'jamendo').catch(() => {});
  } catch (e) {
    // Don't leave half files or "ghost" entries in the library; the song can simply be played again.
    await removeFile(path);
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
  cancelDownloadJob(jobId(id));
}

/** Downloads interrupted by the app being closed are dropped on the next start. */
export async function cleanupInterruptedDownloads(): Promise<void> {
  const interrupted = (await getTracksByStatus('downloading')).filter(
    t => !active.has(t.id),
  );
  if (!interrupted.length) return;
  const files = await fs.list(keepDir()).catch(() => []);
  for (const t of interrupted) {
    const prefix = `${safeFileName(t.id)}.`;
    for (const f of files.filter(x => x.name.startsWith(prefix))) {
      await removeFile(f.path);
    }
    await deleteTrackRow(t.id);
  }
}
