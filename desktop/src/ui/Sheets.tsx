/** The dialogs, centred over the window (the phone app's bottom sheets). Esc or a click outside closes them. */
import { useEffect, useState, type ReactNode } from 'react';
import { addTracksToPlaylist, createPlaylist, togglePlaylistTrack } from '../core/db/database';
import { LANGUAGES, deviceLanguage, tr, type Key } from '../core/i18n';
import { useLibrary, usePlayerState, useSleepLeft } from '../core/player/hooks';
import { PlayerService } from '../core/player/PlayerService';
import { canKaraoke } from '../core/services/karaoke';
import { NameTakenError, recordingName, renameRecording } from '../core/services/karaokeRecordings';
import { deleteFromLibrary } from '../core/services/library';
import {
  chooseLyrics,
  lyricsFor,
  OWN_LYRICS,
  saveOwnLyrics,
  searchLyrics,
  type LyricsMatch,
} from '../core/services/lyrics';
import { saveLyricsRow } from '../core/db/database';
import { useOnline } from '../core/services/network';
import { SPEEDS, saveSettings, speedLabel, useSettings, type Settings } from '../core/services/settings';
import { similarFor, similarInLibrary, type Similar } from '../core/services/similar';
import { formatBytes } from '../core/services/storage';
import { downloadAndInstall, installedVersion, type InstallStep, type Release } from '../core/services/updater';
import { sourceName } from '../core/sources';
import { splitArtistTitle } from '../core/sources/http';
import { closeSheet, openSheet, toast, useUi, type Sheet } from '../core/state/ui';
import { formatTime, paletteFor, useCoverColors, GREEN } from '../core/theme';
import { artworkUri, type QueueItem, type Track } from '../core/types';
import { openCollection, openKaraoke } from './appState';
import { useRowDrag } from './drag';
import { CheckCircleIcon, CheckIcon, CloseIcon, GlobeIcon, GripIcon, ShuffleIcon } from './icons';
import { ACCENT, Cover, CoverGrid, EqOverlay, Note, Spinner } from './kit';
import { lyricsChanged } from './player/common';

export function Sheets() {
  const { sheet } = useUi();
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSheet();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sheet]);
  if (!sheet) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center' }}>
      <div onClick={closeSheet} style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,12,.4)', animation: 'fadeIn .2s' }} />
      <div
        style={{
          position: 'relative',
          width: 460,
          maxHeight: '78%',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--card)',
          color: 'var(--ink)',
          borderRadius: 20,
          padding: '20px 0 22px',
          boxShadow: '0 30px 80px rgba(0,0,0,.3)',
          animation: 'popIn .22s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <button
          onClick={closeSheet}
          title={tr('common.close')}
          style={{ position: 'absolute', top: 14, insetInlineEnd: 14, width: 30, height: 30, border: 0, borderRadius: '50%', background: 'var(--fill2)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', zIndex: 1 }}
        >
          <CloseIcon size={12} stroke={3} />
        </button>
        <SheetBody sheet={sheet} />
      </div>
    </div>
  );
}

function SheetBody({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case 'menu':
      return <MenuSheet track={sheet.track} playlistId={sheet.playlistId} />;
    case 'add':
      return <AddSheet track={sheet.track} />;
    case 'addMany':
      return <AddManySheet trackIds={sheet.trackIds} />;
    case 'new':
      return <NewPlaylistSheet />;
    case 'queue':
      return <QueueSheet />;
    case 'speed':
      return <SpeedSheet />;
    case 'sleep':
      return <SleepSheet />;
    case 'similar':
      return <SimilarSheet track={sheet.track} />;
    case 'update':
      return <UpdateSheet release={sheet.release} />;
    case 'paste':
      return <PasteSheet track={sheet.track} />;
    case 'lyricsSearch':
      return <LyricsSearchSheet track={sheet.track} />;
    case 'lang':
      return <LanguageSheet />;
    case 'rename':
      return <RenameSheet recording={sheet.recording} />;
    default:
      return null;
  }
}

const Title = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div style={{ padding: '0 60px 0 20px' }}>
    <div className="ellipsis" style={{ font: "700 20px 'Geist',sans-serif", letterSpacing: '-.01em' }}>{children}</div>
    {sub && <div style={{ font: "400 13px/1.4 'Geist',sans-serif", color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
  </div>
);

const BigButton = ({ children, onClick, disabled, bg }: { children: ReactNode; onClick: () => void; disabled?: boolean; bg?: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{ width: '100%', height: 48, borderRadius: 14, border: 0, background: disabled ? '#8B8A90' : (bg ?? 'var(--ink)'), color: 'var(--onInk)', font: "600 15px 'Geist',sans-serif", cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
  >
    {children}
  </button>
);

const inputStyle = { height: 46, borderRadius: 12, border: '1px solid var(--line2)', padding: '0 14px', font: "400 15px 'Geist',sans-serif", outline: 0, background: 'var(--bg)', color: 'var(--ink)' } as const;

// ---- the song menu ----

function MenuSheet({ track: base, playlistId }: { track: QueueItem; playlistId?: string }) {
  useCoverColors();
  const { byId, playlists } = useLibrary();
  const { queue, index } = usePlayerState();
  const sleepLeft = useSleepLeft();
  const online = useOnline();
  const track: QueueItem = { ...base, ...(byId.get(base.id) ?? {}) };
  const isCurrent = queue[index]?.id === track.id;
  const inPlaylist = playlistId ? playlists.find(p => p.id === playlistId) : undefined;
  const art = artworkUri(track);

  const actions: Array<{ label: string; hint?: string; danger?: boolean; onClick: () => void }> = [
    { label: tr('sheets.playNext'), onClick: () => (PlayerService.playNext(track), closeSheet()) },
  ];
  if (!isCurrent)
    actions.push({ label: tr('sheets.addToQueue'), hint: tr('sheets.atTheEnd'), onClick: () => (PlayerService.addToQueue(track), closeSheet()) });
  if (track.status !== 'streaming') {
    actions.push(
      { label: tr('sheets.addToPlaylistMenu'), onClick: () => openSheet({ kind: 'add', track }) },
      { label: track.liked ? tr('sheets.removeFromLiked') : tr('sheets.like'), onClick: () => (PlayerService.toggleLike(track), closeSheet()) },
    );
  }
  if (canKaraoke(track))
    actions.push({ label: tr('karaoke.title'), hint: tr('karaoke.menuHint'), onClick: () => (closeSheet(), openKaraoke(track.id)) });
  if (isCurrent) actions.push({ label: tr('sheets.sleepTimerMenu'), hint: sleepLeft ?? undefined, onClick: () => openSheet({ kind: 'sleep' }) });
  if (track.genre) {
    const genre = track.genre;
    actions.push({ label: tr('sheets.goToGenre'), hint: genre, onClick: () => (closeSheet(), openCollection({ kind: 'genre', genre })) });
  }
  if (inPlaylist?.trackIds.includes(track.id))
    actions.push({ label: tr('sheets.removeFromPlaylist', { name: inPlaylist.name }), onClick: () => (togglePlaylistTrack(inPlaylist.id, track.id), closeSheet()) });
  if (track.status === 'streaming' && online)
    actions.push({ label: tr('sheets.saveOffline'), onClick: () => (PlayerService.saveOffline(track), closeSheet()) });
  if (track.status === 'ready' && !isCurrent)
    actions.push({
      label: track.source === 'device' ? tr('sheets.hideFromLibrary') : tr('sheets.removeFromDevice'),
      hint: track.sizeBytes ? formatBytes(track.sizeBytes) : undefined,
      danger: true,
      onClick: () => {
        deleteFromLibrary(track);
        closeSheet();
        toast(track.source === 'device' ? tr('sheets.hiddenToast') : tr('sheets.removedToast'));
      },
    });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 60px 14px 20px', borderBottom: '1px solid var(--line)' }}>
        <Cover src={art} size={52} radius={11} bg={paletteFor(track, art).artBg} />
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ font: "600 16px 'Geist',sans-serif" }}>{track.title}</div>
          <div className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>
            {[track.artist, track.genre].filter(Boolean).join(' · ') || tr('common.unknownArtist')}
          </div>
        </div>
      </div>
      <div style={{ padding: '6px 0' }}>
        {actions.map(a => (
          <button
            key={a.label}
            className="h-fill"
            onClick={a.onClick}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', border: 0, background: 'transparent', font: "500 16px 'Geist',sans-serif", color: a.danger ? 'var(--danger)' : 'var(--ink)', cursor: 'pointer', textAlign: 'start' }}
          >
            <span>{a.label}</span>
            {a.hint && <span style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted2)' }}>{a.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- playlists ----

function PlaylistPick({ name, meta, covers, checked, onClick }: { name: string; meta: string; covers: Array<string | null>; checked?: boolean; onClick: () => void }) {
  return (
    <div className="h-fill" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer' }}>
      <CoverGrid srcs={covers} size={46} radius={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ font: "500 15px 'Geist',sans-serif" }}>{name}</div>
        <div style={{ font: "400 12px 'Geist',sans-serif", color: 'var(--muted)' }}>{meta}</div>
      </div>
      {checked !== undefined && (
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: checked ? 0 : '2px solid var(--line2)', background: checked ? 'var(--ink)' : 'transparent', display: 'grid', placeItems: 'center', color: 'var(--onInk)' }}>
          {checked && <CheckIcon size={12} />}
        </div>
      )}
    </div>
  );
}

function useCovers() {
  const { byId } = useLibrary();
  return (ids: string[]) =>
    ids.slice(0, 4).map(id => {
      const t = byId.get(id);
      return t ? artworkUri(t) : null;
    });
}

function CreateRow({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const go = () => name.trim() && onCreate(name.trim());
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16, padding: '0 20px' }}>
      <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder={tr('sheets.newPlaylistName')} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
      <button onClick={go} style={{ height: 46, padding: '0 16px', borderRadius: 12, border: 0, background: name.trim() ? 'var(--ink)' : '#8B8A90', color: 'var(--onInk)', font: "600 14px 'Geist',sans-serif", cursor: 'pointer' }}>
        {tr('sheets.create')}
      </button>
    </div>
  );
}

function AddSheet({ track }: { track: QueueItem }) {
  const { playlists } = useLibrary();
  const covers = useCovers();
  return (
    <div>
      <Title sub={`${track.title}${track.artist ? ` · ${track.artist}` : ''}`}>{tr('sheets.addToPlaylist')}</Title>
      <CreateRow
        onCreate={async n => {
          await createPlaylist(n, [track.id]);
          closeSheet();
          toast(tr('sheets.addedTo', { name: n }));
        }}
      />
      <div style={{ marginTop: 14 }}>
        {playlists.map(p => (
          <PlaylistPick key={p.id} name={p.name} meta={tr('common.songs', { count: p.trackIds.length })} covers={covers(p.trackIds)} checked={p.trackIds.includes(track.id)} onClick={() => togglePlaylistTrack(p.id, track.id)} />
        ))}
      </div>
    </div>
  );
}

function AddManySheet({ trackIds }: { trackIds: string[] }) {
  const { playlists } = useLibrary();
  const covers = useCovers();
  const count = trackIds.length;
  return (
    <div>
      <Title sub={tr('sheets.selected', { count })}>{tr('sheets.addToPlaylist')}</Title>
      <CreateRow
        onCreate={async n => {
          await createPlaylist(n, trackIds);
          closeSheet();
          toast(tr('sheets.addedSongsTo', { count, name: n }));
        }}
      />
      <div style={{ marginTop: 14 }}>
        {playlists.map(p => (
          <PlaylistPick
            key={p.id}
            name={p.name}
            meta={tr('common.songs', { count: p.trackIds.length })}
            covers={covers(p.trackIds)}
            checked={trackIds.every(id => p.trackIds.includes(id))}
            onClick={async () => {
              const added = await addTracksToPlaylist(p.id, trackIds);
              closeSheet();
              toast(added ? tr('sheets.addedSongsTo', { count: added, name: p.name }) : tr('sheets.alreadyIn', { name: p.name }));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function NewPlaylistSheet() {
  const [name, setName] = useState('');
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const id = await createPlaylist(n);
    closeSheet();
    openCollection({ kind: 'playlist', id });
  };
  return (
    <div>
      <Title>{tr('sheets.newPlaylist')}</Title>
      <div style={{ padding: '0 20px' }}>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder={tr('sheets.giveItAName')} style={{ ...inputStyle, width: '100%', marginTop: 16, height: 50, borderRadius: 14, fontSize: 16 }} />
        <div style={{ marginTop: 12 }}>
          <BigButton onClick={create} disabled={!name.trim()}>{tr('sheets.createPlaylist')}</BigButton>
        </div>
      </div>
    </div>
  );
}

// ---- the queue ----

function QueueSheet() {
  useCoverColors();
  const { queue, index, shuffle, repeat, contextName, isPlaying } = usePlayerState();
  const cur = queue[index];
  const upNext = queue.slice(index + 1);
  const drag = useRowDrag({
    count: upNext.length,
    onMove: (from, to) => PlayerService.moveInQueue(index + 1 + from, index + 1 + to),
    onRemove: i => {
      PlayerService.removeFromQueueOnly(upNext[i].id);
      toast(tr('desktop.takenOut'));
    },
  });
  if (!cur) return null;
  const mode = [shuffle ? tr('sheets.shuffleOn') : tr('sheets.inOrder'), repeat === 'one' ? tr('sheets.repeatOne') : repeat === 'all' ? tr('sheets.repeatAll') : null].filter(Boolean).join(' · ');
  const art = artworkUri(cur);
  return (
    <div>
      <div style={{ padding: '0 60px 0 20px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ font: "700 20px 'Geist',sans-serif", letterSpacing: '-.01em' }}>{tr('sheets.queue')}</span>
        <span style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>{mode}</span>
      </div>
      <div style={{ padding: '4px 20px 0', font: "400 12px 'Geist',sans-serif", color: 'var(--muted2)' }}>{tr('desktop.queueHint')}</div>
      <div className="eyebrow" style={{ padding: '14px 20px 6px', fontSize: 11 }}>{tr('sheets.nowPlaying')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px' }}>
        <Cover src={art} size={46} radius={10} bg={paletteFor(cur, art).artBg}>
          <EqOverlay playing={isPlaying} />
        </Cover>
        <div style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ font: "600 15px 'Geist',sans-serif" }}>{cur.title}</div>
          <div className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>{cur.artist ?? tr('common.unknownArtist')}</div>
        </div>
      </div>
      <div className="eyebrow" style={{ padding: '16px 20px 6px', fontSize: 11 }}>{tr('sheets.upNext', { name: contextName })}</div>
      {!upNext.length && <div style={{ padding: '6px 20px', font: "400 14px 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('sheets.endOfQueue')}</div>}
      {upNext.map((t, k) => {
        const a = artworkUri(t);
        return (
          <div
            key={t.id}
            data-drag-row="1"
            className="h-fill"
            {...drag.swipe(k)}
            onClick={() => !drag.wasDrag() && PlayerService.skipTo(index + 1 + k)}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px 6px 20px', cursor: 'pointer', touchAction: 'pan-y', ...drag.rowStyle(k) }}
          >
            <Cover src={a} size={46} radius={10} bg={paletteFor(t, a).artBg} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: "500 15px 'Geist',sans-serif" }}>{t.title}</div>
              <div className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>{t.artist ?? tr('common.unknownArtist')}</div>
            </div>
            <span className="mono" style={{ font: "400 12px 'Geist Mono',monospace", color: 'var(--muted2)' }}>{t.duration ? formatTime(t.duration) : ''}</span>
            <div {...drag.handle(k)} title={tr('sheets.dragToReorder')} style={{ ...drag.handle(k).style, width: 32, height: 40, display: 'grid', placeItems: 'center', color: 'var(--muted2)', flex: 'none' }}>
              <GripIcon size={18} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- speed, sleep ----

function SpeedSheet() {
  const { playbackSpeed } = useSettings();
  return (
    <div>
      <Title sub={tr('sheets.speedHint')}>{tr('sheets.speedTitle')}</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '16px 20px 0' }}>
        {SPEEDS.map(v => {
          const on = v === playbackSpeed;
          return (
            <button
              key={v}
              onClick={() => {
                PlayerService.setSpeed(v);
                closeSheet();
              }}
              style={{ height: 64, border: 0, borderRadius: 14, background: on ? 'var(--ink)' : 'var(--fill2)', color: on ? 'var(--onInk)' : 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}
            >
              <span className="mono" style={{ font: "600 18px 'Geist Mono',monospace" }}>{speedLabel(v)}</span>
              <span style={{ font: "400 11px 'Geist',sans-serif", opacity: 0.7 }}>
                {v === 1 ? tr('sheets.speedNormal') : v < 1 ? tr('sheets.speedSlower') : tr('sheets.speedFaster')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SleepSheet() {
  const left = useSleepLeft();
  const { sleep } = usePlayerState();
  const endOfSong = !!sleep && 'endOfSong' in sleep;
  const pick = (when: number | 'endOfSong') => {
    PlayerService.setSleep(when);
    closeSheet();
  };
  return (
    <div>
      <Title sub={left ? (endOfSong ? tr('sheets.sleepEndOfSongActive') : tr('sheets.sleepPausesIn', { time: left })) : tr('sheets.sleepIntro')}>{tr('sheets.sleepTitle')}</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, margin: '16px 20px 0' }}>
        {[15, 30, 45, 60, 90].map(m => (
          <button key={m} onClick={() => pick(m)} style={{ height: 58, border: 0, borderRadius: 14, background: 'var(--fill2)', color: 'var(--ink)', cursor: 'pointer', font: "600 15px 'Geist',sans-serif" }}>
            {m} {tr('sheets.minutes')}
          </button>
        ))}
        <button onClick={() => pick('endOfSong')} style={{ height: 58, border: 0, borderRadius: 14, background: 'var(--fill2)', color: 'var(--ink)', cursor: 'pointer', font: "600 15px 'Geist',sans-serif" }}>
          {tr('sheets.endOfSong')}
        </button>
      </div>
      {left && (
        <div style={{ padding: '12px 20px 0' }}>
          <button
            onClick={() => {
              PlayerService.cancelSleep();
              closeSheet();
            }}
            style={{ width: '100%', height: 46, borderRadius: 14, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--danger)', font: "600 14px 'Geist',sans-serif", cursor: 'pointer' }}
          >
            {tr('sheets.sleepOff')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- similar songs ----

function SimilarSheet({ track }: { track: QueueItem }) {
  useCoverColors();
  const { tracks } = useLibrary();
  const [found, setFound] = useState<Similar | null>(null);
  const connected = useOnline();
  const local = found?.local ?? similarInLibrary(track, tracks);
  const online = !connected ? [] : found ? found.online : null;
  useEffect(() => {
    let live = true;
    setFound(null);
    similarFor(track, tracks).then(r => live && setFound(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);
  const ctx = tr('sheets.similarTo', { title: track.title });
  const basis = track.artist && track.genre ? tr('sheets.basisBoth', { artist: track.artist, genre: track.genre }) : track.artist || track.genre || tr('sheets.whatYoureListening');
  const reason = found?.fromYoutube ? tr('sheets.fromYoutube') : found ? tr('sheets.offlineBasedOn', { basis }) : tr('sheets.askingYoutube');
  const empty = !local.length && online !== null && !online.length;
  const row = (key: string, title: string, sub: string, art: string | null | undefined, bg: string, icon: ReactNode, onClick: () => void) => (
    <div key={key} className="h-fill" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 20px', cursor: 'pointer' }}>
      <Cover src={art} size={46} radius={10} bg={bg} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ font: "500 15px 'Geist',sans-serif" }}>{title}</div>
        <div className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>{sub}</div>
      </div>
      {icon}
    </div>
  );
  return (
    <div>
      <Title sub={reason}>{ctx}</Title>
      {(local.length > 0 || (online?.length ?? 0) > 0) && (
        <div style={{ padding: '14px 20px 0' }}>
          <BigButton
            onClick={() => {
              const pool = [...local.map(x => ({ track: x as Track })), ...(online ?? []).map(r => ({ result: r }))];
              closeSheet();
              PlayerService.startRadio(pool[Math.floor(Math.random() * pool.length)]);
            }}
          >
            <ShuffleIcon size={16} />
            {tr('sheets.playRandom')}
          </BigButton>
        </div>
      )}
      {empty && <Note style={{ margin: '14px 20px 0' }}>{tr('sheets.nothingSimilar')}</Note>}
      <div style={{ paddingTop: 10 }}>
        {local.map(x => {
          const a = artworkUri(x);
          return row(x.id, x.title, `${x.artist ?? tr('common.unknownArtist')} · ${tr('sheets.onDevice')}`, a, paletteFor(x, a).artBg, <CheckCircleIcon size={18} color={GREEN} />, () => {
            closeSheet();
            PlayerService.playQueue(local, local.indexOf(x), ctx, false);
          });
        })}
        {online?.map(r =>
          row(r.source + r.sourceId, r.title, `${r.artist ?? tr('common.unknownArtist')} · ${sourceName(r.source)}`, r.thumbnailUrl, paletteFor(r, r.thumbnailUrl).artBg, <GlobeIcon size={18} color={ACCENT} />, () => {
            closeSheet();
            PlayerService.playOnline(r, tr('sheets.suggested'));
          }),
        )}
        {online === null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>
            <Spinner />
            {tr('sheets.gettingRecs')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- updates ----

function UpdateSheet({ release }: { release: Release }) {
  const [step, setStep] = useState<InstallStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = installedVersion()?.name;
  const busy = !!step && !error;
  const start = async () => {
    setError(null);
    try {
      await downloadAndInstall(release, setStep);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStep(null);
    }
  };
  const label = !step
    ? tr('sheets.update')
    : step.step === 'downloading'
      ? tr('sheets.downloading', { percent: Math.round(step.progress * 100) })
      : step.step === 'verifying'
        ? tr('sheets.verifying')
        : tr('desktop.installing');
  return (
    <div>
      <Title sub={`stash ${release.version}${current ? ` · ${tr('sheets.youHave', { version: current })}` : ''}${release.size ? ` · ${formatBytes(release.size)}` : ''}`}>
        {tr('sheets.updateAvailable')}
      </Title>
      <div style={{ padding: '0 20px' }}>
        {release.notes && (
          <div style={{ marginTop: 14, maxHeight: 240, overflowY: 'auto', overflowX: 'hidden', borderRadius: 14, background: 'var(--fill)', padding: 14, font: "400 14px/1.45 'Geist',sans-serif", color: 'var(--ink2)', whiteSpace: 'pre-wrap', userSelect: 'text' }}>
            {release.notes}
          </div>
        )}
        <div style={{ marginTop: 10, font: "400 12px/1.4 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('sheets.updateKeeps')}</div>
        {error && <div style={{ marginTop: 10, font: "500 13px 'Geist',sans-serif", color: 'var(--danger)' }}>{error}</div>}
        <div style={{ marginTop: 14 }}>
          <BigButton onClick={start} disabled={busy}>
            {busy && step?.step !== 'downloading' && <Spinner color="#fff" track="rgba(255,255,255,.3)" />}
            {error ? tr('common.retry') : label}
          </BigButton>
        </div>
        {step?.step === 'downloading' && (
          <div style={{ height: 4, borderRadius: 2, marginTop: 10, overflow: 'hidden', background: 'var(--fill3)' }}>
            <div style={{ height: '100%', width: `${step.progress * 100}%`, background: 'var(--ink)' }} />
          </div>
        )}
        {!busy && (
          <button onClick={closeSheet} style={{ width: '100%', padding: '14px 0 0', border: 0, background: 'transparent', color: 'var(--muted)', font: "500 14px 'Geist',sans-serif", cursor: 'pointer' }}>
            {tr('sheets.later')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- lyrics ----

function PasteSheet({ track }: { track: Track }) {
  const [text, setText] = useState('');
  const [own, setOwn] = useState(false);
  useEffect(() => {
    lyricsFor(track).then(l => {
      if (l.source === OWN_LYRICS) {
        setOwn(true);
        setText(l.lines ? l.lines.map(x => `[${formatLrc(x.time)}] ${x.text}`).join('\n') : (l.plain ?? ''));
      }
    });
  }, [track]);
  return (
    <div>
      <Title sub={`${track.title} · ${tr('player.lyricsPasteHint')}`}>{tr('player.lyricsPasteOwn')}</Title>
      <div style={{ padding: '0 20px' }}>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'[00:12.00] …\n[00:16.50] …'}
          style={{ width: '100%', marginTop: 14, height: 190, borderRadius: 14, border: '1px solid var(--line2)', padding: '12px 14px', font: "400 13px/1.5 'Geist Mono',monospace", outline: 0, background: 'var(--bg)', color: 'var(--ink)', resize: 'none' }}
        />
        <div style={{ marginTop: 10 }}>
          <BigButton
            disabled={!text.trim()}
            onClick={async () => {
              await saveOwnLyrics(track.id, text);
              lyricsChanged();
              closeSheet();
              toast(tr('desktop.usingYours'));
            }}
          >
            {tr('desktop.useLyrics')}
          </BigButton>
        </div>
        {own && (
          <button
            onClick={async () => {
              // Forget them: the next look-up finds the published lyrics again.
              await saveLyricsRow(track.id, { plain: null, synced: null, source: null, checkedAt: 0 });
              lyricsChanged();
              closeSheet();
            }}
            style={{ width: '100%', marginTop: 6, height: 40, border: 0, background: 'transparent', color: 'var(--danger)', font: "500 14px 'Geist',sans-serif", cursor: 'pointer' }}
          >
            {tr('desktop.backToFound')}
          </button>
        )}
      </div>
    </div>
  );
}

const formatLrc = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

function LyricsSearchSheet({ track }: { track: Track }) {
  const guess = splitArtistTitle(track.title, track.artist);
  const [q, setQ] = useState([guess.artist, guess.title].filter(Boolean).join(' '));
  const [results, setResults] = useState<LyricsMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await searchLyrics(q.trim()));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = async (m: LyricsMatch | null) => {
    await chooseLyrics(track.id, m);
    lyricsChanged();
    closeSheet();
  };
  return (
    <div>
      <Title sub={track.title}>{tr('player.lyricsSearch')}</Title>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '0 20px' }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder={tr('player.lyricsPlaceholder')} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        <button onClick={go} style={{ height: 46, padding: '0 16px', borderRadius: 12, border: 0, background: 'var(--ink)', color: 'var(--onInk)', font: "600 14px 'Geist',sans-serif", cursor: 'pointer' }}>
          {busy ? <Spinner color="#fff" track="rgba(255,255,255,.3)" /> : tr('library.searchTitle')}
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {results?.length === 0 && <Note style={{ margin: '0 20px' }}>{tr('player.lyricsNothingFound')}</Note>}
        {results?.map(m => (
          <div key={m.id} className="h-fill" onClick={() => pick(m)} style={{ padding: '10px 20px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className="ellipsis" style={{ font: "500 15px 'Geist',sans-serif" }}>{m.title}</span>
              {m.synced && <span className="mono" style={{ font: "600 10px 'Geist Mono',monospace", color: 'var(--accentInk)', textTransform: 'uppercase', flex: 'none' }}>{tr('player.lyricsSynced')}</span>}
            </div>
            <div className="ellipsis" style={{ font: "400 13px 'Geist',sans-serif", color: 'var(--muted)' }}>
              {[m.artist, m.album, m.duration ? formatTime(m.duration) : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
        <button onClick={() => pick(null)} style={{ width: '100%', padding: '14px 20px 0', border: 0, background: 'transparent', color: 'var(--muted)', font: "500 13px 'Geist',sans-serif", cursor: 'pointer', textAlign: 'start' }}>
          {tr('player.lyricsInstrumental')}
        </button>
        <button onClick={() => openSheet({ kind: 'paste', track })} style={{ width: '100%', padding: '10px 20px 0', border: 0, background: 'transparent', color: 'var(--ink)', font: "600 13px 'Geist',sans-serif", cursor: 'pointer', textAlign: 'start', textDecoration: 'underline' }}>
          {tr('player.lyricsPasteOwn')}
        </button>
      </div>
    </div>
  );
}

// ---- language, rename ----

function LanguageSheet() {
  const { language } = useSettings();
  const sys = LANGUAGES.find(l => l.code === deviceLanguage())?.name ?? 'English';
  const options: Array<{ value: Settings['language']; native: string; label: string }> = [
    { value: 'system', native: tr('desktop.systemLanguage', { name: sys }), label: '' },
    ...LANGUAGES.map(l => ({ value: l.code, native: l.name, label: '' })),
  ];
  return (
    <div>
      <Title sub={tr('desktop.languageHint')}>{tr('settings.language')}</Title>
      <div style={{ paddingTop: 10 }}>
        {options.map(o => (
          <button
            key={o.value}
            className="h-fill"
            onClick={() => {
              saveSettings({ language: o.value });
              closeSheet();
            }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink)', textAlign: 'start', font: "500 16px 'Geist',sans-serif" }}
          >
            <span>{o.native}</span>
            {language === o.value && <CheckIcon size={18} color={ACCENT} stroke={2.6} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function RenameSheet({ recording }: { recording: Parameters<typeof renameRecording>[0] }) {
  const [text, setText] = useState(recordingName(recording));
  const save = async () => {
    try {
      await renameRecording(recording, text);
      closeSheet();
    } catch (e) {
      if (e instanceof NameTakenError) toast(tr('karaoke.nameTaken', { name: e.message }));
      else toast(String((e as Error)?.message ?? e));
    }
  };
  return (
    <div>
      <Title>{tr('karaoke.renameTitle')}</Title>
      <div style={{ padding: '0 20px' }}>
        <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} style={{ ...inputStyle, width: '100%', marginTop: 16, height: 50, borderRadius: 14, fontSize: 16 }} />
        <div style={{ marginTop: 12 }}>
          <BigButton onClick={save} disabled={!text.trim()}>{tr('common.save')}</BigButton>
        </div>
      </div>
    </div>
  );
}

export type { Key };
