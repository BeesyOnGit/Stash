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
    error: null,
  };
  private progress: Progress = { position: 0, duration: 0 };
  private stateListeners = new Set<Listener>();
  private progressListeners = new Set<Listener>();
  /** Increments on every load so late async results for an old song are ignored. */
  private loadToken = 0;
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

  private configure(p: VideoPlayer) {
    p.playInBackground = true;
    p.showNotificationControls = true; // lock screen + notification (play/pause/seek)
    p.mixAudioMode = 'doNotMix'; // pause other music apps, like a normal music player
    if (Platform.OS === 'ios') {
      // iOS-only options (setting them on Android just logs a warning).
      p.playWhenInactive = true;
      p.ignoreSilentSwitchMode = 'ignore'; // play even with the mute switch on
    }

    // ExoPlayer keeps the speed across songs (iOS applies it in play()).
    if (Platform.OS !== 'ios') p.rate = getSettings().playbackSpeed;
    p.addEventListener('onPlaybackStateChange', ({ isPlaying, isBuffering }) =>
      this.setState({ isPlaying, isBuffering }),
    );
    p.addEventListener('onProgress', ({ currentTime }) =>
      this.setProgress({
        position: currentTime,
        duration: this.progress.duration,
      }),
    );
    p.addEventListener('onLoad', ({ duration }) => {
      const d = Number.isFinite(duration) ? duration : 0;
      this.setProgress({ position: 0, duration: d });
      const cur = this.current;
      // Device files have no duration until first played; remember it.
      if (cur && d > 0 && !cur.duration)
        updateTrack(cur.id, { duration: d }).catch(() => {});
    });
    p.addEventListener('onEnd', () => this.onTrackEnded());
    p.addEventListener('onError', e => {
      this.setState({
        error: e.message ?? 'Playback error',
        isBuffering: false,
      });
    });
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

  private async load(index: number, autoplay = true) {
    const item = this.state.queue[index];
    if (!item) return;
    const token = ++this.loadToken;

    // A song may have finished downloading since it was queued — prefer the local file.
    let playable: QueueItem = item;
    if (item.status !== 'ready' || !item.filePath) {
      const fresh = await getTrack(item.id);
      if (fresh?.status === 'ready') {
        playable = { ...item, ...fresh, streamUrl: undefined };
      } else if (!item.streamUrl && item.source !== 'device') {
        // Not on the phone and no URL yet (e.g. tapped while downloading): stream it again.
        try {
          const stream = await this.streamFor(item);
          playable = {
            ...item,
            streamUrl: stream.url,
            streamHeaders: stream.headers,
          };
        } catch (e: any) {
          if (token === this.loadToken) {
            this.setState({ error: `Couldn't play: ${e?.message ?? e}` });
          }
          return;
        }
      }
    }
    if (token !== this.loadToken) return;

    const queue = [...this.state.queue];
    queue[index] = playable;
    this.setState({ queue, index, error: null, isBuffering: true });
    this.setProgress({ position: 0, duration: playable.duration ?? 0 });
    if (playable.status !== 'streaming') {
      updateTrack(playable.id, { lastPlayedAt: Date.now() }).catch(() => {});
      ensureWaveform(playable); // real waveform for songs on the phone (once)
    }
    lyricsFor(playable).catch(() => {}); // ready when the lyrics are opened

    const config = this.sourceConfig(playable);
    if (!this.player) {
      this.player = new VideoPlayer(config);
      this.configure(this.player);
    } else {
      await this.player.replaceSourceAsync(config);
    }
    if (token !== this.loadToken) return;
    if (autoplay) this.play();
  }

  // ---------- starting playback ----------

  /**
   * Play a list starting at `startIndex`.
   * @param shuffle force shuffle on/off (the Play and Shuffle buttons); defaults to the current mode
   */
  async playQueue(
    tracks: QueueItem[],
    startIndex = 0,
    contextName = 'Library',
    shuffle = this.state.shuffle,
  ) {
    if (!tracks.length) return;
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
  ) {
    const id = trackIdFor(result.source, result.sourceId);
    const existing = await getTrack(id);
    if (existing) return this.playQueue([existing], 0, ctx, false);

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
      await this.playQueue([item], 0, ctx, false);
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
    if (!this.player) return;
    this.player.play();
    // iOS: AVPlayer starts at 1× unless told otherwise (and setting a rate while
    // paused would start playback, so it's only applied once playing).
    const speed = getSettings().playbackSpeed;
    if (Platform.OS === 'ios' && speed !== 1) this.player.rate = speed;
  }

  /** Playback speed for everything you play; pitch stays the same. */
  setSpeed(speed: number) {
    saveSettings({ playbackSpeed: speed });
    if (this.player && (Platform.OS !== 'ios' || this.state.isPlaying)) {
      this.player.rate = speed;
    }
  }

  /** Next speed in the list, wrapping around (the car's speed button). */
  cycleSpeed() {
    const i = SPEEDS.indexOf(getSettings().playbackSpeed);
    this.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }
  pause() {
    this.player?.pause();
  }
  togglePlay() {
    if (this.state.isPlaying) this.pause();
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
    await this.load(n);
  }

  async previous() {
    // Like every music player: restart the song unless it just started.
    if (this.progress.position > 3 || this.state.index <= 0) {
      this.seekTo(0);
      return;
    }
    await this.load(this.state.index - 1);
  }

  async skipTo(index: number) {
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
    toast(
      { off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[repeat],
    );
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

  private async playRadioPick(pick: { track?: Track; result?: OnlineResult }) {
    const ctx = 'Random suggestions';
    if (pick.track) {
      this.radioPlayed.add(pick.track.id);
      await this.playQueue([pick.track], 0, ctx, false);
    } else if (pick.result) {
      const r = pick.result;
      this.radioPlayed.add(trackIdFor(r.source, r.sourceId));
      await this.playOnline(r, ctx);
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
      await this.playRadioPick(pool[Math.floor(Math.random() * pool.length)]);
    });
  }

  /**
   * The mini player's ✕: stop, empty the queue and release the native player,
   * so the notification, the mini player and the floating bubble all go away.
   * The next song played starts a fresh player.
   */
  stop() {
    this.loadToken++; // ignore any stream still being resolved
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

  private onTrackEnded() {
    if (this.state.repeat === 'one') {
      this.seekTo(0);
      this.play();
      return;
    }
    this.next(true);
  }
}

export const PlayerService = new PlayerServiceImpl();
