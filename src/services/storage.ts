import { getDownloadedBytes } from '../db/database';
import { getSettings } from './settings';

const GB = 1024 ** 3;

/** Estimated file size when the real one isn't known yet (duration × bitrate). */
export function estimateBytes(
  durationSec: number | null,
  bitrate = 160_000,
): number {
  return ((durationSec ?? 240) * bitrate) / 8;
}

export const limitBytes = () => getSettings().storageLimitGB * GB;

/** Whether a song of `bytes` still fits under the storage limit. */
export async function fitsInStorage(bytes: number): Promise<boolean> {
  return (await getDownloadedBytes()) + bytes <= limitBytes();
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  const mb = bytes / 1024 ** 2;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}
