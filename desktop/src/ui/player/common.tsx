/** What the player bar, the Now playing panel and the full-screen player share. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { tr } from '../../core/i18n';
import {
  useBuffered,
  useDownloadProgress,
  usePlayerState,
  useProgress,
} from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { lyricsFor, type Lyrics } from '../../core/services/lyrics';
import { useSettings } from '../../core/services/settings';
import { sourceName } from '../../core/sources';
import { openSheet } from '../../core/state/ui';
import { paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri, type QueueItem, type Track } from '../../core/types';
import { Spinner } from '../kit';

/** The song playing, its colours and its status line. */
export function useNow() {
  useCoverColors();
  const state = usePlayerState();
  const cur: QueueItem | null = state.queue[state.index] ?? null;
  const settings = useSettings();
  const dl = useDownloadProgress(cur?.id);
  const buffered = useBuffered();
  const art = cur ? artworkUri(cur) : null;
  const pal = cur ? paletteFor(cur, art) : paletteFor({ title: '', artist: null });
  const deep = settings.playerStyle === 'deep';
  const local = cur?.status === 'ready';
  const saving = !local && dl !== undefined;
  const pct = Math.round((dl ?? 0) * 100);
  const src = cur ? sourceName(cur.source) : '';
  const bufPct = local ? 100 : Math.max(buffered, dl ?? 0) * 100;
  const status = !cur
    ? ''
    : state.isResolving
      ? tr('player.findingStream')
      : state.isBuffering && !local
        ? tr('player.bufferingFrom', { source: src })
        : local
          ? cur.savedAt
            ? tr('player.savedOffline')
            : tr('player.onDevice')
          : saving
            ? tr('player.sourceSaving', { source: src, percent: pct })
            : tr('player.streamingOnly', { source: src });
  const mini = !cur
    ? ''
    : local
      ? tr('player.miniOffline', { artist: cur.artist ?? tr('common.unknownArtist') })
      : saving
        ? tr('player.miniSaving', { percent: pct, source: src })
        : tr('player.miniStreaming', { source: src });
  return {
    state,
    cur,
    art,
    pal,
    deep,
    settings,
    local,
    saving,
    streamOnly: !!cur && !local && !saving && cur.source !== 'device',
    downloadPct: dl ?? 0,
    bufPct,
    status,
    mini,
  };
}

/** The CSS animation for a song change (Slide, Fade, Zoom, Flip), restarted on every change. */
export function useSongAnimation(): string {
  const { changeCount, moveDir } = usePlayerState();
  const { songChange } = useSettings();
  if (changeCount < 2) return 'none';
  const name =
    songChange === 'slide'
      ? moveDir < 0
        ? 'slL'
        : 'slR'
      : songChange === 'fade'
        ? 'fd'
        : songChange === 'zoom'
          ? 'zm'
          : 'fl';
  return `${name}${changeCount % 2 ? 'A' : 'B'} .45s cubic-bezier(.2,.8,.2,1)`;
}

/** The song's lyrics (looked up once, then saved), re-read when they change. */
export function useLyrics(track: Track | null) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLyrics(null);
    if (track) lyricsFor(track).then(l => live && setLyrics(l));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, version]);
  useEffect(() => {
    const fn = () => setVersion(v => v + 1);
    window.addEventListener('stash-lyrics-changed', fn);
    return () => window.removeEventListener('stash-lyrics-changed', fn);
  }, []);
  return lyrics;
}

/** Tells every lyrics view the saved lyrics of a song changed. */
export const lyricsChanged = () => window.dispatchEvent(new Event('stash-lyrics-changed'));

const lineAt = (lines: { time: number }[], pos: number) => {
  let k = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].time <= pos) k = i;
  return k;
};

/**
 * Synced lyrics: the current line lit and centred, the others dimmed; click a
 * line to jump there. Plain lyrics scroll. `position` overrides the player's
 * clock (karaoke), and then lines can't be clicked.
 */
export function LyricsView({
  track,
  lyrics,
  size,
  lineHeight,
  height,
  ink,
  position,
  align = 'start',
  highlight,
  onPaste,
}: {
  track: Track;
  lyrics: Lyrics | null;
  size: number;
  lineHeight: number;
  height: number;
  ink: string;
  position?: number;
  align?: 'start' | 'center';
  highlight?: string;
  onPaste?: () => void;
}) {
  const progress = useProgress();
  const pos = position ?? progress.position;
  const mask =
    'linear-gradient(180deg,transparent 0,#000 18%,#000 78%,transparent 100%)';
  const box: CSSProperties = {
    height,
    position: 'relative',
    overflow: 'hidden',
    WebkitMaskImage: mask,
    maskImage: mask,
  };
  const scroller = useRef<HTMLDivElement | null>(null);
  // Synced lines wrap when they're too long, so the current one is placed by
  // where it really is (measured), not by its index × lineHeight.
  const synced = lyrics?.lines ?? null;
  const li = synced ? lineAt(synced, pos) : -1;
  const frame = useRef<HTMLDivElement | null>(null);
  const lineEls = useRef<(HTMLDivElement | null)[]>([]);
  const [lineTop, setLineTop] = useState(0);
  const [, relayout] = useState(0);
  useLayoutEffect(() => {
    const el = lineEls.current[Math.max(0, li)];
    setLineTop(el ? el.offsetTop + el.offsetHeight / 2 - lineHeight / 2 : 0);
  });
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => relayout(n => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [synced]);
  if (!lyrics)
    return (
      <div style={{ ...box, display: 'grid', placeItems: 'center', maskImage: 'none', WebkitMaskImage: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: ink, opacity: 0.8, font: "500 14px 'Geist',sans-serif" }}>
          <Spinner color={ink} track="rgba(255,255,255,.25)" />
          {tr('player.lyricsLooking')}
        </div>
      </div>
    );
  if (lyrics.lines) {
    const lines = lyrics.lines;
    const y = height * 0.39 - lineTop;
    return (
      <div ref={frame} style={box}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            transform: `translateY(${y}px)`,
            transition: 'transform .5s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          {lines.map((l, i) => (
            <div
              key={i}
              ref={el => {
                lineEls.current[i] = el;
              }}
              onClick={position === undefined ? () => PlayerService.seekTo(l.time) : undefined}
              style={{
                minHeight: lineHeight,
                padding: `${Math.round(lineHeight * 0.12)}px ${align === 'center' ? 16 : 0}px`,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: align === 'center' ? 'center' : 'flex-start',
                textAlign: align === 'center' ? 'center' : 'start',
                overflowWrap: 'anywhere',
                textWrap: 'balance' as never,
                font: `${i === li ? 700 : 600} ${i === li && align === 'center' ? size * 1.24 : size}px/1.2 'Geist',sans-serif`,
                letterSpacing: '-.015em',
                color: i === li && highlight ? highlight : ink,
                opacity: i === li ? 1 : Math.abs(i - li) === 1 ? 0.55 : 0.3,
                transition: 'opacity .3s, color .3s',
                cursor: position === undefined ? 'pointer' : 'default',
              }}
            >
              {l.text || '♪'}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (lyrics.plain) {
    return (
      <div
        ref={scroller}
        style={{ height, overflowY: 'auto', overflowX: 'hidden', color: ink, font: `600 ${Math.round(size * 0.9)}px/1.5 'Geist',sans-serif`, whiteSpace: 'pre-wrap', textAlign: align === 'center' ? 'center' : 'start', userSelect: 'text' }}
      >
        {lyrics.plain}
      </div>
    );
  }
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', justifyContent: 'center', gap: 10, textAlign: align === 'center' ? 'center' : 'start', color: ink, padding: '0 12px' }}>
      <div style={{ font: "600 17px 'Geist',sans-serif" }}>{tr('player.lyricsNone')}</div>
      <div style={{ font: "400 13px/1.45 'Geist',sans-serif", opacity: 0.75, maxWidth: 420 }}>{tr('player.lyricsPasteHint')}</div>
      {onPaste && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onPaste} style={{ border: 0, background: ink, color: ink === '#fff' ? '#111' : '#fff', font: "600 13px 'Geist',sans-serif", padding: '9px 16px', borderRadius: 999, cursor: 'pointer' }}>
            {tr('player.lyricsPaste')}
          </button>
          <button
            onClick={() => openSheet({ kind: 'lyricsSearch', track })}
            style={{ border: 0, background: 'rgba(127,127,127,.2)', color: ink, font: "600 13px 'Geist',sans-serif", padding: '9px 16px', borderRadius: 999, cursor: 'pointer' }}
          >
            {tr('player.lyricsSearch')}
          </button>
        </div>
      )}
    </div>
  );
}
