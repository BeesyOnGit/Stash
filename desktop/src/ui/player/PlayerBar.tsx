/** The player bar along the bottom: song, transport, seek bar and the player's tools. */
import { useRef, useState } from 'react';
import { tr } from '../../core/i18n';
import { usePlayerState, useProgress, useSleepLeft } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { canKaraoke } from '../../core/services/karaoke';
import { speedLabel, useSettings } from '../../core/services/settings';
import { openSheet, toast } from '../../core/state/ui';
import { formatTime } from '../../core/theme';
import { openKaraoke, setApp, useApp } from '../appState';
import {
  AddToListIcon,
  ExpandIcon,
  HeartIcon,
  LyricsIcon,
  MicIcon,
  MoonIcon,
  NextIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  SimilarIcon,
  SpeedIcon,
  VolumeIcon,
} from '../icons';
import { ACCENT, Cover, IconButton } from '../kit';
import { useNow } from './common';

/** A seek bar that follows clicks and drags; `max` limits how far a stream can go. */
export function SeekBar({
  height = 4,
  track,
  buffer,
  played,
  maxFraction = 1,
}: {
  height?: number;
  track: string;
  buffer: string;
  played: string;
  maxFraction?: number;
}) {
  const progress = useProgress();
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const now = useNow();
  const d = progress.duration || now.cur?.duration || 0;
  const frac = drag ?? (d > 0 ? Math.min(1, progress.position / d) : 0);
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    let f = (x - r.left) / r.width;
    if (document.dir === 'rtl') f = 1 - f;
    return Math.max(0, Math.min(maxFraction - 0.005, f));
  };
  return (
    <div
      ref={ref}
      onPointerDown={e => {
        if (e.button !== 0 || !d) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={e => drag !== null && setDrag(at(e.clientX))}
      onPointerUp={e => {
        if (drag === null) return;
        PlayerService.seekTo(at(e.clientX) * d);
        setDrag(null);
      }}
      style={{ flex: 1, height: height + 12, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', width: '100%', height, borderRadius: height / 2, background: track, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${now.bufPct}%`, background: buffer }} />
        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: played, borderRadius: height / 2 }} />
      </div>
    </div>
  );
}

let beforeMute = 1;
let wheelSave: ReturnType<typeof setTimeout> | null = null;

/**
 * Speaker button (mute). Hovering it pops up a vertical volume bar above it,
 * in the seek bar's style; the mouse wheel over either works too.
 */
export function VolumeControl({
  track,
  played,
  color,
  panel,
  iconSize = 19,
  buttonSize = 36,
  height = 96,
}: {
  track: string;
  played: string;
  color: string;
  /** The pop-up's background. */
  panel: string;
  iconSize?: number;
  buttonSize?: number;
  height?: number;
}) {
  const { volume } = useSettings();
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const open = hover || drag !== null;
  const v = drag ?? volume;
  const at = (y: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (r.bottom - y) / r.height));
  };
  const set = (f: number, save: boolean) => {
    setDrag(save ? null : f);
    PlayerService.setVolume(f, save);
  };
  const mute = () => {
    if (volume > 0) {
      beforeMute = volume;
      PlayerService.setVolume(0);
    } else {
      PlayerService.setVolume(beforeMute || 1);
    }
  };
  const label = v > 0 ? tr('desktop.mute') : tr('desktop.unmute');
  return (
    <div
      onWheel={e => {
        const f = Math.max(0, Math.min(1, Math.round((v - Math.sign(e.deltaY) * 0.05) * 100) / 100));
        set(f, false);
        if (wheelSave) clearTimeout(wheelSave);
        wheelSave = setTimeout(() => set(f, true), 400);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', color }}
    >
      {open && (
        // Padding (not margin) under the pop-up keeps the pointer inside while moving up to it.
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', paddingBottom: 6, zIndex: 5 }}>
          <div
            style={{ padding: '12px 0 10px', width: 36, borderRadius: 999, background: panel, boxShadow: '0 6px 20px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, animation: 'fadeIn .12s ease-out' }}
          >
            <div
              ref={ref}
              role="slider"
              aria-orientation="vertical"
              aria-label={tr('desktop.volume')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(v * 100)}
              onPointerDown={e => {
                if (e.button !== 0) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                set(at(e.clientY), false);
              }}
              onPointerMove={e => drag !== null && set(at(e.clientY), false)}
              onPointerUp={e => drag !== null && set(at(e.clientY), true)}
              style={{ width: 16, height, display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
            >
              <div style={{ position: 'relative', width: 4, height: '100%', borderRadius: 2, background: track, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v * 100}%`, background: played, borderRadius: 2 }} />
              </div>
            </div>
            <span style={{ font: "500 10px 'Geist Mono',monospace", opacity: 0.75 }}>{Math.round(v * 100)}</span>
          </div>
        </div>
      )}
      <button
        onClick={mute}
        title={label}
        aria-label={label}
        style={{ width: buttonSize, height: buttonSize, border: 0, borderRadius: 10, background: 'transparent', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
      >
        <VolumeIcon level={v} size={iconSize} style={{ transform: document.dir === 'rtl' ? 'scaleX(-1)' : undefined }} />
      </button>
    </div>
  );
}

export function PositionText({ which }: { which: 'pos' | 'dur' }) {
  const p = useProgress();
  const now = useNow();
  return <>{formatTime(which === 'pos' ? p.position : p.duration || now.cur?.duration || 0)}</>;
}

export function PlayerBar() {
  const now = useNow();
  const { cur, art, pal, state, settings } = now;
  const { panel, lyrics } = useApp();
  const sleepLeft = useSleepLeft();
  if (!cur) return null;
  const on = (b: boolean) => (b ? ACCENT : 'var(--ink)');
  return (
    <div
      style={{
        height: 84,
        flex: 'none',
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr)',
        alignItems: 'center',
        gap: 20,
        padding: '0 18px',
        borderTop: '1px solid var(--line)',
        background: 'var(--bar)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div onClick={() => setApp({ panel: !panel })} title={tr('desktop.nowPlayingPanel')} style={{ cursor: 'pointer' }}>
          <Cover src={art} size={52} radius={10} bg={pal.artBg} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ font: "600 14px/1.25 'Geist',sans-serif" }}>{cur.title}</div>
          <div className="ellipsis" style={{ font: "400 12px/1.35 'Geist',sans-serif", color: 'var(--muted)' }}>
            {state.error ?? (state.isResolving ? tr('player.findingStream') : now.mini)}
          </div>
        </div>
        <IconButton size={34} color={cur.liked ? ACCENT : 'var(--ink)'} hover="" onClick={() => PlayerService.toggleLike(cur)} title={tr('sheets.like')}>
          <HeartIcon filled={cur.liked} size={18} />
        </IconButton>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--ink)' }}>
          <IconButton size={34} hover="" color={on(state.shuffle)} onClick={() => PlayerService.toggleShuffle()} title={tr('common.shuffle')} style={{ position: 'relative' }}>
            <ShuffleIcon size={17} />
            {state.shuffle && <Dot />}
          </IconButton>
          <IconButton size={36} hover="" onClick={() => PlayerService.previous()} title={tr('common.previous')}>
            <PrevIcon size={22} style={{ transform: document.dir === 'rtl' ? 'scaleX(-1)' : undefined }} />
          </IconButton>
          <button
            onClick={() => PlayerService.togglePlay()}
            title={tr('desktop.playPauseKey')}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: 'var(--ink)', color: 'var(--onInk)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            {state.isPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </button>
          <IconButton size={36} hover="" onClick={() => PlayerService.next()} title={tr('common.next')}>
            <NextIcon size={22} style={{ transform: document.dir === 'rtl' ? 'scaleX(-1)' : undefined }} />
          </IconButton>
          <IconButton size={34} hover="" color={on(state.repeat !== 'off')} onClick={() => PlayerService.cycleRepeat()} title={tr('desktop.repeat')} style={{ position: 'relative' }}>
            <RepeatIcon size={17} />
            {state.repeat === 'one' && <span style={{ position: 'absolute', top: 2, right: 2, font: "700 9px 'Geist Mono',monospace" }}>1</span>}
            {state.repeat === 'all' && <Dot />}
          </IconButton>
        </div>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, font: "500 11px 'Geist Mono',monospace", color: 'var(--muted)' }}>
          <span style={{ minWidth: 34, textAlign: 'end' }}>
            <PositionText which="pos" />
          </span>
          <SeekBar track="var(--fill3)" buffer="var(--line2)" played={ACCENT} maxFraction={now.local ? 1 : Math.max(0.02, now.bufPct / 100)} />
          <span style={{ minWidth: 34 }}>
            <PositionText which="dur" />
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, color: 'var(--ink)' }}>
        {sleepLeft && (
          <button
            onClick={() => openSheet({ kind: 'sleep' })}
            title={tr('player.sleepTimerLabel', { left: sleepLeft })}
            style={{ height: 32, border: 0, borderRadius: 999, background: 'var(--fill2)', color: ACCENT, padding: '0 9px', cursor: 'pointer', display: 'grid', placeItems: 'center', marginInlineEnd: 4 }}
          >
            <MoonIcon size={15} />
          </button>
        )}
        <button
          onClick={() => openSheet({ kind: 'speed' })}
          title={tr('settings.playbackSpeed')}
          style={{ height: 32, border: 0, borderRadius: 999, background: 'var(--fill2)', color: 'inherit', font: "600 12px 'Geist Mono',monospace", padding: '0 10px 0 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, marginInlineEnd: 4 }}
        >
          <SpeedIcon size={14} />
          {speedLabel(settings.playbackSpeed)}
        </button>
        <IconButton color={lyrics && panel ? ACCENT : 'var(--ink)'} title={tr('desktop.lyricsKey')} onClick={() => setApp({ lyrics: !(lyrics && panel), panel: true })}>
          <LyricsIcon size={19} />
        </IconButton>
        <IconButton title={tr('karaoke.title')} onClick={() => (canKaraoke(cur) ? openKaraoke(cur.id) : toast(tr('desktop.karaokeNeedsFile')))}>
          <MicIcon size={19} />
        </IconButton>
        {settings.suggestSimilar && (
          <IconButton title={tr('desktop.similarSongs')} onClick={() => openSheet({ kind: 'similar', track: cur })}>
            <SimilarIcon size={19} />
          </IconButton>
        )}
        {cur.status !== 'streaming' && (
          <IconButton title={tr('sheets.addToPlaylist')} onClick={() => openSheet({ kind: 'add', track: cur })}>
            <AddToListIcon size={19} stroke={2.2} />
          </IconButton>
        )}
        <IconButton title={tr('sheets.queue')} onClick={() => openSheet({ kind: 'queue' })}>
          <QueueIcon size={19} />
        </IconButton>
        <VolumeControl track="var(--fill3)" played={ACCENT} color="var(--ink)" panel="var(--card)" />
        <IconButton title={tr('desktop.fullScreen')} onClick={() => setApp({ fullScreen: true })}>
          <ExpandIcon size={19} />
        </IconButton>
        <IconButton color={panel ? ACCENT : 'var(--ink)'} title={tr('desktop.nowPlayingPanel')} onClick={() => setApp({ panel: !panel })}>
          <PanelIcon size={19} />
        </IconButton>
      </div>
    </div>
  );
}

const Dot = () => (
  <span style={{ position: 'absolute', bottom: 1, left: '50%', width: 4, height: 4, marginLeft: -2, borderRadius: '50%', background: 'currentColor' }} />
);

export const usePlaying = () => usePlayerState().isPlaying;
