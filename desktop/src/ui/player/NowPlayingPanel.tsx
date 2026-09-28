/** The Now playing panel: cover (or lyrics), status chips, Lyrics / Karaoke / Sleep and Up next. */
import { useState, type PointerEvent as RPointerEvent } from 'react';
import { tr } from '../../core/i18n';
import { usePlayerState, useSleepLeft } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { canKaraoke } from '../../core/services/karaoke';
import { OWN_LYRICS } from '../../core/services/lyrics';
import { useOnline } from '../../core/services/network';
import { openSheet, toast } from '../../core/state/ui';
import { formatTime, GREEN, paletteFor } from '../../core/theme';
import { artworkUri } from '../../core/types';
import { openKaraoke, setApp, useApp } from '../appState';
import { useRowDrag } from '../drag';
import {
  CloseIcon,
  DotsIcon,
  DownloadIcon,
  ExpandIcon,
  GripIcon,
  HeartIcon,
  LyricsIcon,
  MicIcon,
  MoonIcon,
  ShuffleIcon,
} from '../icons';
import { Cover, Spinner, Vinyl } from '../kit';
import { LyricsView, useLyrics, useNow, useSongAnimation } from './common';

export function NowPlayingPanel({ width, onResize, onResetSize, grip }: {
  width: number;
  onResize: (e: RPointerEvent) => void;
  onResetSize: () => void;
  grip: boolean;
}) {
  const now = useNow();
  const { cur, pal, deep, art, state, settings } = now;
  const { lyrics: lyricsOpen } = useApp();
  const anim = useSongAnimation();
  const sleepLeft = useSleepLeft();
  const online = useOnline();
  const lyrics = useLyrics(lyricsOpen ? cur : null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  if (!cur) return null;

  const ink = deep ? '#fff' : pal.softInk;
  const chip = deep ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.6)';
  const bg = deep
    ? `radial-gradient(130% 80% at 50% 0%, ${pal.deep2} 0%, ${pal.deep} 65%)`
    : `linear-gradient(180deg, ${pal.soft2} 0%, ${pal.soft} 55%, #F7F6F3 100%)`;
  const overlay = deep
    ? `linear-gradient(180deg, rgba(0,0,0,.05) 0%, ${pal.deep} 72%)`
    : `linear-gradient(180deg, rgba(255,255,255,.15) 0%, ${pal.soft} 70%, #F7F6F3 100%)`;
  const coverSize = Math.min(width - 90, 380);
  const ringColor = now.local ? (deep ? 'oklch(0.8 0.14 155)' : GREEN) : now.saving ? (deep ? '#FF9A76' : '#E0532F') : ink;
  const heart = cur.liked ? (deep ? '#FF8A65' : '#E0532F') : ink;

  const coverDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const d = ev.clientX - sx;
      if (!moved && Math.abs(d) > 6) moved = true;
      if (moved) {
        setDragging(true);
        setDx(d);
      }
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      const d = ev.clientX - sx;
      setDx(0);
      setDragging(false);
      const rtl = document.dir === 'rtl';
      if (moved && Math.abs(d) > 70) {
        const forward = rtl ? d > 0 : d < 0;
        if (forward) PlayerService.next();
        else PlayerService.previousSong();
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const pasteLabel = lyrics?.source === OWN_LYRICS ? tr('desktop.editYours') : tr('player.lyricsPasteYours');

  return (
    <div
      data-screen-label="Now Playing"
      style={{
        width,
        flex: 'none',
        position: 'relative',
        ['--sb' as string]: ink,
        overflow: 'hidden',
        background: bg,
        color: ink,
        transition: 'background .7s',
        animation: 'panelIn .3s cubic-bezier(.2,.8,.2,1)',
      }}
    >
      {art && (
        <img
          src={art}
          alt=""
          style={{
            position: 'absolute',
            left: '-30%',
            top: '-10%',
            width: '160%',
            height: '60%',
            objectFit: 'cover',
            filter: 'blur(70px) saturate(1.5)',
            opacity: deep ? 0.6 : 0.45,
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, background: overlay, pointerEvents: 'none' }} />
      <div
        onPointerDown={onResize}
        onDoubleClick={onResetSize}
        title={tr('desktop.resizeHint')}
        className="grip-panel"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          insetInlineStart: 0,
          width: 7,
          zIndex: 3,
          cursor: 'col-resize',
          touchAction: 'none',
          background: grip ? 'linear-gradient(90deg,transparent 1px,#E0532F 1px,#E0532F 3px,transparent 3px)' : 'transparent',
        }}
      />
      <div style={{ position: 'relative', height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: '18px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ font: "500 10px 'Geist Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.7 }}>
              {tr('player.playingFrom')}
            </div>
            <div className="ellipsis" style={{ font: "600 13px 'Geist',sans-serif", marginTop: 2 }}>
              {state.contextName}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <RoundChip bg={chip} onClick={() => openSheet({ kind: 'menu', track: cur })} title="•••">
              <DotsIcon size={18} />
            </RoundChip>
            <RoundChip bg={chip} onClick={() => setApp({ fullScreen: true })} title={tr('desktop.fullScreen')}>
              <ExpandIcon size={16} />
            </RoundChip>
            <RoundChip bg={chip} onClick={() => setApp({ panel: false })} title={tr('desktop.hidePanel')}>
              <CloseIcon size={16} />
            </RoundChip>
          </div>
        </div>

        {!lyricsOpen ? (
          <div
            onPointerDown={coverDown}
            title={tr('desktop.dragCover')}
            style={{
              margin: '22px auto 0',
              width: coverSize,
              height: coverSize,
              position: 'relative',
              touchAction: 'pan-y',
              cursor: 'grab',
              transform: `translateX(${dx}px) rotate(${dx / 30}deg) scale(${state.isPlaying ? 1 : 0.88})`,
              transition: dragging ? 'none' : 'transform .45s cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <div key={state.changeCount} style={{ position: 'absolute', inset: 0, animation: anim }}>
              <div style={{ position: 'absolute', inset: '18px 10px -14px', borderRadius: 30, background: pal.glow, filter: 'blur(28px)', opacity: 0.85 }} />
              {settings.playerArt === 'vinyl' ? (
                <Vinyl
                  src={art}
                  vinylStyle={settings.vinylStyle}
                  deep={pal.deep}
                  label={pal.artBg}
                  spinning={settings.rotateArt && state.isPlaying}
                />
              ) : (
                <Cover src={art} size="100%" radius={20} bg={pal.artBg} />
              )}
              {(state.isBuffering || state.isResolving) && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', animation: 'fadeIn .2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', font: "500 12px 'Geist',sans-serif" }}>
                    <Spinner color="#fff" track="rgba(255,255,255,.3)" />
                    {tr('player.buffering')}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 18 }}>
            <LyricsView
              track={cur}
              lyrics={lyrics}
              size={19}
              lineHeight={44}
              height={Math.max(258, coverSize - 20)}
              ink={ink}
              onPaste={() => openSheet({ kind: 'paste', track: cur })}
            />
            {lyrics && (lyrics.lines || lyrics.plain) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8, font: "500 11px 'Geist Mono',monospace", opacity: 0.75 }}>
                <span className="ellipsis">
                  {lyrics.source === OWN_LYRICS ? tr('player.lyricsYours') : lyrics.source}
                  {lyrics.lines ? ` · ${tr('player.lyricsSynced')}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 10, flex: 'none' }}>
                  {online && (
                    <TextLink onClick={() => openSheet({ kind: 'lyricsSearch', track: cur })}>{tr('player.lyricsWrong')}</TextLink>
                  )}
                  <TextLink onClick={() => openSheet({ kind: 'paste', track: cur })}>{pasteLabel}</TextLink>
                </span>
              </div>
            )}
          </div>
        )}

        <div key={`t${state.changeCount}`} style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, animation: anim }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ellipsis" style={{ font: "700 22px/1.15 'Geist',sans-serif", letterSpacing: '-.02em' }}>{cur.title}</div>
            <div className="ellipsis" style={{ marginTop: 3, font: "400 15px 'Geist',sans-serif", opacity: 0.75 }}>
              {cur.artist ?? tr('common.unknownArtist')}
            </div>
          </div>
          <RoundChip size={40} bg={chip} color={heart} onClick={() => PlayerService.toggleLike(cur)} title={tr('sheets.like')}>
            <HeartIcon filled={cur.liked} size={20} />
          </RoundChip>
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div title={now.status} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 11px 5px 7px', borderRadius: 999, background: chip, font: "500 12px 'Geist',sans-serif", minWidth: 0 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" style={{ flex: 'none' }}>
              <circle cx="9" cy="9" r="7" fill="none" stroke={deep ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.1)'} strokeWidth="2.4" />
              <circle cx="9" cy="9" r="7" fill="none" stroke={ringColor} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${((now.bufPct / 100) * 44).toFixed(1)} 44`} transform="rotate(-90 9 9)" />
            </svg>
            <span className="ellipsis">{now.status}</span>
          </div>
          {now.streamOnly && online && (
            <button
              onClick={() => PlayerService.saveOffline(cur)}
              title={tr('player.saveOffline')}
              style={{ border: 0, background: ink, color: deep ? pal.deep : pal.soft, font: "600 12px 'Geist',sans-serif", padding: '7px 12px', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            >
              <DownloadIcon size={14} stroke={2.4} />
              {tr('player.saveOffline')}
            </button>
          )}
          {sleepLeft && (
            <button
              onClick={() => openSheet({ kind: 'sleep' })}
              title={tr('player.sleepTimerLabel', { left: sleepLeft })}
              style={{ border: 0, background: chip, color: ink, font: "600 12px 'Geist Mono',monospace", padding: '6px 11px 6px 9px', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            >
              <MoonIcon size={14} />
              {sleepLeft}
            </button>
          )}
          {state.radio && (
            <button
              onClick={() => PlayerService.stopRadio()}
              title={tr('player.randomOnHint')}
              style={{ border: 0, background: chip, color: ink, font: "600 12px 'Geist',sans-serif", padding: '6px 11px 6px 9px', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            >
              <ShuffleIcon size={14} />
              {tr('player.random')}
            </button>
          )}
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
          <PanelButton bg={lyricsOpen ? (deep ? 'rgba(255,255,255,.3)' : '#fff') : chip} onClick={() => setApp({ lyrics: !lyricsOpen })}>
            <LyricsIcon size={16} />
            {tr('desktop.lyrics')}
          </PanelButton>
          <PanelButton
            bg={chip}
            onClick={() => (canKaraoke(cur) ? openKaraoke(cur.id) : toast(tr('desktop.karaokeNeedsFile')))}
          >
            <MicIcon size={16} />
            {tr('karaoke.title')}
          </PanelButton>
          <PanelButton bg={chip} onClick={() => openSheet({ kind: 'sleep' })}>
            <MoonIcon size={16} stroke={2.1} />
            {tr('desktop.sleep')}
          </PanelButton>
        </div>

        <UpNext ink={ink} chip={chip} />
      </div>
    </div>
  );
}

function UpNext({ ink, chip }: { ink: string; chip: string }) {
  const { queue, index, shuffle, repeat } = usePlayerState();
  const upNext = queue.slice(index + 1);
  const drag = useRowDrag({
    count: upNext.length,
    onMove: (from, to) => PlayerService.moveInQueue(index + 1 + from, index + 1 + to),
    onRemove: i => {
      PlayerService.removeFromQueueOnly(upNext[i].id);
      toast(tr('desktop.takenOut'));
    },
  });
  const mode = [
    shuffle ? tr('sheets.shuffleOn') : tr('sheets.inOrder'),
    repeat === 'one' ? tr('sheets.repeatOne') : repeat === 'all' ? tr('sheets.repeatAll') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mono" style={{ font: "600 11px 'Geist Mono',monospace", letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.7 }}>
          {tr('desktop.upNext')}
        </span>
        <span style={{ font: "400 12px 'Geist',sans-serif", opacity: 0.7 }}>{mode}</span>
      </div>
      {!upNext.length && <div style={{ padding: '10px 0', font: "400 13px 'Geist',sans-serif", opacity: 0.7 }}>{tr('sheets.endOfQueue')}</div>}
      <div style={{ margin: '6px -8px 0', ['--hchip' as string]: chip, ['--dragBg' as string]: 'rgba(40,40,44,.9)' }}>
        {upNext.map((t, k) => {
          const art = artworkUri(t);
          return (
            <div
              key={t.id}
              data-drag-row="1"
              className="h-chip"
              {...drag.swipe(k)}
              onClick={() => !drag.wasDrag() && PlayerService.skipTo(index + 1 + k)}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px 6px 8px', borderRadius: 10, cursor: 'pointer', touchAction: 'pan-y', ...drag.rowStyle(k) }}
            >
              <Cover src={art} size={38} bg={paletteFor(t, art).artBg} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellipsis" style={{ font: "500 13px 'Geist',sans-serif" }}>{t.title}</div>
                <div className="ellipsis" style={{ font: "400 12px 'Geist',sans-serif", opacity: 0.7 }}>{t.artist ?? tr('common.unknownArtist')}</div>
              </div>
              <span className="mono" style={{ font: "400 11px 'Geist Mono',monospace", opacity: 0.7 }}>{t.duration ? formatTime(t.duration) : ''}</span>
              <div {...drag.handle(k)} title={tr('desktop.queueHint')} style={{ ...drag.handle(k).style, width: 24, height: 34, display: 'grid', placeItems: 'center', opacity: 0.6, flex: 'none', color: ink }}>
                <GripIcon size={16} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const RoundChip = ({
  children,
  onClick,
  bg,
  title,
  size = 34,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  bg: string;
  title: string;
  size?: number;
  color?: string;
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    style={{ width: size, height: size, borderRadius: '50%', border: 0, background: bg, display: 'grid', placeItems: 'center', cursor: 'pointer', color: color ?? 'inherit', flex: 'none', padding: 0 }}
  >
    {children}
  </button>
);

const PanelButton = ({ children, onClick, bg }: { children: React.ReactNode; onClick: () => void; bg: string }) => (
  <button
    onClick={onClick}
    style={{ height: 42, borderRadius: 12, border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', font: "600 12px 'Geist',sans-serif", background: bg, color: 'inherit' }}
  >
    {children}
  </button>
);

const TextLink = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} style={{ border: 0, background: 'transparent', color: 'inherit', font: "600 12px 'Geist',sans-serif", textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
    {children}
  </button>
);

