/**
 * Karaoke: a song without its vocals, to sing over.
 *
 * The vocals are removed on the computer by an AI model (UVR-MDX-NET Inst HQ 4,
 * from Ultimate Vocal Remover). It isn't in the app: it's downloaded (59 MB)
 * the first time karaoke removes vocals, then works offline.
 *
 * Making the instrumental starts as soon as karaoke is picked for a song and
 * comes out in pieces of ~2 s, which the karaoke screen plays while the rest
 * is still being made. The finished instrumental is kept, so a song is only
 * done once. Native side: src-tauri/src/karaoke.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { downloadTo, fs, pathJoin, removeFile } from '../native';
import type { Track } from '../types';
import {
  instrumentalDir,
  modelDir,
  pieceRoot,
  safeFileName,
} from './paths';

export const MODEL = {
  name: 'UVR-MDX-NET Inst HQ 4',
  url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_4.onnx',
  bytes: 59074342,
  sha256: '3c4b5b9b05090fdf238f38ba5046813982d50e2a652e9cb3324ea79720c3c9c8',
};

const modelPath = () => pathJoin(modelDir(), 'UVR-MDX-NET-Inst_HQ_4.onnx');

export const karaokeSupported = () => true;

/** Karaoke needs the song's file on the computer. */
export const canKaraoke = (t: Pick<Track, 'status' | 'filePath'>) =>
  t.status === 'ready' && !!t.filePath;

// ---- tiny store: the screens re-render on any change ----

const listeners = new Set<() => void>();
let version = 0;
function changed() {
  version++;
  listeners.forEach(fn => fn());
}
export function subscribeKaraoke(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const getKaraokeVersion = () => version;

// ---- the model ----

export type ModelState =
  | { status: 'unknown' | 'missing' | 'ready' | 'checking' }
  | { status: 'downloading'; received: number; total: number }
  | { status: 'error'; message: string };

let model: ModelState = { status: 'unknown' };
let modelJob: Promise<void> | null = null;

export const getModelState = () => model;

function setModel(next: ModelState) {
  model = next;
  changed();
}

async function modelOnComputer(): Promise<boolean> {
  const stat = await fs.stat(modelPath()).catch(() => null);
  return !!stat && stat.size === MODEL.bytes;
}

/** Whether the model is here (for Settings), without downloading it. */
export async function refreshModelState(): Promise<void> {
  if (model.status === 'downloading' || model.status === 'checking') return;
  setModel({ status: (await modelOnComputer()) ? 'ready' : 'missing' });
}

/** Downloads the model unless it's here already. Never throws (see getModelState). */
export function ensureModel(): Promise<void> {
  if (model.status === 'ready') return Promise.resolve();
  if (modelJob) return modelJob;
  modelJob = (async () => {
    try {
      if (await modelOnComputer()) {
        setModel({ status: 'ready' });
        return;
      }
      await fs.mkdir(modelDir()).catch(() => {});
      const part = `${modelPath()}.download`;
      await removeFile(part);
      setModel({ status: 'downloading', received: 0, total: MODEL.bytes });
      await downloadTo(MODEL.url, part, {
        onProgress: (received, total) =>
          setModel({
            status: 'downloading',
            received,
            total: total || MODEL.bytes,
          }),
      });
      setModel({ status: 'checking' });
      const sum = (await fs.sha256(part)).toLowerCase();
      if (sum !== MODEL.sha256) {
        await removeFile(part);
        throw new Error('The download is damaged');
      }
      await removeFile(modelPath());
      await fs.rename(part, modelPath());
      setModel({ status: 'ready' });
    } catch (e: any) {
      setModel({ status: 'error', message: e?.message ?? String(e) });
    } finally {
      modelJob = null;
    }
  })();
  return modelJob;
}

/** Settings → Delete: the model and every instrumental made with it. */
export async function deleteModel(): Promise<void> {
  for (const job of jobs.values()) cancelKaraoke(job.trackId);
  await invoke('karaoke_release').catch(() => {});
  await removeFile(modelPath());
  await removeFile(instrumentalDir());
  prepared.clear();
  setModel({ status: 'missing' });
}

// ---- making instrumentals ----

export interface Piece {
  path: string;
  index: number;
  /** Seconds into the song. */
  start: number;
  duration: number;
}

export interface KaraokeJob {
  trackId: string;
  id: string;
  status: 'waiting' | 'running' | 'done' | 'error' | 'cancelled';
  /** Pieces made so far, in order (files until the screen has played them). */
  pieces: Piece[];
  /** Seconds of the song made so far, and its length (0 if unknown). */
  done: number;
  total: number;
  /** Audio seconds made per second, measured over the last pieces (0 until known). */
  rate: number;
  /** The finished instrumental (status done). */
  path: string | null;
  error: string | null;
  marks: { elapsed: number; done: number }[];
}

const jobs = new Map<string, KaraokeJob>();
/** Songs whose karaoke screen is open (their pieces are still needed). */
const watching = new Map<string, number>();
/** Songs known to have an instrumental already (see instrumentalReady). */
const prepared = new Set<string>();

export const getJob = (trackId: string) => jobs.get(trackId) ?? null;

const isCancelled = (job: KaraokeJob) => job.status === 'cancelled';

export const instrumentalPath = (trackId: string) =>
  pathJoin(instrumentalDir(), `${safeFileName(trackId)}.wav`);

/** Whether the song's instrumental was made before (opens instantly). */
export async function instrumentalReady(trackId: string) {
  const ok = await fs.exists(instrumentalPath(trackId)).catch(() => false);
  if (ok) prepared.add(trackId);
  return ok;
}
export const isPrepared = (trackId: string) => prepared.has(trackId);

let events: Promise<unknown> | null = null;
function listenPieces() {
  if (events) return;
  // A job from before a reload would hold up this run's (they go one at a time).
  invoke('karaoke_cancel_running').catch(() => {});
  events = listen<{
    job: string;
    path: string;
    index: number;
    start: number;
    duration: number;
    done: number;
    total: number;
    elapsed: number;
  }>('karaoke-piece', ({ payload: e }) => {
    const job = [...jobs.values()].find(j => j.id === e.job);
    if (!job) return;
    job.status = 'running';
    job.pieces = [
      ...job.pieces,
      { path: e.path, index: e.index, start: e.start, duration: e.duration },
    ];
    job.done = e.done;
    job.total = e.total || job.total;
    job.marks = [...job.marks, { elapsed: e.elapsed, done: e.done }];
    // The first piece also paid for loading the model: measure from there on.
    const m = job.marks.slice(-5);
    if (m.length >= 2) {
      const a = m[0];
      const b = m[m.length - 1];
      job.rate = (b.done - a.done) / Math.max(0.001, b.elapsed - a.elapsed);
    }
    changed();
  });
}

/**
 * Starts making the song's instrumental (if it isn't made or being made).
 * Downloads the model first if needed. Returns the job to follow.
 */
export function startKaraoke(track: Track): KaraokeJob | null {
  if (!canKaraoke(track)) return null;
  const existing = jobs.get(track.id);
  if (existing && existing.status !== 'error' && existing.status !== 'cancelled') {
    return existing;
  }
  listenPieces();
  cleanOldPieces();
  const job: KaraokeJob = {
    trackId: track.id,
    id: `${safeFileName(track.id)}-${Date.now()}`,
    status: 'waiting',
    pieces: [],
    done: 0,
    total: track.duration ?? 0,
    rate: 0,
    path: null,
    error: null,
    marks: [],
  };
  jobs.set(track.id, job);
  changed();
  (async () => {
    const out = instrumentalPath(track.id);
    if (await fs.exists(out)) {
      prepared.add(track.id);
      Object.assign(job, { status: 'done', path: out, done: job.total });
      changed();
      return;
    }
    await ensureModel();
    if (model.status !== 'ready') {
      Object.assign(job, {
        status: 'error',
        error: model.status === 'error' ? model.message : 'No model',
      });
      changed();
      return;
    }
    if (isCancelled(job)) return;
    await fs.mkdir(instrumentalDir()).catch(() => {});
    try {
      const length = await invoke<number>('karaoke_separate', {
        job: job.id,
        input: track.filePath!,
        output: out,
        pieceDir: pathJoin(pieceRoot(), job.id),
        modelPath: modelPath(),
      });
      prepared.add(track.id);
      Object.assign(job, { status: 'done', path: out, done: length, total: length });
      if (!watching.get(track.id)) removePieces(job);
    } catch (e: any) {
      if (!isCancelled(job)) {
        Object.assign(job, { status: 'error', error: e?.message ?? String(e) });
      }
    }
    changed();
  })();
  return job;
}

let cleaned = false;
/** Once per run: pieces left behind by a job that didn't finish (app closed). */
function cleanOldPieces() {
  if (cleaned) return;
  cleaned = true;
  fs.list(pieceRoot())
    .then(dirs => {
      const live = new Set([...jobs.values()].map(j => j.id));
      for (const d of dirs) if (!live.has(d.name)) removeFile(d.path);
    })
    .catch(() => {});
}

/** Stops making a song's instrumental. */
export function cancelKaraoke(trackId: string) {
  const job = jobs.get(trackId);
  if (!job || job.status === 'done') return;
  job.status = 'cancelled';
  invoke('karaoke_cancel', { job: job.id }).catch(() => {});
  jobs.delete(trackId);
  removePieces(job);
  changed();
}

/**
 * The karaoke screen is showing this song: its pieces are kept until it
 * closes (reopening while it's made starts again from the first piece).
 */
export function watchJob(trackId: string): () => void {
  watching.set(trackId, (watching.get(trackId) ?? 0) + 1);
  return () => {
    const n = (watching.get(trackId) ?? 1) - 1;
    if (n > 0) watching.set(trackId, n);
    else watching.delete(trackId);
    const job = jobs.get(trackId);
    if (job && n <= 0 && job.status === 'done') removePieces(job);
  };
}

export function removePieces(job: KaraokeJob) {
  removeFile(pathJoin(pieceRoot(), job.id));
}

/** Frees the model's memory; called when karaoke closes (a running job keeps it). */
export function releaseModel() {
  const busy = [...jobs.values()].some(
    j => j.status === 'running' || j.status === 'waiting',
  );
  if (!busy) invoke('karaoke_release').catch(() => {});
}

/**
 * How many seconds must be ready ahead of `position` for playing on from there
 * to never catch up with the making: if the computer makes slower than the
 * song plays, the gap it loses over the rest of the song; plus a piece's worth
 * and a margin. Null until the speed is known.
 */
export function headStartNeeded(job: KaraokeJob, position = 0): number | null {
  if (job.status === 'done') return 0;
  if (job.rate <= 0 || job.pieces.length < 2) return null;
  const piece = job.pieces[job.pieces.length - 1].duration;
  const total = job.total || job.done + 60;
  const rest = Math.max(0, total - position);
  const lost = job.rate >= 1 ? 0 : rest * (1 - job.rate) * 1.1;
  return Math.min(rest, lost + piece + 2);
}
