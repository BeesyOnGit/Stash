/**
 * Plays an instrumental while it's still being made (services/karaoke) and
 * records the singer over it, with Web Audio: the pieces are scheduled back to
 * back, so they play seamlessly, and the audio clock (context.currentTime) is
 * the song position for the lyrics.
 *
 * The microphone is recorded inside the same audio graph (an AudioWorklet), so
 * music and voice share one clock: suspending the context for the making to
 * catch up pauses both, and the voice stays in time with the music.
 */
import { fileSrc, fs, pathJoin } from '../native';
import { voiceDir } from './paths';

const RATE = 44100;
/** Music starts this long after the recording, so none of it is missed. */
const LEAD_S = 0.25;
/** Pause (and wait) when less than this much music is ready ahead. */
const LOW_WATER_S = 1.5;

export type EngineState = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended';

export interface Take {
  /** The recorded voice (WAV). */
  path: string;
  /** Seconds into the recording where the music started (before latency). */
  musicAt: number;
  /** How long the singer went (seconds of music). */
  length: number;
}

const WORKLET = `
class StashRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = e => { if (e.data === 'stop') this.on = false; }; this.first = true; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.on) {
      this.port.postMessage({ t: currentTime, first: this.first, data: ch.slice(0) });
      this.first = false;
    }
    return this.on;
  }
}
registerProcessor('stash-recorder', StashRecorder);
`;

async function decodeFile(ctx: BaseAudioContext, path: string) {
  const res = await fetch(fileSrc(path));
  if (!res.ok) throw new Error(`Can't read ${path}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/** Mono float samples → 16-bit WAV. */
function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export class KaraokeEngine {
  private audio: AudioContext | null = null;
  /**
   * The audio graph, opened again on first use after `close()`: the screen's
   * effects can close the engine and then keep using it (React runs effects
   * twice in development). Decoded pieces aren't tied to a context, so they stay.
   */
  private get ctx(): AudioContext {
    if (!this.audio || this.audio.state === 'closed') {
      this.audio = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
      this.workletReady = null; // the recorder module is loaded per context
    }
    return this.audio;
  }
  private pieces: AudioBuffer[] = [];
  /** Where each piece starts in the song (seconds). */
  private offsets: number[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceGainNode: GainNode | null = null;
  /** Audio clock time of the song's start. */
  private startedAt = 0;
  private playing = false;
  private listeners = new Set<() => void>();
  private workletReady: Promise<void> | null = null;
  private mic: MediaStream | null = null;
  private recorder: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private recordStartedAt = 0;
  private voice: AudioBuffer | null = null;
  /** Where playing stops by itself (the end of a take when listening back). */
  private endAt = Infinity;
  private stoppedAt = 0;

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

  /** Round trip from the speakers to the recording, in ms (the voice lands this late). */
  get latencyMs() {
    const out = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.round(out * 1000 + 25);
  }

  private schedule(buffer: AudioBuffer, songAt: number, into: AudioBufferSourceNode[]) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.connect(this.ctx.destination);
    const at = this.startedAt + songAt;
    const now = this.ctx.currentTime;
    if (at + buffer.duration <= now) return;
    if (at >= now) s.start(at);
    else s.start(now, now - at);
    into.push(s);
  }

  /** Adds the next piece of instrumental (a file), in order. */
  async addPiece(path: string): Promise<void> {
    const buffer = await decodeFile(this.ctx, path);
    this.offsets.push(this.ready);
    this.pieces.push(buffer);
    if (this.playing) this.schedule(buffer, this.ready, this.sources);
    this.ready += buffer.duration;
    this.emit();
  }

  /** The whole music at once (made before, or the song as it is). */
  async setComplete(path?: string): Promise<void> {
    if (path && this.pieces.length === 0) {
      const buffer = await decodeFile(this.ctx, path);
      this.pieces = [buffer];
      this.offsets = [0];
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
    if (!this.playing) return this.stoppedAt;
    return Math.max(0, Math.min(this.ready, this.ctx.currentTime - this.startedAt));
  }

  /** Called a few times a second by the screen: pauses before the music runs out, ends at the end. */
  tick() {
    if (this.state === 'playing' && this.playing) {
      const left = this.ready - this.position;
      if ((this.complete && left <= 0.05) || this.position >= this.endAt) {
        this.stop(true);
        return;
      }
      if (!this.complete && left < LOW_WATER_S) {
        this.state = 'waiting';
        this.ctx.suspend().catch(() => {});
        this.emit();
      }
    } else if (this.state === 'waiting') {
      const left = this.ready - this.position;
      if (this.complete || left >= this.needAhead()) {
        this.state = 'playing';
        this.ctx.resume().catch(() => {});
        this.emit();
      }
    }
  }

  private async startRecorder() {
    if (!this.workletReady) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
      this.workletReady = this.ctx.audioWorklet.addModule(url);
    }
    await this.workletReady;
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const src = this.ctx.createMediaStreamSource(this.mic);
    const node = new AudioWorkletNode(this.ctx, 'stash-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.chunks = [];
    this.recordStartedAt = this.ctx.currentTime;
    node.port.onmessage = e => {
      if (e.data.first) this.recordStartedAt = e.data.t;
      this.chunks.push(e.data.data);
    };
    // Silent output, so the graph keeps pulling the recorder.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(this.ctx.destination);
    this.recorder = node;
    this.recording = true;
  }

  private stopRecorder() {
    this.recorder?.port.postMessage('stop');
    this.recorder?.disconnect();
    this.recorder = null;
    this.mic?.getTracks().forEach(t => t.stop());
    this.mic = null;
    this.recording = false;
  }

  /** Plays the music from the start, recording the singer if `record`. */
  async start(record: boolean): Promise<void> {
    this.stop(false);
    await this.ctx.resume();
    if (record) await this.startRecorder();
    this.endAt = Infinity;
    this.startedAt = this.ctx.currentTime + LEAD_S;
    this.playing = true;
    this.sources = [];
    this.pieces.forEach((b, i) => this.schedule(b, this.offsets[i], this.sources));
    this.state = 'playing';
    this.emit();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.ctx.suspend().catch(() => {});
    this.state = 'paused';
    this.emit();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ctx.resume().catch(() => {});
    this.state = 'playing';
    this.emit();
  }

  /** Stops playing and recording; returns the take if one was being recorded. */
  async stopRecording(): Promise<Take | null> {
    const wasRecording = this.recording || this.chunks.length > 0;
    const length = this.playing ? this.position : this.stoppedAt;
    const musicAt = this.startedAt - this.recordStartedAt;
    this.stopRecorder();
    this.stop(false);
    if (!wasRecording || !this.chunks.length) return null;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const samples = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      samples.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    const voice = this.ctx.createBuffer(1, samples.length, RATE);
    voice.copyToChannel(samples, 0);
    this.voice = voice;
    await fs.mkdir(voiceDir()).catch(() => {});
    const path = pathJoin(voiceDir(), `voice-${Date.now()}.wav`);
    await fs.writeBytes(path, wavBytes(samples, RATE));
    return { path, musicAt, length };
  }

  stop(ended: boolean) {
    this.stoppedAt = this.position;
    if (!ended && this.recording) {
      this.stopRecorder();
      this.chunks = [];
    }
    for (const s of this.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {}
    }
    this.sources = [];
    try {
      this.voiceSource?.stop();
      this.voiceSource?.disconnect();
    } catch {}
    this.voiceSource = null;
    this.voiceGainNode?.disconnect();
    this.voiceGainNode = null;
    this.playing = false;
    this.ctx.resume().catch(() => {});
    this.state = ended ? 'ended' : 'idle';
    this.emit();
  }

  /** Plays the take over the music: `offsetMs` of the recording skipped, voice at `gain`. */
  async playTake(take: Take, offsetMs: number, gain: number): Promise<void> {
    this.stop(false);
    await this.ctx.resume();
    if (!this.voice) this.voice = await decodeFile(this.ctx, take.path);
    this.startedAt = this.ctx.currentTime + 0.1;
    this.playing = true;
    this.pieces.forEach((b, i) => this.schedule(b, this.offsets[i], this.sources));
    const voice = this.ctx.createBufferSource();
    voice.buffer = this.voice;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    voice.connect(g);
    g.connect(this.ctx.destination);
    const skip = offsetMs / 1000;
    if (skip >= 0) voice.start(this.startedAt, skip);
    else voice.start(this.startedAt - skip);
    this.voiceSource = voice;
    this.voiceGainNode = g;
    this.endAt = take.length;
    this.state = 'playing';
    this.emit();
  }

  setVoiceGain(gain: number) {
    if (this.voiceGainNode) this.voiceGainNode.gain.value = gain;
  }

  forgetTake() {
    this.voice = null;
  }

  async close() {
    this.stop(false);
    this.listeners.clear();
    // Let go of it first, so anything after this gets a fresh context, not a closing one.
    const audio = this.audio;
    this.audio = null;
    await audio?.close().catch(() => {});
  }
}

/** Asks for the microphone once; true when allowed. */
export async function micAllowed(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}
