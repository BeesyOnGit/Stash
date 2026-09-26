/**
 * Song lyrics from free sources, best first:
 *
 * 1. A `.lrc` file next to a song on the phone (exactly that song, works offline).
 * 2. LRCLIB (lrclib.net): open, community lyrics, often timed ("synced"), looked
 *    up by title + artist + duration so the right version is picked.
 * 3. YouTube Music: plain lyrics (licensed from LyricFind & co.) for the song's
 *    video — exact for anything from YouTube, and it covers a lot of regional
 *    music LRCLIB doesn't.
 *
 * Whatever is found (or that nothing was) is saved per song, so lyrics show
 * offline afterwards. "Wrong lyrics?" in the player searches LRCLIB by hand.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import { getLyricsRow, saveLyricsRow, type LyricsRow } from '../db/database';
import { cleanVideoTitle, fold, splitArtistTitle } from '../sources/http';
import { innertubeFindVideo, innertubeLyrics } from '../sources/innertube';
import type { Track } from '../types';
import { isOnline } from './network';

export interface LyricLine {
  /** Seconds. */
  time: number;
  text: string;
}

export interface Lyrics {
  lines: LyricLine[] | null;
  plain: string | null;
  /** Shown under the lyrics, e.g. "LRCLIB" or "YouTube Music · LyricFind". */
  source: string | null;
}

/** A song LRCLIB knows, for the manual search. */
export interface LyricsMatch {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  synced: string | null;
  plain: string | null;
}

const LRCLIB = 'https://lrclib.net/api';
/** LRCLIB asks apps to identify themselves. */
const HEADERS = { 'User-Agent': 'stash music player (personal use)' };
/** Look again for songs that had no lyrics, in case someone has added them since. */
const RETRY_NONE_MS = 7 * 24 * 3600 * 1000;

// ---- public ----

const pending = new Map<string, Promise<Lyrics>>();

/** Saved lyrics, or looks them up (and saves them). Never throws. */
export function lyricsFor(track: Track): Promise<Lyrics> {
  const running = pending.get(track.id);
  if (running) return running;
  const job = (async () => {
    const saved = await getLyricsRow(track.id).catch(() => null);
    const none = saved && !saved.plain && !saved.synced;
    const stale = none && Date.now() - saved!.checkedAt > RETRY_NONE_MS;
    if (saved && !stale) return fromRow(saved);
    if (!isOnline()) {
      return (await sidecar(track)) ?? (saved ? fromRow(saved) : empty());
    }
    const row = await find(track).catch(() => null);
    if (!row) return saved ? fromRow(saved) : empty();
    await saveLyricsRow(track.id, row).catch(() => {});
    return fromRow(row);
  })().finally(() => pending.delete(track.id));
  pending.set(track.id, job);
  return job;
}

/** LRCLIB search for "Wrong lyrics?". Songs with timed lyrics first. */
export async function searchLyrics(query: string): Promise<LyricsMatch[]> {
  const list = await lrclibSearch({ q: query });
  return list
    .filter(r => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
    .map(r => ({
      id: r.id,
      title: r.trackName,
      artist: r.artistName,
      album: r.albumName ?? null,
      duration: r.duration ?? null,
      synced: r.syncedLyrics ?? null,
      plain: r.plainLyrics ?? null,
    }));
}

/** Keep a hand-picked result for this song (or `null`: this song has no lyrics). */
export async function chooseLyrics(
  trackId: string,
  match: LyricsMatch | null,
): Promise<Lyrics> {
  const row: LyricsRow = {
    plain: match?.plain ?? null,
    synced: match?.synced ?? null,
    source: match ? 'LRCLIB' : null,
    checkedAt: Date.now(),
  };
  await saveLyricsRow(trackId, row);
  return fromRow(row);
}

/** `source` of lyrics the user pasted (shown as "Your lyrics"). */
export const OWN_LYRICS = 'Yours';

/** Keeps lyrics the user pasted: timed if they're LRC ("[01:02.50] …"), plain otherwise. */
export async function saveOwnLyrics(
  trackId: string,
  text: string,
): Promise<Lyrics> {
  const clean = text.trim();
  const timed = parseLrc(clean);
  const row: LyricsRow = {
    plain: timed.length ? timed.map(l => l.text).join('\n') : clean,
    synced: timed.length ? clean : null,
    source: OWN_LYRICS,
    checkedAt: Date.now(),
  };
  await saveLyricsRow(trackId, row);
  return fromRow(row);
}

/** "[01:02.50]" style timed lyrics → lines, in order. Tags like [ar:…] are skipped. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [
      ...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g),
    ];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? Number(s[3]) / 10 ** s[3].length : 0;
      lines.push({ time: Number(s[1]) * 60 + Number(s[2]) + frac, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

// ---- finding ----

const empty = (): Lyrics => ({ lines: null, plain: null, source: null });

function fromRow(row: LyricsRow): Lyrics {
  const lines = row.synced ? parseLrc(row.synced) : null;
  return {
    lines: lines?.length ? lines : null,
    plain: row.plain,
    source: row.source,
  };
}

async function find(track: Track): Promise<LyricsRow> {
  const now = Date.now();
  const local = await sidecarRow(track);
  if (local) return local;

  const best = await lrclibBest(track);
  // Timed lyrics that clearly match are the best there is.
  if (best && best.syncedLyrics && best.confident) {
    return {
      plain: best.plainLyrics ?? null,
      synced: best.syncedLyrics,
      source: 'LRCLIB',
      checkedAt: now,
    };
  }
  // YouTube Music is exact for the song's own video, so it beats a loose match.
  const yt = await youtubeLyrics(track);
  if (yt && (!best || !best.confident)) return { ...yt, checkedAt: now };
  if (best) {
    return {
      plain: best.plainLyrics ?? null,
      synced: best.syncedLyrics ?? null,
      source: 'LRCLIB',
      checkedAt: now,
    };
  }
  if (yt) return { ...yt, checkedAt: now };
  return { plain: null, synced: null, source: null, checkedAt: now };
}

/** `song.lrc` next to `song.mp3` on the phone. */
async function sidecarRow(track: Track): Promise<LyricsRow | null> {
  if (track.source !== 'device' || !track.filePath) return null;
  const path = track.filePath.replace(/\.[^./]+$/, '.lrc');
  try {
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return null;
    const text = await ReactNativeBlobUtil.fs.readFile(path, 'utf8');
    const lines = parseLrc(text);
    return {
      plain: lines.length ? lines.map(l => l.text).join('\n') : text.trim(),
      synced: lines.length ? text : null,
      source: 'LRC file',
      checkedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function sidecar(track: Track): Promise<Lyrics | null> {
  const row = await sidecarRow(track);
  return row ? fromRow(row) : null;
}

// ---- LRCLIB ----

interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function lrclibFetch<T>(path: string, params: Record<string, string>) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${LRCLIB}${path}?${qs}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const lrclibSearch = async (params: Record<string, string>) =>
  (await lrclibFetch<LrclibRecord[]>('/search', params)) ?? [];

/** Title/artist pairs to try: as stored, and cleaned up the way YouTube uploads need. */
function namesFor(track: Track) {
  const out: { title: string; artist: string }[] = [];
  const add = (title: string, artist: string | null) => {
    const t = title.replace(/\s*[([]feat[^)\]]*[)\]]/i, '').trim();
    if (!t || !artist) return;
    if (
      !out.some(
        n => fold(n.title) === fold(t) && fold(n.artist) === fold(artist),
      )
    ) {
      out.push({ title: t, artist });
    }
  };
  add(track.title, track.artist);
  const split = splitArtistTitle(track.title, track.artist);
  add(split.title, split.artist);
  // Some uploads are "Title - Artist".
  if (split.artist && split.artist !== track.artist)
    add(split.artist, split.title);
  return out;
}

/** The video title without "(Official…)", translations after "~" or "|", etc. */
const bareTitle = (t: Track) =>
  cleanVideoTitle(t.title)
    .split(/[~|｜•]/)[0]
    .trim();

const firstArtist = (a: string) => fold(a.split(/,|&| feat| x /i)[0] ?? a);

/** How well an LRCLIB record fits the song; `confident` when title, artist and length agree. */
function rate(
  track: Track,
  r: LrclibRecord,
  names: { title: string; artist: string }[],
) {
  const title = fold(r.trackName);
  const artist = firstArtist(r.artistName);
  const titleOk = names.some(n => {
    const t = fold(n.title);
    return (
      t === title || (t.length > 3 && (t.includes(title) || title.includes(t)))
    );
  });
  const artistOk =
    names.some(n => {
      const a = firstArtist(n.artist);
      return (
        a === artist ||
        (a.length > 2 && (a.includes(artist) || artist.includes(a)))
      );
    }) ||
    (artist.length > 2 && ` ${fold(track.title)} `.includes(` ${artist} `));
  const diff =
    track.duration && r.duration ? Math.abs(track.duration - r.duration) : null;
  const lengthOk = diff === null || diff <= 4;
  return {
    usable:
      titleOk &&
      (artistOk || (diff !== null && diff <= 2)) &&
      (diff === null || diff <= 12),
    confident: titleOk && artistOk && lengthOk,
    score:
      (titleOk ? 4 : 0) +
      (artistOk ? 3 : 0) +
      (diff === null ? 0 : Math.max(0, 3 - diff / 2)) +
      (r.syncedLyrics ? 1 : 0),
  };
}

async function lrclibBest(
  track: Track,
): Promise<(LrclibRecord & { confident: boolean }) | null> {
  const names = namesFor(track);
  if (!names.length) return null;
  // Exact lookup first (LRCLIB matches the duration within a couple of seconds).
  if (track.duration) {
    for (const n of names) {
      const r = await lrclibFetch<LrclibRecord>('/get', {
        track_name: n.title,
        artist_name: n.artist,
        duration: String(Math.round(track.duration)),
      }).catch(() => null);
      if (r && !r.instrumental && (r.syncedLyrics || r.plainLyrics)) {
        return { ...r, confident: true };
      }
    }
  }
  const found: LrclibRecord[] = [];
  for (const n of names) {
    found.push(
      ...(await lrclibSearch({
        track_name: n.title,
        artist_name: n.artist,
      }).catch(() => [])),
    );
    if (found.length) break;
  }
  if (!found.length) {
    const queries = [
      ...names.map(n => `${n.artist} ${n.title}`),
      bareTitle(track),
    ];
    for (const q of [...new Set(queries)]) {
      found.push(...(await lrclibSearch({ q }).catch(() => [])));
      if (found.length) break;
    }
  }
  let best: (LrclibRecord & { confident: boolean; score: number }) | null =
    null;
  for (const r of found) {
    if (r.instrumental || !(r.syncedLyrics || r.plainLyrics)) continue;
    const m = rate(track, r, names);
    if (!m.usable) continue;
    if (!best || m.score > best.score) best = { ...r, ...m };
  }
  return best;
}

// ---- YouTube Music ----

async function youtubeLyrics(
  track: Track,
): Promise<Omit<LyricsRow, 'checkedAt'> | null> {
  try {
    const videoId =
      track.source === 'youtube'
        ? track.sourceId
        : await innertubeFindVideo(track.title, track.artist);
    if (!videoId) return null;
    const found = await innertubeLyrics(videoId);
    if (!found) return null;
    const credit = found.credit?.replace(/^source:\s*/i, '');
    return {
      plain: found.text,
      synced: null,
      source: credit ? `YouTube Music · ${credit}` : 'YouTube Music',
    };
  } catch {
    return null;
  }
}
