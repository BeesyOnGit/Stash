/**
 * The real shape of a song for the player's waveform: decode the saved file once,
 * measure the loudness of each slice, and store the bar heights in the library.
 */
import { decodeAudioData } from 'react-native-audio-api';
import { updateTrack } from '../db/database';
import type { Track } from '../types';

export const WAVEFORM_BARS = 56;
/** Loudness doesn't need hi-fi: decoding at 4 kHz is ~10× less work than 44.1 kHz. */
const DECODE_RATE = 4000;
/**
 * Formats react-native-audio-api decodes from a file: FFmpeg for MP4/M4A/AAC,
 * miniaudio for the rest (incl. its libvorbis / libopus backends for Ogg).
 * Not WebM (YouTube's Opus fallback), WMA or AMR: those keep the placeholder.
 */
const DECODABLE = /\.(mp3|m4a|mp4|aac|wav|flac|ogg|oga|opus)$/i;

const pending = new Map<string, Promise<number[] | null>>();

/**
 * The decoder needs a file:// URI: in release builds on Android it reads any
 * other string as an asset bundled in the app ("Could not read asset bytes"),
 * so a plain path worked in development only. It URL-decodes the path, so
 * each part is encoded to survive names with %, #, spaces…
 */
const fileUri = (path: string) =>
  'file://' + path.split('/').map(encodeURIComponent).join('/');

/** Bar heights 0..100 from mono PCM: RMS per slice, scaled so the loudest bar is 100. */
export function barsFromSamples(
  samples: Float32Array,
  bars = WAVEFORM_BARS,
): number[] {
  const size = Math.max(1, Math.floor(samples.length / bars));
  const rms: number[] = [];
  for (let b = 0; b < bars; b++) {
    let sum = 0;
    const start = b * size;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    rms.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const max = Math.max(...rms, 1e-6);
  // Floor at 12% so quiet parts still show a bar, like every music app's scrubber.
  return rms.map(v => Math.round(12 + (v / max) * 88));
}

/** Computes and stores the waveform for a song on the phone; no-op if it has one. */
export function ensureWaveform(track: Track): Promise<number[] | null> {
  if (track.waveform?.length) return Promise.resolve(track.waveform);
  if (
    track.status !== 'ready' ||
    !track.filePath ||
    !DECODABLE.test(track.filePath)
  ) {
    return Promise.resolve(null);
  }
  const running = pending.get(track.id);
  if (running) return running;

  const job = (async () => {
    try {
      const buffer = await decodeAudioData(
        fileUri(track.filePath!),
        DECODE_RATE,
      );
      const bars = barsFromSamples(buffer.getChannelData(0));
      await updateTrack(track.id, { waveform: bars });
      return bars;
    } catch (e) {
      console.warn(`Waveform for ${track.title} failed`, e);
      return null;
    } finally {
      pending.delete(track.id);
    }
  })();
  pending.set(track.id, job);
  return job;
}
