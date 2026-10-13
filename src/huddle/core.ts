/**
 * Huddle: listen together, same song, same second. Same file in both apps.
 *
 * The server (huddle_api/) keeps the room in memory: the shared playlist, the
 * shared controls and the clock. Songs are shared by their link (source +
 * id): every member resolves and downloads each one with this app's own
 * sources before it plays, and the server only starts a song once all members
 * have it, a moment in the future so everyone begins together. Here:
 * the connection, the clock offset, the cache queue and keeping the local
 * player on the room's timeline. Platform parts come in through `HuddleHost`.
 */

export interface SharedTrack {
  /** `${source}:${sourceId}`, like the library's track ids. */
  key: string;
  source: string;
  sourceId: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  artwork: string | null;
  by: string;
  byName: string;
  byColor: number;
}

export interface HuddleMember {
  id: string;
  name: string;
  color: number;
  /** Has the current song cached. */
  ready: boolean;
}

export interface HuddleChat {
  id: number;
  at: number;
  kind: 'msg' | 'start' | 'join' | 'leave' | 'add' | 'move' | 'emos';
  who: string;
  name: string;
  color: number;
  text: string;
}

export interface HuddleLast {
  name: string;
  color: number;
  action: 'played' | 'paused' | 'resumed' | 'skipped' | 'back' | 'seek';
  arg: string;
  at: number;
}

export interface RoomState {
  code: string;
  name: string;
  host: string;
  members: HuddleMember[];
  queue: SharedTrack[];
  index: number;
  playing: boolean;
  /** Play was pressed; waiting for everyone to have the song. */
  pending: boolean;
  /** Seconds at server time `at` (ms). */
  pos: number;
  at: number;
  chat: HuddleChat[];
  reactions: Record<string, number> | null;
  emos: string[];
  last: HuddleLast | null;
}

/** A reaction flying up the screen. */
export interface HuddleFloat {
  id: number;
  emoji: string;
  name: string;
  color: number;
  x: number;
  at: number;
}

export type HuddleStatus = 'idle' | 'connecting' | 'live' | 'reconnecting';
/** Error codes; the screens translate them. */
export type HuddleError = 'not_found' | 'full' | 'unreachable';

export type CacheState = number | 'done' | 'failed';

export interface HuddleView {
  status: HuddleStatus;
  error: HuddleError | null;
  you: string | null;
  room: RoomState | null;
  /** Per track key: download progress 0..1, done or failed. */
  cache: Record<string, CacheState>;
  floats: HuddleFloat[];
  /** Reactions you sent for the current song (highlighted in the tray). */
  mine: Record<string, true>;
}

/** What the huddle needs from the app around it. */
export interface HuddleHost {
  serverUrl(): string;
  /** The song on this device: from the library if it's there, else resolved and downloaded into the huddle cache. Returns its path. */
  cache(t: SharedTrack, onProgress: (p: number) => void): Promise<string>;
  clearCache(): Promise<void>;
  /** The local player, driven by the room. */
  player: {
    /** Puts the huddle's songs in the queue and loads `index` without playing. */
    load(items: { track: SharedTrack; path: string | null }[], index: number): Promise<void>;
    play(): void;
    pause(): void;
    seek(seconds: number): void;
    position(): number;
    isPlaying(): boolean;
    /** While set, the app's play/pause/next/seek buttons go to the room. */
    setRemote(remote: HuddleRemote | null): void;
    stop(): void;
  };
}

export interface HuddleRemote {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  skipTo(index: number): void;
  ended(): void;
}

/** Off by more than this, the local player jumps back onto the room's timeline. */
const DRIFT_S = 0.45;
/** Drift is ignored this long after a seek (the player settles). */
const SETTLE_MS = 1500;
const PING_EVERY_MS = 10_000;
const RETRY_MS = 3000;

export const HUDDLE_COLORS = ['#E0532F', '#8B5CF6', '#2F80C2', '#2E9D62', '#D99A2B', '#D6457A', '#0FA3A3', '#6B6A70'];
export const huddleColor = (i: number) => HUDDLE_COLORS[i % HUDDLE_COLORS.length];

export function createHuddle(host: HuddleHost) {
  let view: HuddleView = { status: 'idle', error: null, you: null, room: null, cache: {}, floats: [], mine: {} };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HuddleView>) => {
    view = { ...view, ...patch };
    listeners.forEach(fn => fn());
  };

  let ws: WebSocket | null = null;
  /** How to (re)connect: the code once known, the room name for creating. */
  let joinWith: { name: string; code?: string; create?: string } | null = null;
  let offset = 0;
  let bestRtt = Infinity;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  /** Local paths of cached songs, by key. */
  const paths = new Map<string, string>();
  let caching: string | null = null;
  let loadedKey: string | null = null;
  let loading = false;
  let settleUntil = 0;
  let floatSeq = 0;
  let mineFor: string | null = null;

  const serverNow = () => Date.now() + offset;
  const base = () => host.serverUrl().replace(/\/+$/, '');
  const send = (msg: object) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  };

  // ---------- connection ----------

  function connect() {
    if (!joinWith) return;
    const url = base();
    const q = Object.entries(joinWith)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join('&');
    const sock = new WebSocket(`${url.replace(/^http/, 'ws')}/huddles/ws?${q}`);
    ws = sock;
    let welcomed = false;
    sock.onmessage = e => {
      if (ws !== sock) return;
      const msg = JSON.parse(String(e.data));
      if (msg.t === 'welcome') {
        welcomed = true;
        joinWith = { name: joinWith!.name, code: msg.code };
        set({ status: 'live', error: null, you: msg.you });
        bestRtt = Infinity;
        for (let i = 0; i < 5; i++) setTimeout(ping, i * 250);
        // A reconnection is a new member: say again what's on this device.
        for (const k of paths.keys()) send({ t: 'ready', key: k });
      } else if (msg.t === 'state') onState(msg as RoomState);
      else if (msg.t === 'pong') onPong(msg.c, msg.s);
      else if (msg.t === 'react') onReact(msg);
      else if (msg.t === 'error') {
        leave(false);
        set({ error: msg.message });
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (!joinWith) return; // left, or refused (error above)
      if (!welcomed && !view.room) {
        leave(false);
        set({ error: 'unreachable' });
        return;
      }
      set({ status: 'reconnecting' });
      retryTimer = setTimeout(connect, RETRY_MS);
    };
  }

  function ping() {
    send({ t: 'ping', c: Date.now() });
  }

  function onPong(c: number, s: number) {
    const now = Date.now();
    const rtt = now - c;
    // The quickest round trip gives the most accurate clock.
    if (rtt <= bestRtt) {
      bestRtt = rtt;
      offset = s - (c + rtt / 2);
    }
  }

  function onReact(m: { who: string; name: string; color: number; emoji: string }) {
    const now = Date.now();
    const floats = [
      ...view.floats.filter(f => now - f.at < 3300),
      { id: ++floatSeq, emoji: m.emoji, name: m.name, color: m.color, x: Math.random() * 50, at: now },
    ].slice(-24);
    const mine = m.who === view.you ? { ...view.mine, [m.emoji]: true as const } : view.mine;
    set({ floats, mine });
  }

  function start(name: string, how: { code?: string; create?: string }) {
    leave(false);
    joinWith = { name, ...how };
    set({ status: 'connecting', error: null, room: null, you: null, cache: {}, floats: [], mine: {} });
    host.player.setRemote(remote);
    pingTimer = setInterval(ping, PING_EVERY_MS);
    tickTimer = setInterval(() => {
      sync();
      if (view.floats.length && Date.now() - view.floats[0].at > 3300)
        set({ floats: view.floats.filter(f => Date.now() - f.at < 3300) });
    }, 1000);
    connect();
  }

  function leave(stopPlayer = true) {
    const wasIn = !!joinWith || !!view.room;
    joinWith = null;
    ws?.close();
    ws = null;
    for (const t of [pingTimer, tickTimer]) if (t) clearInterval(t);
    for (const t of [retryTimer, startTimer]) if (t) clearTimeout(t);
    pingTimer = tickTimer = retryTimer = startTimer = null;
    loadedKey = null;
    paths.clear();
    caching = null;
    host.player.setRemote(null);
    if (wasIn) {
      if (stopPlayer) host.player.stop();
      host.clearCache().catch(() => {});
    }
    set({ status: 'idle', room: null, you: null, cache: {}, floats: [], mine: {} });
  }

  // ---------- room state ----------

  function onState(room: RoomState) {
    const prev = view.room;
    const cur = room.queue[room.index];
    if (cur?.key !== mineFor) {
      mineFor = cur?.key ?? null;
      view = { ...view, mine: {} };
    }
    // Cache entries for songs no longer in the list are forgotten.
    const keys = new Set(room.queue.map(t => t.key));
    const cache: Record<string, CacheState> = {};
    for (const [k, v] of Object.entries(view.cache)) if (keys.has(k)) cache[k] = v;
    set({ room, cache });
    // The playlist changed under the player: reload it so Up next matches.
    if (prev && cur && loadedKey === cur.key && prev.queue.map(t => t.key).join() !== room.queue.map(t => t.key).join())
      loadedKey = null;
    pump();
    sync();
  }

  /** Caches the songs one at a time: the current one first, then what comes next. */
  async function pump() {
    const room = view.room;
    if (!room || caching) return;
    const order = [...room.queue.slice(room.index), ...room.queue.slice(0, room.index).reverse()];
    const next = order.find(t => view.cache[t.key] === undefined);
    if (!next) return;
    caching = next.key;
    set({ cache: { ...view.cache, [next.key]: 0 } });
    let ok = false;
    try {
      const path = await host.cache(next, p => {
        if (caching === next.key) set({ cache: { ...view.cache, [next.key]: Math.min(0.99, p) } });
      });
      if (caching !== next.key) return; // left meanwhile
      paths.set(next.key, path);
      ok = true;
    } catch (e) {
      console.warn(`Huddle: couldn't cache ${next.title}`, e);
    }
    if (caching !== next.key) return;
    caching = null;
    set({ cache: { ...view.cache, [next.key]: ok ? 'done' : 'failed' } });
    // A failed song is "ready" too: this device just stays silent, the others aren't held up.
    send({ t: 'ready', key: next.key });
    sync();
    pump();
  }

  /** Keeps the local player on the room's timeline. Runs on every state and every second. */
  async function sync() {
    const room = view.room;
    if (!room || loading) return;
    const cur = room.queue[room.index];
    if (!cur) {
      if (host.player.isPlaying()) host.player.pause();
      return;
    }
    const path = paths.get(cur.key) ?? null;
    if (loadedKey !== cur.key) {
      if (host.player.isPlaying()) host.player.pause();
      if (!path) return;
      loading = true;
      try {
        await host.player.load(
          room.queue.map(t => ({ track: t, path: paths.get(t.key) ?? null })),
          room.index,
        );
        loadedKey = cur.key;
        settleUntil = 0;
      } finally {
        loading = false;
      }
      return sync();
    }
    if (!path) return;

    const now = serverNow();
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
    if (!room.playing) {
      if (host.player.isPlaying()) host.player.pause();
      if (Math.abs(host.player.position() - room.pos) > DRIFT_S) host.player.seek(room.pos);
      return;
    }
    if (room.at > now) {
      // Everyone starts at the same instant, a moment from now.
      if (host.player.isPlaying()) host.player.pause();
      host.player.seek(room.pos);
      startTimer = setTimeout(() => {
        startTimer = null;
        settleUntil = Date.now() + SETTLE_MS;
        host.player.play();
      }, room.at - now);
      return;
    }
    const expected = room.pos + (now - room.at) / 1000;
    if (cur.duration && expected >= cur.duration) return; // the "ended" is on its way
    if (!host.player.isPlaying()) {
      host.player.seek(expected);
      settleUntil = Date.now() + SETTLE_MS;
      host.player.play();
    } else if (Date.now() > settleUntil && Math.abs(host.player.position() - expected) > DRIFT_S) {
      host.player.seek(expected);
      settleUntil = Date.now() + SETTLE_MS;
    }
  }

  // ---------- the app's buttons, sent to the room ----------

  const remote: HuddleRemote = {
    play: () => send({ t: 'play' }),
    pause: () => send({ t: 'pause' }),
    next: () => send({ t: 'next' }),
    previous: () => send({ t: 'prev' }),
    seek: seconds => send({ t: 'seek', pos: seconds }),
    skipTo: index => send({ t: 'jump', index }),
    ended: () => view.room && send({ t: 'ended', index: view.room.index }),
  };

  /** Shares a song by its link: every member fetches it from the same source. */
  function addOnline(t: Omit<SharedTrack, 'key' | 'by' | 'byName' | 'byColor'>) {
    send({ t: 'add', track: { ...t, key: `${t.source}:${t.sourceId}` } });
  }

  return {
    getView: () => view,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    create: (name: string, roomName: string) => start(name, { create: roomName }),
    join: (name: string, code: string) => start(name, { code: code.toUpperCase() }),
    leave: () => leave(true),
    clearError: () => set({ error: null }),
    remote,
    addOnline,
    remove: (key: string) => send({ t: 'remove', key }),
    move: (from: number, to: number) => send({ t: 'move', from, to }),
    chat: (text: string) => text.trim() && send({ t: 'chat', text }),
    react: (emoji: string) => send({ t: 'react', emoji }),
    setEmos: (list: string[]) => send({ t: 'emos', list }),
    /** Is this song (by library id) already in the shared playlist? */
    has: (key: string) => !!view.room?.queue.some(t => t.key === key),
    /** Where the room is right now (for the seek bar). */
    position: () => {
      const r = view.room;
      if (!r) return 0;
      return r.playing ? Math.max(r.pos, r.pos + (serverNow() - r.at) / 1000) : r.pos;
    },
  };
}

export type Huddle = ReturnType<typeof createHuddle>;

export const EMO_LIB = ['❤️', '👍', '🎉', '👏', '😂', '😮', '🔥', '😍', '🥹', '😭', '🤯', '🙌', '💃', '🕺', '🎶', '🎸', '🥁', '🎤', '✨', '💯', '👀', '🤘', '😎', '🫶', '💀', '🥳', '😴', '👎', '🤔', '🌊', '🌙', '☀️'];
export const DEFAULT_EMOS = ['❤️', '👍', '🎉', '👏', '😂', '😮', '🔥'];
