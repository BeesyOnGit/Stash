import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlayerService } from '../player/PlayerService';
import {
  useCurrentTrack,
  useDownloadProgress,
  usePlayerState,
  useProgress,
} from '../player/hooks';
import { useOnline } from '../services/network';
import { haptic, type HapticKind } from '../services/haptics';
import { speedLabel, useSettings } from '../services/settings';
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
  LyricsIcon,
  HeartIcon,
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

export function PlayerScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const track = useCurrentTrack();
  const st = usePlayerState();
  const {
    playerStyle,
    playbackSpeed,
    suggestSimilar,
    playerArt,
    rotateArt,
    vinylStyle,
  } = useSettings();
  const vinyl = playerArt === 'vinyl';
  const dl = useDownloadProgress(track?.id);
  const online = useOnline();
  const scale = useRef(new Animated.Value(1)).current;
  const [showLyrics, setShowLyrics] = useState(false);

  useEffect(() => {
    Animated.timing(scale, {
      toValue: st.isPlaying || st.isBuffering ? 1 : 0.88,
      duration: 550,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [st.isPlaying, st.isBuffering, scale]);

  if (!track) return <View style={styles.fill} />;

  const deep = playerStyle === 'deep';
  const P = paletteFor(track);
  const ink = deep ? '#fff' : P.softInk;
  const chip = deep ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)';
  const solid = deep ? P.deep : P.soft;
  const accentOn = deep ? P.accent : P.deep2;
  const art = artworkUri(track);
  const artSize = Math.min(300, width - 48, height * 0.36);

  const local = track.status === 'ready';
  const saving = track.status === 'downloading';
  const buffered = local ? 1 : dl ?? 0;
  const src = sourceLabel[track.source];
  const status = st.isBuffering
    ? `Buffering from ${src}`
    : local
    ? track.savedAt
      ? 'Saved · plays offline'
      : 'On device · offline'
    : saving
    ? `${src} · saving ${Math.round(buffered * 100)}%`
    : `${src} · streaming only`;
  const ring = local
    ? deep
      ? GREEN_LIGHT
      : GREEN
    : saving
    ? deep
      ? '#FF9A76'
      : ACCENT
    : ink;

  const showSave = track.status === 'streaming' && online;
  // Save offline + Random + speed don't fit next to the full text: keep just the ring.
  const compactStatus = st.radio && showSave;

  const next =
    st.queue[st.index + 1] ?? (st.repeat === 'all' ? st.queue[0] : null);
  const upNext = next
    ? `${next.title}${next.artist ? ` — ${next.artist}` : ''}`
    : 'End of queue';

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: solid,
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
              Playing from
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
            onPress={() => openSheet({ kind: 'menu', track })}
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
          style={[
            showLyrics && styles.hidden,
            styles.artWrap,
            { width: artSize, height: artSize, transform: [{ scale }] },
          ]}
        >
          <View
            style={[
              styles.glow,
              vinyl && { borderRadius: artSize / 2 },
              {
                backgroundColor: P.glow,
                boxShadow: `0px 12px 40px 10px ${P.glow}`,
              },
            ]}
          />
          {vinyl && (
            <Vinyl
              uri={art}
              size={artSize}
              vinylStyle={vinylStyle}
              palette={P}
              spinning={rotateArt && st.isPlaying && !st.isBuffering}
              style={styles.disc}
            />
          )}
          <View
            style={[
              vinyl
                ? [StyleSheet.absoluteFill, { borderRadius: artSize / 2 }]
                : { backgroundColor: P.artBg },
              styles.art,
              vinyl && { borderRadius: artSize / 2 },
            ]}
            pointerEvents="none"
          >
            {!vinyl && !!art && (
              <Image source={{ uri: art }} style={StyleSheet.absoluteFill} />
            )}
            {st.isBuffering && (
              <View style={styles.buffering}>
                <View style={styles.bufPill}>
                  <Spinner color="#fff" track="rgba(255,255,255,0.3)" />
                  <Text style={[font(500, 12), styles.white]}>Buffering</Text>
                </View>
              </View>
            )}
          </View>
        </Animated.View>

        <View style={styles.titleRow}>
          <View style={styles.flex}>
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
              {track.artist ?? 'Unknown artist'}
            </Text>
          </View>
          <RoundBtn
            bg={chip}
            size={44}
            haptic="confirm"
            onPress={() => PlayerService.toggleLike(track)}
          >
            <HeartIcon
              size={22}
              color={track.liked ? (deep ? '#FF8A65' : ACCENT) : ink}
              fill={track.liked ? (deep ? '#FF8A65' : ACCENT) : 'none'}
            />
          </RoundBtn>
        </View>

        <View style={styles.statusRow}>
          <View
            accessible
            accessibilityLabel={status}
            style={[
              styles.statusChip,
              compactStatus && styles.statusChipCompact,
              { backgroundColor: chip },
            ]}
          >
            <RingIcon
              color={ring}
              track={deep ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}
              progress={buffered}
            />
            {!compactStatus && (
              <Text style={[font(500, 12), { color: ink }]}>{status}</Text>
            )}
          </View>
          {showSave && (
            <Pressable
              onPress={() => PlayerService.saveOffline(track)}
              style={[styles.saveBtn, { backgroundColor: ink }]}
            >
              <Text style={[font(600, 12), { color: solid }]}>
                Save offline
              </Text>
            </Pressable>
          )}
          {st.radio && (
            <Pressable
              onPress={() => PlayerService.stopRadio()}
              accessibilityLabel="Random suggestions on. Tap to turn off"
              style={[styles.radioChip, { backgroundColor: chip }]}
            >
              <SimilarIcon size={15} color={accentOn} />
              <Text style={[font(600, 12), { color: ink }]}>Random</Text>
              <CloseIcon size={8} color={ink} />
            </Pressable>
          )}
          <Pressable
            onPress={() => openSheet({ kind: 'speed' })}
            accessibilityLabel="Playback speed"
            style={[styles.speedBtn, { backgroundColor: chip }]}
          >
            <SpeedIcon color={ink} />
            <Text style={[mono(600, 12), { color: ink }]}>
              {speedLabel(playbackSpeed)}
            </Text>
          </Pressable>
        </View>
        {!!st.error && (
          <Text numberOfLines={2} style={[font(400, 12), styles.error]}>
            {st.error}
          </Text>
        )}

        <View style={styles.bottom}>
          <Waveform
            track={track}
            palette={P}
            deep={deep}
            buffered={buffered}
            ink={ink}
            local={local}
          />

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
                onPress={() => openSheet({ kind: 'similar', track })}
                style={[styles.similarBtn, { backgroundColor: chip }]}
              >
                <SimilarIcon color={ink} />
                <Text style={[font(600, 13), { color: ink }]}>Similar</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityLabel={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
              onPress={() => setShowLyrics(v => !v)}
              style={[
                styles.addBtn,
                { backgroundColor: showLyrics ? ink : chip },
              ]}
            >
              <LyricsIcon color={showLyrics ? solid : ink} />
            </Pressable>
            {(track.status !== 'streaming' || online) && (
              <Pressable
                onPress={() =>
                  track.status === 'streaming'
                    ? PlayerService.saveOffline(track)
                    : openSheet({ kind: 'add', track })
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

/**
 * The design's waveform seek bar: 56 bars; played / loaded / not-yet-loaded
 * shades. Tap or drag to seek.
 */
function Waveform({
  track,
  palette: P,
  deep,
  buffered,
  ink,
  local,
}: {
  track: QueueItem;
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
  const played = drag ?? (duration > 0 ? position / duration : 0);
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
              width: smooth.interpolate({
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
          {formatTime(played * duration)}
        </Text>
        <Text style={[mono(500, 12), styles.dim, { color: ink }]}>
          {local ? '' : loaded >= 100 ? 'fully loaded' : `${loaded}% loaded`}
        </Text>
        <Text style={[mono(500, 12), styles.dim, { color: ink }]}>
          {formatTime(duration || track.duration)}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 26,
  },
  artist: { marginTop: 3, opacity: 0.75 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
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
  saveBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  radioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 9,
    paddingRight: 11,
    paddingVertical: 6,
    borderRadius: 999,
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
