/** One collection: a playlist (songs can be dragged into order), Liked songs, an automatic playlist or a genre. */
import { ask } from '@tauri-apps/plugin-dialog';
import { deletePlaylist, setPlaylistOrder } from '../../core/db/database';
import { tr } from '../../core/i18n';
import { useLibrary } from '../../core/player/hooks';
import { PlayerService } from '../../core/player/PlayerService';
import { useSettings } from '../../core/services/settings';
import { smartListName, smartTracks } from '../../core/services/smartLists';
import { toast } from '../../core/state/ui';
import { genreColors, paletteFor, useCoverColors } from '../../core/theme';
import { artworkUri, type Track } from '../../core/types';
import { setApp, type Collection } from '../appState';
import { useRowDrag } from '../drag';
import { ChevronLeftIcon, GripIcon, PlayIcon, ShuffleIcon } from '../icons';
import { CoverGrid } from '../kit';
import { TrackHeader, TrackRow } from '../TrackRow';
import { isNewSave, PrimaryButton, SecondaryButton } from './LibraryScreen';

export function CollectionScreen({ detail }: { detail: Collection }) {
  useCoverColors();
  const { tracks, byId, playlists } = useLibrary();
  const dark = useSettings().theme === 'dark';
  const ready = tracks.filter(t => t.status === 'ready');

  let list: Track[] = [];
  let name = '';
  let kind = '';
  let playlistId: string | undefined;
  let genreHue: ReturnType<typeof genreColors> | null = null;
  if (detail.kind === 'liked') {
    list = ready.filter(t => t.liked);
    name = tr('library.likedSongs');
    kind = tr('library.kindPlaylist');
  } else if (detail.kind === 'smart') {
    list = smartTracks(detail.id, tracks);
    name = smartListName(detail.id);
    kind = tr('library.kindAuto');
  } else if (detail.kind === 'genre') {
    list = ready.filter(t => t.genre === detail.genre);
    name = detail.genre;
    kind = tr('library.kindGenre');
    genreHue = genreColors(detail.genre, dark);
  } else {
    const p = playlists.find(x => x.id === detail.id);
    if (p) {
      list = p.trackIds.map(id => byId.get(id)).filter((t): t is Track => !!t);
      name = p.name;
      kind = tr('library.kindPlaylist');
      playlistId = p.id;
    }
  }

  const drag = useRowDrag({
    count: list.length,
    onMove: (from, to) => {
      if (!playlistId) return;
      const ids = list.map(t => t.id);
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x);
      setPlaylistOrder(playlistId, ids);
    },
  });

  const first = list[0];
  const pal = first ? paletteFor(first, artworkUri(first)) : null;
  const bg = genreHue ? genreHue.bg : dark ? (pal?.deep2 ?? '#1C1C20') : (pal?.soft ?? '#EFEDE8');
  const ink = genreHue ? genreHue.ink : dark ? '#F2F1EE' : (pal?.softInk ?? '#16161A');
  const mins = Math.round(list.reduce((a, t) => a + (t.duration ?? 0), 0) / 60);

  return (
    <div data-screen-label="Collection" style={{ paddingBottom: 24 }}>
      <div style={{ background: bg, padding: '20px 32px 26px', transition: 'background .5s' }}>
        <button
          onClick={() => setApp({ detail: null })}
          style={{
            height: 32,
            padding: '0 12px 0 6px',
            border: 0,
            borderRadius: 999,
            background: 'var(--glass)',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            font: "500 13px 'Geist',sans-serif",
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          <ChevronLeftIcon size={18} style={{ transform: document.dir === 'rtl' ? 'scaleX(-1)' : undefined }} />
          {tr('library.title')}
        </button>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', marginTop: 18 }}>
          <CoverGrid
            srcs={list.slice(0, 4).map(t => artworkUri(t))}
            size={180}
            radius={18}
            style={{ boxShadow: '0 14px 34px rgba(20,18,14,.2)' }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow" style={{ fontSize: 11, color: ink }}>
              {kind}
            </div>
            <div style={{ marginTop: 6, font: "700 40px/1.05 'Geist',sans-serif", letterSpacing: '-.035em', color: ink }}>
              {name}
            </div>
            <div style={{ marginTop: 8, font: "400 14px 'Geist',sans-serif", color: ink, opacity: 0.8 }}>
              {tr('common.songs', { count: list.length })} · {tr('library.minutes', { count: mins })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <PrimaryButton
                icon={<PlayIcon size={14} />}
                label={tr('common.play')}
                onClick={() => list.length && PlayerService.playQueue(list, 0, name, false)}
              />
              <SecondaryButton
                glass
                icon={<ShuffleIcon size={15} />}
                label={tr('common.shuffle')}
                onClick={() => list.length && PlayerService.shuffleAll(list, name)}
              />
              {playlistId && (
                <button
                  onClick={async () => {
                    const ok = await ask(tr('library.deletePlaylistBody'), {
                      title: tr('library.deletePlaylist'),
                      kind: 'warning',
                    });
                    if (!ok) return;
                    await deletePlaylist(playlistId!);
                    setApp({ detail: null });
                    toast(tr('library.playlistDeleted'));
                  }}
                  style={{
                    height: 40,
                    padding: '0 14px',
                    border: 0,
                    borderRadius: 12,
                    background: 'transparent',
                    color: 'var(--danger)',
                    font: "500 14px 'Geist',sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  {tr('library.deletePlaylist')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {!list.length && (
        <div
          style={{
            margin: '24px 32px',
            padding: 16,
            borderRadius: 14,
            background: 'var(--fill)',
            font: "400 14px/1.45 'Geist',sans-serif",
            color: 'var(--ink2)',
          }}
        >
          {detail.kind === 'smart' && detail.id === 'most'
            ? tr('library.emptyMost')
            : detail.kind === 'smart'
              ? tr('library.emptySaved')
              : tr('library.emptyPlaylist')}
        </div>
      )}
      <div style={{ padding: '20px 12px 0' }}>
        <TrackHeader />
        <div style={{ paddingTop: 6 }}>
          {list.map((t, i) => (
            <TrackRow
              key={t.id}
              track={t}
              isNew={isNewSave(t)}
              playlistId={playlistId}
              onPlay={() => !drag.wasDrag() && PlayerService.playQueue(list, i, name)}
              style={drag.rowStyle(i)}
              handle={
                playlistId && list.length > 1 ? (
                  <div
                    {...drag.handle(i)}
                    title={tr('library.dragToReorder')}
                    style={{
                      ...drag.handle(i).style,
                      width: 22,
                      height: 36,
                      marginInlineStart: -6,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--muted2)',
                      flex: 'none',
                    }}
                  >
                    <GripIcon size={16} />
                  </div>
                ) : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
