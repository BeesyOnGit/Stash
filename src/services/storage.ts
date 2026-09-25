import { getDownloadedBytes } from '../db/database';
import { currentLanguage, tr } from '../i18n';
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

/** A number with the language's decimal mark (1.5 → "1,5" in French). */
export function formatNumber(n: number, digits = 0): string {
  const text = n.toFixed(digits);
  return ['fr', 'es', 'de'].includes(currentLanguage())
    ? text.replace('.', ',')
    : text;
}

/** A size in GB as shown to the user, e.g. "0.5 GB" / "0,5 Go". */
export function formatGB(gb: number): string {
  return tr('settings.sizeGB', {
    size: formatNumber(gb, Number.isInteger(gb) ? 0 : 1),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= GB) {
    return tr('settings.sizeGB', { size: formatNumber(bytes / GB, 2) });
  }
  const mb = bytes / 1024 ** 2;
  return tr('settings.sizeMB', {
    size: mb >= 10 ? formatNumber(Math.round(mb)) : formatNumber(mb, 1),
  });
}
