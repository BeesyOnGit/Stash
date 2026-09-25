/**
 * Android floating bubble: a spinning record that floats over other apps while
 * stash plays in the background (Settings → Listening → Floating bubble).
 * Tapping it opens a card with the song, controls, favorites and suggestions.
 * Native side: android/app/src/main/java/com/musicapp/bubble/.
 *
 * Native decides when the bubble shows (app in the background, something in
 * the player, permission granted); JS only keeps it up to date and plays what
 * is tapped. Audio always comes from PlayerService.
 */
import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { onLanguageChange, tr } from '../i18n';
import { navigationRef } from '../navigation/ref';
import { PlayerService } from '../player/PlayerService';
import { getLibrarySnapshot, subscribeLibrarySnapshot } from '../player/hooks';
import { whileAway } from '../services/keepAlive';
import { isOnline, subscribeNetwork } from '../services/network';
import {
  getSettings,
  saveSettings,
  subscribeSettings,
} from '../services/settings';
import {
  similarFor,
  similarInLibrary,
  type Similar,
} from '../services/similar';
import { hueOf } from '../theme';
import { artworkUri, type Track } from '../types';

interface BubbleItem {
  title: string;
  artist: string;
  art: string;
  hue: number;
  /** Suggestions: "Offline" or the source it would stream from. */
  tag?: string;
  local?: boolean;
}

interface BubbleNative {
  canDrawOverlays(): Promise<boolean>;
  requestPermission(): void;
  setConfig(c: {
    enabled: boolean;
    ringColor: string;
    vinylStyle: string;
    rotate: boolean;
    haptics: boolean;
    hapticStrength: string;
  }): void;
  setNowPlaying(p: {
    has: boolean;
    title: string;
    artist: string;
    art: string;
    hue: number;
    playing: boolean;
    buffering: boolean;
    position: number;
    duration: number;
    speed: number;
  }): void;
  setLists(json: string): void;
}

type BubbleEvent =
  | { type: 'toggle' | 'next' | 'previous' | 'open' }
  | { type: 'favorite' | 'suggestion'; index: number };

const Native: BubbleNative | undefined =
  Platform.OS === 'android' ? NativeModules.StashBubble : undefined;

const MAX_FAVORITES = 12;
const MAX_SUGGESTIONS = 8;

const itemFor = (t: Track, tag?: string): BubbleItem => ({
  title: t.title,
  artist: t.artist ?? '',
  art: artworkUri(t) ?? '',
  hue: hueOf(t.title + (t.artist ?? '')),
  tag,
  local: tag ? true : undefined,
});

// ---- permission ----

export const bubbleSupported = () => !!Native;

/** Waiting for the user to come back from the "Display over other apps" screen. */
let awaitingPermission = false;

/**
 * Turns the bubble on, asking for "Display over other apps" first if needed.
 * Resolves false if permission is still missing (the setting stays off, and turns
 * on by itself if the user grants it and comes back).
 */
export async function enableBubble(): Promise<boolean> {
  if (!Native) return false;
  if (await Native.canDrawOverlays()) {
    saveSettings({ floatingBubble: true });
    return true;
  }
  awaitingPermission = true;
  Native.requestPermission();
  return false;
}

// ---- lists: favorites + suggestions ----

/** What the card rows play, in the order sent. */
let favorites: Track[] = [];
let suggestions: (
  | { kind: 'local'; t: Track }
  | { kind: 'online'; i: number }
)[] = [];
let found: { seedId: string; similar: Similar } | null = null;
let lastLists = '';

function pushLists() {
  const cur = PlayerService.current;
  const tracks = getLibrarySnapshot().tracks.filter(
    t => t.status !== 'streaming',
  );
  favorites = tracks.filter(t => t.liked).slice(0, MAX_FAVORITES);

  suggestions = [];
  const items: BubbleItem[] = [];
  if (cur && getSettings().suggestSimilar) {
    const sim = found?.seedId === cur.id ? found.similar : null;
    const local = sim
      ? sim.local
      : similarInLibrary(cur, tracks, MAX_SUGGESTIONS);
    const online = sim && isOnline() ? sim.online : [];
    // Alternate offline / online, like the design.
    for (
      let i = 0;
      items.length < MAX_SUGGESTIONS && (i < local.length || i < online.length);
      i++
    ) {
      if (local[i]) {
        suggestions.push({ kind: 'local', t: local[i] });
        items.push(itemFor(local[i], tr('system.offline')));
      }
      if (online[i] && items.length < MAX_SUGGESTIONS) {
        const r = online[i];
        suggestions.push({ kind: 'online', i });
        items.push({
          title: r.title,
          artist: r.artist ?? '',
          art: r.thumbnailUrl ?? '',
          hue: hueOf(r.title + (r.artist ?? '')),
          tag: 'YouTube',
          local: false,
        });
      }
    }
  }
  const json = JSON.stringify({
    favorites: favorites.map(t => itemFor(t)),
    suggestions: items,
    // The card's own texts, in the app's language.
    labels: {
      open: tr('system.bubbleOpen'),
      playPause: tr('system.bubblePlayPause'),
      previous: tr('common.previous'),
      next: tr('common.next'),
      favorites: tr('system.bubbleFavorites'),
      suggested: tr('system.ctxSuggested'),
      empty: tr('system.bubbleEmpty'),
      bubble: tr('system.bubbleHint'),
    },
  });
  if (json === lastLists) return;
  lastLists = json;
  Native!.setLists(json);
}

function loadSuggestions() {
  const cur = PlayerService.current;
  if (!cur || !getSettings().suggestSimilar) return;
  if (found?.seedId === cur.id && (found.similar.fromYoutube || !isOnline()))
    return;
  const tracks = getLibrarySnapshot().tracks.filter(
    t => t.status !== 'streaming',
  );
  whileAway(() =>
    similarFor(cur, tracks, { localLimit: 6, onlineLimit: 6 }).then(similar => {
      if (PlayerService.current?.id !== cur.id) return;
      found = { seedId: cur.id, similar };
      pushLists();
    }),
  ).catch(() => {});
}

// ---- state ----

function pushConfig() {
  const s = getSettings();
  Native!.setConfig({
    enabled: s.floatingBubble,
    ringColor: s.bubbleRingColor,
    vinylStyle: s.vinylStyle,
    rotate: s.rotateArt,
    haptics: s.haptics,
    hapticStrength: s.hapticStrength,
  });
}

let lastSeedId: string | undefined;

function pushPlayback() {
  const st = PlayerService.getState();
  const cur = st.queue[st.index];
  const { position, duration } = PlayerService.getProgress();
  Native!.setNowPlaying({
    has: !!cur,
    title: cur?.title ?? '',
    artist: cur?.artist ?? '',
    art: (cur && artworkUri(cur)) ?? '',
    hue: cur ? hueOf(cur.title + (cur.artist ?? '')) : 0,
    playing: st.isPlaying || st.isResolving,
    buffering: st.isBuffering || st.isResolving,
    position,
    duration: duration || cur?.duration || 0,
    speed: getSettings().playbackSpeed,
  });
  if (cur?.id !== lastSeedId) {
    lastSeedId = cur?.id;
    pushLists();
    loadSuggestions();
  }
}

// ---- taps in the bubble ----

/** Next / previous / a picked song can mean resolving an online stream: see [whileAway]. */
function onEvent(e: BubbleEvent): unknown {
  switch (e.type) {
    case 'toggle':
      return PlayerService.togglePlay();
    case 'next':
      return PlayerService.next();
    case 'previous':
      return PlayerService.previous();
    case 'open':
      // Native brings the app to the front; show the full player there.
      if (navigationRef.isReady() && PlayerService.current) {
        navigationRef.navigate('Player');
      }
      return;
    case 'favorite':
      if (!favorites[e.index]) return;
      return PlayerService.playQueue(
        favorites,
        e.index,
        tr('system.ctxLiked'),
        false,
      );
    case 'suggestion': {
      const s = suggestions[e.index];
      const cur = PlayerService.current;
      const name = cur
        ? tr('system.ctxSimilarTo', { title: cur.title })
        : tr('system.ctxSuggested');
      if (s?.kind === 'local') {
        return PlayerService.playQueue([s.t], 0, name, false);
      }
      const r = s && found?.similar.online[s.i];
      if (r) return PlayerService.playOnline(r, name);
    }
  }
}

let started = false;

export function startBubbleBridge() {
  if (!Native || started) return;
  started = true;
  new NativeEventEmitter(NativeModules.StashBubble).addListener(
    'StashBubble',
    e => {
      whileAway(() => onEvent(e as BubbleEvent)).catch(() => {});
    },
  );

  pushConfig();
  PlayerService.subscribe(pushPlayback);
  // Native moves the ring itself; resync every few seconds and on seeks.
  let lastPos = 0;
  PlayerService.subscribeProgress(() => {
    const { position } = PlayerService.getProgress();
    if (Math.abs(position - lastPos) >= 3 || position < lastPos) {
      lastPos = position;
      pushPlayback();
    }
  });
  subscribeLibrarySnapshot(pushLists);
  subscribeNetwork(() => {
    pushLists();
    loadSuggestions();
  });
  subscribeSettings(() => {
    pushConfig();
    pushPlayback();
    lastLists = '';
    pushLists();
    loadSuggestions();
  });
  // The card's texts and the "Offline" tags are sent as text: resend them.
  onLanguageChange(pushLists);
  AppState.addEventListener('change', async state => {
    if (state !== 'active') return;
    if (awaitingPermission) {
      awaitingPermission = false;
      if (await Native.canDrawOverlays())
        saveSettings({ floatingBubble: true });
    } else if (
      getSettings().floatingBubble &&
      !(await Native.canDrawOverlays())
    ) {
      // Permission taken away in system settings: show the setting as off.
      saveSettings({ floatingBubble: false });
    }
  });
}
