export async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Remove "(Official Video)", "[Lyrics]", "HD" etc. that video titles carry. */
export function cleanVideoTitle(raw: string): string {
  return raw
    .replace(
      /[([][^)\]]*(official|video|lyric|audio|visuali[sz]er|clip|hd|4k|mv|remaster(ed)?)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** "Artist - Title" is the usual YouTube music naming; fall back to the channel name. */
export function splitArtistTitle(
  rawTitle: string,
  channel: string | null,
): { title: string; artist: string | null } {
  const title = cleanVideoTitle(rawTitle);
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  const artist = channel
    ? channel
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/VEVO$/i, '')
        .trim()
    : null;
  return { title, artist: artist || null };
}

/** Lowercase, no accents or punctuation — for comparing titles and names. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
