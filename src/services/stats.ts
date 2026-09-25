/**
 * Listening stats from the listening log (db: listens), for Library → Stats.
 * Everything here is plain calculation, so it's easy to test.
 */
import type { ListenRow } from '../db/database';
import { tr } from '../i18n';
import type { Track } from '../types';

export type StatsPeriod = 'week' | 'month' | 'all';

export interface Ranked {
  key: string;
  label: string;
  sub: string | null;
  seconds: number;
  plays: number;
}

export interface Bucket {
  /** "2026-09-25" for days, "2026-09" for months. */
  key: string;
  seconds: number;
}

export interface Stats {
  seconds: number;
  plays: number;
  songs: number;
  /** Days with some listening in the period. */
  activeDays: number;
  /** Average per day over the period's days (all time: since the first listen). */
  perDay: number;
  /** Days in a row with listening, up to today (or yesterday). */
  streak: number;
  /** The hour of the day with the most listening, or null. */
  topHour: number | null;
  /** Listening per day (week, month) or per month (all time), oldest first. */
  buckets: Bucket[];
  byHour: number[];
  topSongs: Ranked[];
  topArtists: Ranked[];
  topGenres: Ranked[];
  /** Share of the library's songs played in the period (0..1). */
  libraryShare: number;
  /** Songs added to the library in the period. */
  added: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** Local calendar day, "2026-09-25". */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/** The first day of the period, or null for all time. */
export function periodStart(
  period: StatsPeriod,
  now = new Date(),
): string | null {
  if (period === 'all') return null;
  const days = period === 'week' ? 7 : 30;
  return dayKey(new Date(now.getTime() - (days - 1) * DAY_MS));
}

function rank(
  rows: ListenRow[],
  keyOf: (r: ListenRow) => string | null,
  labelOf: (r: ListenRow) => string,
  subOf: (r: ListenRow) => string | null,
  limit: number,
): Ranked[] {
  const map = new Map<string, Ranked>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    const e = map.get(key) ?? {
      key,
      label: labelOf(r),
      sub: subOf(r),
      seconds: 0,
      plays: 0,
    };
    e.seconds += r.seconds;
    e.plays += r.plays;
    map.set(key, e);
  }
  return [...map.values()]
    .filter(e => e.seconds >= 30 || e.plays > 0)
    .sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
    .slice(0, limit);
}

/** Days in a row with listening, ending today (or yesterday, if today is empty so far). */
export function streakOf(days: string[], now = new Date()): number {
  const have = new Set(days);
  let d = new Date(now);
  if (!have.has(dayKey(d))) d = new Date(d.getTime() - DAY_MS);
  let n = 0;
  while (have.has(dayKey(d))) {
    n++;
    d = new Date(d.getTime() - DAY_MS);
  }
  return n;
}

export function computeStats(
  period: StatsPeriod,
  rows: ListenRow[],
  allDays: string[],
  library: Track[],
  now = new Date(),
): Stats {
  const seconds = rows.reduce((a, r) => a + r.seconds, 0);
  const plays = rows.reduce((a, r) => a + r.plays, 0);
  const songIds = new Set(
    rows.filter(r => r.seconds >= 30 || r.plays).map(r => r.trackId),
  );

  const perDayMap = new Map<string, number>();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    perDayMap.set(r.day, (perDayMap.get(r.day) ?? 0) + r.seconds);
    byHour[r.hour] += r.seconds;
  }
  const activeDays = [...perDayMap.values()].filter(s => s > 0).length;

  let buckets: Bucket[];
  let spanDays: number;
  if (period === 'all') {
    // The last 12 months, by month.
    const months: Bucket[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = dayKey(m).slice(0, 7);
      months.push({ key, seconds: 0 });
    }
    for (const r of rows) {
      const b = months.find(x => x.key === r.day.slice(0, 7));
      if (b) b.seconds += r.seconds;
    }
    buckets = months;
    const first = allDays[0];
    spanDays = first
      ? Math.max(
          1,
          Math.round((now.getTime() - new Date(first).getTime()) / DAY_MS) + 1,
        )
      : 1;
  } else {
    spanDays = period === 'week' ? 7 : 30;
    buckets = Array.from({ length: spanDays }, (_, i) => {
      const key = dayKey(new Date(now.getTime() - (spanDays - 1 - i) * DAY_MS));
      return { key, seconds: perDayMap.get(key) ?? 0 };
    });
  }

  const topHourSeconds = Math.max(...byHour);
  const start = periodStart(period, now);
  const startMs = start ? new Date(`${start}T00:00:00`).getTime() : 0;
  const saved = library.filter(t => t.status !== 'streaming');

  return {
    seconds,
    plays,
    songs: songIds.size,
    activeDays,
    perDay: seconds / spanDays,
    streak: streakOf(allDays, now),
    topHour: topHourSeconds > 0 ? byHour.indexOf(topHourSeconds) : null,
    buckets,
    byHour,
    topSongs: rank(
      rows,
      r => r.trackId,
      r => r.title,
      r => r.artist,
      10,
    ),
    topArtists: rank(
      rows,
      r => (r.artist ? r.artist.toLowerCase() : null),
      r => r.artist ?? '',
      () => null,
      5,
    ),
    topGenres: rank(
      rows,
      r => r.genre,
      r => r.genre ?? '',
      () => null,
      5,
    ),
    libraryShare: saved.length
      ? saved.filter(t => songIds.has(t.id)).length / saved.length
      : 0,
    added: saved.filter(t => (t.savedAt ?? t.addedAt) >= startMs).length,
  };
}

/** "3 h 12 min", "45 min", "40 s" (in the app's language). */
export function formatListened(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (seconds < 60) return tr('stats.time.s', { n: Math.round(seconds) });
  if (min < 60) return tr('stats.time.min', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? tr('stats.time.hMin', { h, m }) : tr('stats.time.h', { h });
}
