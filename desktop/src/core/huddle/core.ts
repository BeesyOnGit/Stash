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
  genre?: string | null;
  /** A short message from whoever added it, shown when it starts. */
  shout?: string | null;
}

export interface HuddleMember {
  id: string;
  name: string;
  color: number;
  /** Has the current song cached. */
  ready: boolean;
  /** Reactions sent. */
  reacts: number;
  /** `"key emoji"`: what they reacted to and how (for taste match). */
  likes: string[];
  /** In the voice chat. */
  voice: boolean;
}

export interface HuddleChat {
  id: number;
  at: number;
  kind: 'msg' | 'start' | 'join' | 'leave' | 'add' | 'move' | 'emos' | 'round' | 'game';
  who: string;
  name: string;
  color: number;
  text: string;
  /** Reactions on a message: emoji → member ids. */
  rx: Record<string, string[]>;
  edited: boolean;
}

export interface GameOpt {
  title: string;
  artist: string | null;
}

/** A round of Guess the song. */
export interface HuddleGame {
  by: string;
  byName: string;
  byColor: number;
  round: number;
  opts: GameOpt[];
  /** Server ms the guessing started (0 while everyone gets the song) and ends. */
  start: number;
  end: number;
  phase: 'ask' | 'reveal';
  answered: string[];
  picks: { who: string; opt: number; at: number }[] | null;
  answer: number | null;
  results: { who: string; pts: number }[];
}

export interface HuddleScore {
  id: string;
  name: string;
  color: number;
  pts: number;
}

export interface HuddleRecap {
  started: number;
  played: string[];
  msgs: number;
  bestStreak: number;
  topKey: string | null;
  topN: number;
  topEmoji: string | null;
  topEmojiN: number;
  mvp: { name: string; color: number; n: number } | null;
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
  game: HuddleGame | null;
  scores: HuddleScore[];
  recap: HuddleRecap;
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
  /** The same emoji 3+ times in a row from anyone: a big burst. */
  burst: { id: number; emoji: string; n: number; at: number } | null;
  /** The current song's shoutout, popped up when it starts. */
  shout: { key: string; at: number } | null;
  /** Voice chat, while you're in it (or joining). */
  voice: VoiceView | null;
}

export interface VoiceView {
  /** False while joining. */
  live: boolean;
  /** Member ids in the call (you too), who's talking and who's muted. */
  ids: string[];
  speaking: string[];
  mutedIds: string[];
  muted: boolean;
  /** Lower the music while the others talk. */
  duck: boolean;
}

/** Who's in the call, from the voice server (its identities are member ids). */
export interface VoiceUpdate {
  ids: string[];
  speaking: string[];
  muted: string[];
}

export interface VoiceCall {
  setMuted(muted: boolean): Promise<void>;
  leave(): void;
}

/** Who you are in a huddle: this device, a name and a colour. */
export interface HuddleMe {
  name: string;
  color: number;
}

/** What the huddle needs from the app around it. */
export interface HuddleHost {
  serverUrl(): string;
  /** Stays the same on this device: you're the same member when you reconnect. */
  deviceId(): string;
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
  /** Voice chat; missing where this device can't do it. */
  voice?: {
    /** Joins the call with the mic on. `ended` fires if the call drops for good. */
    connect(url: string, token: string, on: { update(u: VoiceUpdate): void; ended(): void }): Promise<VoiceCall>;
    /** The music's level while ducking, 0..1 (1 = as set). */
    duck(level: number): void;
    /** A short sound: someone joined (up) or left the call. */
    chime(up: boolean): void;
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
/** The music's level while the others talk, and how long it waits after they stop. */
const DUCK_LEVEL = 0.3;
const DUCK_HOLD_MS = 800;

export const HUDDLE_COLORS = ['#E0532F', '#8B5CF6', '#2F80C2', '#2E9D62', '#D99A2B', '#D6457A', '#0FA3A3', '#6B6A70'];
export const huddleColor = (i: number) => HUDDLE_COLORS[i % HUDDLE_COLORS.length];

export function createHuddle(host: HuddleHost) {
  const empty = { room: null, you: null, cache: {}, floats: [], mine: {}, burst: null, shout: null, voice: null };
  let view: HuddleView = { status: 'idle', error: null, ...empty };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HuddleView>) => {
    view = { ...view, ...patch };
    listeners.forEach(fn => fn());
  };

  let ws: WebSocket | null = null;
  /** How to (re)connect: the code once known, the room name for creating. */
  let joinWith: { name: string; id: string; color: string; code?: string; create?: string } | null = null;
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
  /** Round already reported ended, and when this device saw its reveal. */
  let endSent = 0;
  let revealSeen: { round: number; at: number; sent: boolean } | null = null;
  let call: VoiceCall | null = null;
  /** Bumped on every join and leave: callbacks from an older call are ignored. */
  let voiceGen = 0;
  let duckOn = true;
  let duckLevel = 1;
  let duckFade: ReturnType<typeof setInterval> | null = null;
  let duckHold: ReturnType<typeof setTimeout> | null = null;

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
        joinWith = { ...joinWith!, create: undefined, code: msg.code };
        set({ status: 'live', error: null, you: msg.you });
        bestRtt = Infinity;
        for (let i = 0; i < 5; i++) setTimeout(ping, i * 250);
        // A reconnection is a new member: say again what's on this device.
        for (const k of paths.keys()) send({ t: 'ready', key: k });
        if (view.voice?.live) send({ t: 'voice', on: true });
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

  function onReact(m: { who: string; name: string; color: number; emoji: string; streak: number }) {
    const now = Date.now();
    const floats = [
      ...view.floats.filter(f => now - f.at < 3300),
      { id: ++floatSeq, emoji: m.emoji, name: m.name, color: m.color, x: Math.random() * 50, at: now },
    ].slice(-24);
    const mine = m.who === view.you ? { ...view.mine, [m.emoji]: true as const } : view.mine;
    const b = view.burst;
    const burst = m.streak >= 3 ? { id: b && b.emoji === m.emoji && now - b.at < 2600 ? b.id : ++floatSeq, emoji: m.emoji, n: m.streak, at: now } : b;
    set({ floats, mine, burst });
  }

  function start(me: HuddleMe, how: { code?: string; create?: string }) {
    leave(false);
    joinWith = { name: me.name, color: String(me.color), id: host.deviceId(), ...how };
    set({ status: 'connecting', error: null, ...empty });
    host.player.setRemote(remote);
    pingTimer = setInterval(ping, PING_EVERY_MS);
    tickTimer = setInterval(() => {
      sync();
      if (view.floats.length && Date.now() - view.floats[0].at > 3300)
        set({ floats: view.floats.filter(f => Date.now() - f.at < 3300) });
      if (view.burst && Date.now() - view.burst.at > 2000) set({ burst: null });
      gameTick();
    }, 1000);
    connect();
  }

  function leave(stopPlayer = true) {
    const wasIn = !!joinWith || !!view.room;
    leaveVoice();
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
    set({ status: 'idle', ...empty });
  }

  /** Every member's countdown reports the end; the server takes the first in time. */
  function gameTick() {
    const g = view.room?.game;
    if (!g) return;
    if (g.phase === 'ask' && g.start && serverNow() >= g.end && endSent !== g.round) {
      endSent = g.round;
      send({ t: 'gameEnd' });
    }
    if (g.phase === 'reveal') {
      if (revealSeen?.round !== g.round) revealSeen = { round: g.round, at: Date.now(), sent: false };
      if (!revealSeen.sent && Date.now() - revealSeen.at > 6000) {
        revealSeen.sent = true;
        send({ t: 'gameClose' });
      }
    }
  }

  // ---------- room state ----------

  function onState(room: RoomState) {
    const prev = view.room;
    const cur = room.queue[room.index];
    if (cur?.key !== mineFor) {
      // A song changed (not on the first state: no shoutout for what was already on).
      const shout = prev && cur?.shout && !room.game ? { key: cur.key, at: Date.now() } : view.shout;
      mineFor = cur?.key ?? null;
      view = { ...view, mine: {}, shout };
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

  // ---------- voice chat ----------

  /** Joins the call: a token from the huddle server (members only), then the voice server. */
  async function joinVoice(): Promise<boolean> {
    const code = view.room?.code;
    if (!host.voice || !code || !view.you || view.voice) return !!view.voice;
    const gen = ++voiceGen;
    const current = () => gen === voiceGen && !!view.voice;
    /** Who was in the call at the last update, once we're in it. */
    let known: string[] | null = null;
    set({ voice: { live: false, ids: [], speaking: [], mutedIds: [], muted: false, duck: duckOn } });
    try {
      const res = await fetch(`${base()}/huddles/${code}/voice?id=${encodeURIComponent(view.you)}`);
      if (!res.ok) throw new Error(`voice token: HTTP ${res.status}`);
      const { url, token } = await res.json();
      if (!current()) return false; // left meanwhile
      const c = await host.voice.connect(url, token, {
        update: u => {
          if (!current()) return;
          if (known) {
            if (u.ids.some(id => !known!.includes(id))) host.voice?.chime(true);
            else if (known.some(id => !u.ids.includes(id))) host.voice?.chime(false);
          }
          if (call) known = u.ids;
          set({ voice: { ...view.voice!, ids: u.ids, speaking: u.speaking, mutedIds: u.muted } });
          duckForSpeakers();
        },
        ended: () => current() && leaveVoice(),
      });
      if (!current()) {
        c.leave();
        return false;
      }
      call = c;
      known = view.voice!.ids;
      host.voice.chime(true);
      set({ voice: { ...view.voice!, live: true } });
      send({ t: 'voice', on: true });
      return true;
    } catch (e) {
      console.warn("Huddle: couldn't join voice", e);
      if (gen === voiceGen) set({ voice: null });
      return false;
    }
  }

  function leaveVoice() {
    voiceGen++;
    if (call) {
      send({ t: 'voice', on: false });
      host.voice?.chime(false);
    }
    call?.leave();
    call = null;
    if (view.voice) set({ voice: null });
    duckForSpeakers();
  }

  async function toggleMute() {
    const v = view.voice;
    if (!v || !call) return;
    set({ voice: { ...v, muted: !v.muted } });
    await call.setMuted(!v.muted).catch(() => view.voice && set({ voice: { ...view.voice, muted: v.muted } }));
  }

  function toggleDuck() {
    duckOn = !duckOn;
    if (view.voice) set({ voice: { ...view.voice, duck: duckOn } });
    duckForSpeakers();
  }

  /** Music down while someone else talks; back up a moment after they stop (right away out of the call). */
  function duckForSpeakers() {
    const v = view.voice;
    const down = !!v?.duck && v.speaking.some(id => id !== view.you);
    if (duckHold) clearTimeout(duckHold);
    duckHold = null;
    if (down) fadeMusic(DUCK_LEVEL);
    else if (duckLevel !== 1) duckHold = setTimeout(() => fadeMusic(1), v ? DUCK_HOLD_MS : 0);
  }

  function fadeMusic(target: number) {
    if (duckFade) clearInterval(duckFade);
    duckFade = setInterval(() => {
      const step = Math.min(0.07, Math.abs(target - duckLevel));
      duckLevel = Math.round((duckLevel + Math.sign(target - duckLevel) * step) * 100) / 100;
      host.voice?.duck(duckLevel);
      if (duckLevel === target && duckFade) {
        clearInterval(duckFade);
        duckFade = null;
      }
    }, 40);
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
    create: (me: HuddleMe, roomName: string) => start(me, { create: roomName }),
    join: (me: HuddleMe, code: string) => start(me, { code: code.toUpperCase() }),
    leave: () => leave(true),
    clearError: () => set({ error: null }),
    remote,
    addOnline,
    remove: (key: string) => send({ t: 'remove', key }),
    move: (from: number, to: number) => send({ t: 'move', from, to }),
    chat: (text: string) => text.trim() && send({ t: 'chat', text }),
    react: (emoji: string) => send({ t: 'react', emoji }),
    setEmos: (list: string[]) => send({ t: 'emos', list }),
    chatReact: (id: number, emoji: string) => send({ t: 'chatReact', id, emoji }),
    chatEdit: (id: number, text: string) => text.trim() && send({ t: 'chatEdit', id, text }),
    /** Starts a round of Guess the song with a song from the shared playlist. */
    startGame: (key: string, decoys: GameOpt[]) => send({ t: 'gameStart', key, decoys }),
    guess: (opt: number) => send({ t: 'guess', opt }),
    closeShout: () => set({ shout: null }),
    /** Can this device do voice chat? */
    canVoice: !!host.voice,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDuck,
    serverNow,
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

/** The emoji picker (chat and the host's reaction editor): [name key, icon, emojis]. */
export const EMO_CATS: [string, string, string[]][] = [
  ['smileys', '😀', ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤐','🤨','😐','😏','😒','🙄','😬','😌','😔','😪','😴','😷','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','💀','👻','👽','🤖','💩','🙈','🙉','🙊']],
  ['gestures', '👋', ['👍','👎','👏','🙌','👐','🤲','🤝','🙏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','👌','🤌','🤏','💪','🫶','🫡','👀','💃','🕺','🙋','🙆','🙅','🤷','🤦']],
  ['hearts', '❤️', ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💖','💗','💓','💞','💕','💘','💝','💔','❣️','💯','💢','💥','💫','💦','💨']],
  ['party', '🎶', ['🎶','🎵','🎤','🎧','🎸','🎹','🥁','🎷','🎺','🎻','🪗','📻','🎼','🎉','🎊','🥳','🎈','🎁','🪩','✨','🌟','⭐','🔥','⚡','🏆','🥇','🎯','🎮','🎬','📸']],
  ['nature', '🌸', ['☀️','🌙','🌈','☁️','🌧️','❄️','🌊','🌸','🌹','🌻','🌴','🍀','🍁','🌵','🐶','🐱','🦊','🐻','🐼','🐸','🦄','🐝','🦋','🐙']],
  ['food', '🍕', ['🍕','🍔','🍟','🌮','🍣','🍜','🍩','🍪','🎂','🍰','🍫','🍿','🍓','🍉','🍑','🥑','☕','🧋','🍹','🍸','🍷','🍺','🥂','🧃']],
];
export const EMO_LIB = [...new Set(EMO_CATS.flatMap(c => c[2]))];
/** Quick reactions on a chat message. */
export const QUICK_EMOS = ['❤️', '😂', '🔥', '👍', '😮', '😭'];

/** How much your reactions and theirs agree, 0..100; null until both reacted. */
export function tasteMatch(room: RoomState, you: string | null, id: string): number | null {
  const a = new Set(room.members.find(m => m.id === you)?.likes ?? []);
  const b = new Set(room.members.find(m => m.id === id)?.likes ?? []);
  if (!a.size || !b.size) return null;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return Math.round((100 * both) / (a.size + b.size - both));
}

const MOODS: Record<string, string> = {
  electronic: 'electric', dance: 'electric', house: 'electric', techno: 'electric', pop: 'bright', indie: 'dreamy',
  'hip-hop': 'bouncy', 'hip hop': 'bouncy', rap: 'bouncy', rock: 'loud', metal: 'loud', jazz: 'smoky', classical: 'calm',
  'r&b': 'smooth', soul: 'warm', folk: 'cosy', ambient: 'floaty', funk: 'groovy', alternative: 'moody',
};
/** The room's mood from the song's genre (a key for huddle.vibe.*). */
export function vibeOf(genre: string | null | undefined): string {
  const g = (genre ?? '').toLowerCase();
  return Object.entries(MOODS).find(([k]) => g.includes(k))?.[1] ?? 'chill';
}

type Pickable = { title: string; artist: string | null; genre?: string | null };
/** Up to 3 wrong answers that sound like the right one: same artist first, then same genre. */
export function pickDecoys(right: Pickable, pool: Pickable[]): GameOpt[] {
  const seen = new Set([right.title.toLowerCase()]);
  const score = (x: Pickable) => (x.artist && x.artist === right.artist ? 2 : 0) + (x.genre && x.genre === right.genre ? 1.2 : 0) + Math.random() * 0.9;
  return pool
    .map(x => ({ x, k: score(x) }))
    .sort((a, b) => b.k - a.k)
    .filter(({ x }) => !seen.has(x.title.toLowerCase()) && !!seen.add(x.title.toLowerCase()))
    .slice(0, 3)
    .map(({ x }) => ({ title: x.title, artist: x.artist }));
}
export const DEFAULT_EMOS = ['❤️', '👍', '🎉', '👏', '😂', '😮', '🔥'];
