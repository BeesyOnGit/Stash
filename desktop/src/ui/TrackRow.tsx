/** A song in a list (Library, collections): cover, title, genre, like, time and its ••• menu. */
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { tr } from '../core/i18n';
import { usePlayerState } from '../core/player/hooks';
import { openSheet } from '../core/state/ui';
import { formatTime, paletteFor, useCoverColors } from '../core/theme';
import { artworkUri, type Track } from '../core/types';
import { CheckIcon, DotsIcon, HeartIcon } from './icons';
import { ACCENT, Cover, EqOverlay } from './kit';

export const TRACK_GRID = 'minmax(0,2.4fr) minmax(0,1fr) 28px 56px 40px';

export function TrackHeader() {
  return (
    <div
      className="eyebrow"
      style={{
        display: 'grid',
        gridTemplateColumns: TRACK_GRID,
        gap: 12,
        alignItems: 'center',
        padding: '0 12px 8px',
        margin: '0 20px',
        borderBottom: '1px solid var(--line)',
        fontSize: 11,
      }}
    >
      <span>{tr('desktop.colTitle')}</span>
      <span>{tr('desktop.colGenre')}</span>
      <span />
      <span style={{ textAlign: 'end' }}>{tr('desktop.colTime')}</span>
      <span />
    </div>
  );
}

export const NewBadge = () => (
  <span
    style={{
      font: "600 9px 'Geist Mono',monospace",
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: 'var(--accentInk)',
      background: 'var(--accentSoft)',
      padding: '2px 5px',
      borderRadius: 4,
      flex: 'none',
    }}
  >
    {tr('sheets.newBadge')}
  </span>
);

export function TrackRow({
  track,
  isNew,
  onPlay,
  onLongPress,
  onCtrlClick,
  selecting,
  selected,
  playlistId,
  handle,
  style,
  rowProps,
}: {
  track: Track;
  isNew?: boolean;
  onPlay: () => void;
  /** Press and hold (starts selecting). */
  onLongPress?: () => void;
  onCtrlClick?: () => void;
  selecting?: boolean;
  selected?: boolean;
  playlistId?: string;
  /** A drag handle shown before the cover (playlists). */
  handle?: ReactNode;
  style?: CSSProperties;
  rowProps?: Record<string, unknown>;
}) {
  useCoverColors();
  const { queue, index, isPlaying } = usePlayerState();
  const isCurrent = queue[index]?.id === track.id;
  const art = artworkUri(track);
  const pal = paletteFor(track, art);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  return (
    <div
      data-drag-row="1"
      className="h-fill"
      onPointerDown={e => {
        if (e.button !== 0 || !onLongPress) return;
        held.current = false;
        hold.current = setTimeout(() => {
          held.current = true;
          onLongPress();
        }, 480);
      }}
      onPointerUp={() => hold.current && clearTimeout(hold.current)}
      onPointerLeave={() => hold.current && clearTimeout(hold.current)}
      onClick={e => {
        if (held.current) {
          held.current = false;
          return;
        }
        if ((e.ctrlKey || e.metaKey) && onCtrlClick) return onCtrlClick();
        onPlay();
      }}
      onDoubleClick={e => e.preventDefault()}
      onContextMenu={e => {
        e.preventDefault();
        openSheet({ kind: 'menu', track, playlistId });
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: TRACK_GRID,
        gap: 12,
        alignItems: 'center',
        padding: '6px 12px',
        margin: '0 20px',
        borderRadius: 10,
        cursor: 'pointer',
        background: selecting && selected ? 'var(--accentSoft)' : undefined,
        ...style,
      }}
      {...rowProps}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {handle}
        {selecting && (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: selected ? 0 : '2px solid var(--line2)',
              background: selected ? ACCENT : 'transparent',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              flex: 'none',
            }}
          >
            {selected && <CheckIcon size={12} />}
          </div>
        )}
        <Cover src={art} size={42} bg={pal.artBg}>
          {isCurrent && <EqOverlay playing={isPlaying} />}
        </Cover>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ellipsis" style={{ font: "500 14px/1.3 'Geist',sans-serif" }}>
              {track.title}
            </span>
            {isNew && <NewBadge />}
          </div>
          <div
            className="ellipsis"
            style={{ font: "400 13px/1.35 'Geist',sans-serif", color: 'var(--muted)' }}
          >
            {track.artist ?? tr('common.unknownArtist')}
          </div>
        </div>
      </div>
      <span className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>
        {track.genre ?? ''}
      </span>
      <span style={{ display: 'grid', placeItems: 'center' }}>
        {track.liked && <HeartIcon filled size={14} color={ACCENT} />}
      </span>
      <span
        style={{
          textAlign: 'end',
          font: "400 12px 'Geist Mono',monospace",
          color: 'var(--muted2)',
        }}
      >
        {track.duration ? formatTime(track.duration) : ''}
      </span>
      <button
        className="h-fill2"
        aria-label="•••"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          openSheet({ kind: 'menu', track, playlistId });
        }}
        style={{
          width: 34,
          height: 34,
          border: 0,
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--muted)',
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
        }}
      >
        <DotsIcon size={18} />
      </button>
    </div>
  );
}
