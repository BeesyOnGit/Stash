/**
 * One app-wide audio player living outside React, so playback (and moving to
 * the next song) keeps working with the window minimised or closed to the tray.
 *
 * The engine is the web view's own <audio>: local files through the asset
 * protocol, online songs straight from their stream URL. The next song is
 * loaded in a second, silent element before this one ends (no gap), which is
 * also what crossfades. The OS media controls (keyboard media keys, the
 * Windows media flyout, macOS Now Playing) come from the Media Session API.
 */
import {
  addListening,
  countPlay,
  getAllTracks,
  getTrack,
  updateTrack,
  upsertTrack,
} from '../db/database';
import { tr } from '../i18n';
import { fileSrc } from '../native';
import { ensureArtwork } from '../services/artwork';
import { downloadTrack, isDownloading } from '../services/downloader';
import { lyricsFor } from '../services/lyrics';
import { getSettings, saveSettings, SPEEDS } from '../services/settings';
import { similarFor } from '../services/similar';
import { estimateBytes, fitsInStorage } from '../services/storage';
import { sourceFor, sourceName } from '../sources';
import { toast } from '../state/ui';
import {
  artworkUri,
  trackFromResult,
  trackIdFor,
  type OnlineResult,
  type QueueItem,
  type ResolvedStream,
  type Track,
} from '../types';

export type RepeatMode = 'off' | 'all' | 'one';

export type MoveDir = -1 | 0 | 1;

/** Pause at a time (epoch ms), or when the current song ends. */
export type SleepTimer = { at: number } | { endOfSong: true };

/** The music fades out over the last seconds of a sleep timer. */
const SLEEP_FADE_S = 30;
/** How long before the end of a song the next one starts loading. */
const PRELOAD_BEFORE_END_S = 15;
/** A preloaded element takes about this long from play() to its first sound. */
const NEXT_START_DELAY_S = 0.1;

export interface PlayerState {
  /** The list the user started from, in its own order (used to turn shuffle off). */
  context: QueueItem[];
  /** Play order: `context` as is, or shuffled with the current song first. */
  queue: QueueItem[];
  index: number;
  /** "Playing from …" label, e.g. Library, a playlist, Search · YouTube. */
  contextName: string;
  isPlaying: boolean;
  isBuffering: boolean;
  /** True while resolving an online stream (before the player gets a URL). */
  isResolving: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Random suggestions: when the queue runs out, keep playing similar songs. */
  radio: boolean;
  sleep: SleepTimer | null;
  /** Which way the last song change went: 1 next, -1 previous, 0 a new list (for the player's animation). */
  moveDir: MoveDir;
  /** Bumped on every song change (for the change animation). */
  changeCount: number;
  error: string | null;
}

export interface Progress {
  position: number;
  duration: number;
}

type Listener = () => void;

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** YouTube stream URLs expire after ~6 hours; re-resolve before that. */
const STREAM_TTL_MS = 5 * 3600 * 1000;

class StreamCache {
  private map = new Map<string, { stream: ResolvedStream; at: number }>();
  get(id: string): ResolvedStream | undefined {
    const hit = this.map.get(id);
    if (!hit || Date.now() - hit.at > STREAM_TTL_MS) return undefined;
    return hit.stream;
  }
  set(id: string, stream: ResolvedStream) {
    this.map.set(id, { stream, at: Date.now() });
  }
}

const srcFor = (item: QueueItem) =>
  item.status === 'ready' && item.filePath
    ? fileSrc(item.filePath)
    : item.streamUrl!;

class PlayerServiceImpl {
  private player: HTMLAudioElement | null = null;

  private state: PlayerState = {
    context: [],
    queue: [],
    index: -1,
    contextName: '',
    isPlaying: false,
    isBuffering: false,
    isResolving: false,
    repeat: 'off',
    shuffle: false,
    radio: false,
    sleep: null,
    moveDir: 0,
    changeCount: 0,
    error: null,
  };
  private progress: Progress = { position: 0, duration: 0 };
  /** Seconds of the song downloaded so far as a fraction (streams), for the seek bar. */
  private buffered = 0;
  /** The song loaded last has been counted as played (see countIfListened). */
  private counted = false;
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The next song, loaded in a silent element before this one ends (see maybePreload). */
  private preloaded: { item: QueueItem; player: HTMLAudioElement } | null =
    null;
  private preloadedFor = -1;
  private moveDir: MoveDir = 0;
  private crossfadeNext = 0;
  private fading: {
    old: HTMLAudioElement;
    next: HTMLAudioElement;
    timer: ReturnType<typeof setInterval>;
  } | null = null;
  private startedNextFor = -1;
  private stateListeners = new Set<Listener>();
  private progressListeners = new Set<Listener>();
  /** Increments on every load so late async results for an old song are ignored. */
  private loadToken = 0;
  private wantsToPlay = false;
  /** Songs already picked in this run of random suggestions (no repeats). */
  private radioPlayed = new Set<string>();
  private streams = new StreamCache();

  constructor() {
    this.setupMediaSession();
  }

  // ---------- subscriptions (used by hooks via useSyncExternalStore) ----------

  getState = () => this.state;
  getProgress = () => this.progress;
  getBuffered = () => this.buffered;

  subscribe = (fn: Listener) => {
    this.stateListeners.add(fn);
    return () => {
      this.stateListeners.delete(fn);
    };
  };
  subscribeProgress = (fn: Listener) => {
    this.progressListeners.add(fn);
    return () => {
      this.progressListeners.delete(fn);
    };
  };

  private setState(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    // Queue, shuffle, repeat or sleep timer changed what plays next: load that one instead.
    if (this.preloaded && this.upcoming()?.id !== this.preloaded.item.id) {
      this.dropPreloaded();
      this.preloadedFor = -1;
    }
    this.stateListeners.forEach(fn => fn());
    this.updateMediaSession();
  }
  private setProgress(p: Progress) {
    this.progress = p;
    this.progressListeners.forEach(fn => fn());
  }

  get current(): QueueItem | null {
    return this.state.queue[this.state.index] ?? null;
  }

  // ---------- the audio elements ----------

  /** A new audio element; its events count only while it's `this.player`. */
  private createPlayer(src: string): HTMLAudioElement {
    const p = new Audio();
    p.preload = 'auto';
    p.preservesPitch = true;
    p.defaultPlaybackRate = getSettings().playbackSpeed;
    p.playbackRate = getSettings().playbackSpeed;
    const mine = () => p === this.player;
    const playing = () => {
      if (mine())
        this.setState({ isPlaying: !p.paused, isBuffering: false, error: null });
    };
    p.addEventListener('playing', playing);
    p.addEventListener('play', () => {
      if (mine()) this.setState({ isPlaying: true });
    });
    p.addEventListener('pause', () => {
      if (mine()) this.setState({ isPlaying: false, isBuffering: false });
    });
    p.addEventListener('waiting', () => {
      if (mine() && !p.paused) this.setState({ isBuffering: true });
    });
    p.addEventListener('canplay', () => {
      if (mine() && this.state.isBuffering) this.setState({ isBuffering: false });
    });
    p.addEventListener('progress', () => {
      if (!mine()) return;
      const d = p.duration;
      if (Number.isFinite(d) && d > 0 && p.buffered.length) {
        this.buffered = Math.min(1, p.buffered.end(p.buffered.length - 1) / d);
        this.progressListeners.forEach(fn => fn());
      }
    });
    p.addEventListener('timeupdate', () => {
      if (!mine()) return;
      this.setProgress({
        position: p.currentTime,
        duration: this.progress.duration,
      });
      this.countIfListened();
      this.noteListening();
      this.checkSleep();
      this.maybePreload();
      this.maybeStartNextOnTime(p.currentTime);
    });
    p.addEventListener('loadedmetadata', () => {
      if (!mine()) return;
      const d = Number.isFinite(p.duration) ? p.duration : 0;
      this.setProgress({ position: p.currentTime, duration: d });
      this.rememberDuration(d);
    });
    p.addEventListener('ended', () => {
      if (mine()) this.onTrackEnded();
    });
    p.addEventListener('error', () => {
      if (!mine()) return;
      const code = p.error?.code;
      this.setState({
        error:
          code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? tr('system.couldntPlay', { error: 'unsupported format' })
            : tr('system.playbackError'),
        isBuffering: false,
        isPlaying: false,
      });
    });
    p.src = src;
    return p;
  }

  private releasePlayer(p: HTMLAudioElement) {
    try {
      p.pause();
      p.removeAttribute('src');
      p.load();
    } catch {}
  }

  /** Files without a length in the library get it the first time they're played. */
  private rememberDuration(d: number) {
    const cur = this.current;
    if (cur && d > 0 && !cur.duration && cur.status !== 'streaming')
      updateTrack(cur.id, { duration: d }).catch(() => {});
  }

  private async streamFor(track: Track): Promise<ResolvedStream> {
    const cached = this.streams.get(track.id);
    if (cached) return cached;
    if (track.source === 'device') throw new Error(tr('system.notOnline'));
    const stream = await sourceFor(track.source).resolveStream({
      source: track.source,
      sourceId: track.sourceId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      thumbnailUrl: track.remoteArtworkUrl,
    });
    this.streams.set(track.id, stream);
    return stream;
  }

  private patchItem(id: string, patch: Partial<QueueItem>) {
    const up = (list: QueueItem[]) =>
      list.map(t => (t.id === id ? { ...t, ...patch } : t));
    this.setState({
      queue: up(this.state.queue),
      context: up(this.state.context),
    });
  }

  /** The item with something to play: its file if it's saved by now, otherwise a stream URL. */
  private async playableFor(item: QueueItem): Promise<QueueItem> {
    if (item.status === 'ready' && item.filePath) return item;
    // A song may have finished downloading since it was queued — prefer the local file.
    const fresh = await getTrack(item.id);
    if (fresh?.status === 'ready') {
      return { ...item, ...fresh, streamUrl: undefined };
    }
    if (item.streamUrl || item.source === 'device') return item;
    // Not on the computer and no URL yet (e.g. tapped while downloading): stream it again.
    const stream = await this.streamFor(item);
    return { ...item, streamUrl: stream.url, streamHeaders: stream.headers };
  }

  private async load(index: number, autoplay = true, startAt = 0) {
    const item = this.state.queue[index];
    if (!item) return;
    this.finishCrossfade();
    const token = ++this.loadToken;

    const pre = this.takePreloaded(item.id);
    if (pre && autoplay && !startAt) {
      this.swapTo(pre, index);
      return;
    }

    let playable: QueueItem;
    try {
      playable = await this.playableFor(item);
    } catch (e: any) {
      if (token === this.loadToken) {
        this.setState({
          error: tr('system.couldntPlay', { error: String(e?.message ?? e) }),
        });
      }
      return;
    }
    if (token !== this.loadToken) return;

    this.showLoaded(playable, index, true);
    const old = this.player;
    this.player = this.createPlayer(srcFor(playable));
    if (old) this.releasePlayer(old);
    if (startAt > 0) this.player.currentTime = startAt;
    this.applyLoop();
    this.applyVolume();
    if (autoplay) this.play();
  }

  /** The queue, progress and library bookkeeping for the song now loaded. */
  private showLoaded(playable: QueueItem, index: number, buffering: boolean) {
    this.saveListening();
    const queue = [...this.state.queue];
    queue[index] = playable;
    this.buffered = playable.status === 'ready' ? 1 : 0;
    this.setState({
      queue,
      index,
      error: null,
      isBuffering: buffering,
      moveDir: this.moveDir,
      changeCount: this.state.changeCount + 1,
    });
    this.moveDir = 0;
    this.setProgress({ position: 0, duration: playable.duration ?? 0 });
    this.counted = false;
    if (playable.status !== 'streaming') {
      updateTrack(playable.id, { lastPlayedAt: Date.now() }).catch(() => {});
    }
    lyricsFor(playable).catch(() => {}); // ready when the lyrics are opened
  }

  // ---------- the next song, ready before this one ends ----------

  private maybePreload() {
    const { position, duration } = this.progress;
    if (
      this.preloadedFor === this.loadToken ||
      duration <= 0 ||
      duration - position >
        Math.max(PRELOAD_BEFORE_END_S, getSettings().crossfadeSeconds + 10)
    )
      return;
    this.preloadedFor = this.loadToken;
    this.preloadNext(this.loadToken).catch(() => {});
  }

  /**
   * With the next song preloaded, it's started from the last progress ticks
   * instead of waiting for "ended": just early enough for its first sound to
   * follow the end of this one (or for the crossfade).
   */
  private maybeStartNextOnTime(position: number) {
    const pre = this.preloaded;
    const left = this.secondsLeft(position);
    const fade = this.crossfadeLength();
    const lead = fade || NEXT_START_DELAY_S;
    if (
      !pre ||
      this.startedNextFor === this.loadToken ||
      left > lead + 0.4 ||
      left <= 0 ||
      pre.item.id !== this.upcoming()?.id
    )
      return;
    const token = this.loadToken;
    this.startedNextFor = token;
    const wait = Math.max(0, (left - lead) * 1000);
    setTimeout(() => {
      // Paused, seeked or changed song meanwhile: leave it to the normal end.
      if (token !== this.loadToken || !this.player || this.player.paused) return;
      if (fade) this.crossfadeNext = Math.min(fade, this.secondsLeft());
      this.next(true);
    }, wait);
  }

  /** Seconds of real time until the song ends, at the playback speed. */
  private secondsLeft(position = this.progress.position) {
    return (this.progress.duration - position) / getSettings().playbackSpeed;
  }

  /** The crossfade setting, shortened for short songs (0 = off). */
  private crossfadeLength() {
    const s = getSettings().crossfadeSeconds;
    if (!s) return 0;
    return Math.min(s, this.progress.duration / getSettings().playbackSpeed / 3);
  }

  /**
   * The song before keeps playing, getting quieter, while the new one gets
   * louder (equal power, so the sum stays as loud).
   */
  private startCrossfade(
    old: HTMLAudioElement,
    next: HTMLAudioElement,
    seconds: number,
  ) {
    const start = Date.now();
    const step = () => {
      if (this.fading?.next !== next) return;
      const x = Math.min(1, (Date.now() - start) / (seconds * 1000));
      const level = this.level();
      next.volume = Math.sin((x * Math.PI) / 2) * level;
      old.volume = Math.cos((x * Math.PI) / 2) * level;
      if (x >= 1) this.finishCrossfade();
    };
    this.fading = { old, next, timer: setInterval(step, 50) };
    step();
  }

  /** Ends a crossfade now (done, or cut short): the song before stops, this one plays at full volume. */
  private finishCrossfade() {
    const f = this.fading;
    if (!f) return;
    this.fading = null;
    clearInterval(f.timer);
    f.next.volume = this.level();
    this.releasePlayer(f.old);
  }

  /** What `next(true)` will play when this song ends, when that's known in advance. */
  private upcoming(): QueueItem | null {
    const { queue, index, repeat, shuffle, radio, sleep } = this.state;
    if (repeat === 'one' || (sleep && 'endOfSong' in sleep)) return null;
    if (index + 1 < queue.length) return queue[index + 1];
    if (radio || repeat !== 'all' || shuffle) return null;
    return queue[0] ?? null;
  }

  private async preloadNext(token: number) {
    const next = this.upcoming();
    if (!next || next.id === this.current?.id) return;
    if (this.preloaded?.item.id === next.id) return;
    this.dropPreloaded();
    let item: QueueItem;
    try {
      item = await this.playableFor(next);
    } catch {
      return; // it'll be tried again, the normal way, when it's its turn
    }
    if (token !== this.loadToken || this.upcoming()?.id !== next.id) {
      this.preloadedFor = -1;
      return;
    }
    const player = this.createPlayer(srcFor(item));
    player.load();
    this.preloaded = { item, player };
  }

  private takePreloaded(id: string) {
    const pre = this.preloaded;
    this.preloaded = null;
    if (pre && pre.item.id === id) return pre;
    if (pre) this.releasePlayer(pre.player);
    return null;
  }

  private dropPreloaded() {
    const pre = this.preloaded;
    this.preloaded = null;
    if (pre) this.releasePlayer(pre.player);
  }

  /** Starts the preloaded element in place of the current one. */
  private swapTo(
    pre: { item: QueueItem; player: HTMLAudioElement },
    index: number,
  ) {
    const old = this.player;
    const p = pre.player;
    const fade = this.crossfadeNext;
    this.crossfadeNext = 0;
    this.player = p;
    this.applyLoop();
    if (fade && old) p.volume = 0;
    else this.applyVolume();
    const live = this.state.queue[index];
    this.showLoaded(
      { ...pre.item, liked: live?.liked ?? pre.item.liked },
      index,
      false,
    );
    const d = Number.isFinite(p.duration) ? p.duration : 0;
    if (d > 0) {
      this.setProgress({ position: 0, duration: d });
      this.rememberDuration(d);
    }
    this.play();
    if (old) {
      if (fade) this.startCrossfade(old, p, fade);
      else {
        // Started on time for the end: let its last moment play out under the new start.
        const left = (old.duration || 0) - old.currentTime;
        if (left > 0 && left < 1) setTimeout(() => this.releasePlayer(old), left * 1000 + 100);
        else this.releasePlayer(old);
      }
    }
    this.checkSleep();
  }

  // ---------- starting playback ----------

  /**
   * Play a list starting at `startIndex`.
   * @param shuffle force shuffle on/off (the Play and Shuffle buttons); defaults to the current mode
   * @param dir how the player animates to it (random suggestions move on like Next)
   */
  async playQueue(
    tracks: QueueItem[],
    startIndex = 0,
    contextName = tr('system.ctxLibrary'),
    shuffle = this.state.shuffle,
    dir: MoveDir = 0,
  ) {
    if (!tracks.length) return;
    this.moveDir = dir;
    const start = tracks[startIndex] ?? tracks[0];
    const queue = shuffle
      ? [start, ...shuffled(tracks.filter(t => t.id !== start.id))]
      : tracks;
    this.setState({
      context: tracks,
      queue,
      index: shuffle ? 0 : tracks.indexOf(start),
      contextName,
      shuffle,
    });
    await this.load(this.state.index);
  }

  /** Shuffle a list from a random song (the Shuffle buttons). */
  shuffleAll(tracks: QueueItem[], contextName: string) {
    const start = Math.floor(Math.random() * tracks.length);
    return this.playQueue(tracks, start, contextName, true);
  }

  private async resolveOnline(result: OnlineResult) {
    const source = sourceFor(result.source);
    const stream = await source.resolveStream(result);
    this.streams.set(trackIdFor(result.source, result.sourceId), stream);
    return { source, stream };
  }

  /** Saves an online song into the library, if it fits under the storage limit. */
  private async startSaving(
    track: Track,
    stream: ResolvedStream,
    preferCoverLookup: boolean,
  ): Promise<boolean> {
    const size = estimateBytes(track.duration, stream.bitrate);
    if (!(await fitsInStorage(size))) {
      toast(tr('system.notEnoughSpace'));
      return false;
    }
    const saving: Track = { ...track, status: 'downloading' };
    await upsertTrack(saving);
    downloadTrack(saving, stream);
    ensureArtwork(saving, preferCoverLookup).catch(() => {});
    return true;
  }

  /**
   * Play a song found online. It streams right away and, with "Save while
   * streaming" on, downloads in parallel so it's in the library afterwards.
   */
  async playOnline(
    result: OnlineResult,
    ctx = tr('system.ctxSearch', { source: sourceName(result.source) }),
    dir: MoveDir = 0,
  ) {
    const id = trackIdFor(result.source, result.sourceId);
    const existing = await getTrack(id);
    if (existing) return this.playQueue([existing], 0, ctx, false, dir);

    const token = ++this.loadToken;
    this.setState({ isResolving: true, error: null });
    try {
      const { source, stream } = await this.resolveOnline(result);
      let track = trackFromResult(result, 'streaming');
      if (getSettings().saveWhileStreaming) {
        const saving = await this.startSaving(
          track,
          stream,
          source.preferCoverLookup,
        );
        if (saving) track = { ...track, status: 'downloading' };
      }
      if (token !== this.loadToken) return; // user picked something else meanwhile
      const item: QueueItem = {
        ...track,
        streamUrl: stream.url,
        streamHeaders: stream.headers,
      };
      await this.playQueue([item], 0, ctx, false, dir);
    } catch (e: any) {
      this.setState({
        error: tr('system.couldntPlayTitle', {
          title: result.title,
          error: String(e?.message ?? e),
        }),
      });
    } finally {
      this.setState({ isResolving: false });
    }
  }

  /** Download an online song without playing it (the ↓ button in search results). */
  async downloadOnly(result: OnlineResult) {
    const id = trackIdFor(result.source, result.sourceId);
    if ((await getTrack(id)) || isDownloading(id)) return;
    try {
      const { source, stream } = await this.resolveOnline(result);
      const ok = await this.startSaving(
        trackFromResult(result, 'downloading'),
        stream,
        source.preferCoverLookup,
      );
      if (ok) toast(tr('system.downloadingOnly', { title: result.title }));
    } catch (e: any) {
      toast(
        tr('system.couldntDownload', {
          title: result.title,
          error: String(e?.message ?? e),
        }),
      );
    }
  }

  /** "Save offline" for a song that's only streaming. */
  async saveOffline(item: QueueItem) {
    if (item.status !== 'streaming' || item.source === 'device') return;
    try {
      const stream = await this.streamFor(item);
      const ok = await this.startSaving(
        item,
        stream,
        sourceFor(item.source).preferCoverLookup,
      );
      if (ok) this.patchItem(item.id, { status: 'downloading' });
    } catch (e: any) {
      toast(
        tr('system.couldntSave', {
          title: item.title,
          error: String(e?.message ?? e),
        }),
      );
    }
  }

  /** Insert a song right after the current one. */
  playNext(item: QueueItem) {
    if (!this.current) {
      this.playQueue([item], 0, tr('system.ctxLibrary'), false);
      return;
    }
    const queue = this.state.queue.filter(t => t.id !== item.id);
    const index = queue.findIndex(t => t.id === this.current!.id);
    queue.splice(index + 1, 0, item);
    this.setState({
      queue,
      index,
      context: this.state.context.some(t => t.id === item.id)
        ? this.state.context
        : [...this.state.context, item],
    });
    toast(tr('system.playsNext'));
  }

  /** Adds a song at the end of the queue (moves it there if it's already coming up). */
  addToQueue(item: QueueItem) {
    const cur = this.current;
    if (!cur) {
      this.playQueue([item], 0, tr('system.ctxLibrary'), false);
      return;
    }
    if (item.id === cur.id) {
      toast(tr('system.alreadyPlaying'));
      return;
    }
    const queue = this.state.queue.filter(t => t.id !== item.id);
    queue.push(item);
    this.setState({
      queue,
      index: queue.findIndex(t => t.id === cur.id),
      context: this.state.context.some(t => t.id === item.id)
        ? this.state.context
        : [...this.state.context, item],
    });
    toast(tr('system.addedToQueue'));
  }

  /** Moves a song in the queue (drag handles). */
  moveInQueue(from: number, to: number) {
    const { queue, index, shuffle } = this.state;
    if (from === to || !queue[from] || !queue[to]) return;
    const cur = queue[index];
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.setState({
      queue: next,
      index: cur ? next.findIndex(t => t.id === cur.id) : index,
      ...(shuffle ? {} : { context: next }),
    });
  }

  /** Takes a song out of the queue only (it stays in the library). */
  removeFromQueueOnly(id: string) {
    const { queue, index } = this.state;
    const i = queue.findIndex(t => t.id === id);
    if (i < 0 || i === index) return;
    this.setState({
      queue: queue.filter(t => t.id !== id),
      context: this.state.context.filter(t => t.id !== id),
      index: i < index ? index - 1 : index,
    });
  }

  async toggleLike(item: QueueItem) {
    if (item.status === 'streaming') {
      toast(tr('system.saveToLike'));
      return;
    }
    const liked = !item.liked;
    await updateTrack(item.id, { liked });
    this.patchItem(item.id, { liked });
  }

  // ---------- transport ----------

  play() {
    this.wantsToPlay = true;
    const sleep = this.state.sleep;
    if (sleep && 'at' in sleep && sleep.at <= Date.now()) this.cancelSleep(true);
    const p = this.player;
    if (!p) {
      if (this.current) this.load(this.state.index, true, this.progress.position);
      return;
    }
    p.playbackRate = getSettings().playbackSpeed;
    p.play().catch(e => {
      if (p !== this.player || e?.name === 'AbortError') return;
      // A stream URL that expired or was refused: resolve it again once.
      const cur = this.current;
      if (cur && cur.status !== 'ready' && cur.streamUrl) {
        this.streams = new StreamCache();
        this.patchItem(cur.id, { streamUrl: undefined });
        this.load(this.state.index, true, this.progress.position);
      }
    });
  }

  /** Playback speed for everything you play; pitch stays the same. */
  setSpeed(speed: number) {
    saveSettings({ playbackSpeed: speed });
    if (this.player) this.player.playbackRate = speed;
    if (this.preloaded) this.preloaded.player.playbackRate = speed;
  }

  cycleSpeed() {
    const i = SPEEDS.indexOf(getSettings().playbackSpeed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  pause() {
    this.wantsToPlay = false;
    this.saveListening();
    this.finishCrossfade();
    this.player?.pause();
    if (this.state.isPlaying) this.setState({ isPlaying: false });
  }

  togglePlay() {
    if (this.player && !this.player.paused) this.pause();
    else this.play();
  }

  seekTo(seconds: number) {
    this.finishCrossfade();
    if (this.player) this.player.currentTime = seconds;
    this.startedNextFor = -1;
    this.setProgress({ ...this.progress, position: seconds });
  }

  async next(auto = false) {
    const { queue, index, repeat, shuffle } = this.state;
    if (!queue.length) return;
    let n = index + 1;
    if (n >= queue.length) {
      if (this.state.radio) {
        await this.playRandomSuggestion();
        return;
      }
      if (repeat !== 'all' && auto) {
        this.pause();
        this.seekTo(0);
        return;
      }
      if (shuffle) this.setState({ queue: shuffled(queue) });
      n = 0;
    }
    this.moveDir = 1;
    await this.load(n);
  }

  async previous() {
    // Like every music player: restart the song unless it just started.
    if (this.progress.position > 3 || this.state.index <= 0) {
      this.seekTo(0);
      return;
    }
    this.moveDir = -1;
    await this.load(this.state.index - 1);
  }

  /** The song before this one, even well into the song (swiping the cover). */
  async previousSong() {
    if (this.state.index <= 0) {
      this.seekTo(0);
      return;
    }
    this.moveDir = -1;
    await this.load(this.state.index - 1);
  }

  async skipTo(index: number) {
    this.moveDir =
      index > this.state.index ? 1 : index < this.state.index ? -1 : 0;
    await this.load(index);
  }

  cycleRepeat() {
    const next: Record<RepeatMode, RepeatMode> = {
      off: 'all',
      all: 'one',
      one: 'off',
    };
    const repeat = next[this.state.repeat];
    this.setState({ repeat });
    this.applyLoop();
    const label = {
      off: 'system.repeatOff',
      all: 'system.repeatAll',
      one: 'system.repeatOne',
    } as const;
    toast(tr(label[repeat]));
  }

  /** Repeat one is done by the element itself (no gap). */
  private applyLoop() {
    const endOfSong = !!this.state.sleep && 'endOfSong' in this.state.sleep;
    if (this.player)
      this.player.loop = this.state.repeat === 'one' && !endOfSong;
  }

  private applyVolume() {
    if (this.player && !this.fading) this.player.volume = this.level();
  }

  private countIfListened() {
    const cur = this.current;
    if (this.counted || !cur || cur.status === 'streaming') return;
    const { position, duration } = this.progress;
    if (position >= Math.min(30, duration > 0 ? duration / 2 : 30)) {
      this.counted = true;
      countPlay(cur.id).catch(() => {});
      addListening(cur, 0, 1).catch(() => {});
    }
  }

  // ---------- listening time (stats) ----------

  private listened = 0;
  private listening: QueueItem | null = null;
  private lastTickAt = 0;

  private noteListening() {
    const now = Date.now();
    const cur = this.current;
    const last = this.lastTickAt;
    this.lastTickAt = now;
    if (!cur || !this.state.isPlaying || !last) return;
    if (this.listening?.id !== cur.id) {
      this.saveListening();
      this.listening = cur;
    }
    this.listened += Math.min(now - last, 1500) / 1000;
    if (this.listened >= 20) this.saveListening();
  }

  /** Writes the listening time not saved yet (also when the app quits). */
  saveListening() {
    const song = this.listening;
    const seconds = this.listened;
    this.listened = 0;
    this.lastTickAt = 0;
    if (song && seconds >= 1) addListening(song, seconds, 0).catch(() => {});
  }

  // ---------- sleep timer ----------

  /** Pause in `minutes`, or at the end of the current song (`'endOfSong'`). */
  setSleep(when: number | 'endOfSong') {
    this.clearSleepTimeout();
    const sleep: SleepTimer =
      when === 'endOfSong'
        ? { endOfSong: true }
        : { at: Date.now() + when * 60_000 };
    this.setState({ sleep });
    this.applyVolume();
    this.applyLoop();
    if ('at' in sleep) {
      this.sleepTimeout = setTimeout(() => this.checkSleep(), sleep.at - Date.now());
    }
    toast(
      when === 'endOfSong'
        ? tr('system.sleepEndOfSong')
        : tr('system.sleepIn', { count: when }),
    );
  }

  cancelSleep(silent = false) {
    if (!this.state.sleep) return;
    this.clearSleepTimeout();
    this.setState({ sleep: null });
    this.applyVolume();
    this.applyLoop();
    if (!silent) toast(tr('system.sleepOff'));
  }

  private clearSleepTimeout() {
    if (this.sleepTimeout) clearTimeout(this.sleepTimeout);
    this.sleepTimeout = null;
  }

  /** Fades out, then pauses once the time is up. */
  private checkSleep() {
    const sleep = this.state.sleep;
    if (!sleep || !('at' in sleep)) return;
    const left = (sleep.at - Date.now()) / 1000;
    if (left <= 0) {
      const playing = this.state.isPlaying || this.wantsToPlay;
      if (playing) this.pause();
      this.cancelSleep(true);
      if (playing) toast(tr('system.sleepPaused'));
      return;
    }
    if (left < SLEEP_FADE_S) this.applyVolume();
  }

  /** 1, or less during the sleep timer's fade-out. */
  /** Sets the volume (0–1). `save: false` while the slider is dragged, so the setting isn't written on every move. */
  setVolume(v: number, save = true) {
    this.liveVolume = Math.max(0, Math.min(1, v));
    if (save) {
      saveSettings({ volume: this.liveVolume });
      this.liveVolume = null;
    }
    this.applyVolume(); // a crossfade picks the new level up on its next step
  }

  private liveVolume: number | null = null;

  /** What the player plays at: the volume, lowered by the sleep timer's fade. */
  private level() {
    return (this.liveVolume ?? getSettings().volume) * this.sleepLevel();
  }

  private sleepLevel() {
    const sleep = this.state.sleep;
    if (!sleep || !('at' in sleep)) return 1;
    const left = (sleep.at - Date.now()) / 1000;
    return left < SLEEP_FADE_S ? Math.max(0.05, left / SLEEP_FADE_S) : 1;
  }

  toggleShuffle() {
    const cur = this.current;
    const shuffle = !this.state.shuffle;
    if (!cur) {
      this.setState({ shuffle });
      return;
    }
    const others = this.state.context.filter(t => t.id !== cur.id);
    if (shuffle) {
      this.setState({ shuffle, queue: [cur, ...shuffled(others)], index: 0 });
    } else {
      const inCtx = this.state.context.some(t => t.id === cur.id);
      const queue = inCtx
        ? this.state.context.map(t => (t.id === cur.id ? cur : t))
        : [cur, ...this.state.context];
      this.setState({
        shuffle,
        queue,
        index: queue.findIndex(t => t.id === cur.id),
      });
    }
    toast(tr(shuffle ? 'system.shuffleOn' : 'system.shuffleOff'));
  }

  // ---------- random suggestions ----------

  async startRadio(first: { track?: Track; result?: OnlineResult }) {
    this.radioPlayed.clear();
    this.setState({ radio: true });
    toast(tr('system.radioOn'));
    await this.playRadioPick(first);
  }

  stopRadio() {
    if (!this.state.radio) return;
    this.setState({ radio: false });
    toast(tr('system.radioOff'));
  }

  private async playRadioPick(
    pick: { track?: Track; result?: OnlineResult },
    dir: MoveDir = 0,
  ) {
    const ctx = tr('system.ctxRandom');
    if (pick.track) {
      this.radioPlayed.add(pick.track.id);
      await this.playQueue([pick.track], 0, ctx, false, dir);
    } else if (pick.result) {
      const r = pick.result;
      this.radioPlayed.add(trackIdFor(r.source, r.sourceId));
      await this.playOnline(r, ctx, dir);
    }
  }

  private async playRandomSuggestion() {
    const seed = this.current;
    if (!seed) return;
    this.radioPlayed.add(seed.id);
    const library = (await getAllTracks()).filter(t => t.status !== 'streaming');
    const found = await similarFor(seed, library, {
      localLimit: 15,
      onlineLimit: 20,
    });
    const all = [
      ...found.local.map(track => ({ id: track.id, track })),
      ...found.online.map(result => ({
        id: trackIdFor(result.source, result.sourceId),
        result,
      })),
    ].filter(c => c.id !== seed.id);
    const fresh = all.filter(c => !this.radioPlayed.has(c.id));
    const pool = fresh.length ? fresh : all;
    if (!pool.length || !this.state.radio) {
      if (!pool.length) {
        this.setState({ radio: false });
        toast(tr('system.radioEnded'));
        this.pause();
      }
      return;
    }
    await this.playRadioPick(pool[Math.floor(Math.random() * pool.length)], 1);
  }

  /** Stop, empty the queue and release the audio: the player bar goes away. */
  stop() {
    this.wantsToPlay = false;
    this.loadToken++;
    this.cancelSleep(true);
    this.saveListening();
    this.finishCrossfade();
    this.dropPreloaded();
    const p = this.player;
    this.player = null;
    if (p) this.releasePlayer(p);
    this.setState({
      context: [],
      queue: [],
      index: -1,
      isPlaying: false,
      isBuffering: false,
      isResolving: false,
      radio: false,
      error: null,
    });
    this.setProgress({ position: 0, duration: 0 });
  }

  /** Called by the library when a track is deleted. */
  removeFromQueue(id: string) {
    const { queue, index } = this.state;
    const i = queue.findIndex(t => t.id === id);
    if (i < 0) return;
    if (i === index && this.player) {
      this.releasePlayer(this.player);
      this.player = null;
    }
    this.setState({
      queue: queue.filter(t => t.id !== id),
      context: this.state.context.filter(t => t.id !== id),
      index: i < index ? index - 1 : i === index ? -1 : index,
    });
  }

  /** Keeps queue items in sync with the library (downloads finishing, likes, covers). */
  refreshFromLibrary(tracks: Map<string, Track>) {
    let changed = false;
    const up = (list: QueueItem[]) =>
      list.map(t => {
        const fresh = tracks.get(t.id);
        if (!fresh) return t;
        if (
          fresh.status === t.status &&
          fresh.title === t.title &&
          fresh.artist === t.artist &&
          fresh.album === t.album &&
          fresh.liked === t.liked &&
          fresh.artworkPath === t.artworkPath &&
          fresh.genre === t.genre &&
          fresh.filePath === t.filePath
        )
          return t;
        changed = true;
        return { ...t, ...fresh, streamUrl: t.streamUrl };
      });
    const queue = up(this.state.queue);
    const context = up(this.state.context);
    if (changed) this.setState({ queue, context });
  }

  private onTrackEnded() {
    const sleep = this.state.sleep;
    if (sleep && 'endOfSong' in sleep) {
      this.cancelSleep(true);
      this.pause();
      this.seekTo(0);
      return;
    }
    if (this.state.repeat === 'one') {
      this.seekTo(0);
      this.play();
      return;
    }
    this.next(true);
  }

  // ---------- the OS media controls ----------

  private setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const on = (a: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {}
    };
    on('play', () => this.play());
    on('pause', () => this.pause());
    on('stop', () => this.pause());
    on('nexttrack', () => this.next());
    on('previoustrack', () => this.previous());
    on('seekto', d => {
      if (d.seekTime != null) this.seekTo(d.seekTime);
    });
  }

  private sessionFor: string | null = null;
  private updateMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const cur = this.current;
    ms.playbackState = !cur ? 'none' : this.state.isPlaying ? 'playing' : 'paused';
    const key = cur ? `${cur.id}|${cur.title}|${cur.artist}|${cur.artworkPath}` : null;
    if (key === this.sessionFor) return;
    this.sessionFor = key;
    if (!cur) {
      ms.metadata = null;
      return;
    }
    const art = cur.remoteArtworkUrl ?? artworkUri(cur);
    ms.metadata = new MediaMetadata({
      title: cur.title,
      artist: cur.artist ?? '',
      album: cur.album ?? '',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
  }
}

export const PlayerService = new PlayerServiceImpl();
