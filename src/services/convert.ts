/**
 * Every download ends up as an M4A: YouTube sometimes only offers Opus (WebM)
 * or Ogg, which the waveform decoder can't read (the player then shows a
 * placeholder shape) and some players can't open. Those are re-encoded to AAC
 * with the phone's own codecs (native side: audio/AudioConverter.kt).
 * MP3 is left alone: it already works everywhere, and re-encoding only loses quality.
 */
import { NativeModules, Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getTracksByStatus, updateTrack } from '../db/database';
import { removeFile } from './paths';
import { ensureWaveform } from './waveform';

const Native:
  | { toM4a(input: string, output: string): Promise<void> }
  | undefined =
  Platform.OS === 'android' ? NativeModules.StashAudio : undefined;

const NEEDS_CONVERSION = /\.(webm|ogg|oga|opus)$/i;

export const needsConversion = (path: string) =>
  !!Native && NEEDS_CONVERSION.test(path);

/**
 * Converts a downloaded file to M4A next to it and deletes the original.
 * Returns the new path, or null if it couldn't (the original is kept and still plays).
 */
export async function convertToM4a(path: string): Promise<string | null> {
  if (!needsConversion(path)) return null;
  const out = path.replace(NEEDS_CONVERSION, '.m4a');
  try {
    await Native!.toM4a(path, out);
    await removeFile(path).catch(() => {});
    return out;
  } catch (e) {
    console.warn(`Converting ${path} to M4A failed`, e);
    return null;
  }
}

/** Once at startup: convert downloads saved before conversion existed. */
export async function convertOldDownloads(): Promise<void> {
  if (!Native) return;
  const old = (await getTracksByStatus('ready')).filter(
    t =>
      t.source !== 'device' && t.filePath && NEEDS_CONVERSION.test(t.filePath),
  );
  for (const t of old) {
    const path = await convertToM4a(t.filePath!);
    if (!path) continue;
    const stat = await ReactNativeBlobUtil.fs.stat(path).catch(() => null);
    const updated = {
      filePath: path,
      sizeBytes: stat ? Number(stat.size) : t.sizeBytes,
      waveform: null,
    };
    await updateTrack(t.id, updated);
    ensureWaveform({ ...t, ...updated });
  }
}
