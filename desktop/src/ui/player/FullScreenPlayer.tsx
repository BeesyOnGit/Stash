/** Full screen (F): the player fills the window (the window itself keeps its size); the cover big, lyrics or Up next beside it; the controls fade out when the mouse rests. */
import { useEffect, useRef, useState } from 'react';
import { tr } from '../../core/i18n';
import { usePlayerState, useSleepLeft } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { canKaraoke } from '../../core/services/karaoke';
import { speedLabel } from '../../core/services/settings';
import { openSheet, toast } from '../../core/state/ui';
import { formatTime, paletteFor } from '../../core/theme';
import { artworkUri } from '../../core/types';
import { openKaraoke, setApp, useApp } from '../appState';
import {
  AddToListIcon,
  CollapseIcon,
  HeartIcon,
  MicIcon,
  MoonIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ShuffleIcon,
} from '../icons';
import { Cover } from '../kit';
import { LyricsView, useLyrics, useNow, useSongAnimation } from './common';
import { PositionText, SeekBar, VolumeControl } from './PlayerBar';

const HOT = '#FF8A65';
const W = '#F4F3F0';

export function FullScreenPlayer() {
  const now = useNow();
  const { cur, art, pal, state, settings } = now;
  const { lyrics: lyricsTab } = useApp();
  const anim = useSongAnimation();
  const sleepLeft = useSleepLeft();
  const lyrics = useLyrics(lyricsTab ? cur : null);
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), 3000);
    setIdle(false);
  };
  useEffect(() => {
    wake();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // The display stays awake while the full-screen player is open (Settings → Appearance).
  useEffect(() => {
    if (!settings.keepScreenOn || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then(l => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, [settings.keepScreenOn]);

  if (!cur) return null;
  const hidden = idle && state.isPlaying;
  const chrome = { opacity: hidden ? 0 : 1, transition: 'opacity .5s' };
  const upNext = state.queue.slice(state.index + 1);

  return (
    <div
      data-screen-label="Full screen player"
      onMouseMove={wake}
      style={{ position: 'absolute', inset: 0, zIndex: 44, overflow: 'hidden', background: '#0B0B0D', color: W, ['--sb' as string]: W, cursor: hidden ? 'none' : 'default', animation: 'fadeIn .35s ease-out' }}
    >
      {art && (
        <img src={art} alt="" style={{ position: 'absolute', left: '-20%', top: '-25%', width: '140%', height: '150%', objectFit: 'cover', filter: 'blur(90px) saturate(1.5)', opacity: 0.55, pointerEvents: 'none' }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(8,8,10,.3) 0%,rgba(8,8,10,.5) 55%,rgba(8,8,10,.88) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '22px 40px 26px' }}>
        <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, ...chrome }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <Glass onClick={() => setApp({ fullScreen: false })} title={tr('desktop.exitFullScreen')}>
              <CollapseIcon size={16} />
            </Glass>
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ font: "500 10px 'Geist Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.7 }}>
                {tr('player.playingFrom')}
              </div>
              <div className="ellipsis" style={{ font: "600 14px 'Geist',sans-serif", marginTop: 2 }}>{state.contextName}</div>
            </div>
          </div>
          <div style={{ display: 'flex', padding: 3, borderRadius: 999, background: 'rgba(255,255,255,.1)', gap: 2 }}>
            <Tab on={lyricsTab} onClick={() => setApp({ lyrics: true })}>{tr('desktop.lyrics')}</Tab>
            <Tab on={!lyricsTab} onClick={() => setApp({ lyrics: false })}>{tr('desktop.upNext')}</Tab>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 64, alignItems: 'center', padding: '8px 24px' }}>
          <div key={state.changeCount} style={{ position: 'relative', width: 'min(440px, 42vh)', height: 'min(440px, 42vh)', animation: anim }}>
            <div style={{ position: 'absolute', inset: '30px 16px -20px', borderRadius: 40, background: pal.artBg, filter: 'blur(40px)', opacity: 0.7 }} />
            <Cover src={art} size="100%" radius={24} bg={pal.artBg} style={{ boxShadow: '0 30px 70px rgba(0,0,0,.45)' }} />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div key={`t${state.changeCount}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, animation: anim }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "700 48px/1.05 'Geist',sans-serif", letterSpacing: '-.035em', textWrap: 'balance' as never }}>{cur.title}</div>
                <div style={{ marginTop: 8, font: "400 20px 'Geist',sans-serif", opacity: 0.75 }}>{cur.artist ?? tr('common.unknownArtist')}</div>
              </div>
              <Glass size={48} color={cur.liked ? HOT : W} onClick={() => PlayerService.toggleLike(cur)} title={tr('sheets.like')}>
                <HeartIcon filled={cur.liked} size={22} />
              </Glass>
            </div>
            {lyricsTab ? (
              <LyricsView track={cur} lyrics={lyrics} size={30} lineHeight={56} height={320} ink="#fff" onPaste={() => openSheet({ kind: 'paste', track: cur })} />
            ) : (
              <div style={{ height: 320, overflowY: 'auto', overflowX: 'hidden', margin: '0 -10px', paddingInlineEnd: 4 }}>
                {!upNext.length && <div style={{ padding: 10, font: "400 15px 'Geist',sans-serif", opacity: 0.7 }}>{tr('sheets.endOfQueue')}</div>}
                {upNext.map((t, k) => {
                  const a = artworkUri(t);
                  return (
                    <div
                      key={t.id}
                      className="h-white08"
                      onClick={() => PlayerService.skipTo(state.index + 1 + k)}
                      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 10px', borderRadius: 12, cursor: 'pointer' }}
                    >
                      <Cover src={a} size={48} radius={10} bg={paletteFor(t, a).artBg} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ellipsis" style={{ font: "500 16px 'Geist',sans-serif" }}>{t.title}</div>
                        <div className="ellipsis" style={{ font: "400 14px 'Geist',sans-serif", opacity: 0.7 }}>{t.artist ?? tr('common.unknownArtist')}</div>
                      </div>
                      <span className="mono" style={{ font: "400 13px 'Geist Mono',monospace", opacity: 0.7 }}>{t.duration ? formatTime(t.duration) : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={chrome}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: "500 12px 'Geist Mono',monospace" }}>
            <span style={{ minWidth: 40, textAlign: 'end', opacity: 0.8 }}><PositionText which="pos" /></span>
            <SeekBar height={5} track="rgba(255,255,255,.16)" buffer="rgba(255,255,255,.14)" played="#fff" maxFraction={now.local ? 1 : Math.max(0.02, now.bufPct / 100)} />
            <span style={{ minWidth: 40, opacity: 0.8 }}><PositionText which="dur" /></span>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlassPill onClick={() => openSheet({ kind: 'speed' })} title={tr('settings.playbackSpeed')}>{speedLabel(settings.playbackSpeed)}</GlassPill>
              {sleepLeft && (
                <GlassPill onClick={() => openSheet({ kind: 'sleep' })} title={tr('sheets.sleepTitle')}>
                  <MoonIcon size={14} />
                  {sleepLeft}
                </GlassPill>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <Plain size={40} color={state.shuffle ? HOT : W} onClick={() => PlayerService.toggleShuffle()} title={tr('common.shuffle')}>
                <ShuffleIcon size={20} />
              </Plain>
              <Plain size={44} onClick={() => PlayerService.previous()} title={tr('common.previous')}>
                <PrevIcon size={28} />
              </Plain>
              <button
                onClick={() => PlayerService.togglePlay()}
                title={tr('desktop.playPauseKey')}
                style={{ width: 64, height: 64, borderRadius: '50%', border: 0, background: '#fff', color: '#0B0B0D', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
              >
                {state.isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
              </button>
              <Plain size={44} onClick={() => PlayerService.next()} title={tr('common.next')}>
                <NextIcon size={28} />
              </Plain>
              <Plain size={40} color={state.repeat !== 'off' ? HOT : W} onClick={() => PlayerService.cycleRepeat()} title={tr('desktop.repeat')}>
                <RepeatIcon size={20} />
                {state.repeat === 'one' && <span style={{ position: 'absolute', top: 3, right: 3, font: "700 9px 'Geist Mono',monospace" }}>1</span>}
              </Plain>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <VolumeControl track="rgba(255,255,255,.18)" played="#fff" color={W} panel="rgba(40,40,44,.92)" iconSize={20} buttonSize={40} height={110} />
              <Plain size={40} hover title={tr('karaoke.title')} onClick={() => (canKaraoke(cur) ? openKaraoke(cur.id) : toast(tr('desktop.karaokeNeedsFile')))}>
                <MicIcon size={20} />
              </Plain>
              {cur.status !== 'streaming' && (
                <Plain size={40} hover title={tr('sheets.addToPlaylist')} onClick={() => openSheet({ kind: 'add', track: cur })}>
                  <AddToListIcon size={20} stroke={2.2} />
                </Plain>
              )}
              <Plain size={40} hover title={tr('desktop.exitFullScreen')} onClick={() => setApp({ fullScreen: false })}>
                <CollapseIcon size={20} />
              </Plain>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const Glass = ({ children, onClick, title, size = 40, color = '#fff' }: { children: React.ReactNode; onClick: () => void; title: string; size?: number; color?: string }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className="h-white16"
    style={{ width: size, height: size, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.12)', color, display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
  >
    {children}
  </button>
);

const GlassPill = ({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) => (
  <button
    onClick={onClick}
    title={title}
    style={{ height: 36, border: 0, borderRadius: 999, background: 'rgba(255,255,255,.12)', color: '#fff', font: "600 12px 'Geist Mono',monospace", padding: '0 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
  >
    {children}
  </button>
);

const Plain = ({ children, onClick, title, size, color = '#fff', hover }: { children: React.ReactNode; onClick: () => void; title: string; size: number; color?: string; hover?: boolean }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={hover ? 'h-white10' : undefined}
    style={{ position: 'relative', width: size, height: size, border: 0, borderRadius: 10, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color }}
  >
    {children}
  </button>
);

const Tab = ({ children, on, onClick }: { children: React.ReactNode; on: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{ height: 32, padding: '0 16px', border: 0, borderRadius: 999, background: on ? 'rgba(255,255,255,.18)' : 'transparent', color: '#fff', font: "600 13px 'Geist',sans-serif", cursor: 'pointer' }}
  >
    {children}
  </button>
);

export const usePlayingNow = () => usePlayerState().isPlaying;
