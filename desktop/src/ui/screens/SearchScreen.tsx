/** Search: your library first, then free sources (YouTube Music, Jamendo). The box is in the title bar. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchLibrary } from '../../core/db/database';
import { tr } from '../../core/i18n';
import { useDownloads, useLibrary, usePlayerState } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { getDownloadProgress } from '../../core/services/downloader';
import { useOnline } from '../../core/services/network';
import { useSettings } from '../../core/services/settings';
import { searchOnline, sourceName, type SourceProgress } from '../../core/sources';
import { openSheet } from '../../core/state/ui';
import { formatTime, genreColors, paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri, trackIdFor, type OnlineResult, type Track } from '../../core/types';
import { openCollection, setApp, useApp } from '../appState';
import { CheckCircleIcon, DotsIcon, DownloadIcon, GlobeIcon, PlayIcon } from '../icons';
import { ACCENT, Card, Cover, EqOverlay, Note, Spinner } from '../kit';

const SUGGESTIONS = ['Daft Punk', 'Stromae', 'Tame Impala', 'Clair de Lune'];

export function SearchScreen() {
  useCoverColors();
  const { query } = useApp();
  const { tracks } = useLibrary();
  const online = useOnline();
  const dark = useSettings().theme === 'dark';
  const q = query.trim();
  const [locals, setLocals] = useState<Track[]>([]);
  const [scan, setScan] = useState<{
    for: string;
    sources: SourceProgress[];
    results: OnlineResult[];
    done: boolean;
  } | null>(null);
  const scanFor = useRef('');

  const startScan = (text: string) => {
    scanFor.current = text;
    setScan({ for: text, sources: [], results: [], done: false });
    searchOnline(text, (sources, results) => {
      if (scanFor.current !== text) return;
      setScan({ for: text, sources, results, done: sources.every(s => s.status !== 'searching') });
    }).catch(() => {});
  };

  // A new query: search the library, and online straight away when nothing is here.
  useEffect(() => {
    let live = true;
    scanFor.current = '';
    setScan(null);
    if (!q) {
      setLocals([]);
      return;
    }
    const timer = setTimeout(async () => {
      const found = await searchLibrary(q).catch(() => []);
      if (!live) return;
      setLocals(found);
      if (!found.length && online) startScan(q);
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // The library changed (e.g. a song from the results finished saving): refresh
  // "In your library" only — the online results stay as they are.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!q) return;
    let live = true;
    searchLibrary(q)
      .then(found => live && setLocals(found))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);

  const genres = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) if (t.genre && t.status === 'ready') m.set(t.genre, (m.get(t.genre) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
  }, [tracks]);

  return (
    <div data-screen-label="Search" style={{ maxWidth: 880, padding: '28px 12px 24px' }}>
      <h1 style={{ margin: '0 20px', font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em' }}>
        {tr('library.searchTitle')}
      </h1>
      {!q ? (
        <div
          style={{
            padding: '20px 20px 0',
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)',
            gap: 28,
            alignItems: 'start',
          }}
        >
          <div>
            <div style={{ font: "400 14px 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('desktop.searchTry')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="h-line2"
                  onClick={() => setApp({ query: s })}
                  style={{
                    border: '1px solid var(--line)',
                    background: 'var(--card)',
                    color: 'var(--ink)',
                    font: "500 14px 'Geist',sans-serif",
                    padding: '9px 14px',
                    borderRadius: 999,
                    cursor: 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {genres.length > 0 && (
              <>
                <div style={{ font: "600 16px 'Geist',sans-serif", margin: '28px 0 12px' }}>
                  {tr('library.browseGenre')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {genres.map(g => {
                    const c = genreColors(g, dark);
                    return (
                      <button
                        key={g}
                        onClick={() => openCollection({ kind: 'genre', genre: g })}
                        style={{
                          border: 0,
                          background: c.bg,
                          color: c.ink,
                          font: "600 14px 'Geist',sans-serif",
                          padding: '10px 14px',
                          borderRadius: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <Card style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 14 }}>
              {tr('library.howTitle')}
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {(
                [
                  ['1', 'library.step1Title', 'library.step1Text'],
                  ['2', 'library.step2Title', 'library.step2Text'],
                  ['3', 'library.step3Title', 'library.step3Text'],
                ] as const
              ).map(([n, t, x]) => (
                <div key={n} style={{ display: 'flex', gap: 12 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      flex: 'none',
                      borderRadius: '50%',
                      background: n === '3' ? ACCENT : 'var(--ink)',
                      color: n === '3' ? '#fff' : 'var(--onInk)',
                      display: 'grid',
                      placeItems: 'center',
                      font: "600 12px 'Geist Mono',monospace",
                    }}
                  >
                    {n}
                  </span>
                  <div style={{ font: "400 14px/1.4 'Geist',sans-serif", color: 'var(--ink2)' }}>
                    <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{tr(t)}</b> {tr(x)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <div style={{ padding: '22px 0 20px' }}>
          <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircleIcon size={15} color="oklch(0.58 0.13 155)" />
            <span style={{ font: "600 15px 'Geist',sans-serif" }}>{tr('library.inLibrary')}</span>
            <span style={{ font: "400 13px 'Geist Mono',monospace", color: 'var(--muted2)' }}>{locals.length}</span>
          </div>
          {locals.map((t, i) => (
            <LocalRow key={t.id} track={t} onPlay={() => PlayerService.playQueue(locals, i, tr('system.ctxQuery', { query: q }))} />
          ))}
          {!locals.length && (
            <Note style={{ margin: '0 20px' }}>
              {online ? tr('library.lookingOnline') : tr('library.notHereOffline')}
            </Note>
          )}
          {locals.length > 0 && !scan && (
            <div style={{ padding: '12px 20px 0' }}>
              {online ? (
                <button
                  className="h-card"
                  onClick={() => startScan(q)}
                  style={{
                    width: '100%',
                    height: 46,
                    borderRadius: 14,
                    border: '1px dashed var(--line2)',
                    background: 'transparent',
                    font: "500 14px 'Geist',sans-serif",
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <GlobeIcon size={16} />
                  {tr('library.alsoSearch')}
                </button>
              ) : (
                <Note>{tr('library.offlineOnlyLibrary')}</Note>
              )}
            </div>
          )}
          {scan && !scan.done && <Scanning sources={scan.sources} />}
          {scan && (scan.done || scan.results.length > 0) && <Results scan={scan} />}
        </div>
      )}
    </div>
  );
}

function LocalRow({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const art = artworkUri(track);
  return (
    <div
      className="h-fill"
      onClick={onPlay}
      onContextMenu={e => {
        e.preventDefault();
        openSheet({ kind: 'menu', track });
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px 7px 20px', cursor: 'pointer' }}
    >
      <Cover src={art} size={50} radius={11} bg={paletteFor(track, art).artBg} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ font: "500 15px/1.25 'Geist',sans-serif" }}>
          {track.title}
        </div>
        <div className="ellipsis" style={{ font: "400 13px/1.35 'Geist',sans-serif", color: 'var(--muted)' }}>
          {track.artist ?? tr('common.unknownArtist')} · {tr('library.offlineTag')}
        </div>
      </div>
      <span style={{ font: "400 12px 'Geist Mono',monospace", color: 'var(--muted2)' }}>
        {track.duration ? formatTime(track.duration) : ''}
      </span>
      <button
        onClick={e => {
          e.stopPropagation();
          openSheet({ kind: 'menu', track });
        }}
        style={{ width: 36, height: 40, border: 0, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
      >
        <DotsIcon size={18} />
      </button>
    </div>
  );
}

function Scanning({ sources }: { sources: SourceProgress[] }) {
  return (
    <Card style={{ margin: '16px 20px 0', padding: 16, borderRadius: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Spinner />
        <span style={{ font: "600 14px 'Geist',sans-serif" }}>{tr('library.searchingSources')}</span>
      </div>
      <div style={{ display: 'grid', gap: 9 }}>
        {sources.map(s => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              font: "400 14px 'Geist',sans-serif",
              color: s.status === 'done' ? 'var(--ink)' : s.status === 'searching' ? 'var(--accentInk)' : 'var(--muted2)',
            }}
          >
            <span>{s.name}</span>
            <span style={{ font: "400 12px 'Geist Mono',monospace" }}>{sourceStatus(s)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const sourceStatus = (s: SourceProgress) =>
  s.status === 'done'
    ? tr('library.srcFound', { count: s.count ?? 0 })
    : s.status === 'searching'
      ? tr('library.srcSearching')
      : s.status === 'failed'
        ? tr('library.srcNoAnswer')
        : tr('library.srcOff');

function Results({ scan }: { scan: { sources: SourceProgress[]; results: OnlineResult[]; done: boolean } }) {
  const { byId } = useLibrary();
  const { queue, index, isPlaying } = usePlayerState();
  useDownloads();
  const cur = queue[index]?.id;
  const problems = scan.sources.filter(s => s.status === 'failed' || s.status === 'off');
  return (
    <div>
      <div style={{ padding: '22px 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <GlobeIcon size={15} color={ACCENT} />
        <span style={{ font: "600 15px 'Geist',sans-serif" }}>{tr('library.foundOnline')}</span>
        <span style={{ font: "400 13px 'Geist Mono',monospace", color: 'var(--muted2)' }}>{scan.results.length}</span>
      </div>
      {scan.results.map(r => {
        const id = trackIdFor(r.source, r.sourceId);
        const lib = byId.get(id);
        const saved = lib?.status === 'ready';
        const pct = getDownloadProgress(id);
        const saving = !saved && pct !== undefined;
        return (
          <div
            key={id}
            className="h-fill"
            onClick={() => PlayerService.playOnline(r)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 20px', cursor: 'pointer' }}
          >
            <Cover src={r.thumbnailUrl} size={50} radius={11} bg={paletteFor(r, r.thumbnailUrl).artBg}>
              {cur === id && <EqOverlay playing={isPlaying} />}
            </Cover>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: "500 15px/1.25 'Geist',sans-serif" }}>
                {r.title}
              </div>
              <div className="ellipsis" style={{ font: "400 13px/1.35 'Geist',sans-serif", color: 'var(--muted)' }}>
                {[r.artist ?? tr('common.unknownArtist'), sourceName(r.source), r.duration ? formatTime(r.duration) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {saved ? (
              <CheckCircleIcon size={18} color="oklch(0.58 0.13 155)" />
            ) : saving ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: "500 12px 'Geist Mono',monospace", color: 'var(--accentInk)', flex: 'none' }}>
                <div style={{ width: 34, height: 4, borderRadius: 2, background: 'var(--accentSoft2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((pct ?? 0) * 100)}%`, background: ACCENT }} />
                </div>
                {Math.round((pct ?? 0) * 100)}%
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                <button
                  className="h-ink-border"
                  title={tr('library.downloadOnly')}
                  aria-label={tr('library.downloadOnly')}
                  onClick={e => {
                    e.stopPropagation();
                    PlayerService.downloadOnly(r);
                  }}
                  style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--line2)', background: 'var(--card)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}
                >
                  <DownloadIcon size={16} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 34, padding: '0 11px 0 9px', borderRadius: 999, background: 'var(--ink)', color: 'var(--onInk)', font: "500 12px 'Geist',sans-serif" }}>
                  <PlayIcon size={12} />
                  {tr('common.play')}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {problems.map(s => (
        <div key={s.id} style={{ padding: '8px 20px 0', font: "400 12px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>
          {s.status === 'off' ? tr('library.sourceOff', { name: s.name }) : tr('library.sourceFailed', { name: s.name, error: s.error ?? '' })}
        </div>
      ))}
      <div style={{ padding: '10px 20px 0', font: "400 12px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>
        {tr('library.footnote')}
      </div>
    </div>
  );
}
