/**
 * Library → Stats: how much you listen, when, and to what.
 * Data: the listening log (db: listens), calculated in services/stats.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getListenDays, getListens } from '../db/database';
import { tr, type Key } from '../i18n';
import { useLibrary } from '../player/hooks';
import {
  computeStats,
  formatListened,
  periodStart,
  type Bucket,
  type Ranked,
  type Stats,
  type StatsPeriod,
} from '../services/stats';
import { ACCENT, eyebrow, font, mono, paletteFor, useTheme } from '../theme';
import { artworkUri } from '../types';
import { Cover, Note, Segmented } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

const dayName = (d: number) => tr(`stats.day.${d}` as Key);
const monthName = (m: number) => tr(`stats.month.${m}` as Key);

/** "Tue 24 Sep" for a day key, "Sep 2026" for a month key (in the app's language). */
function bucketLabel(key: string, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const month = monthName(m);
  if (!d) return long ? tr('stats.date.month', { month, year: y }) : month;
  if (!long) return tr('stats.date.short', { date: d, month });
  const day = dayName(new Date(y, m - 1, d).getDay());
  return tr('stats.date.long', { day, date: d, month });
}

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function StatsView() {
  const t = useTheme();
  const { tracks, byId } = useLibrary();
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    const [rows, days] = await Promise.all([
      getListens(periodStart(period)),
      getListenDays(),
    ]);
    setStats(computeStats(period, rows, days, tracks));
  }, [period, tracks]);

  useEffect(() => {
    load().catch(() => {});
    // Listening goes on while the tab is open: refresh now and then.
    const id = setInterval(() => load().catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const empty = stats && stats.seconds < 60 && stats.plays === 0;

  return (
    <View style={styles.wrap}>
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'week', label: tr('stats.period.week') },
          { value: 'month', label: tr('stats.period.month') },
          { value: 'all', label: tr('stats.period.all') },
        ]}
      />
      {!stats ? null : empty ? (
        <Note style={styles.mt16}>{tr('stats.empty')}</Note>
      ) : (
        <>
          <View style={styles.hero}>
            <Text style={[eyebrow(11), { color: t.muted }]}>
              {tr('stats.timeListened')}
            </Text>
            <Text style={[styles.heroValue, { color: t.ink }]}>
              {formatListened(stats.seconds)}
            </Text>
            <Text style={[font(400, 13), { color: t.muted }]}>
              {[
                tr('stats.plays', { count: stats.plays }),
                tr('common.songs', { count: stats.songs }),
                stats.activeDays
                  ? tr('stats.days', { count: stats.activeDays })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>

          <View style={styles.tiles}>
            <Tile
              label={tr('stats.perDay')}
              value={formatListened(stats.perDay)}
            />
            <Tile
              label={tr('stats.streak')}
              value={tr('stats.days', { count: stats.streak })}
            />
            <Tile
              label={tr('stats.topHour')}
              value={stats.topHour === null ? '—' : hourLabel(stats.topHour)}
            />
            <Tile
              label={tr('stats.libraryShare')}
              value={tr('stats.percent', {
                n: Math.round(stats.libraryShare * 100),
              })}
            />
          </View>

          <Card
            title={
              period === 'all'
                ? tr('stats.chart.perMonth')
                : tr('stats.chart.perDay')
            }
          >
            <BarChart
              buckets={stats.buckets}
              label={b => bucketLabel(b.key)}
              longLabel={b => bucketLabel(b.key, true)}
            />
          </Card>

          <Card title={tr('stats.chart.byHour')}>
            <BarChart
              buckets={stats.byHour.map((seconds, h) => ({
                key: String(h),
                seconds,
              }))}
              label={b => String(Number(b.key)).padStart(2, '0')}
              longLabel={b =>
                `${hourLabel(Number(b.key))} – ${hourLabel(
                  (Number(b.key) + 1) % 24,
                )}`
              }
              tickEvery={6}
            />
          </Card>

          {stats.topSongs.length > 0 && (
            <Card title={tr('stats.topSongs')}>
              {stats.topSongs.map((s, i) => {
                const track = byId.get(s.key);
                return (
                  <RankRow
                    key={s.key}
                    rank={i + 1}
                    item={s}
                    art={
                      <Cover
                        uri={track ? artworkUri(track) : null}
                        size={40}
                        radius={9}
                        bg={
                          paletteFor(track ?? { title: s.label, artist: s.sub })
                            .artBg
                        }
                      />
                    }
                  />
                );
              })}
            </Card>
          )}

          {stats.topArtists.length > 0 && (
            <Card title={tr('stats.topArtists')}>
              <Shares items={stats.topArtists} />
            </Card>
          )}

          {stats.topGenres.length > 0 && (
            <Card title={tr('stats.topGenres')}>
              <Shares items={stats.topGenres} />
            </Card>
          )}

          <Text style={[font(400, 13), styles.foot, { color: t.muted }]}>
            {!stats.added
              ? tr('stats.addedNone')
              : period === 'all'
              ? tr('stats.addedAll', { count: stats.added })
              : tr('stats.added', { count: stats.added })}
          </Text>
        </>
      )}
    </View>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View
      style={[styles.tile, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Text numberOfLines={1} style={[font(700, 19), { color: t.ink }]}>
        {value}
      </Text>
      <Text
        numberOfLines={1}
        style={[font(400, 12), styles.mt2, { color: t.muted }]}
      >
        {label}
      </Text>
    </View>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
    >
      <Text style={[font(600, 15), styles.cardTitle, { color: t.ink }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const CHART_H = 110;
const TICK_W = 56;

/**
 * One series of bars (minutes), rounded at the top and anchored to the
 * baseline. Tap a bar for its value; tap it again to go back to the total.
 */
function BarChart({
  buckets,
  label,
  longLabel,
  tickEvery,
}: {
  buckets: Bucket[];
  label: (b: Bucket) => string;
  longLabel: (b: Bucket) => string;
  /** Label every n-th bar (default: first, middle and last). */
  tickEvery?: number;
}) {
  const t = useTheme();
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [buckets.length]);
  const max = Math.max(...buckets.map(b => b.seconds), 1);
  const total = buckets.reduce((a, b) => a + b.seconds, 0);
  const n = buckets.length;
  const ticks = new Set(
    tickEvery
      ? buckets.map((_, i) => i).filter(i => i % tickEvery === 0)
      : [0, Math.floor((n - 1) / 2), n - 1],
  );
  const sel = picked === null ? null : buckets[picked];

  return (
    <View>
      <Text style={[mono(500, 12), styles.caption, { color: t.ink2 }]}>
        {sel
          ? `${longLabel(sel)} · ${formatListened(sel.seconds)}`
          : tr('stats.chart.total', { time: formatListened(total) })}
      </Text>
      <View style={[styles.plot, { borderBottomColor: t.line2 }]}>
        {buckets.map((b, i) => {
          const h =
            b.seconds > 0 ? Math.max(3, (b.seconds / max) * CHART_H) : 0;
          const on = picked === i;
          return (
            <Pressable
              key={b.key}
              haptic="tick"
              onPress={() => setPicked(on ? null : i)}
              accessibilityLabel={`${longLabel(b)}: ${formatListened(
                b.seconds,
              )}`}
              style={styles.barHit}
            >
              <View
                style={[
                  styles.bar,
                  {
                    height: h,
                    backgroundColor: ACCENT,
                    opacity: picked === null || on ? 1 : 0.35,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.ticks}>
        {[...ticks].map(i => {
          const first = i === 0;
          const last = i === n - 1 && !first;
          return (
            <Text
              key={buckets[i].key}
              numberOfLines={1}
              style={[
                mono(400, 10),
                styles.tick,
                { color: t.muted2 },
                first
                  ? { left: 0, textAlign: 'left' }
                  : last
                  ? { right: 0, textAlign: 'right' }
                  : {
                      left: `${((i + 0.5) / n) * 100}%`,
                      marginLeft: -TICK_W / 2,
                      textAlign: 'center',
                    },
              ]}
            >
              {label(buckets[i])}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function RankRow({
  rank,
  item,
  art,
}: {
  rank: number;
  item: Ranked;
  art: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.rankRow}>
      <Text style={[mono(600, 13), styles.rank, { color: t.muted2 }]}>
        {rank}
      </Text>
      {art}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[font(500, 14), { color: t.ink }]}>
          {item.label}
        </Text>
        <Text numberOfLines={1} style={[font(400, 12), { color: t.muted }]}>
          {[item.sub, tr('stats.plays', { count: item.plays })]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Text style={[mono(500, 12), { color: t.ink2 }]}>
        {formatListened(item.seconds)}
      </Text>
    </View>
  );
}

/** Ranked names with a thin bar for their share of the top one. */
function Shares({ items }: { items: Ranked[] }) {
  const t = useTheme();
  const top = items[0]?.seconds || 1;
  return (
    <View style={styles.shares}>
      {items.map((a, i) => (
        <View key={a.key}>
          <View style={styles.shareHead}>
            <Text
              numberOfLines={1}
              style={[font(500, 14), styles.flex, { color: t.ink }]}
            >
              <Text style={[mono(600, 13), { color: t.muted2 }]}>{i + 1} </Text>
              {a.label}
            </Text>
            <Text style={[mono(500, 12), { color: t.ink2 }]}>
              {formatListened(a.seconds)}
            </Text>
          </View>
          <View style={[styles.shareTrack, { backgroundColor: t.fill2 }]}>
            <View
              style={[
                styles.shareFill,
                {
                  width: `${(a.seconds / top) * 100}%`,
                  backgroundColor: ACCENT,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32 },
  flex: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  mt16: { marginTop: 16 },
  hero: { marginTop: 22, gap: 4 },
  heroValue: { ...font(700, 40, 1.1), letterSpacing: -1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  card: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  cardTitle: { marginBottom: 10 },
  caption: { marginBottom: 10 },
  plot: {
    height: CHART_H,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
  },
  barHit: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 1, // 2px between bars
  },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  ticks: { height: 14, marginTop: 6 },
  tick: { position: 'absolute', top: 0, width: TICK_W },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  rank: { width: 18, textAlign: 'right' },
  shares: { gap: 12 },
  shareHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  shareTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  shareFill: { height: '100%', borderRadius: 3 },
  foot: { marginTop: 16, textAlign: 'center' },
});
