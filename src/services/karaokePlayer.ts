/**
 * Plays an instrumental while it's still being made (services/karaoke) and
 * records the singer over it, with react-native-audio-api: the pieces are
 * queued back to back on one source, so they play seamlessly, and the audio
 * clock (context.currentTime) is the song position for the lyrics.
 *
 * If the making falls behind, the whole thing (music and recording) pauses
 * until it has caught up, so the voice stays in time with the music.
 */
import {
  AudioBuffer,
  AudioBufferQueueSourceNode,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
  FileDirectory,
  FileFormat,
  FilePreset,
  GainNode,
  decodeAudioData,
} from 'react-native-audio-api';

const RATE = 44100;
/** Music starts this long after the recording, so none of it is missed. */
const LEAD_S = 0.25;
/**
 * Typical round trip from the speaker to the recording on Android (the
 * voice lands this late); the Sync slider corrects the rest.
 */
export const DEFAULT_LATENCY_MS = 150;
/** Pause (and wait) when less than this much music is ready ahead. */
const LOW_WATER_S = 1.5;

/** The decoder wants a file:// URI with each part encoded (see services/waveform). */
export const fileUri = (path: string) =>
  path.startsWith('file://')
    ? path
    : 'file://' + path.split('/').map(encodeURIComponent).join('/');

export type EngineState = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended';

export interface Take {
  /** The recorded voice (M4A). */
  path: string;
  /** Seconds into the recording where the music started (before latency). */
  musicAt: number;
  /** How long the singer went (seconds of music). */
  length: number;
}

export class KaraokeEngine {
  private ctx = new AudioContext({ sampleRate: RATE });
  private pieces: AudioBuffer[] = [];
  private source: AudioBufferQueueSourceNode | null = null;
  /** Audio clock time of the song's start. */
  private startedAt = 0;
  private recorder: AudioRecorder | null = null;
  private recordStartedAt = 0;
  private preview: {
    music: AudioBufferQueueSourceNode;
    voice: AudioBufferSourceNode;
    gain: GainNode;
  } | null = null;
  private voice: AudioBuffer | null = null;
  /** Where playing stops by itself (the end of a take when listening back). */
  private endAt = Infinity;
  /** The position when playing last stopped. */
  private stoppedAt = 0;
  private listeners = new Set<() => void>();

  state: EngineState = 'idle';
  recording = false;
  /** Seconds of instrumental received so far, and whether that's all of it. */
  ready = 0;
  complete = false;
  /** Set by the screen: how much must be ready ahead before playing on. */
  needAhead: () => number = () => 4;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach(fn => fn());
  }

  /** Adds the next piece of instrumental (a file), in order. */
  async addPiece(path: string): Promise<void> {
    const buffer = await decodeAudioData(fileUri(path), RATE);
    this.pieces.push(buffer);
    this.ready += buffer.duration;
    this.source?.enqueueBuffer(buffer);
    this.preview?.music.enqueueBuffer(buffer);
    this.emit();
  }

  /** The whole instrumental at once (it was made before). */
  async setComplete(path?: string): Promise<void> {
    if (path && this.pieces.length === 0) {
      const buffer = await decodeAudioData(fileUri(path), RATE);
      this.pieces = [buffer];
      this.ready = buffer.duration;
    }
    this.complete = true;
    this.emit();
  }

  get length() {
    return this.ready;
  }

  /** Song position in seconds. */
  get position(): number {
    if (this.preview || this.source) {
      return Math.max(
        0,
        Math.min(this.ready, this.ctx.currentTime - this.startedAt),
      );
    }
    return 0;
  }

  /** Called a few times a second by the screen: pauses before the music runs out, ends at the end. */
  tick() {
    if (this.state === 'playing' && (this.source || this.preview)) {
      const left = this.ready - this.position;
      if ((this.complete && left <= 0.05) || this.position >= this.endAt) {
        this.stop(true);
        return;
      }
      if (!this.complete && left < LOW_WATER_S) {
        this.state = 'waiting';
        this.ctx.suspend().catch(() => {});
        this.recorder?.pause();
        this.emit();
      }
    } else if (this.state === 'waiting') {
      const left = this.ready - this.position;
      if (this.complete || left >= this.needAhead()) {
        this.state = 'playing';
        this.recorder?.resume();
        this.ctx.resume().catch(() => {});
        this.emit();
      }
    }
  }

  /** Plays the instrumental from the start, recording the singer if `record`. */
  async start(record: boolean): Promise<void> {
    this.stop(false);
    await this.running();
    if (record) {
      const recorder = new AudioRecorder();
      const enabled = recorder.enableFileOutput({
        directory: FileDirectory.Cache,
        subDirectory: 'karaoke',
        fileNamePrefix: 'voice',
        channelCount: 1,
        format: FileFormat.M4A,
        preset: FilePreset.High,
      });
      if (enabled.status === 'error') throw new Error(enabled.message);
      const started = await recorder.start();
      if (started.status === 'error') throw new Error(started.message);
      this.recorder = recorder;
      this.recordStartedAt = this.ctx.currentTime;
      this.recording = true;
    }
    const source = new AudioBufferQueueSourceNode(this.ctx);
    source.connect(this.ctx.destination);
    for (const b of this.pieces) source.enqueueBuffer(b);
    this.endAt = Infinity;
    this.startedAt = this.ctx.currentTime + LEAD_S;
    // The offset has to be given: the library's own default (-1) fails its check.
    source.start(this.startedAt, 0);
    this.source = source;
    this.state = 'playing';
    this.emit();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.ctx.suspend().catch(() => {});
    this.recorder?.pause();
    this.state = 'paused';
    this.emit();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.recorder?.resume();
    this.ctx.resume().catch(() => {});
    this.state = 'playing';
    this.emit();
  }

  /**
   * Stops playing (and recording). Returns the take if one was being recorded.
   */
  async stopRecording(): Promise<Take | null> {
    const recorder = this.recorder;
    const length = this.source ? this.position : this.stoppedAt;
    const musicAt = this.startedAt - this.recordStartedAt;
    this.recorder = null;
    this.recording = false;
    this.stop(false);
    if (!recorder) return null;
    const res = await recorder.stop();
    if (res.status === 'error') throw new Error(res.message);
    const path = res.paths[res.paths.length - 1];
    if (!path) return null;
    return { path, musicAt, length };
  }

  stop(ended: boolean) {
    this.stoppedAt = this.position;
    if (this.recorder) {
      // Ending by itself: keep the recorder for stopRecording() to finish.
      if (!ended) {
        this.recorder.stop().catch(() => {});
        this.recorder = null;
        this.recording = false;
      }
    }
    for (const node of [
      this.source,
      this.preview?.music,
      this.preview?.voice,
    ]) {
      try {
        node?.stop();
      } catch {}
      try {
        node?.disconnect();
      } catch {}
    }
    this.preview?.gain.disconnect();
    this.source = null;
    this.preview = null;
    this.ctx.resume().catch(() => {});
    this.state = ended ? 'ended' : 'idle';
    this.emit();
  }

  /** Plays the take over the music: `offsetMs` of the recording skipped, voice at `gain`. */
  async playTake(take: Take, offsetMs: number, gain: number): Promise<void> {
    this.stop(false);
    await this.running();
    if (!this.voice)
      this.voice = await decodeAudioData(fileUri(take.path), RATE);
    const music = new AudioBufferQueueSourceNode(this.ctx);
    music.connect(this.ctx.destination);
    for (const b of this.pieces) music.enqueueBuffer(b);
    // Set through the property: the constructor's `buffer` option hands the JS
    // wrapper to native code, which rejects it ("not a HostObject of desired type").
    const voice = new AudioBufferSourceNode(this.ctx);
    voice.buffer = this.voice;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    voice.connect(g);
    g.connect(this.ctx.destination);
    const at = this.ctx.currentTime + 0.1;
    const skip = offsetMs / 1000;
    music.start(at, 0);
    if (skip >= 0) voice.start(at, skip);
    else voice.start(at - skip);
    this.startedAt = at;
    this.endAt = take.length;
    this.preview = { music, voice, gain: g };
    this.state = 'playing';
    this.emit();
  }

  /**
   * A running audio context: the current one, or a new one if it can't be
   * resumed (closed, or its output stream was lost). Buffers carry over.
   */
  private async running(): Promise<void> {
    try {
      await this.ctx.resume();
    } catch {
      this.ctx.close().catch(() => {});
      this.ctx = new AudioContext({ sampleRate: RATE });
      await this.ctx.resume().catch(() => {});
    }
  }

  setVoiceGain(gain: number) {
    if (this.preview) this.preview.gain.gain.value = gain;
  }

  forgetTake() {
    this.voice = null;
  }

  async close() {
    this.stop(false);
    this.listeners.clear();
    await this.ctx.close().catch(() => {});
  }
}

/** Asks for the microphone; true when allowed. */
export async function micAllowed(): Promise<boolean> {
  const now = await AudioManager.checkRecordingPermissions();
  if (now === 'Granted') return true;
  return (await AudioManager.requestRecordingPermissions()) === 'Granted';
}
