/**
 * Android Auto: keeps the car's screens in sync with the app and plays what the
 * driver picks. Native side: android/app/src/main/java/com/musicapp/car/.
 *
 * The car gets three tabs — Library, Playlists (liked, playlists, genres) and,
 * with "Suggest similar songs" on, For you (YouTube's recommendations for the
 * song playing) — plus now playing with Like, Speed
 * and Shuffle buttons. Audio always comes from PlayerService.
 *
 * Started from index.js (not a component), so it also works when Android Auto
 * launches the app in the background with no screen.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { searchLibrary } from '../db/database';
import { onLanguageChange, tr } from '../i18n';
import { PlayerService } from '../player/PlayerService';
import { getLibrarySnapshot, subscribeLibrarySnapshot } from '../player/hooks';
import { whileAway } from '../services/keepAlive';
import { isOnline, subscribeNetwork } from '../services/network';
import { getSettings, subscribeSettings } from '../services/settings';
import {
  similarFor,
  similarInLibrary,
  type Similar,
} from '../services/similar';
import { searchOnline } from '../sources';
import { artworkUri, type QueueItem, type Track } from '../types';

interface CarItem {
  id: string;
  title: string;
  subtitle?: string;
  art?: string;
  duration?: number;
  playable?: boolean;
  browsable?: boolean;
}

interface CarNative {
  setQueue(items: CarItem[], offset: number): void;
  setPlayback(p: {
    index: number;
    playing: boolean;
    buffering: boolean;
    position: number;
    speed: number;
    repeat: string;
    shuffle: boolean;
    liked: boolean;
    canLike: boolean;
    /** Button labels, in the app's language. */
    likeLabel: string;
    speedLabel: string;
    shuffleLabel: string;
  }): void;
  setBrowseTree(json: string): void;
}

type CarEvent =
  | { type: 'connected' | 'play' | 'pause' | 'next' | 'previous' }
  | { type: 'like' | 'cycleSpeed' | 'shuffle' }
  | { type: 'seek'; position: number }
  | { type: 'skipTo'; index: number }
  | { type: 'speed'; value: number }
  | { type: 'repeat'; mode: 'off' | 'all' | 'one' }
  | { type: 'playItem' | 'playNext'; id: string }
  | { type: 'playSearch'; query: string };

const Native: CarNative | undefined = NativeModules.StashCar;

/** Songs before / after the current one sent to the car's queue view. */
const QUEUE_BEFORE = 20;
const QUEUE_AFTER = 100;
/** Browse lists are capped; the car shows long lists poorly anyway. */
const MAX_LIST = 300;

const songItem = (parent: string, t: Track): CarItem => ({
  id: `play|${parent}|${t.id}`,
  title: t.title,
  subtitle: t.artist ?? undefined,
  art: artworkUri(t) ?? undefined,
  duration: t.duration ?? undefined,
});

const folder = (
  id: string,
  title: string,
  sub: string,
  art?: string | null,
) => ({
  id,
  title,
  subtitle: sub,
  art: art ?? undefined,
  playable: false,
  browsable: true,
});

/** YouTube's recommendations for the "For you" seed, once they've arrived. */
let forYou: { seedId: string; found: Similar } | null = null;

/** The song to base "For you" on: what's playing, else the last played or a liked one. */
function seedTrack(tracks: Track[]): Track | undefined {
  const cur = PlayerService.current;
  if (cur && cur.status !== 'streaming') return cur;
  const played = tracks
    .filter(t => t.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))[0];
  return played ?? tracks.find(t => t.liked);
}

/** Songs behind a browse id ("library", "liked", "pl:<id>", "genre:<name>", "foryou"). */
function listFor(parent: string): { name: string; tracks: Track[] } {
  const { tracks: all, playlists, byId } = getLibrarySnapshot();
  const tracks = all.filter(t => t.status !== 'streaming');
  if (parent === 'library') return { name: tr('system.ctxLibrary'), tracks };
  if (parent === 'liked')
    return { name: tr('system.ctxLiked'), tracks: tracks.filter(t => t.liked) };
  if (parent === 'foryou') {
    const seed = seedTrack(tracks);
    return {
      name: seed
        ? tr('system.ctxSimilarTo', { title: seed.title })
        : tr('system.ctxForYou'),
      tracks:
        forYou && forYou.seedId === seed?.id
          ? forYou.found.local
          : seed
          ? similarInLibrary(seed, tracks, 20)
          : [],
    };
  }
  if (parent.startsWith('genre:')) {
    const g = parent.slice(6);
    return {
      name: g,
      tracks: tracks.filter(t => t.status === 'ready' && t.genre === g),
    };
  }
  if (parent.startsWith('pl:')) {
    const p = playlists.find(x => x.id === parent.slice(3));
    return {
      name: p?.name ?? tr('system.ctxPlaylist'),
      tracks: (p?.trackIds ?? [])
        .map(id => byId.get(id))
        .filter((t): t is Track => !!t),
    };
  }
  return { name: tr('system.ctxLibrary'), tracks: [] };
}

function buildTree() {
  const { tracks: all, playlists } = getLibrarySnapshot();
  const tracks = all.filter(t => t.status !== 'streaming');
  const suggest = getSettings().suggestSimilar;
  const count = (n: number) => tr('common.songs', { count: n });
  const songs = (parent: string) =>
    listFor(parent)
      .tracks.slice(0, MAX_LIST)
      .map(t => songItem(parent, t));
  const shuffleItem = (parent: string): CarItem => ({
    id: `shuffle|${parent}`,
    title: tr('system.carShuffleAll'),
    subtitle: count(listFor(parent).tracks.length),
  });

  const genres = [
    ...new Set(
      tracks.filter(t => t.status === 'ready' && t.genre).map(t => t.genre!),
    ),
  ].sort();
  const liked = tracks.filter(t => t.liked);
  const collections: CarItem[] = [
    folder(
      'liked',
      tr('system.ctxLiked'),
      count(liked.length),
      liked[0] && artworkUri(liked[0]),
    ),
    ...playlists.map(p => {
      const first = listFor(`pl:${p.id}`).tracks[0];
      return folder(
        `pl:${p.id}`,
        p.name,
        count(p.trackIds.length),
        first && artworkUri(first),
      );
    }),
    ...genres.map(g => {
      const list = listFor(`genre:${g}`).tracks;
      return folder(
        `genre:${g}`,
        g,
        tr('system.carGenre', { songs: count(list.length) }),
        list[0] && artworkUri(list[0]),
      );
    }),
  ];

  const children: Record<string, CarItem[]> = {
    library: [shuffleItem('library'), ...songs('library')],
    playlists: collections,
    liked: [shuffleItem('liked'), ...songs('liked')],
  };
  for (const p of playlists) {
    children[`pl:${p.id}`] = [
      shuffleItem(`pl:${p.id}`),
      ...songs(`pl:${p.id}`),
    ];
  }
  for (const g of genres) {
    children[`genre:${g}`] = [
      shuffleItem(`genre:${g}`),
      ...songs(`genre:${g}`),
    ];
  }
  const roots: CarItem[] = [
    folder('library', tr('system.ctxLibrary'), count(tracks.length)),
    folder(
      'playlists',
      tr('system.carPlaylists'),
      tr('system.carPlaylistCount', { count: playlists.length + 1 }),
    ),
  ];
  if (suggest) {
    roots.push(
      folder('foryou', tr('system.ctxForYou'), listFor('foryou').name),
    );
    // Web suggestions only while there's a connection to stream them.
    const web = (isOnline() ? forYou?.found.online ?? [] : []).map(
      (r, i): CarItem => ({
        id: `web|foryou|${i}`,
        title: r.title,
        subtitle: [r.artist, 'YouTube'].filter(Boolean).join(' · '),
        art: r.thumbnailUrl ?? undefined,
        duration: r.duration ?? undefined,
      }),
    );
    children.foryou = [...songs('foryou'), ...web];
  }
  return { roots, children };
}

// ---- pushing state to the car ----

let lastTree = '';
function pushTree() {
  const json = JSON.stringify(buildTree());
  if (json === lastTree) return;
  lastTree = json;
  Native!.setBrowseTree(json);
}

let lastQueue: QueueItem[] | null = null;
let lastOffset = -1;
let lastSeedId: string | undefined;

function pushPlayback() {
  const st = PlayerService.getState();
  const { position } = PlayerService.getProgress();
  const offset = Math.max(0, st.index - QUEUE_BEFORE);
  if (st.queue !== lastQueue || offset !== lastOffset) {
    lastQueue = st.queue;
    lastOffset = offset;
    Native!.setQueue(
      st.queue.slice(offset, st.index + QUEUE_AFTER).map(q => ({
        id: q.id,
        title: q.title,
        subtitle: q.artist ?? undefined,
        art: (q.artworkPath ? artworkUri(q) : q.remoteArtworkUrl) ?? undefined,
        duration: q.duration ?? undefined,
      })),
      offset,
    );
  }
  const cur = st.queue[st.index];
  const speed = getSettings().playbackSpeed;
  Native!.setPlayback({
    index: st.index - offset,
    playing: st.isPlaying || st.isResolving,
    buffering: st.isBuffering || st.isResolving,
    position,
    speed,
    repeat: st.repeat,
    shuffle: st.shuffle,
    liked: !!cur?.liked,
    canLike: !!cur && cur.status !== 'streaming',
    likeLabel: tr(cur?.liked ? 'system.carUnlike' : 'system.carLike'),
    speedLabel: tr('system.carSpeed', { speed: String(speed) }),
    shuffleLabel: tr(
      st.shuffle ? 'system.carShuffleOff' : 'system.carShuffleOn',
    ),
  });
  // "For you" follows the song that's playing.
  if (cur?.id !== lastSeedId) {
    lastSeedId = cur?.id;
    pushTree();
    loadForYou();
  }
}

function loadForYou() {
  if (!getSettings().suggestSimilar) return;
  const tracks = getLibrarySnapshot().tracks.filter(
    t => t.status !== 'streaming',
  );
  const seed = seedTrack(tracks);
  // Offline results are only the fallback: fetch YouTube's again once back online.
  if (!seed || (forYou?.seedId === seed.id && forYou.found.fromYoutube)) {
    return;
  }
  similarFor(seed, tracks, { localLimit: 20, onlineLimit: 20 })
    .then(found => {
      if (seedTrack(getLibrarySnapshot().tracks)?.id !== seed.id) return;
      forYou = { seedId: seed.id, found };
      pushTree();
    })
    .catch(() => {});
}

// ---- the driver's actions ----

/** Car sends "play" right after picking a song; don't resume the old one meanwhile. */
let pickedAt = 0;

function playFromBrowse(mediaId: string, next = false) {
  const [kind, parent, trackId] = mediaId.split('|');
  const { name, tracks } = listFor(parent ?? '');
  if (!tracks.length && kind !== 'web') return;
  pickedAt = Date.now();
  if (kind === 'web') {
    const r = forYou?.found.online[Number(trackId)];
    if (r) PlayerService.playOnline(r, name);
    return;
  }
  if (kind === 'shuffle') {
    PlayerService.shuffleAll(tracks, name);
    return;
  }
  const i = Math.max(
    0,
    tracks.findIndex(t => t.id === trackId),
  );
  if (next) PlayerService.playNext(tracks[i]);
  else PlayerService.playQueue(tracks, i, name, false);
}

/** "Hey Google, play … on stash": the library first, then the online sources. */
async function playSearch(query: string) {
  pickedAt = Date.now();
  const local = await searchLibrary(query);
  if (local.length) {
    PlayerService.playQueue(local, 0, tr('system.ctxQuery', { query }), false);
    return;
  }
  if (!isOnline()) return;
  const online = await searchOnline(query, () => {});
  if (online[0])
    PlayerService.playOnline(online[0], tr('system.ctxQuery', { query }));
}

function onEvent(e: CarEvent) {
  const cur = PlayerService.current;
  switch (e.type) {
    case 'connected':
      lastTree = '';
      lastQueue = null;
      pushTree();
      pushPlayback();
      loadForYou();
      break;
    case 'play':
      if (Date.now() - pickedAt > 1500) PlayerService.play();
      break;
    case 'pause':
      PlayerService.pause();
      break;
    // Also sent by the notification and lock screen buttons, often with the screen off.
    case 'next':
      whileAway(() => PlayerService.next()).catch(() => {});
      break;
    case 'previous':
      whileAway(() => PlayerService.previous()).catch(() => {});
      break;
    case 'seek':
      PlayerService.seekTo(e.position);
      break;
    case 'skipTo':
      PlayerService.skipTo(e.index);
      break;
    case 'speed':
      PlayerService.setSpeed(e.value);
      break;
    case 'cycleSpeed':
      PlayerService.cycleSpeed();
      break;
    case 'repeat':
      while (PlayerService.getState().repeat !== e.mode)
        PlayerService.cycleRepeat();
      break;
    case 'shuffle':
      PlayerService.toggleShuffle();
      break;
    case 'like':
      if (cur) PlayerService.toggleLike(cur);
      break;
    case 'playItem':
      playFromBrowse(e.id);
      break;
    case 'playNext':
      playFromBrowse(e.id, true);
      break;
    case 'playSearch':
      playSearch(e.query).catch(() => {});
      break;
  }
}

let started = false;

export function startCarBridge() {
  if (!Native || started) return;
  started = true;
  new NativeEventEmitter(NativeModules.StashCar).addListener('StashCar', e =>
    onEvent(e as CarEvent),
  );

  PlayerService.subscribe(pushPlayback);
  // Position: the car moves the clock itself, so a resync every few seconds is plenty.
  let lastPos = 0;
  PlayerService.subscribeProgress(() => {
    const { position } = PlayerService.getProgress();
    if (Math.abs(position - lastPos) >= 3 || position < lastPos) {
      lastPos = position;
      pushPlayback();
    }
  });
  subscribeLibrarySnapshot(() => {
    pushTree();
    loadForYou();
  }); // also loads the library
  subscribeNetwork(() => {
    pushTree();
    loadForYou();
  });
  subscribeSettings(() => {
    pushTree();
    pushPlayback();
  });
  // Folder names and button labels are sent as text: resend them in the new language.
  onLanguageChange(() => {
    pushTree();
    pushPlayback();
  });
}
