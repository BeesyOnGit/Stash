/**
 * One app-wide audio player living outside React, so playback (and moving to the
 * next song) keeps working when the screen is off or the app is in the background.
 *
 * react-native-video v7 is used as the audio engine: ExoPlayer/Media3 on Android
 * (foreground MediaSessionService + notification) and AVPlayer on iOS
 * (background audio mode + lock-screen Now Playing).
 */
import { Platform } from 'react-native';
import { VideoPlayer, type VideoConfig } from 'react-native-video';
import {
  countPlay,
  getAllTracks,
  getTrack,
  updateTrack,
  upsertTrack,
} from '../db/database';
import { ensureArtwork } from '../services/artwork';
import { downloadTrack, isDownloading } from '../services/downloader';
import { whileAway } from '../services/keepAlive';
import { getSettings, saveSettings, SPEEDS } from '../services/settings';
import { lyricsFor } from '../services/lyrics';
import { similarFor } from '../services/similar';
import { ensureWaveform } from '../services/waveform';
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
/** Android only for now: the notification handover it needs is patched on Android, and iOS is untested. */
const PRELOAD = Platform.OS === 'android';
/** A preloaded player takes about this long from play() to its first sound (longer with the screen off). */
const NEXT_START_DELAY_S = 0.2;

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

class PlayerServiceImpl {
  private player: VideoPlayer | null = null;

  private state: PlayerState = {
    context: [],
    queue: [],
    index: -1,
    contextName: 'Library',
    isPlaying: false,
    isBuffering: false,
    isResolving: false,
    repeat: 'off',
    shuffle: false,
    radio: false,
    sleep: null,
    moveDir: 0,
    error: null,
  };
  private progress: Progress = { position: 0, duration: 0 };
  /** The song loaded last has been counted as played (see countIfListened). */
  private counted = false;
  /** Foreground backup for the sleep timer; in the background the progress ticks check it. */
  private sleepTimeout: ReturnType<typeof setTimeout> | null = null;
  /** The next song, loaded in a silent player before this one ends (see maybePreload). */
  private preloaded: { item: QueueItem; player: VideoPlayer } | null = null;
  /** The load (loadToken) the next song was preloaded for, so it's done once per song. */
  private preloadedFor = -1;
  /** The player is switching to another song's file (see load). */
  private replacing = false;
  /** Direction of the song change being loaded, copied into the state once it shows. */
  private moveDir: MoveDir = 0;
  /** The load the next song was started early for (see maybeStartNextOnTime). */
  private startedNextFor = -1;
  /** The player of the song before, released once the new one has taken over (see swapTo). */
  private retiring: VideoPlayer | null = null;
  private stateListeners = new Set<Listener>();
  private progressListeners = new Set<Listener>();
  /** Increments on every load so late async results for an old song are ignored. */
  private loadToken = 0;
  /** The user wants sound (play pressed, not paused since): for spotting a dead player. */
  private wantsToPlay = false;
  /** Songs already picked in this run of random suggestions (no repeats). */
  private radioPlayed = new Set<string>();
  /** Resolved stream URLs of online songs (short-lived, so kept in memory only). */
  private streams = new StreamCache();

  // ---------- subscriptions (used by hooks via useSyncExternalStore) ----------

  getState = () => this.state;
  getProgress = () => this.progress;

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
  }
  private setProgress(p: Progress) {
    this.progress = p;
    this.progressListeners.forEach(fn => fn());
  }

  get current(): QueueItem | null {
    return this.state.queue[this.state.index] ?? null;
  }

  // ---------- native player ----------

  /** A new native player; its events count only while it's `this.player`. */
  private createPlayer(config: VideoConfig): VideoPlayer {
    const p = new VideoPlayer(config);
    p.mixAudioMode = 'doNotMix'; // pause other music apps, like a normal music player
    // ExoPlayer keeps the speed across songs (iOS applies it in play()).
    if (Platform.OS !== 'ios') p.rate = getSettings().playbackSpeed;
    const mine = () => p === this.player;

    p.addEventListener(
      'onPlaybackStateChange',
      ({ isPlaying, isBuffering }) => {
        if (mine()) this.setState({ isPlaying, isBuffering });
      },
    );
    p.addEventListener('onProgress', ({ currentTime }) => {
      if (!mine() || this.replacing) return;
      this.setProgress({
        position: currentTime,
        duration: this.progress.duration,
      });
      this.countIfListened();
      this.checkSleep();
      this.maybePreload();
      this.maybeStartNextOnTime(currentTime);
      if (this.retiring && currentTime >= 2) this.releaseRetiring();
    });
    p.addEventListener('onLoad', ({ duration }) => {
      if (!mine()) return;
      const d = Number.isFinite(duration) ? duration : 0;
      this.setProgress({ position: 0, duration: d });
      this.rememberDuration(d);
    });
    p.addEventListener('onEnd', () => {
      if (mine()) this.onTrackEnded();
    });
    p.addEventListener('onError', e => {
      if (!mine()) return;
      this.setState({
        error: e.message ?? 'Playback error',
        isBuffering: false,
      });
    });
    return p;
  }

  /** Background playback and the notification: only the player that's playing has them. */
  private activate(p: VideoPlayer) {
    p.playInBackground = true;
    p.showNotificationControls = true; // lock screen + notification
    if (Platform.OS === 'ios') {
      // iOS-only options (setting them on Android just logs a warning).
      p.playWhenInactive = true;
      p.ignoreSilentSwitchMode = 'ignore'; // play even with the mute switch on
    }
  }

  /** Device files have no duration until first played; remember it. */
  private rememberDuration(d: number) {
    const cur = this.current;
    if (cur && d > 0 && !cur.duration)
      updateTrack(cur.id, { duration: d }).catch(() => {});
  }

  private sourceConfig(item: QueueItem): VideoConfig {
    const local = item.status === 'ready' && item.filePath;
    const art = item.remoteArtworkUrl ?? artworkUri(item) ?? undefined;
    return {
      uri: local ? `file://${item.filePath}` : item.streamUrl!,
      headers: local ? undefined : item.streamHeaders,
      metadata: {
        title: item.title,
        artist: item.artist ?? undefined,
        subtitle: item.album ?? undefined,
        imageUri: art,
      },
    };
  }

  private async streamFor(track: Track): Promise<ResolvedStream> {
    const cached = this.streams.get(track.id);
    if (cached) return cached;
    if (track.source === 'device') throw new Error('Not an online track');
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
    // Not on the phone and no URL yet (e.g. tapped while downloading): stream it again.
    const stream = await this.streamFor(item);
    return { ...item, streamUrl: stream.url, streamHeaders: stream.headers };
  }

  private async load(index: number, autoplay = true) {
    const item = this.state.queue[index];
    if (!item) return;
    const token = ++this.loadToken;

    const pre = this.takePreloaded(item.id);
    if (pre && autoplay) {
      this.swapTo(pre, index);
      return;
    }

    let playable: QueueItem;
    try {
      playable = await this.playableFor(item);
    } catch (e: any) {
      if (token === this.loadToken) {
        this.setState({ error: `Couldn't play: ${e?.message ?? e}` });
      }
      return;
    }
    if (token !== this.loadToken) return;

    this.showLoaded(playable, index, true);
    const config = this.sourceConfig(playable);
    if (!this.player) {
      this.player = this.createPlayer(config);
      this.activate(this.player);
    } else {
      // Ticks still coming from the song before would move the new one's position.
      this.replacing = true;
      try {
        await this.player.replaceSourceAsync(config);
      } finally {
        this.replacing = false;
      }
    }
    this.applyLoop();
    if (token !== this.loadToken) return;
    if (autoplay) this.play();
  }

  /** The queue, progress and library bookkeeping for the song now loaded. */
  private showLoaded(playable: QueueItem, index: number, buffering: boolean) {
    const queue = [...this.state.queue];
    queue[index] = playable;
    this.setState({
      queue,
      index,
      error: null,
      isBuffering: buffering,
      moveDir: this.moveDir,
    });
    this.moveDir = 0;
    this.setProgress({ position: 0, duration: playable.duration ?? 0 });
    this.counted = false;
    if (playable.status !== 'streaming') {
      updateTrack(playable.id, { lastPlayedAt: Date.now() }).catch(() => {});
      ensureWaveform(playable); // real waveform for songs on the phone (once)
    }
    lyricsFor(playable).catch(() => {}); // ready when the lyrics are opened
  }

  // ---------- the next song, ready before this one ends ----------

  /**
   * Loads the song that plays next in a second, silent player shortly before
   * the end, so it starts the moment this one finishes: no gap, no buffering,
   * and online songs don't wait for their stream URL.
   */
  private maybePreload() {
    const { position, duration } = this.progress;
    if (
      !PRELOAD ||
      this.preloadedFor === this.loadToken ||
      duration <= 0 ||
      duration - position > PRELOAD_BEFORE_END_S
    )
      return;
    const token = this.loadToken;
    this.preloadedFor = token;
    whileAway(() => this.preloadNext(token)).catch(() => {});
  }

  /**
   * The native "ended" event reaches JS most of a second late, so with the next
   * song preloaded, it's started from the last progress ticks instead: just
   * early enough for its first sound to follow the end of this one.
   */
  private maybeStartNextOnTime(position: number) {
    const pre = this.preloaded;
    const left =
      (this.progress.duration - position) / getSettings().playbackSpeed;
    if (
      !pre ||
      this.startedNextFor === this.loadToken ||
      left > 0.6 ||
      left <= 0 ||
      pre.item.id !== this.upcoming()?.id
    )
      return;
    const token = this.loadToken;
    this.startedNextFor = token;
    const wait = Math.max(0, (left - NEXT_START_DELAY_S) * 1000);
    whileAway(
      () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            // Paused, seeked or changed song meanwhile: leave it to the normal end.
            if (token !== this.loadToken || !this.nativePlaying()) {
              resolve();
              return;
            }
            this.next(true).finally(resolve);
          }, wait),
        ),
    ).catch(() => {});
  }

  /** What `next(true)` will play when this song ends, when that's known in advance. */
  private upcoming(): QueueItem | null {
    const { queue, index, repeat, shuffle, radio, sleep } = this.state;
    if (repeat === 'one' || (sleep && 'endOfSong' in sleep)) return null;
    if (index + 1 < queue.length) return queue[index + 1];
    // Random suggestions pick at the end, and shuffle reorders when wrapping around.
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
      this.preloadedFor = -1; // what plays next changed meanwhile: try again
      return;
    }
    this.preloaded = {
      item,
      player: this.createPlayer(this.sourceConfig(item)),
    };
  }

  /** The preloaded player if it holds `id`; any other preloaded song is thrown away. */
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

  private releasePlayer(p: VideoPlayer) {
    try {
      p.pause();
      p.release();
    } catch {}
  }

  private releaseRetiring() {
    const r = this.retiring;
    this.retiring = null;
    if (r) this.releasePlayer(r);
  }

  /**
   * Starts the preloaded player in place of the current one. The playback
   * service hands the notification over to the new one
   * (patches/react-native-video+*.patch); the old one is released a moment
   * later, once that has happened: releasing it straight away would drop the
   * notification and the background playback with it.
   */
  private swapTo(pre: { item: QueueItem; player: VideoPlayer }, index: number) {
    const old = this.player;
    const p = pre.player;
    this.releaseRetiring();
    if (old) {
      // Started on time for the end (maybeStartNextOnTime): let the last
      // moments play out under the new song's start. Skipped to: stop it now.
      const left = this.progress.duration - this.progress.position;
      if (!(left > 0 && left < 1)) {
        try {
          old.pause();
        } catch {}
      }
      this.retiring = old;
    }
    this.player = p;
    this.activate(p);
    this.applyLoop();
    this.play();

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
    this.checkSleep(); // keep fading if the sleep timer is about to stop the music
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
    contextName = 'Library',
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
      toast('Not enough space — raise the limit in Settings');
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
    ctx = `Search · ${sourceName(result.source)}`,
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
        error: `Couldn't play "${result.title}": ${e?.message ?? e}`,
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
      if (ok) toast(`Downloading “${result.title}” — no streaming`);
    } catch (e: any) {
      toast(`Couldn't download “${result.title}”: ${e?.message ?? e}`);
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
      toast(`Couldn't save “${item.title}”: ${e?.message ?? e}`);
    }
  }

  /** Insert a song right after the current one. */
  playNext(item: QueueItem) {
    if (!this.current) {
      this.playQueue([item], 0, 'Library', false);
      return;
    }
    const without = (l: QueueItem[]) => l.filter(t => t.id !== item.id);
    const queue = without(this.state.queue);
    const index = queue.findIndex(t => t.id === this.current!.id);
    queue.splice(index + 1, 0, item);
    this.setState({
      queue,
      index,
      context: this.state.context.some(t => t.id === item.id)
        ? this.state.context
        : [...this.state.context, item],
    });
    toast('Plays next');
  }

  async toggleLike(item: QueueItem) {
    if (item.status === 'streaming') {
      toast('Save the song first to like it');
      return;
    }
    const liked = !item.liked;
    await updateTrack(item.id, { liked });
    this.patchItem(item.id, { liked });
  }

  // ---------- transport ----------

  play() {
    const p = this.player;
    this.wantsToPlay = true;
    // Time ran out while paused: don't pause again on the first tick.
    const sleep = this.state.sleep;
    if (sleep && 'at' in sleep && sleep.at <= Date.now())
      this.cancelSleep(true);
    if (!p) {
      this.revive();
      return;
    }
    try {
      p.play();
    } catch {
      this.revive();
      return;
    }
    // iOS: AVPlayer starts at 1× unless told otherwise (and setting a rate while
    // paused would start playback, so it's only applied once playing).
    const speed = getSettings().playbackSpeed;
    if (Platform.OS === 'ios' && speed !== 1) p.rate = speed;
    // The native player can be torn down behind our back (e.g. the app swiped
    // away from recents stops the playback service). If nothing starts, rebuild it.
    const token = this.loadToken;
    setTimeout(() => {
      if (
        this.wantsToPlay &&
        this.player === p &&
        token === this.loadToken &&
        !this.nativePlaying() &&
        !this.state.isBuffering &&
        !this.state.isResolving
      ) {
        this.revive();
      }
    }, 1500);
  }

  /** Asked the player itself: our state can be stale if the native side went away. */
  private nativePlaying(): boolean {
    try {
      return !!this.player?.isPlaying;
    } catch {
      return false;
    }
  }

  private reviving = false;

  /** A fresh native player for the current song, at the same position. */
  private async revive() {
    const cur = this.current;
    if (!cur || this.reviving) return;
    this.reviving = true;
    const at = this.progress.position;
    const old = this.player;
    this.player = null;
    this.releaseRetiring();
    try {
      old?.release();
    } catch {}
    try {
      await this.load(this.state.index, true);
      // load() just made a new player (TypeScript still sees the null set above).
      // Resume where it was, unless it had reached the end (then from the start).
      const end = this.progress.duration || cur.duration || 0;
      if (at > 1 && (!end || at < end - 2)) {
        (this.player as VideoPlayer | null)?.seekTo(at);
      }
    } finally {
      this.reviving = false;
    }
  }

  /** Playback speed for everything you play; pitch stays the same. */
  setSpeed(speed: number) {
    saveSettings({ playbackSpeed: speed });
    if (this.player && (Platform.OS !== 'ios' || this.state.isPlaying)) {
      this.player.rate = speed;
    }
    if (this.preloaded && Platform.OS !== 'ios') {
      this.preloaded.player.rate = speed;
    }
  }

  /** Next speed in the list, wrapping around (the car's speed button). */
  cycleSpeed() {
    const i = SPEEDS.indexOf(getSettings().playbackSpeed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  pause() {
    this.wantsToPlay = false;
    try {
      this.player?.pause();
    } catch {}
    // A dead player sends no event: don't leave the button showing "pause".
    if (this.state.isPlaying && !this.nativePlaying()) {
      this.setState({ isPlaying: false });
    }
  }
  togglePlay() {
    if (this.nativePlaying()) this.pause();
    else this.play();
  }

  seekTo(seconds: number) {
    this.player?.seekTo(seconds);
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
      // Wrapping around: a new random order for the next pass.
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
    toast(
      { off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[repeat],
    );
  }

  /** Repeat one is done by the native player itself, so it works with the screen off. */
  private applyLoop() {
    // A native loop never ends the song, so "end of song" for the sleep timer turns it off.
    const endOfSong = !!this.state.sleep && 'endOfSong' in this.state.sleep;
    try {
      if (this.player)
        this.player.loop = this.state.repeat === 'one' && !endOfSong;
    } catch {}
  }

  private countIfListened() {
    const cur = this.current;
    if (this.counted || !cur || cur.status === 'streaming') return;
    const { position, duration } = this.progress;
    if (position >= Math.min(30, duration > 0 ? duration / 2 : 30)) {
      this.counted = true;
      countPlay(cur.id).catch(() => {});
    }
  }

  // ---------- sleep timer ----------

  /** Pause in `minutes`, or at the end of the current song (`'endOfSong'`). */
  setSleep(when: number | 'endOfSong') {
    this.clearSleepTimeout();
    this.setVolume(1);
    const sleep: SleepTimer =
      when === 'endOfSong'
        ? { endOfSong: true }
        : { at: Date.now() + when * 60_000 };
    this.setState({ sleep });
    this.applyLoop();
    if ('at' in sleep) {
      this.sleepTimeout = setTimeout(
        () => this.checkSleep(),
        sleep.at - Date.now(),
      );
    }
    toast(
      when === 'endOfSong'
        ? 'Music pauses when this song ends'
        : `Music pauses in ${when} min`,
    );
  }

  cancelSleep(silent = false) {
    if (!this.state.sleep) return;
    this.clearSleepTimeout();
    this.setVolume(1);
    this.setState({ sleep: null });
    this.applyLoop();
    if (!silent) toast('Sleep timer off');
  }

  private clearSleepTimeout() {
    if (this.sleepTimeout) clearTimeout(this.sleepTimeout);
    this.sleepTimeout = null;
  }

  private setVolume(v: number) {
    try {
      if (this.player && this.player.volume !== v) this.player.volume = v;
    } catch {}
  }

  /**
   * Fades out, then pauses once the time is up. Called on every progress tick,
   * which keeps coming with the screen off (JS timers don't).
   */
  private checkSleep() {
    const sleep = this.state.sleep;
    if (!sleep || !('at' in sleep)) return;
    const left = (sleep.at - Date.now()) / 1000;
    if (left <= 0) {
      const playing = this.state.isPlaying || this.wantsToPlay;
      if (playing) this.pause();
      this.cancelSleep(true); // after pausing: it turns the volume back up
      if (playing) toast('Sleep timer: music paused');
      return;
    }
    if (left < SLEEP_FADE_S)
      this.setVolume(Math.max(0.05, left / SLEEP_FADE_S));
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
    toast(shuffle ? 'Shuffle on' : 'Shuffle off');
  }

  // ---------- random suggestions ----------

  /**
   * "Play random suggestions": play `first` (a random pick from the Similar
   * sheet), then keep going with random similar songs — offline or online —
   * whenever the queue runs out, until turned off.
   */
  async startRadio(first: { track?: Track; result?: OnlineResult }) {
    this.radioPlayed.clear();
    this.setState({ radio: true });
    toast('Random suggestions on — tap the icon to stop');
    await this.playRadioPick(first);
  }

  stopRadio() {
    if (!this.state.radio) return;
    this.setState({ radio: false });
    toast('Random suggestions off');
  }

  private async playRadioPick(
    pick: { track?: Track; result?: OnlineResult },
    dir: MoveDir = 0,
  ) {
    const ctx = 'Random suggestions';
    if (pick.track) {
      this.radioPlayed.add(pick.track.id);
      await this.playQueue([pick.track], 0, ctx, false, dir);
    } else if (pick.result) {
      const r = pick.result;
      this.radioPlayed.add(trackIdFor(r.source, r.sourceId));
      await this.playOnline(r, ctx, dir);
    }
  }

  /** A random song similar to the one that just played (runs in the background too). */
  private playRandomSuggestion() {
    return whileAway(async () => {
      const seed = this.current;
      if (!seed) return;
      this.radioPlayed.add(seed.id);
      const library = (await getAllTracks()).filter(
        t => t.status !== 'streaming',
      );
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
          toast('No more suggestions — random suggestions off');
          this.pause();
        }
        return;
      }
      await this.playRadioPick(
        pool[Math.floor(Math.random() * pool.length)],
        1,
      );
    });
  }

  /**
   * The mini player's ✕: stop, empty the queue and release the native player,
   * so the notification, the mini player and the floating bubble all go away.
   * The next song played starts a fresh player.
   */
  stop() {
    this.wantsToPlay = false;
    this.loadToken++; // ignore any stream still being resolved
    this.cancelSleep(true);
    this.dropPreloaded();
    this.releaseRetiring();
    const p = this.player;
    this.player = null;
    if (p) {
      try {
        p.pause();
        p.release();
      } catch {}
    }
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
    if (i === index) {
      this.player?.pause();
      this.player?.replaceSourceAsync(null);
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
          fresh.liked === t.liked &&
          fresh.artworkPath === t.artworkPath &&
          fresh.genre === t.genre &&
          fresh.waveform === t.waveform
        )
          return t;
        changed = true;
        return { ...t, ...fresh, streamUrl: t.streamUrl };
      });
    const queue = up(this.state.queue);
    const context = up(this.state.context);
    if (changed) this.setState({ queue, context });
  }

  /**
   * Runs with the screen off too: the next song may need its stream resolved,
   * which waits on JS timers that Android pauses in the background (whileAway).
   */
  private onTrackEnded() {
    whileAway(async () => {
      const sleep = this.state.sleep;
      if (sleep && 'endOfSong' in sleep) {
        this.cancelSleep(true);
        this.pause();
        this.seekTo(0);
        return;
      }
      if (this.state.repeat === 'one') {
        // Normally looped natively (applyLoop); this is the fallback.
        this.seekTo(0);
        this.play();
        return;
      }
      await this.next(true);
    }).catch(() => {});
  }
}

export const PlayerService = new PlayerServiceImpl();
