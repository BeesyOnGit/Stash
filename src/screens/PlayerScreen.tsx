import { useNavigation } from '@react-navigation/native';
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  PanResponder,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PlayerService,
  type MoveDir,
  type Progress,
} from '../player/PlayerService';
import {
  useCurrentTrack,
  useDownloadProgress,
  usePlayerState,
  useProgress,
  useSleepLeft,
} from '../player/hooks';
import { tr } from '../i18n';
import { useOnline } from '../services/network';
import { haptic, type HapticKind } from '../services/haptics';
import {
  speedLabel,
  useSettings,
  type SongChange,
  type VinylStyle,
} from '../services/settings';
import { keepScreenOn } from '../services/screen';
import { WAVEFORM_BARS } from '../services/waveform';
import { openSheet } from '../state/ui';
import {
  ACCENT,
  GREEN,
  GREEN_LIGHT,
  font,
  formatTime,
  mono,
  paletteFor,
  sourceLabel,
  type Palette,
} from '../theme';
import { artworkUri, type QueueItem } from '../types';
import {
  AddToListIcon,
  ChevronDownIcon,
  CloseIcon,
  DownloadIcon,
  LyricsIcon,
  HeartIcon,
  MoonIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayRoundIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RingIcon,
  ShuffleIcon,
  SimilarIcon,
  SpeedIcon,
} from '../ui/icons';
import { Spinner } from '../ui/primitives';
import { Vinyl } from '../ui/Vinyl';
import { LyricsPanel } from '../components/LyricsPanel';
import { Pressable } from '../ui/Pressable';

const BARS = WAVEFORM_BARS;

/**
 * Modern masters are loud almost everywhere, so a plain loudness plot looks flat.
 * Stretch between the song's quietest and loudest moments (and ease the curve)
 * so intros, drops and fade-outs stand out, as in music apps' scrubbers.
 */
function withContrast(bars: number[]): number[] {
  const level = bars.map(h => (h - 12) / 88); // stored as 12..100 → loudness 0..1
  const min = Math.min(...level);
  const range = Math.max(...level) - min || 1;
  return level.map(v => Math.round(14 + 86 * ((v - min) / range) ** 1.4));
}

/** A song change: the old song's page (background, cover, title, waveform) leaves, the new one comes in. */
const CHANGE_MS = 460;
/** Cross-fade (no direction): where in the change (0..1) the old ones are gone and the new ones start. */
const SPLIT = 0.4;

type ChipKey = 'status' | 'save' | 'random' | 'sleep' | 'speed';
const CHIP_KEYS: ChipKey[] = ['status', 'save', 'random', 'sleep', 'speed'];
/** Which chips give up their text first when the status row is crowded. */
const SHRINK_ORDER = ['status', 'save', 'random', 'sleep'] as const;
type Minimised = Record<(typeof SHRINK_ORDER)[number], boolean>;
const FULL: Minimised = {
  status: false,
  save: false,
  random: false,
  sleep: false,
};
/** A chip shrunk to its icon (the status: its ring). */
const SMALL_CHIP = 32;
const CHIP_GAP = 8;

type Styled = Animated.WithAnimatedValue<ViewStyle> | null;

/**
 * How the new song comes in and the old one leaves, from `t` (0 → 1 over the
 * change). `in`/`out` go on the cover, title, status and waveform; `bg*` on
 * the backgrounds (which cross-fade, except when sliding with the page).
 */
function songChangeStyles(
  mode: SongChange,
  dir: MoveDir,
  t: Animated.Value,
  width: number,
): { inStyle: Styled; outStyle: Styled; bgIn: Styled; bgOut: Styled } {
  const range = (inputRange: number[], outputRange: number[] | string[]) =>
    t.interpolate({ inputRange, outputRange, extrapolate: 'clamp' } as any);
  const fadeIn = range([0, SPLIT, 1], [0, 0, 1]);
  const fadeOut = range([0, SPLIT], [1, 0]);
  const crossfade = { opacity: range([0, 1], [1, 0]) };

  if (mode === 'slide' && dir) {
    const inStyle = {
      transform: [{ translateX: range([0, 1], [dir * width, 0]) }],
    };
    const outStyle = {
      transform: [{ translateX: range([0, 1], [0, -dir * width]) }],
    };
    return { inStyle, outStyle, bgIn: inStyle, bgOut: outStyle };
  }
  if (mode === 'zoom') {
    return {
      inStyle: {
        opacity: fadeIn,
        transform: [{ scale: range([0, SPLIT, 1], [1.12, 1.12, 1]) }],
      },
      outStyle: {
        opacity: fadeOut,
        transform: [{ scale: range([0, SPLIT], [1, 0.82]) }],
      },
      bgIn: null,
      bgOut: crossfade,
    };
  }
  if (mode === 'flip') {
    // Turns away from the side of the song coming in (as Next / Previous go).
    const d = dir || 1;
    return {
      inStyle: {
        opacity: range([0, 0.5, 0.501, 1], [0, 0, 1, 1]),
        transform: [
          { perspective: 900 },
          {
            rotateY: range(
              [0, 0.5, 1],
              [`${-d * 90}deg`, `${-d * 90}deg`, '0deg'],
            ),
          },
        ],
      },
      outStyle: {
        opacity: range([0, 0.499, 0.5], [1, 1, 0]),
        transform: [
          { perspective: 900 },
          { rotateY: range([0, 0.5], ['0deg', `${d * 90}deg`]) },
        ],
      },
      bgIn: null,
      bgOut: crossfade,
    };
  }
  // Fade (and a slide with no direction: a new list).
  return {
    inStyle: { opacity: fadeIn },
    outStyle: { opacity: fadeOut },
    bgIn: null,
    bgOut: crossfade,
  };
}

/** `t` when no change is running: everything shown as it is. */
const SETTLED = new Animated.Value(1);

interface Leaving {
  track: QueueItem;
  dir: MoveDir;
  /** Where it was when it stopped, so its waveform leaves as it was. */
  progress: Progress;
}

/**
 * The song that was playing, for the moment it takes to fade out, and `t`
 * going 0 → 1 over the change. The whole change runs natively from one value:
 * right after a song change JS is busy, and anything waiting on it would stall.
 */
function useSongChange(live: QueueItem | null, dir: MoveDir) {
  const lastProgress = useRef(new Map<string, Progress>());
  const prev = useRef(live);
  const [change, setChange] = useState<{
    id: string | undefined;
    leaving: Leaving | null;
    t: Animated.Value;
  }>({ id: live?.id, leaving: null, t: SETTLED });

  useEffect(
    () =>
      PlayerService.subscribeProgress(() => {
        const cur = PlayerService.current;
        const p = PlayerService.getProgress();
        if (!cur || !(p.duration > 0)) return;
        const seen = lastProgress.current;
        seen.set(cur.id, p);
        if (seen.size > 8) seen.delete(seen.keys().next().value!);
      }),
    [],
  );

  // Worked out while rendering, and with a new value that starts at 0, so the
  // first frame of the new song already has the old one on top. (Setting an
  // existing value reaches the native side before the old layer is mounted.)
  if (live && change.id !== live.id) {
    const before = prev.current;
    const leaving =
      before && before.id !== live.id
        ? {
            track: before,
            dir,
            progress: lastProgress.current.get(before.id) ?? {
              position: 0,
              duration: before.duration ?? 0,
            },
          }
        : null;
    setChange({
      id: live.id,
      leaving,
      t: leaving ? new Animated.Value(0) : SETTLED,
    });
  }
  prev.current = live;

  const { leaving, t } = change;
  useEffect(() => {
    if (!leaving) return;
    const run = Animated.timing(t, {
      toValue: 1,
      duration: CHANGE_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished)
        setChange(c => (c.leaving === leaving ? { ...c, leaving: null } : c));
    });
    return () => run.stop();
  }, [leaving, t]);

  return { t, leaving };
}

export function PlayerScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const live = useCurrentTrack();
  const st = usePlayerState();
  const { t, leaving: lv } = useSongChange(live, st.moveDir);
  const track = live;
  const {
    playerStyle,
    playbackSpeed,
    suggestSimilar,
    playerArt,
    rotateArt,
    vinylStyle,
    songChange,
    keepScreenOn: keepOn,
  } = useSettings();
  const vinyl = playerArt === 'vinyl';
  const dl = useDownloadProgress(track?.id);
  const sleepLeft = useSleepLeft();
  // The chip says just "End" for the end-of-song timer.
  const sleepAtEnd = !!st.sleep && 'endOfSong' in st.sleep;
  const online = useOnline();
  const scale = useRef(new Animated.Value(1)).current;
  // Swipe the cover like a carousel: it follows the finger with the next (or
  // previous) cover beside it, and on release carries on until that one is in
  // the middle; then the song changes. No song that way: it stretches and
  // springs back.
  const swipeX = useRef(new Animated.Value(0)).current;
  /** The cover swiped in, shown until the player has switched to its song. */
  const [landing, setLanding] = useState<QueueItem | null>(null);
  /** The song reached by the last swipe: its change doesn't animate the cover again. */
  const swipedTo = useRef<string | null>(null);
  const neighbours = useRef<{ prev: QueueItem | null; next: QueueItem | null }>(
    {
      prev: null,
      next: null,
    },
  );
  const swipeW = useRef(width);
  swipeW.current = width;
  const coverSwipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const target =
          g.dx < 0 ? neighbours.current.next : neighbours.current.prev;
        swipeX.setValue(target ? g.dx : g.dx * 0.25);
      },
      onPanResponderRelease: (_, g) => {
        const toNext = g.dx < 0;
        const target = toNext
          ? neighbours.current.next
          : neighbours.current.prev;
        const far = Math.abs(g.dx) > 70 || Math.abs(g.vx) > 0.5;
        if (!far || !target) {
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 16,
            bounciness: 5,
          }).start();
          return;
        }
        haptic('tap');
        const W = swipeW.current;
        const left = W - Math.abs(g.dx);
        Animated.timing(swipeX, {
          toValue: toNext ? -W : W,
          // Keep the finger's speed: a fast flick lands fast.
          duration: Math.max(
            120,
            Math.min(320, left / Math.max(Math.abs(g.vx), 1.2)),
          ),
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          swipedTo.current = target.id;
          setLanding(target);
          if (toNext) PlayerService.next();
          else PlayerService.previousSong();
        });
      },
      onPanResponderTerminate: () =>
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;
  // The landed cover now sits in the middle: bring the carousel back to 0 in
  // the same frame it's drawn there.
  useLayoutEffect(() => {
    if (landing) swipeX.setValue(0);
  }, [landing, swipeX]);
  useEffect(() => {
    if (landing && live?.id === landing.id) setLanding(null);
  }, [landing, live?.id]);
  const [showLyrics, setShowLyrics] = useState(false);

  // The screen stays on while the full player is open (Settings → Appearance).
  useEffect(() => {
    if (!keepOn) return;
    keepScreenOn(true);
    return () => keepScreenOn(false);
  }, [keepOn]);
  const [statusWidth, setStatusWidth] = useState(0);
  const [chipWidths, setChipWidths] = useState<
    Partial<Record<ChipKey, number>>
  >({});

  useEffect(() => {
    Animated.timing(scale, {
      toValue: st.isPlaying || st.isBuffering ? 1 : 0.88,
      duration: 550,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [st.isPlaying, st.isBuffering, scale]);

  if (!track || !live) return <View style={styles.fill} />;

  neighbours.current = {
    prev: st.queue[st.index - 1] ?? null,
    next:
      st.queue[st.index + 1] ??
      (st.repeat === 'all' && !st.shuffle && !st.radio
        ? st.queue[0] ?? null
        : null),
  };
  const centre = landing ?? track;
  // A swipe already brought this song's cover in: don't animate it again.
  const swiped = !!lv && swipedTo.current === track.id;

  const deep = playerStyle === 'deep';
  const P = paletteFor(track);
  const ink = deep ? '#fff' : P.softInk;
  const chip = deep ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)';
  const solid = deep ? P.deep : P.soft;
  const accentOn = deep ? P.accent : P.deep2;
  const { inStyle, outStyle, bgIn, bgOut } = songChangeStyles(
    songChange,
    lv?.dir ?? 0,
    t,
    width,
  );
  const oldInk = lv && (deep ? '#fff' : paletteFor(lv.track).softInk);
  const artSize = Math.min(300, width - 48, height * 0.36);

  /** What the title and status rows show for a song, in its colours. */
  const songInfo = (song: QueueItem, leavingSong: boolean) => {
    const Pt = paletteFor(song);
    const inkT = deep ? '#fff' : Pt.softInk;
    const localT = song.status === 'ready';
    const savingT = song.status === 'downloading';
    const bufT = localT ? 1 : leavingSong ? 0 : dl ?? 0;
    const srcT = sourceLabel[song.source];
    const buffering = !leavingSong && st.isBuffering;
    const showSaveT = song.status === 'streaming' && online;
    return {
      P: Pt,
      ink: inkT,
      solid: deep ? Pt.deep : Pt.soft,
      accentOn: deep ? Pt.accent : Pt.deep2,
      local: localT,
      buffered: bufT,
      showSave: showSaveT,
      status: buffering
        ? tr('player.bufferingFrom', { source: srcT })
        : localT
        ? song.savedAt
          ? tr('player.savedOffline')
          : tr('player.onDevice')
        : savingT
        ? tr('player.sourceSaving', {
            source: srcT,
            percent: Math.round(bufT * 100),
          })
        : tr('player.streamingOnly', { source: srcT }),
      ring: localT
        ? deep
          ? GREEN_LIGHT
          : GREEN
        : savingT
        ? deep
          ? '#FF9A76'
          : ACCENT
        : inkT,
    };
  };

  /**
   * The status row's chips. Crowded, they shrink one by one, in this order:
   * the status text to just its ring, then Save offline, Random and the sleep
   * timer to their icons. `measure` wraps each full-size chip, to know its width.
   */
  const statusChips = (
    i: ReturnType<typeof songInfo>,
    small: Minimised,
    measure?: (key: ChipKey, chip: React.ReactNode) => React.ReactNode,
  ) => {
    const m = measure ?? ((_: ChipKey, chip: React.ReactNode) => chip);
    return (
      <>
        {m(
          'status',
          <View
            accessible
            accessibilityLabel={i.status}
            style={[
              styles.statusChip,
              small.status && styles.statusChipCompact,
              { backgroundColor: chip },
            ]}
          >
            <RingIcon
              color={i.ring}
              track={deep ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}
              progress={i.buffered}
            />
            {!small.status && (
              <Text numberOfLines={1} style={[font(500, 12), { color: i.ink }]}>
                {i.status}
              </Text>
            )}
          </View>,
        )}
        {i.showSave &&
          m(
            'save',
            <Pressable
              onPress={() => PlayerService.saveOffline(live)}
              accessibilityLabel={tr('player.saveOffline')}
              hitSlop={6}
              style={[
                small.save ? styles.iconChip : styles.saveBtn,
                { backgroundColor: i.ink },
              ]}
            >
              <DownloadIcon size={15} color={i.solid} strokeWidth={2.6} />
              {!small.save && (
                <Text style={[font(600, 12), { color: i.solid }]}>
                  {tr('player.saveOffline')}
                </Text>
              )}
            </Pressable>,
          )}
        {st.radio &&
          m(
            'random',
            <Pressable
              onPress={() => PlayerService.stopRadio()}
              accessibilityLabel={tr('player.randomOnHint')}
              hitSlop={6}
              style={[
                small.random ? styles.iconChip : styles.radioChip,
                { backgroundColor: chip },
              ]}
            >
              <SimilarIcon size={small.random ? 16 : 15} color={i.accentOn} />
              {!small.random && (
                <>
                  <Text style={[font(600, 12), { color: i.ink }]}>
                    {tr('player.random')}
                  </Text>
                  <CloseIcon size={8} color={i.ink} />
                </>
              )}
            </Pressable>,
          )}
        {!!sleepLeft &&
          m(
            'sleep',
            <Pressable
              onPress={() => openSheet({ kind: 'sleep' })}
              accessibilityLabel={tr('player.sleepTimerLabel', {
                left: sleepLeft,
              })}
              hitSlop={6}
              style={[
                small.sleep ? styles.iconChip : styles.chipRow,
                { backgroundColor: chip },
              ]}
            >
              <MoonIcon color={i.ink} />
              {!small.sleep && (
                <Text style={[mono(600, 12), { color: i.ink }]}>
                  {sleepAtEnd ? tr('player.sleepEnd') : sleepLeft}
                </Text>
              )}
            </Pressable>,
          )}
        {m(
          'speed',
          <Pressable
            onPress={() => openSheet({ kind: 'speed' })}
            accessibilityLabel={tr('player.playbackSpeed')}
            style={[styles.speedBtn, { backgroundColor: chip }]}
          >
            <SpeedIcon color={i.ink} />
            <Text style={[mono(600, 12), { color: i.ink }]}>
              {speedLabel(playbackSpeed)}
            </Text>
          </Pressable>,
        )}
      </>
    );
  };

  // How many chips must shrink for the row to fit (widths measured at full size).
  const liveInfo = songInfo(track, false);
  const present: Record<ChipKey, boolean> = {
    status: true,
    save: liveInfo.showSave,
    random: st.radio,
    sleep: !!sleepLeft,
    speed: true,
  };
  const fitsWith = (shrunk: number) => {
    let total = 0;
    let count = 0;
    for (const k of CHIP_KEYS) {
      if (!present[k]) continue;
      const order = SHRINK_ORDER.indexOf(k as (typeof SHRINK_ORDER)[number]);
      total += order >= 0 && order < shrunk ? SMALL_CHIP : chipWidths[k] ?? 0;
      count++;
    }
    return total + CHIP_GAP * (count - 1) <= statusWidth;
  };
  let shrunk = 0;
  if (statusWidth > 0)
    while (shrunk < SHRINK_ORDER.length && !fitsWith(shrunk)) shrunk++;
  const mini: Minimised = {
    status: shrunk >= 1,
    save: shrunk >= 2,
    random: shrunk >= 3,
    sleep: shrunk >= 4,
  };

  /** The title row (with Like) and the status row: they swipe with the song. */
  const details = (song: QueueItem, leavingSong: boolean) => {
    const i = songInfo(song, leavingSong);
    return {
      title: (
        <>
          <View style={styles.flex}>
            <SongTitle track={song} ink={i.ink} />
          </View>
          <RoundBtn
            bg={chip}
            size={44}
            haptic="confirm"
            onPress={() => PlayerService.toggleLike(live)}
          >
            <HeartIcon
              size={22}
              color={song.liked ? (deep ? '#FF8A65' : ACCENT) : i.ink}
              fill={song.liked ? (deep ? '#FF8A65' : ACCENT) : 'none'}
            />
          </RoundBtn>
        </>
      ),
      status: statusChips(i, mini),
    };
  };
  const { local, buffered } = liveInfo;
  const shown = details(track, false);
  const gone = lv && details(lv.track, true);

  const next =
    st.queue[st.index + 1] ?? (st.repeat === 'all' ? st.queue[0] : null);
  const upNext = next
    ? `${next.title}${next.artist ? ` — ${next.artist}` : ''}`
    : tr('player.endOfQueue');

  return (
    <View style={styles.fill}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, bgIn]}
      >
        <Backdrop track={live} deep={deep} />
      </Animated.View>
      {!!lv && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, bgOut]}
        >
          <Backdrop track={lv.track} deep={deep} />
        </Animated.View>
      )}

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={styles.top}>
          <RoundBtn bg={chip} onPress={() => nav.goBack()}>
            <ChevronDownIcon color={ink} />
          </RoundBtn>
          <View style={styles.topMid}>
            <Text style={[mono(500, 10), styles.from, { color: ink }]}>
              {tr('player.playingFrom')}
            </Text>
            <Text
              numberOfLines={1}
              style={[font(600, 13), styles.ctx, { color: ink }]}
            >
              {st.contextName}
            </Text>
          </View>
          <RoundBtn
            bg={chip}
            onPress={() => openSheet({ kind: 'menu', track: live })}
          >
            <MoreIcon color={ink} />
          </RoundBtn>
        </View>

        {showLyrics && (
          <LyricsPanel
            track={track}
            ink={ink}
            chip={chip}
            style={styles.lyrics}
          />
        )}
        <Animated.View
          // Hidden but still on top of the lyrics: let touches through to them.
          pointerEvents={showLyrics ? 'none' : 'auto'}
          {...(showLyrics ? {} : coverSwipe.panHandlers)}
          style={[
            styles.artWrap,
            {
              width: artSize,
              height: artSize,
              transform: [{ scale }],
            },
            showLyrics && styles.hidden,
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              swiped || landing ? null : inStyle,
              { transform: [{ translateX: swipeX }] },
            ]}
          >
            <Cover
              track={centre}
              size={artSize}
              vinyl={vinyl}
              vinylStyle={vinylStyle}
              spinning={
                !landing && rotateArt && st.isPlaying && !st.isBuffering
              }
              buffering={!landing && st.isBuffering}
            />
          </Animated.View>
          {!landing &&
            [neighbours.current.prev, neighbours.current.next].map(
              (n, side) =>
                n && (
                  <Animated.View
                    key={side ? 'next' : 'prev'}
                    pointerEvents="none"
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        transform: [
                          {
                            translateX: Animated.add(
                              swipeX,
                              side ? width : -width,
                            ),
                          },
                        ],
                      },
                    ]}
                  >
                    <Cover
                      track={n}
                      size={artSize}
                      vinyl={vinyl}
                      vinylStyle={vinylStyle}
                      spinning={false}
                      buffering={false}
                    />
                  </Animated.View>
                ),
            )}
          {!!lv && !swiped && !landing && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, outStyle]}
            >
              <Cover
                track={lv.track}
                size={artSize}
                vinyl={vinyl}
                vinylStyle={vinylStyle}
                spinning={false}
                buffering={false}
              />
            </Animated.View>
          )}
        </Animated.View>

        <View style={styles.titleWrap}>
          <Animated.View style={[styles.row, inStyle]}>
            {shown.title}
          </Animated.View>
          {!!gone && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.row, outStyle]}
            >
              {gone.title}
            </Animated.View>
          )}
        </View>

        <View
          style={styles.statusWrap}
          onLayout={e => setStatusWidth(e.nativeEvent.layout.width)}
        >
          <View pointerEvents="none" style={styles.measure}>
            {statusChips(liveInfo, FULL, (key, c) => (
              <View
                key={key}
                onLayout={e => {
                  const w = Math.ceil(e.nativeEvent.layout.width);
                  setChipWidths(p => (p[key] === w ? p : { ...p, [key]: w }));
                }}
              >
                {c}
              </View>
            ))}
          </View>
          <Animated.View style={[styles.statusRow, inStyle]}>
            {shown.status}
          </Animated.View>
          {!!gone && (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.statusRow, outStyle]}
            >
              {gone.status}
            </Animated.View>
          )}
        </View>
        {!!st.error && (
          <Text numberOfLines={2} style={[font(400, 12), styles.error]}>
            {st.error}
          </Text>
        )}

        <View style={styles.bottom}>
          <View>
            <Animated.View style={inStyle}>
              <Waveform
                track={track}
                palette={P}
                deep={deep}
                buffered={buffered}
                ink={ink}
                local={local}
              />
            </Animated.View>
            {!!lv && (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, outStyle]}
              >
                <Waveform
                  track={lv.track}
                  frozen={lv.progress}
                  palette={paletteFor(lv.track)}
                  deep={deep}
                  buffered={lv.track.status === 'ready' ? 1 : 0}
                  ink={oldInk!}
                  local={lv.track.status === 'ready'}
                />
              </Animated.View>
            )}
          </View>

          <View style={styles.controls}>
            <IconBtn size={48} onPress={() => PlayerService.toggleShuffle()}>
              <ShuffleIcon size={22} color={st.shuffle ? accentOn : ink} />
              {st.shuffle && <Dot color={accentOn} />}
            </IconBtn>
            <IconBtn size={56} onPress={() => PlayerService.previous()}>
              <PrevIcon color={ink} />
            </IconBtn>
            <Pressable
              onPress={() => PlayerService.togglePlay()}
              style={({ pressed }) => [
                styles.playBtn,
                {
                  backgroundColor: deep ? '#fff' : P.softInk,
                  boxShadow: `0px 12px 30px ${
                    deep ? 'rgba(0,0,0,0.35)' : P.inkA(0.35)
                  }`,
                  transform: [{ scale: pressed ? 0.93 : 1 }],
                },
              ]}
            >
              {st.isPlaying || st.isBuffering ? (
                <PauseIcon size={30} color={deep ? P.deep : '#fff'} />
              ) : (
                <PlayRoundIcon size={30} color={deep ? P.deep : '#fff'} />
              )}
            </Pressable>
            <IconBtn size={56} onPress={() => PlayerService.next()}>
              <NextIcon color={ink} />
            </IconBtn>
            <IconBtn size={48} onPress={() => PlayerService.cycleRepeat()}>
              <RepeatIcon color={st.repeat !== 'off' ? accentOn : ink} />
              {st.repeat === 'one' && (
                <View style={[styles.one, { backgroundColor: accentOn }]}>
                  <Text style={[mono(700, 9), { color: solid }]}>1</Text>
                </View>
              )}
              {st.repeat === 'all' && <Dot color={accentOn} />}
            </IconBtn>
          </View>

          <View style={styles.queueRow}>
            <Pressable
              onPress={() => openSheet({ kind: 'queue' })}
              style={[styles.nextBtn, { backgroundColor: chip }]}
            >
              <QueueIcon color={ink} />
              <Text
                numberOfLines={1}
                style={[font(500, 13), styles.flex, { color: ink }]}
              >
                {upNext}
              </Text>
            </Pressable>
            {suggestSimilar && (
              <Pressable
                onPress={() => openSheet({ kind: 'similar', track: live })}
                style={[styles.similarBtn, { backgroundColor: chip }]}
              >
                <SimilarIcon color={ink} />
                <Text style={[font(600, 13), { color: ink }]}>
                  {tr('player.similar')}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityLabel={
                showLyrics ? tr('player.hideLyrics') : tr('player.showLyrics')
              }
              onPress={() => setShowLyrics(v => !v)}
              style={[
                styles.addBtn,
                { backgroundColor: showLyrics ? ink : chip },
              ]}
            >
              <LyricsIcon color={showLyrics ? solid : ink} />
            </Pressable>
            {(live.status !== 'streaming' || online) && (
              <Pressable
                onPress={() =>
                  live.status === 'streaming'
                    ? PlayerService.saveOffline(live)
                    : openSheet({ kind: 'add', track: live })
                }
                style={[styles.addBtn, { backgroundColor: chip }]}
              >
                <AddToListIcon color={ink} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

/** The big cover (or record) with its glow. */
function Cover({
  track,
  size,
  vinyl,
  vinylStyle,
  spinning,
  buffering,
}: {
  track: QueueItem;
  size: number;
  vinyl: boolean;
  vinylStyle: VinylStyle;
  spinning: boolean;
  buffering: boolean;
}) {
  const P = paletteFor(track);
  const art = artworkUri(track);
  return (
    <>
      <View
        style={[
          styles.glow,
          vinyl && { borderRadius: size / 2 },
          {
            backgroundColor: P.glow,
            boxShadow: `0px 12px 40px 10px ${P.glow}`,
          },
        ]}
      />
      {vinyl && (
        <Vinyl
          uri={art}
          size={size}
          vinylStyle={vinylStyle}
          palette={P}
          spinning={spinning}
          style={styles.disc}
        />
      )}
      <View
        style={[
          vinyl
            ? [StyleSheet.absoluteFill, { borderRadius: size / 2 }]
            : { backgroundColor: P.artBg },
          styles.art,
          vinyl && { borderRadius: size / 2 },
        ]}
        pointerEvents="none"
      >
        {!vinyl && !!art && (
          <Image source={{ uri: art }} style={StyleSheet.absoluteFill} />
        )}
        {buffering && (
          <View style={styles.buffering}>
            <View style={styles.bufPill}>
              <Spinner color="#fff" track="rgba(255,255,255,0.3)" />
              <Text style={[font(500, 12), styles.white]}>
                {tr('player.buffering')}
              </Text>
            </View>
          </View>
        )}
      </View>
    </>
  );
}

function SongTitle({ track, ink }: { track: QueueItem; ink: string }) {
  return (
    <>
      <Text
        numberOfLines={1}
        style={[font(700, 25, 1.15), { color: ink, letterSpacing: -0.5 }]}
      >
        {track.title}
      </Text>
      <Text
        numberOfLines={1}
        style={[font(400, 16), styles.artist, { color: ink }]}
      >
        {track.artist ?? tr('common.unknownArtist')}
      </Text>
    </>
  );
}

/** The player's background for a song: its colours and a blurred copy of its cover. */
function Backdrop({ track, deep }: { track: QueueItem; deep: boolean }) {
  const P = paletteFor(track);
  const art = artworkUri(track);
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.clip,
        {
          backgroundColor: deep ? P.deep : P.soft,
          backgroundImage: deep
            ? `radial-gradient(130% 80% at 50% 0%, ${P.deep2} 0%, ${P.deep} 65%)`
            : `linear-gradient(180deg, ${P.soft2} 0%, ${P.soft} 55%, #F7F6F3 100%)`,
        },
      ]}
    >
      {!!art && (
        <Image
          source={{ uri: art }}
          blurRadius={40}
          style={[styles.blur, { opacity: deep ? 0.6 : 0.45 }]}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: deep
              ? `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, ${P.deep} 72%)`
              : `linear-gradient(180deg, rgba(255,255,255,0.15) 0%, ${P.soft} 70%, #F7F6F3 100%)`,
          },
        ]}
      />
    </View>
  );
}

/**
 * The design's waveform seek bar: 56 bars; played / loaded / not-yet-loaded
 * shades. Tap or drag to seek.
 */
function Waveform({
  track,
  frozen,
  palette: P,
  deep,
  buffered,
  ink,
  local,
}: {
  track: QueueItem;
  /** The song before, leaving: shown where it stopped. */
  frozen?: Progress;
  palette: Palette;
  deep: boolean;
  buffered: number;
  ink: string;
  local: boolean;
}) {
  const { position, duration } = useProgress();
  const { isPlaying, isBuffering } = usePlayerState();
  const { playbackSpeed } = useSettings();
  const width = useRef(1);
  const [rowWidth, setRowWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const smooth = useSmoothProgress(
    position,
    duration,
    isPlaying && !isBuffering,
    playbackSpeed,
    drag,
  );
  // The song's real loudness once it's on the phone; a placeholder shape until then.
  const heights = useMemo(
    () =>
      track.waveform?.length === BARS
        ? withContrast(track.waveform)
        : Array.from({ length: BARS }, (_, i) => {
            const x =
              Math.sin(i * 0.9 + P.h) * 0.5 +
              Math.sin(i * 0.37 + P.h * 2) * 0.35 +
              Math.sin(i * 2.1) * 0.15;
            return Math.round(28 + ((x + 1) / 2) * 72);
          }),
    [P.h, track.waveform],
  );
  const played = frozen
    ? frozen.duration > 0
      ? frozen.position / frozen.duration
      : 0
    : drag ?? (duration > 0 ? position / duration : 0);
  const total = frozen ? frozen.duration : duration || track.duration || 0;
  const cPlayed = deep ? '#fff' : P.softInk;
  const cBuf = deep ? 'rgba(255,255,255,0.42)' : P.inkA(0.35);
  const cEmpty = deep ? 'rgba(255,255,255,0.14)' : P.inkA(0.12);
  const ratio = (x: number) => Math.min(1, Math.max(0, x / width.current));
  const loaded = Math.round(buffered * 100);

  return (
    <View>
      <View
        style={styles.wave}
        onLayout={e => {
          width.current = e.nativeEvent.layout.width || 1;
          setRowWidth(e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => setDrag(ratio(e.nativeEvent.locationX))}
        onResponderMove={e => setDrag(ratio(e.nativeEvent.locationX))}
        onResponderRelease={e => {
          haptic('tick');
          PlayerService.seekTo(ratio(e.nativeEvent.locationX) * duration);
          setDrag(null);
        }}
        onResponderTerminate={() => setDrag(null)}
      >
        {heights.map((h, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.waveBar,
              {
                height: `${h}%`,
                backgroundColor: (i + 0.5) / BARS <= buffered ? cBuf : cEmpty,
              },
            ]}
          />
        ))}
        {/* The played part: the same bars in full colour, clipped to exactly the
            position, so the fill moves through each bar instead of bar by bar. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wavePlayed,
            {
              width: frozen
                ? played * rowWidth
                : smooth.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, rowWidth],
                    extrapolate: 'clamp',
                  }),
            },
          ]}
        >
          <View style={[styles.wave, { width: rowWidth }]}>
            {heights.map((h, i) => (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  { height: `${h}%`, backgroundColor: cPlayed },
                ]}
              />
            ))}
          </View>
        </Animated.View>
      </View>
      <View style={styles.times}>
        <Text style={[mono(500, 12), styles.dim, { color: ink }]}>
          {formatTime(played * total)}
        </Text>
        <Text style={[mono(500, 12), styles.dim, { color: ink }]}>
          {local
            ? ''
            : loaded >= 100
            ? tr('player.fullyLoaded')
            : tr('player.loadedPercent', { percent: loaded })}
        </Text>
        <Text style={[mono(500, 12), styles.dim, { color: ink }]}>
          {formatTime(total)}
        </Text>
      </View>
    </View>
  );
}

/**
 * The playback position (0..1) as an animated value that glides between the
 * player's progress events (a few per second) instead of jumping: each event
 * animates to where the song will be at the next one. Seeks, pauses and
 * dragging move it at once.
 */
function useSmoothProgress(
  position: number,
  duration: number,
  playing: boolean,
  speed: number,
  drag: number | null,
) {
  const value = useRef(new Animated.Value(0)).current;
  const last = useRef({ pos: 0, at: 0, every: 500 });

  useEffect(() => {
    if (drag !== null) {
      value.stopAnimation();
      value.setValue(drag);
      return;
    }
    if (!(duration > 0)) {
      value.setValue(0);
      return;
    }
    const now = Date.now();
    const l = last.current;
    const gap = now - l.at;
    // How often progress events arrive, smoothed.
    if (gap > 50 && gap < 3000) l.every = l.every * 0.7 + gap * 0.3;
    const expected = l.pos + (gap / 1000) * speed;
    const jumped = Math.abs(position - expected) > 1.5;
    l.pos = position;
    l.at = now;

    const here = position / duration;
    if (!playing || jumped) {
      value.stopAnimation();
      value.setValue(here);
      return;
    }
    Animated.timing(value, {
      toValue: Math.min(1, (position + (l.every / 1000) * speed) / duration),
      duration: l.every,
      easing: Easing.linear,
      useNativeDriver: false, // animates a width
    }).start();
  }, [position, duration, playing, speed, drag, value]);

  return value;
}

function RoundBtn({
  bg,
  size = 40,
  haptic: kind,
  onPress,
  children,
}: {
  bg: string;
  size?: number;
  haptic?: HapticKind;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      haptic={kind}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          transform: [{ scale: pressed ? 0.9 : 1 }],
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function IconBtn({
  size,
  onPress,
  children,
}: {
  size: number;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.round, { width: size, height: size }]}
    >
      {children}
    </Pressable>
  );
}

const Dot = ({ color }: { color: string }) => (
  <View style={[styles.dot, { backgroundColor: color }]} />
);

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  clip: { overflow: 'hidden' },
  flex: { flex: 1, minWidth: 0 },
  white: { color: '#fff' },
  // Runs past the bottom of the screen: Android's blur keeps the image's edges
  // sharp, and an edge mid-screen shows as a line behind the status chips.
  // The overlay gradient fades it out well before the bottom anyway.
  blur: {
    position: 'absolute',
    left: '-25%',
    top: '-12%',
    width: '150%',
    height: '125%',
  },
  content: { flex: 1, paddingHorizontal: 24 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topMid: { alignItems: 'center', flex: 1, marginHorizontal: 12 },
  from: { letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 },
  ctx: { marginTop: 2, maxWidth: 220 },
  round: { alignItems: 'center', justifyContent: 'center' },
  artWrap: { alignSelf: 'center', marginTop: 26 },
  // Kept mounted (so the record keeps its angle) but out of the way.
  hidden: { position: 'absolute', opacity: 0 },
  lyrics: { marginTop: 18, marginBottom: 4 },
  glow: {
    position: 'absolute',
    top: 18,
    left: 10,
    right: 10,
    bottom: -14,
    borderRadius: 30,
    opacity: 0.55,
  },
  art: { flex: 1, borderRadius: 24, overflow: 'hidden' },
  disc: {
    ...StyleSheet.absoluteFill,
    boxShadow:
      '0px 0px 0px 3px rgba(0,0,0,0.55), 0px 10px 26px rgba(0,0,0,0.3)',
  },
  buffering: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bufPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  titleWrap: { marginTop: 26 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  artist: { marginTop: 3, opacity: 0.75 },
  statusWrap: { marginTop: 12 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 7,
    paddingRight: 11,
    paddingVertical: 5,
    borderRadius: 999,
    flexShrink: 1,
  },
  statusChipCompact: { paddingRight: 7 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  radioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  // Full-size copies of the status chips, laid out only to be measured.
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    flexDirection: 'row',
    opacity: 0,
  },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  similarBtn: {
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  error: { color: '#FF8A80', marginTop: 6 },
  bottom: { marginTop: 'auto' },
  wave: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 2 },
  waveBar: { flex: 1, borderRadius: 2 },
  wavePlayed: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  dim: { opacity: 0.8 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  playBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  one: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  nextBtn: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
