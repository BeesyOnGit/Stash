/**
 * Karaoke: a song without its vocals, to sing over.
 *
 * The vocals are removed on the phone by an AI model (UVR-MDX-NET Inst HQ 4,
 * from Ultimate Vocal Remover, the best of its kind that runs on a phone).
 * It isn't in the app: it's downloaded (59 MB) the first time karaoke is
 * opened, then works offline.
 *
 * Removing the vocals takes about as long as the song itself (depends on the
 * phone), so it starts as soon as karaoke is picked for a song and comes out
 * in pieces of ~4 s, which the karaoke screen plays while the rest is still
 * being made. The finished instrumental is kept, so a song is only done once.
 *
 * Native side: karaoke/KaraokeModule.kt (Android only).
 */
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { Track } from '../types';
import {
  PRIVATE_DIR,
  PUBLIC_DIR,
  addNewRecording,
  cleanFileName,
  type Recording,
} from './karaokeRecordings';
import { mayWritePublicMusic } from './keep';
import { safeFileName } from './paths';

const { fs } = ReactNativeBlobUtil;

interface NativeKaraoke {
  separate(
    job: string,
    input: string,
    output: string,
    pieceDir: string,
    modelPath: string,
  ): Promise<number>;
  cancel(job: string): void;
  cancelRunning(): void;
  release(): void;
  mix(
    instrumental: string,
    voice: string,
    output: string,
    voiceOffsetMs: number,
    voiceGain: number,
    musicGain: number,
  ): Promise<number>;
}

const Native: NativeKaraoke | undefined =
  Platform.OS === 'android' ? NativeModules.StashKaraoke : undefined;

export const MODEL = {
  name: 'UVR-MDX-NET Inst HQ 4',
  url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_4.onnx',
  bytes: 59074342,
  sha256: '3c4b5b9b05090fdf238f38ba5046813982d50e2a652e9cb3324ea79720c3c9c8',
};

const MODEL_DIR = `${fs.dirs.DocumentDir}/models`;
const MODEL_PATH = `${MODEL_DIR}/UVR-MDX-NET-Inst_HQ_4.onnx`;
/** Finished instrumentals, one per song. */
const INSTRUMENTAL_DIR = `${fs.dirs.DocumentDir}/karaoke`;
/** The pieces played while a song is being made (deleted as they're played). */
const PIECE_DIR = `${fs.dirs.CacheDir}/karaoke-pieces`;

export const karaokeSupported = () => !!Native;

/** Karaoke needs the song's file on the phone. */
export const canKaraoke = (t: Pick<Track, 'status' | 'filePath'>) =>
  !!Native && t.status === 'ready' && !!t.filePath;

// ---- tiny store: the screen re-renders on any change ----

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

async function modelOnPhone(): Promise<boolean> {
  if (!(await fs.exists(MODEL_PATH))) return false;
  const stat = await fs.stat(MODEL_PATH).catch(() => null);
  return !!stat && Number(stat.size) === MODEL.bytes;
}

/** Downloads the model unless it's on the phone already. Never throws (see getModelState). */
export function ensureModel(): Promise<void> {
  if (model.status === 'ready') return Promise.resolve();
  if (modelJob) return modelJob;
  modelJob = (async () => {
    try {
      if (await modelOnPhone()) {
        setModel({ status: 'ready' });
        return;
      }
      await fs.mkdir(MODEL_DIR).catch(() => {});
      const part = `${MODEL_PATH}.part`;
      await fs.unlink(part).catch(() => {});
      setModel({ status: 'downloading', received: 0, total: MODEL.bytes });
      const task = ReactNativeBlobUtil.config({
        path: part,
        overwrite: true,
      }).fetch('GET', MODEL.url);
      task.progress({ interval: 250 }, (received, total) => {
        setModel({
          status: 'downloading',
          received: Number(received),
          total: Number(total) || MODEL.bytes,
        });
      });
      const res = await task;
      if (res.info().status >= 400) {
        throw new Error(`HTTP ${res.info().status}`);
      }
      setModel({ status: 'checking' });
      const sum = (await fs.hash(part, 'sha256')).toLowerCase();
      if (sum !== MODEL.sha256) {
        await fs.unlink(part).catch(() => {});
        throw new Error('The download is damaged');
      }
      await fs.unlink(MODEL_PATH).catch(() => {});
      await fs.mv(part, MODEL_PATH);
      setModel({ status: 'ready' });
    } catch (e: any) {
      setModel({ status: 'error', message: e?.message ?? String(e) });
    } finally {
      modelJob = null;
    }
  })();
  return modelJob;
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
  /** When each piece arrived (for `rate`). */
  marks: { elapsed: number; done: number }[];
}

const jobs = new Map<string, KaraokeJob>();
/** Songs whose karaoke screen is open (their pieces are still needed). */
const watching = new Map<string, number>();

export const getJob = (trackId: string) => jobs.get(trackId) ?? null;

/** (A function so TypeScript doesn't narrow the status across the awaits.) */
const isCancelled = (job: KaraokeJob) => job.status === 'cancelled';

export const instrumentalPath = (trackId: string) =>
  `${INSTRUMENTAL_DIR}/${safeFileName(trackId)}.m4a`;

/** Whether the song's instrumental was made before (opens instantly). */
export const instrumentalReady = (trackId: string) =>
  fs.exists(instrumentalPath(trackId)).catch(() => false);

let events: { remove(): void } | null = null;
function listen() {
  if (events || !Native) return;
  // A job from before a JS reload would hold up this run's (they go one at a time).
  Native.cancelRunning();
  events = new NativeEventEmitter(NativeModules.StashKaraoke).addListener(
    'StashKaraoke',
    (e: any) => {
      const job = [...jobs.values()].find(j => j.id === e.job);
      if (!job || e.type !== 'piece') return;
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
    },
  );
}

/**
 * Starts making the song's instrumental (if it isn't made or being made).
 * Downloads the model first if needed. Returns the job to follow.
 */
export function startKaraoke(track: Track): KaraokeJob | null {
  if (!Native || !canKaraoke(track)) return null;
  const existing = jobs.get(track.id);
  if (
    existing &&
    existing.status !== 'error' &&
    existing.status !== 'cancelled'
  ) {
    return existing;
  }
  listen();
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
    await fs.mkdir(INSTRUMENTAL_DIR).catch(() => {});
    try {
      const length = await Native.separate(
        job.id,
        track.filePath!,
        out,
        `${PIECE_DIR}/${job.id}`,
        MODEL_PATH,
      );
      Object.assign(job, {
        status: 'done',
        path: out,
        done: length,
        total: length,
      });
      if (!watching.get(track.id)) removePieces(job);
    } catch (e: any) {
      if (!isCancelled(job)) {
        Object.assign(job, {
          status: 'error',
          error: e?.message ?? String(e),
        });
      }
    }
    changed();
  })();
  return job;
}

let cleaned = false;
/** Once per run: pieces left behind by a job that didn't finish (app closed or killed). */
function cleanOldPieces() {
  if (cleaned) return;
  cleaned = true;
  fs.ls(PIECE_DIR)
    .then(dirs => {
      // Read when the listing is back: the job being started is in there by then.
      const live = new Set([...jobs.values()].map(j => j.id));
      for (const d of dirs) {
        if (!live.has(d)) fs.unlink(`${PIECE_DIR}/${d}`).catch(() => {});
      }
    })
    .catch(() => {});
}

/** Stops making a song's instrumental. */
export function cancelKaraoke(trackId: string) {
  const job = jobs.get(trackId);
  if (!job || job.status === 'done') return;
  job.status = 'cancelled';
  Native?.cancel(job.id);
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

/** Deletes a job's piece files (they're only for playing while it's made). */
export function removePieces(job: KaraokeJob) {
  fs.unlink(`${PIECE_DIR}/${job.id}`).catch(() => {});
}

/** Frees the model's memory; called when karaoke closes (a running job keeps it). */
export function releaseModel() {
  const busy = [...jobs.values()].some(
    j => j.status === 'running' || j.status === 'waiting',
  );
  if (!busy) Native?.release();
}

/**
 * How many seconds must be ready ahead of `position` for playing on from
 * there to never catch up with the making: if the phone makes slower than
 * the song plays, the gap it loses over the rest of the song; plus a piece's
 * worth and a margin. Null until the speed is known.
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

// ---- saving a performance ----

/**
 * Mixes the voice onto the music and saves it (Music/Karaoke), listed under
 * Saving → Karaoke recordings. `over`: the instrumental, or the song as it is
 * (for songs that are instrumental already). `offsetMs`: how much of the start
 * of the recording to skip to line it up.
 */
export async function saveMix(
  track: Track,
  voicePath: string,
  offsetMs: number,
  voiceGain: number,
  over: 'instrumental' | 'original',
): Promise<Recording> {
  const job = jobs.get(track.id);
  const music =
    over === 'original'
      ? track.filePath
      : job?.path ?? instrumentalPath(track.id);
  if (!Native || !music || !(await fs.exists(music))) {
    throw new Error('The instrumental is not ready yet');
  }
  let dir = PRIVATE_DIR;
  if (await mayWritePublicMusic()) {
    try {
      if (!(await fs.exists(PUBLIC_DIR))) await fs.mkdir(PUBLIC_DIR);
      dir = PUBLIC_DIR;
    } catch {}
  }
  if (dir === PRIVATE_DIR && !(await fs.exists(dir))) await fs.mkdir(dir);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const name = cleanFileName(`${track.title} (karaoke) ${stamp}`);
  let out = `${dir}/${name}.m4a`;
  for (let n = 2; await fs.exists(out); n++) out = `${dir}/${name} (${n}).m4a`;
  const duration = await Native.mix(
    music,
    voicePath.replace(/^file:\/\//, ''),
    out,
    offsetMs,
    voiceGain,
    1,
  );
  // So music apps and the file manager see it straight away.
  await fs.scanFile([{ path: out, mime: 'audio/mp4' }]).catch(() => {});
  return addNewRecording({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    path: out,
    duration,
  });
}
