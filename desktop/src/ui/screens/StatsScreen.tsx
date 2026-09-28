/** Stats: listening time over 7 days, 30 days or all time, charts and top songs / artists / genres. */
import { useEffect, useState } from 'react';
import { getListenDays, getListens, subscribeLibrary } from '../../core/db/database';
import { tr, type Key } from '../../core/i18n';
import { useLibrary } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { useSettings } from '../../core/services/settings';
import {
  computeStats,
  formatListened,
  periodStart,
  type Stats,
  type StatsPeriod,
} from '../../core/services/stats';
import { genreColors, paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri } from '../../core/types';
import { ACCENT, Card, Cover, Segmented } from '../kit';

const day = (key: string) => new Date(`${key}T12:00:00`);
const weekday = (d: Date) => tr(`stats.day.${d.getDay()}` as Key);
const month = (m: number) => tr(`stats.month.${m}` as Key);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

export function StatsScreen() {
  useCoverColors();
  const { tracks, byId } = useLibrary();
  const dark = useSettings().theme === 'dark';
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [stats, setStats] = useState<Stats | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [hourSel, setHourSel] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [rows, days] = await Promise.all([getListens(periodStart(period)), getListenDays()]);
      if (live) setStats(computeStats(period, rows, days, tracks));
    };
    load().catch(() => {});
    const unsub = subscribeLibrary(() => load().catch(() => {}));
    const timer = setInterval(() => load().catch(() => {}), 30_000);
    return () => {
      live = false;
      unsub();
      clearInterval(timer);
    };
  }, [period, tracks]);

  useEffect(() => setSel(null), [period]);

  const s = stats;
  const bars = s?.buckets ?? [];
  const max = Math.max(1, ...bars.map(b => b.seconds));
  const hmax = Math.max(1, ...(s?.byHour ?? [1]));
  const barLabel = (key: string, i: number) => {
    if (period === 'all') return month(Number(key.slice(5, 7)));
    const d = day(key);
    if (period === 'week') return weekday(d).slice(0, 2);
    return i % 7 === 0 || i === bars.length - 1 ? String(d.getDate()) : '';
  };
  const barFull = (key: string) => {
    if (period === 'all')
      return tr('stats.date.month', { month: month(Number(key.slice(5, 7))), year: key.slice(0, 4) });
    const d = day(key);
    return tr('stats.date.long', { day: weekday(d), date: d.getDate(), month: month(d.getMonth() + 1) });
  };
  const total = s?.seconds ?? 0;

  return (
    <div data-screen-label="Stats" style={{ maxWidth: 1060, padding: '28px 32px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">{tr('stats.eyebrow')}</div>
          <h1 style={{ margin: '4px 0 0', font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em' }}>
            {tr('stats.title')}
          </h1>
        </div>
        <Segmented
          height={32}
          pad={16}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: tr('stats.period.week') },
            { value: 'month', label: tr('stats.period.month') },
            { value: 'all', label: tr('stats.period.all') },
          ]}
        />
      </div>

      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr)', gap: 12 }}>
        <div style={{ padding: 22, borderRadius: 16, background: 'var(--ink)', color: 'var(--onInk)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
          <div className="mono" style={{ font: "600 11px 'Geist Mono',monospace", letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.7 }}>
            {tr('stats.timeListened')}
          </div>
          <div>
            <div style={{ font: "700 44px/1 'Geist',sans-serif", letterSpacing: '-.035em' }}>{formatListened(total)}</div>
            <div style={{ marginTop: 8, font: "400 13px 'Geist',sans-serif", opacity: 0.75 }}>
              {period === 'week' ? tr('desktop.lastWeek') : period === 'month' ? tr('desktop.lastMonth') : tr('desktop.allTime')}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {[
            [String(s?.plays ?? 0), tr('desktop.statPlays')],
            [String(s?.songs ?? 0), tr('desktop.statSongs')],
            [formatListened(s?.perDay ?? 0), tr('desktop.statDaily')],
            [tr('stats.days', { count: s?.streak ?? 0 }), tr('stats.streak')],
            [s?.topHour != null ? hourLabel(s.topHour) : '—', tr('stats.topHour')],
            [tr('stats.percent', { n: Math.round((s?.libraryShare ?? 0) * 100) }), tr('desktop.statLibrary')],
          ].map(([v, l]) => (
            <Card key={l} style={{ padding: '14px 16px' }}>
              <div style={{ font: "600 20px 'Geist',sans-serif", letterSpacing: '-.02em', whiteSpace: 'nowrap' }}>{v}</div>
              <div style={{ marginTop: 2, font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>{l}</div>
            </Card>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 12 }}>
        <Card style={{ padding: 18, minWidth: 0 }}>
          <div style={{ font: "600 15px 'Geist',sans-serif" }}>
            {period === 'all' ? tr('stats.chart.perMonth') : tr('stats.chart.perDay')}
          </div>
          <div style={{ marginTop: 3, font: "500 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
            {sel != null && bars[sel] ? `${barFull(bars[sel].key)} · ${formatListened(bars[sel].seconds)}` : tr('desktop.tapBar')}
          </div>
          <Bars
            gap={period === 'month' ? 3 : 8}
            values={bars.map(b => b.seconds / max)}
            sel={sel}
            onSel={setSel}
          />
          <div style={{ display: 'flex', gap: period === 'month' ? 3 : 8, marginTop: 6 }}>
            {bars.map((b, i) => (
              <span key={b.key} style={{ flex: 1, minWidth: 0, textAlign: 'center', font: "500 10px 'Geist Mono',monospace", color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
                {barLabel(b.key, i)}
              </span>
            ))}
          </div>
        </Card>
        <Card style={{ padding: 18, minWidth: 0 }}>
          <div style={{ font: "600 15px 'Geist',sans-serif" }}>{tr('stats.chart.byHour')}</div>
          <div style={{ marginTop: 3, font: "500 12px 'Geist Mono',monospace", color: 'var(--muted)' }}>
            {hourSel != null && s ? `${hourLabel(hourSel)} · ${formatListened(s.byHour[hourSel])}` : tr('desktop.tapBar')}
          </div>
          <Bars gap={2} values={(s?.byHour ?? Array(24).fill(0)).map(v => v / hmax)} sel={hourSel} onSel={setHourSel} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, font: "500 10px 'Geist Mono',monospace", color: 'var(--muted2)' }}>
            <span>12am</span>
            <span>6am</span>
            <span>12pm</span>
            <span>6pm</span>
            <span>11pm</span>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr) minmax(0,.9fr)', gap: 12, alignItems: 'start' }}>
        <Card style={{ padding: '16px 8px 10px' }}>
          <div style={{ padding: '0 10px 8px', font: "600 15px 'Geist',sans-serif" }}>{tr('stats.topSongs')}</div>
          {(s?.topSongs ?? []).map((r, i) => {
            const t = byId.get(r.key);
            const art = t ? artworkUri(t) : null;
            return (
              <div
                key={r.key}
                className="h-fill"
                onClick={() => t && PlayerService.playQueue([t], 0, tr('stats.topSongs'), false)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', borderRadius: 10, cursor: t ? 'pointer' : 'default' }}
              >
                <span style={{ width: 14, font: "600 13px 'Geist Mono',monospace", color: 'var(--muted2)', flex: 'none' }}>{i + 1}</span>
                <Cover src={art} size={40} bg={paletteFor({ title: r.label, artist: r.sub }, art).artBg} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ellipsis" style={{ font: "500 14px 'Geist',sans-serif" }}>{r.label}</div>
                  <div className="ellipsis" style={{ font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>{r.sub ?? ''}</div>
                </div>
                <span style={{ font: "500 12px 'Geist Mono',monospace", color: 'var(--muted)', flex: 'none' }}>{formatListened(r.seconds)}</span>
              </div>
            );
          })}
          {!s?.topSongs.length && (
            <div style={{ padding: '4px 10px 8px', font: "400 13px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('stats.empty')}</div>
          )}
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ font: "600 15px 'Geist',sans-serif", marginBottom: 12 }}>{tr('stats.topArtists')}</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {(s?.topArtists ?? []).map(a => (
              <div key={a.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, font: "500 14px 'Geist',sans-serif" }}>
                  <span className="ellipsis">{a.label}</span>
                  <span style={{ font: "500 12px 'Geist Mono',monospace", color: 'var(--muted)', flex: 'none' }}>{formatListened(a.seconds)}</span>
                </div>
                <div style={{ marginTop: 5, height: 6, borderRadius: 3, background: 'var(--fill2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(a.seconds / (s!.topArtists[0].seconds || 1)) * 100}%`, background: ACCENT, borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ font: "600 15px 'Geist',sans-serif", marginBottom: 12 }}>{tr('stats.topGenres')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(s?.topGenres ?? []).map(g => {
              const c = genreColors(g.label, dark);
              return (
                <div key={g.key} style={{ padding: '9px 12px', borderRadius: 12, background: c.bg, color: c.ink, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: "600 14px 'Geist',sans-serif" }}>{g.label}</span>
                  <span style={{ font: "500 11px 'Geist Mono',monospace", opacity: 0.8 }}>{formatListened(g.seconds)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div style={{ marginTop: 18, font: "400 12px/1.45 'Geist',sans-serif", color: 'var(--muted2)' }}>
        {s
          ? period === 'all'
            ? tr('stats.addedAll', { count: s.added })
            : s.added
              ? tr('stats.added', { count: s.added })
              : tr('stats.addedNone')
          : ''}{' '}
        {tr('desktop.statsFootnote')}
      </div>
    </div>
  );
}

function Bars({
  values,
  gap,
  sel,
  onSel,
}: {
  values: number[];
  gap: number;
  sel: number | null;
  onSel: (i: number | null) => void;
}) {
  return (
    <div style={{ marginTop: 16, height: 150, display: 'flex', alignItems: 'flex-end', gap }}>
      {values.map((v, i) => (
        <div
          key={i}
          onClick={() => onSel(sel === i ? null : i)}
          style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}
        >
          <div
            style={{
              width: '100%',
              height: `${Math.max(3, v * 100)}%`,
              borderRadius: 3,
              background: i === sel ? ACCENT : 'var(--ink)',
              opacity: sel == null || i === sel ? 1 : 0.3,
              transition: 'height .3s,opacity .2s',
            }}
          />
        </div>
      ))}
    </div>
  );
}
