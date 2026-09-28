/** Library: songs (with recently played / just saved), playlists and genres. */
import { ask } from '@tauri-apps/plugin-dialog';
import { useMemo, useState } from 'react';
import { updateTrack } from '../../core/db/database';
import { tr } from '../../core/i18n';
import { useLibrary, usePlayerState } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { deleteFromLibrary } from '../../core/services/library';
import { useSettings } from '../../core/services/settings';
import { SMART_LISTS, smartListName, smartTracks } from '../../core/services/smartLists';
import { formatBytes } from '../../core/services/storage';
import { openSheet, toast } from '../../core/state/ui';
import { genreColors, paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri, type Track } from '../../core/types';
import { openCollection, setApp, useApp, type Seg } from '../appState';
import {
  AddToListIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  HeartIcon,
  PlayIcon,
  PlusIcon,
  ShuffleIcon,
  StatsIcon,
  TrashIcon,
} from '../icons';
import { ACCENT, Cover, CoverGrid } from '../kit';
import { TrackHeader, TrackRow } from '../TrackRow';

/** When this run of the app started: songs saved since are "new". */
export const SESSION_START = Date.now();
export const isNewSave = (t: Track) => !!t.savedAt && t.savedAt >= SESSION_START;

type Sort = 'recent' | 'az' | 'artist';

export function readyTracks(tracks: Track[]) {
  return tracks.filter(t => t.status === 'ready');
}

export function LibraryScreen() {
  const { tracks, playlists } = useLibrary();
  const { seg, selecting, selected } = useApp();
  const settings = useSettings();
  const [sort, setSort] = useState<Sort>('recent');
  const ready = useMemo(() => readyTracks(tracks), [tracks]);
  const sorted = useMemo(() => {
    const list = [...ready];
    if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'artist')
      list.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? '') || a.title.localeCompare(b.title));
    return list;
  }, [ready, sort]);
  const size = ready.reduce((a, t) => a + (t.sizeBytes ?? 0), 0);
  const ctx = tr('system.ctxLibrary');

  const toggleSel = (id: string) =>
    setApp(s => ({
      selecting: true,
      selected: s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id],
    }));

  return (
    <div data-screen-label="Library" style={{ paddingBottom: 24 }}>
      <div
        style={{
          padding: '28px 32px 0',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow">{tr('library.eyebrow')}</div>
          <h1 style={{ margin: '4px 0 0', font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em' }}>
            {tr('library.title')}
          </h1>
          <div
            style={{
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              font: "500 13px 'Geist',sans-serif",
              color: 'var(--ink2)',
            }}
          >
            <CheckCircleIcon size={15} color="oklch(0.58 0.13 155)" />
            <span>{tr('desktop.allOffline', { count: ready.length, size: formatBytes(size) })}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <PrimaryButton
            icon={<PlayIcon size={14} />}
            label={tr('common.play')}
            onClick={() => sorted.length && PlayerService.playQueue(sorted, 0, ctx, false)}
          />
          <SecondaryButton
            icon={<ShuffleIcon size={15} />}
            label={tr('common.shuffle')}
            onClick={() => sorted.length && PlayerService.shuffleAll(sorted, ctx)}
          />
        </div>
      </div>

      <div
        style={{
          margin: '22px 32px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', gap: 24 }}>
          {(
            [
              ['songs', tr('library.segSongs')],
              ['playlists', tr('library.segPlaylists')],
              ['genres', tr('library.segGenres')],
            ] as Array<[Seg, string]>
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setApp({ seg: k })}
              style={{
                border: 0,
                background: 'transparent',
                padding: '0 0 12px',
                marginBottom: -1,
                borderBottom: `2px solid ${seg === k ? ACCENT : 'transparent'}`,
                color: 'var(--ink)',
                font: `${seg === k ? 600 : 500} 15px 'Geist',sans-serif`,
                cursor: 'pointer',
                opacity: 0.9,
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {seg === 'songs' && (
          <div style={{ display: 'flex', gap: 6, paddingBottom: 10 }}>
            {(
              [
                ['recent', tr('library.sortRecent')],
                ['az', tr('library.sortAZ')],
                ['artist', tr('library.sortArtist')],
              ] as Array<[Sort, string]>
            ).map(([k, l]) => (
              <Chip key={k} on={sort === k} label={l} onClick={() => setSort(k)} />
            ))}
          </div>
        )}
      </div>

      {seg === 'songs' && (
        <SongsView
          tracks={sorted}
          selecting={selecting}
          selected={selected}
          toggleSel={toggleSel}
        />
      )}
      {seg === 'playlists' && <PlaylistsGrid tracks={tracks} playlists={playlists} />}
      {seg === 'genres' && <GenresGrid tracks={ready} dark={settings.theme === 'dark'} />}
    </div>
  );
}

export const PrimaryButton = ({
  icon,
  label,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    style={{
      height: 40,
      padding: '0 18px',
      borderRadius: 12,
      border: 0,
      background: 'var(--ink)',
      color: 'var(--onInk)',
      font: "600 14px 'Geist',sans-serif",
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer',
    }}
  >
    {icon}
    {label}
  </button>
);

export const SecondaryButton = ({
  icon,
  label,
  onClick,
  glass,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  glass?: boolean;
}) => (
  <button
    onClick={onClick}
    style={{
      height: 40,
      padding: '0 16px',
      borderRadius: 12,
      border: glass ? 0 : '1px solid var(--line2)',
      background: glass ? 'var(--glass)' : 'var(--card)',
      color: 'var(--ink)',
      font: "600 14px 'Geist',sans-serif",
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer',
    }}
  >
    {icon}
    {label}
  </button>
);

export const Chip = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`,
      background: on ? 'var(--ink)' : 'var(--card)',
      color: on ? 'var(--onInk)' : 'var(--ink)',
      font: "500 12px 'Geist',sans-serif",
      padding: '5px 11px',
      borderRadius: 999,
      cursor: 'pointer',
    }}
  >
    {label}
  </button>
);

function Shelf({
  title,
  tag,
  tracks,
  sub,
  ctx,
}: {
  title: string;
  tag?: string;
  tracks: Track[];
  sub: (t: Track) => string;
  ctx: string;
}) {
  useCoverColors();
  return (
    <div style={{ padding: '22px 0 0' }}>
      <div style={{ padding: '0 32px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ font: "600 16px 'Geist',sans-serif" }}>{title}</span>
        {tag && (
          <span
            style={{
              font: "600 10px 'Geist Mono',monospace",
              letterSpacing: '.05em',
              textTransform: 'uppercase',
              color: 'var(--accentInk)',
              background: 'var(--accentSoft)',
              padding: '3px 6px',
              borderRadius: 5,
            }}
          >
            {tag}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', padding: '0 32px 6px' }}>
        {tracks.map(t => {
          const art = artworkUri(t);
          return (
            <div
              key={t.id}
              onClick={() => PlayerService.playQueue([t], 0, ctx, false)}
              onContextMenu={e => {
                e.preventDefault();
                openSheet({ kind: 'menu', track: t });
              }}
              style={{ width: 140, flex: 'none', cursor: 'pointer' }}
            >
              <Cover src={art} size={140} radius={14} bg={paletteFor(t, art).artBg} />
              <div className="ellipsis" style={{ marginTop: 8, font: "500 14px/1.25 'Geist',sans-serif" }}>
                {t.title}
              </div>
              <div
                className="ellipsis"
                style={{ font: "400 12px/1.3 'Geist',sans-serif", color: 'var(--muted)' }}
              >
                {sub(t)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SongsView({
  tracks,
  selecting,
  selected,
  toggleSel,
}: {
  tracks: Track[];
  selecting: boolean;
  selected: string[];
  toggleSel: (id: string) => void;
}) {
  const { queue, index } = usePlayerState();
  const recent = useMemo(
    () =>
      tracks
        .filter(t => t.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, 8),
    [tracks],
  );
  const justSaved = useMemo(
    () =>
      tracks
        .filter(isNewSave)
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
        .slice(0, 8),
    [tracks],
  );
  const selTracks = tracks.filter(t => selected.includes(t.id));
  const done = () => setApp({ selecting: false, selected: [] });
  const ctx = tr('system.ctxLibrary');

  const removeSelected = async () => {
    const playingId = queue[index]?.id;
    const rm = selTracks.filter(t => t.id !== playingId);
    if (!rm.length) return toast(tr('library.cantRemovePlaying'));
    const ok = await ask(
      `${tr('desktop.removeBody')}${rm.length < selTracks.length ? `\n${tr('library.removePlayingStays')}` : ''}`,
      { title: tr('library.removeTitle', { count: rm.length }), kind: 'warning' },
    );
    if (!ok) return;
    for (const t of rm) await deleteFromLibrary(t);
    done();
    toast(tr('library.removedCount', { count: rm.length }));
  };

  return (
    <div>
      {recent.length > 0 && (
        <Shelf
          title={tr('library.recentlyPlayed')}
          tracks={recent}
          ctx={tr('library.recentlyPlayed')}
          sub={t => t.artist ?? tr('common.unknownArtist')}
        />
      )}
      {justSaved.length > 0 && (
        <Shelf
          title={tr('library.justSaved')}
          tag={tr('library.fromWeb')}
          tracks={justSaved}
          ctx={tr('library.justSaved')}
          sub={t => tr('library.fromSource', { source: t.source === 'jamendo' ? 'Jamendo' : 'YouTube' })}
        />
      )}
      <div style={{ padding: '24px 12px 0' }}>
        <TrackHeader />
        {selecting ? (
          <div
            style={{
              position: 'sticky',
              top: 8,
              zIndex: 5,
              margin: '8px 20px 6px',
              padding: '5px 5px 5px 16px',
              borderRadius: 12,
              background: 'var(--ink)',
              color: 'var(--onInk)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              boxShadow: '0 10px 24px rgba(0,0,0,.18)',
            }}
          >
            <span style={{ flex: 1, font: "600 14px 'Geist',sans-serif" }}>
              {tr('library.selectedCount', { count: selTracks.length })}
            </span>
            <SelButton
              icon={<PlayIcon size={14} />}
              label={tr('common.play')}
              onClick={() => {
                if (!selTracks.length) return;
                PlayerService.playQueue(selTracks, 0, tr('library.selectedQueue'), false);
                done();
              }}
            />
            <SelButton
              icon={<AddToListIcon size={16} />}
              label={tr('library.addToPlaylist')}
              onClick={() => selTracks.length && openSheet({ kind: 'addMany', trackIds: selTracks.map(t => t.id) })}
            />
            <SelButton
              icon={<HeartIcon size={16} />}
              label={tr('library.like')}
              onClick={async () => {
                for (const t of selTracks) await updateTrack(t.id, { liked: true });
                toast(tr('library.likedCount', { count: selTracks.length }));
                done();
              }}
            />
            <SelButton icon={<TrashIcon size={16} />} label={tr('common.remove')} onClick={removeSelected} />
            <SelButton
              icon={<span style={{ font: "500 13px 'Geist',sans-serif" }}>{selTracks.length === tracks.length ? tr('library.selectNone') : tr('library.selectAll')}</span>}
              label=""
              onClick={() =>
                setApp({ selected: selTracks.length === tracks.length ? [] : tracks.map(t => t.id) })
              }
            />
            <SelButton icon={<CloseIcon size={15} />} label="" title={tr('library.stopSelecting')} onClick={done} />
          </div>
        ) : (
          <div style={{ padding: '8px 32px 0', font: "400 12px 'Geist',sans-serif", color: 'var(--muted2)' }}>
            {tracks.length ? tr('desktop.selectHint') : ''}
          </div>
        )}
        {!tracks.length && (
          <div style={{ margin: '14px 32px' }}>
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 14,
                background: 'var(--fill)',
                font: "400 14px/1.45 'Geist',sans-serif",
                color: 'var(--ink2)',
              }}
            >
              {tr('desktop.libraryEmpty')}
            </div>
          </div>
        )}
        <div style={{ paddingTop: 6 }}>
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              isNew={isNewSave(t)}
              selecting={selecting}
              selected={selected.includes(t.id)}
              onPlay={() => (selecting ? toggleSel(t.id) : PlayerService.playQueue(tracks, i, ctx))}
              onLongPress={() => tracks.length > 1 && toggleSel(t.id)}
              onCtrlClick={() => toggleSel(t.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const SelButton = ({
  icon,
  label,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
}) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      height: 34,
      padding: label ? '0 12px' : '0 9px',
      border: 0,
      borderRadius: 9,
      background: 'transparent',
      color: 'inherit',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: 'pointer',
      font: "500 13px 'Geist',sans-serif",
    }}
  >
    {icon}
    {label}
  </button>
);

export const SMART_COLORS: Record<string, [string, string]> = {
  recent: ['oklch(0.9 0.06 150)', 'oklch(0.32 0.08 150)'],
  most: ['oklch(0.9 0.06 270)', 'oklch(0.32 0.08 270)'],
  downloaded: ['oklch(0.9 0.06 75)', 'oklch(0.32 0.08 75)'],
};
export const SMART_SUB: Record<string, 'desktop.smartRecentSub' | 'desktop.smartMostSub' | 'desktop.smartDownloadedSub'> = {
  recent: 'desktop.smartRecentSub',
  most: 'desktop.smartMostSub',
  downloaded: 'desktop.smartDownloadedSub',
};
export const SmartIcon = ({ id, size }: { id: string; size: number }) =>
  id === 'recent' ? <PlusIcon size={size} stroke={2.2} /> : id === 'most' ? <StatsIcon size={size} stroke={2.4} /> : <DownloadIcon size={size} />;

function PlaylistsGrid({
  tracks,
  playlists,
}: {
  tracks: Track[];
  playlists: ReturnType<typeof useLibrary>['playlists'];
}) {
  const dark = useSettings().theme === 'dark';
  const byId = new Map(tracks.map(t => [t.id, t]));
  const liked = tracks.filter(t => t.liked && t.status === 'ready');
  const card = (key: string, cover: React.ReactNode, name: string, meta: string, onClick: () => void) => (
    <div key={key} onClick={onClick} style={{ cursor: 'pointer', minWidth: 0 }}>
      {cover}
      <div className="ellipsis" style={{ marginTop: 10, font: "600 14px 'Geist',sans-serif" }}>
        {name}
      </div>
      <div className="ellipsis" style={{ font: "400 12px 'Geist',sans-serif", color: 'var(--muted)', marginTop: 2 }}>
        {meta}
      </div>
    </div>
  );
  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))',
        gap: 20,
      }}
    >
      <div onClick={() => openSheet({ kind: 'new' })} style={{ cursor: 'pointer' }}>
        <div
          className="h-fill"
          style={{
            aspectRatio: '1',
            borderRadius: 14,
            border: '1.5px dashed var(--line2)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <PlusIcon size={28} stroke={2} />
        </div>
        <div style={{ marginTop: 10, font: "600 14px 'Geist',sans-serif" }}>{tr('library.newPlaylist')}</div>
      </div>
      {card(
        'liked',
        <div style={{ aspectRatio: '1', borderRadius: 14, background: ACCENT, display: 'grid', placeItems: 'center', color: '#fff' }}>
          <HeartIcon filled size={44} />
        </div>,
        tr('library.likedSongs'),
        `${tr('common.songs', { count: liked.length })} · ${tr('library.autoPlaylistMeta')}`,
        () => openCollection({ kind: 'liked' }),
      )}
      {SMART_LISTS.map(s => {
        const [bg, ink] = SMART_COLORS[s.id];
        return card(
          s.id,
          <div
            style={{
              aspectRatio: '1',
              borderRadius: 14,
              background: dark ? ink : bg,
              color: dark ? bg : ink,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <SmartIcon id={s.id} size={40} />
          </div>,
          smartListName(s.id),
          `${tr('common.songs', { count: smartTracks(s.id, tracks).length })} · ${tr(SMART_SUB[s.id])}`,
          () => openCollection({ kind: 'smart', id: s.id }),
        );
      })}
      {playlists.map(p =>
        card(
          p.id,
          <CoverGrid
            srcs={p.trackIds.slice(0, 4).map(id => {
              const t = byId.get(id);
              return t ? artworkUri(t) : null;
            })}
            size="100%"
            radius={14}
            style={{ aspectRatio: '1', height: 'auto' }}
          />,
          p.name,
          tr('common.songs', { count: p.trackIds.filter(id => byId.has(id)).length }),
          () => openCollection({ kind: 'playlist', id: p.id }),
        ),
      )}
    </div>
  );
}

function GenresGrid({ tracks, dark }: { tracks: Track[]; dark: boolean }) {
  const genres = useMemo(() => {
    const m = new Map<string, Track[]>();
    for (const t of tracks) if (t.genre) m.set(t.genre, [...(m.get(t.genre) ?? []), t]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [tracks]);
  if (!genres.length)
    return (
      <div style={{ margin: '24px 32px' }}>
        <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--fill)', font: "400 14px/1.4 'Geist',sans-serif", color: 'var(--ink2)' }}>
          {tr('library.genresEmpty')}
        </div>
      </div>
    );
  return (
    <div
      style={{
        padding: '24px 32px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
        gap: 16,
      }}
    >
      {genres.map(([g, list]) => {
        const c = genreColors(g, dark);
        const i1 = artworkUri(list[0]);
        const i2 = artworkUri(list[1] ?? list[0]);
        return (
          <div
            key={g}
            className="h-dim"
            onClick={() => openCollection({ kind: 'genre', genre: g })}
            style={{
              position: 'relative',
              height: 130,
              borderRadius: 18,
              overflow: 'hidden',
              background: c.bg,
              cursor: 'pointer',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
            }}
          >
            {i1 && (
              <img src={i1} alt="" style={{ position: 'absolute', insetInlineEnd: -8, top: -8, width: 74, height: 74, borderRadius: 10, objectFit: 'cover', transform: 'rotate(14deg)', boxShadow: '0 6px 16px rgba(0,0,0,.18)' }} />
            )}
            {i2 && (
              <img src={i2} alt="" style={{ position: 'absolute', insetInlineEnd: 48, top: 12, width: 54, height: 54, borderRadius: 8, objectFit: 'cover', transform: 'rotate(-8deg)', boxShadow: '0 6px 16px rgba(0,0,0,.18)' }} />
            )}
            <div style={{ position: 'relative', font: "700 20px/1.1 'Geist',sans-serif", letterSpacing: '-.02em', color: c.ink }}>
              {g}
            </div>
            <div style={{ position: 'relative', marginTop: 3, font: "500 12px 'Geist Mono',monospace", color: c.ink, opacity: 0.75 }}>
              {tr('common.songs', { count: list.length })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
