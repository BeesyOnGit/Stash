/**
 * The mini vinyl player (the phone app's floating bubble), main-window side.
 *
 * It's its own small, always-on-top, transparent window (label "mini",
 * mini.html). It shows while stash is minimised or closed to the tray, a song
 * is loaded, Settings → Mini vinyl player is on and it wasn't dismissed. This
 * side sends it what to draw ("mini-state") and runs what it asks ("mini-cmd").
 */
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Window } from '@tauri-apps/api/window';
import { tr } from '../core/i18n';
import { getLibrarySnapshot, subscribeLibrarySnapshot } from '../core/player/hooks';
import { PlayerService } from '../core/player/PlayerService';
import { getSettings, subscribeSettings } from '../core/services/settings';
import { similarFor } from '../core/services/similar';
import { sourceName } from '../core/sources';
import { paletteFor } from '../core/theme';
import { artworkUri, trackIdFor, type OnlineResult, type Track } from '../core/types';
import { showMainWindow } from '../core/native';
import { toast } from '../core/state/ui';
import { RING_COLORS } from './screens/SettingsScreen';
import { VINYLS } from './kit';

export interface MiniItem {
  key: string;
  title: string;
  artist: string;
  art: string | null;
  artBg: string;
  tag?: string;
  local?: boolean;
}

export interface MiniState {
  visible: boolean;
  title: string;
  artist: string;
  art: string | null;
  artBg: string;
  disc: string;
  inset: number;
  imageOpacity: number;
  spinning: boolean;
  playing: boolean;
  progress: number;
  ring: string;
  favorites: MiniItem[];
  suggestions: MiniItem[];
  words: { open: string; favorites: string; suggested: string; offline: string; empty: string; hint: string };
}

export type MiniCommand =
  | { type: 'toggle' | 'next' | 'prev' | 'open' | 'dismiss' | 'ready' }
  | { type: 'play'; key: string };

let hidden = false;
let minimized = false;
let dismissed = false;
let suggestions: Array<{ key: string; track?: Track; result?: OnlineResult }> = [];
let suggestionsFor: string | null = null;
let shown = false;

const mini = () => Window.getByLabel('mini');

function item(t: { title: string; artist: string | null }, art: string | null, key: string, extra?: Partial<MiniItem>): MiniItem {
  return { key, title: t.title, artist: t.artist ?? tr('common.unknownArtist'), art, artBg: paletteFor(t, art).artBg, ...extra };
}

function stateNow(): MiniState {
  const s = getSettings();
  const { queue, index, isPlaying } = PlayerService.getState();
  const cur = queue[index] ?? null;
  const art = cur ? artworkUri(cur) : null;
  const pal = cur ? paletteFor(cur, art) : paletteFor({ title: '', artist: null });
  const { duration, position } = PlayerService.getProgress();
  const v = VINYLS[s.vinylStyle];
  const liked = getLibrarySnapshot().tracks.filter(t => t.liked && t.status === 'ready');
  const visible = (hidden || minimized) && !dismissed && !!cur && s.floatingBubble;
  return {
    visible,
    title: cur?.title ?? '',
    artist: cur?.artist ?? '',
    art,
    artBg: pal.artBg,
    disc: v.disc ?? pal.deep,
    inset: v.bubbleInset,
    imageOpacity: v.op,
    spinning: isPlaying && s.rotateArt,
    playing: isPlaying,
    progress: duration > 0 ? Math.min(1, position / duration) : 0,
    ring: s.bubbleRingColor === 'cover' ? pal.accent : RING_COLORS[s.bubbleRingColor],
    favorites: liked.slice(0, 6).map(t => item(t, artworkUri(t), `fav:${t.id}`)),
    suggestions: s.suggestSimilar
      ? suggestions.map(x =>
          x.track
            ? item(x.track, artworkUri(x.track), x.key, { tag: tr('system.offline'), local: true })
            : item(x.result!, x.result!.thumbnailUrl, x.key, { tag: sourceName(x.result!.source) }),
        )
      : [],
    words: {
      open: tr('system.bubbleOpen'),
      favorites: tr('system.bubbleFavorites'),
      suggested: tr('sheets.suggested'),
      offline: tr('system.offline'),
      empty: tr('desktop.miniEmpty'),
      hint: tr('system.bubbleHint'),
    },
  };
}

let sendTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;
function send() {
  if (sendTimer) return;
  const wait = Math.max(0, 250 - (Date.now() - lastSent));
  sendTimer = setTimeout(async () => {
    sendTimer = null;
    lastSent = Date.now();
    const st = stateNow();
    if (!st.visible && !shown) return;
    await refreshSuggestions();
    emitTo('mini', 'mini-state', stateNow()).catch(() => {});
    const w = await mini();
    if (!w) return;
    if (st.visible && !shown) {
      shown = true;
      await w.show().catch(() => {});
    } else if (!st.visible && shown) {
      shown = false;
      await w.hide().catch(() => {});
      (await Window.getByLabel('dismiss'))?.hide().catch(() => {});
    }
  }, wait);
}

async function refreshSuggestions() {
  const cur = PlayerService.current;
  if (!cur || cur.id === suggestionsFor || !getSettings().suggestSimilar) return;
  suggestionsFor = cur.id;
  const library = getLibrarySnapshot().tracks;
  const found = await similarFor(cur, library, { localLimit: 4, onlineLimit: 4 }).catch(() => null);
  if (!found || suggestionsFor !== cur.id) return;
  const out: typeof suggestions = [];
  for (let i = 0; out.length < 8 && (i < found.local.length || i < found.online.length); i++) {
    if (found.local[i]) out.push({ key: `sug:${found.local[i].id}`, track: found.local[i] });
    const r = found.online[i];
    if (r) out.push({ key: `sug:${trackIdFor(r.source, r.sourceId)}`, result: r });
  }
  suggestions = out;
}

async function run(cmd: MiniCommand) {
  switch (cmd.type) {
    case 'ready':
      emitTo('mini', 'mini-state', stateNow()).catch(() => {});
      return;
    case 'toggle':
      return PlayerService.togglePlay();
    case 'next':
      return PlayerService.next();
    case 'prev':
      return PlayerService.previous();
    case 'open':
      await showMainWindow();
      return;
    case 'dismiss':
      dismissed = true;
      toast(tr('desktop.miniHidden'));
      send();
      return;
    case 'play': {
      if (cmd.key.startsWith('fav:')) {
        const liked = getLibrarySnapshot().tracks.filter(t => t.liked && t.status === 'ready');
        const i = liked.findIndex(t => `fav:${t.id}` === cmd.key);
        if (i >= 0) PlayerService.playQueue(liked, i, tr('system.ctxLiked'));
      } else {
        const s = suggestions.find(x => x.key === cmd.key);
        if (s?.track) PlayerService.playQueue([s.track], 0, tr('system.ctxSuggested'), false);
        else if (s?.result) PlayerService.playOnline(s.result, tr('system.ctxSuggested'));
      }
    }
  }
}

/** Starts following the main window and the player. */
export function startMiniBridge() {
  const win = getCurrentWindow();
  const check = async () => {
    const m = await win.isMinimized().catch(() => false);
    const v = await win.isVisible().catch(() => true);
    const wasAway = hidden || minimized;
    minimized = m;
    hidden = !v;
    // Back in the app: the next time it goes away, the mini player comes back.
    if (wasAway && !hidden && !minimized) dismissed = false;
    send();
  };
  win.onResized(check);
  win.onFocusChanged(check);
  listen('main-hidden', () => {
    hidden = true;
    send();
  });
  listen('main-shown', () => {
    hidden = false;
    minimized = false;
    dismissed = false;
    send();
  });
  listen<MiniCommand>('mini-cmd', e => run(e.payload));
  PlayerService.subscribe(send);
  PlayerService.subscribeProgress(send);
  subscribeSettings(send);
  subscribeLibrarySnapshot(send);
  check();
}
