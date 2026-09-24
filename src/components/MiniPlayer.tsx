import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { navigationRef } from '../navigation/ref';
import { PlayerService } from '../player/PlayerService';
import {
  useCurrentTrack,
  useDownloadProgress,
  usePlayerState,
  useProgress,
} from '../player/hooks';
import { haptic } from '../services/haptics';
import { ACCENT, font, paletteFor, sourceLabel, useTheme } from '../theme';
import { artworkUri } from '../types';
import {
  CloseIcon,
  HeartIcon,
  PauseIcon,
  PlayRoundIcon,
  SimilarIcon,
} from '../ui/icons';
import { Cover } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

export function MiniPlayer() {
  const t = useTheme();
  const track = useCurrentTrack();
  const { isPlaying, isResolving, error, radio } = usePlayerState();
  const { position, duration } = useProgress();
  const dl = useDownloadProgress(track?.id);
  const swipe = useSwipeToStop();

  if (!track && !isResolving && !error) return null;

  const pal = track ? paletteFor(track) : null;
  const bg = pal ? (t.dark ? pal.deep2 : pal.soft) : t.card;
  const ink = pal ? (t.dark ? '#fff' : pal.softInk) : t.ink;
  const src = track ? sourceLabel[track.source] : '';
  const status = error
    ? error
    : isResolving
    ? 'Finding the stream…'
    : !track
    ? ''
    : track.status === 'ready'
    ? `${track.artist ?? 'Unknown artist'} · Offline`
    : dl !== undefined
    ? `Saving ${Math.round(dl * 100)}% · ${src}`
    : `Streaming · ${src}`;
  const buffered = track?.status === 'ready' ? 1 : dl ?? 0;
  const played = duration > 0 ? position / duration : 0;

  return (
    <Animated.View
      style={[styles.wrap, swipe.style]}
      onLayout={swipe.onLayout}
      {...swipe.handlers}
    >
      <Pressable
        onPress={() => track && navigationRef.navigate('Player')}
        style={[styles.card, { backgroundColor: bg }]}
      >
        <Cover
          uri={track ? artworkUri(track) : null}
          size={44}
          radius={10}
          bg={pal?.artBg ?? t.fill3}
        />
        <View style={styles.info}>
          <Text numberOfLines={1} style={[font(600, 14, 1.25), { color: ink }]}>
            {track?.title ?? 'Loading…'}
          </Text>
          <Text
            numberOfLines={1}
            style={[
              font(400, 12, 1.35),
              styles.dim,
              { color: error ? t.danger : ink },
            ]}
          >
            {status}
          </Text>
        </View>
        {radio && (
          <Pressable
            hitSlop={8}
            accessibilityLabel="Random suggestions on. Tap to turn off"
            onPress={() => PlayerService.stopRadio()}
            style={styles.radio}
          >
            <SimilarIcon size={18} color={ink} />
            <View style={[styles.radioDot, { backgroundColor: ACCENT }]} />
          </Pressable>
        )}
        {track && (
          <Pressable
            hitSlop={8}
            haptic="confirm"
            style={styles.heart}
            onPress={() => PlayerService.toggleLike(track)}
          >
            <HeartIcon color={ink} fill={track.liked ? ink : 'none'} />
          </Pressable>
        )}
        <Pressable
          hitSlop={8}
          onPress={() => PlayerService.togglePlay()}
          style={[styles.play, { backgroundColor: ink }]}
        >
          {isResolving ? (
            <ActivityIndicator size="small" color={bg} />
          ) : isPlaying ? (
            <PauseIcon color={bg} />
          ) : (
            <PlayRoundIcon color={bg} />
          )}
        </Pressable>
        <Pressable
          hitSlop={8}
          accessibilityLabel="Stop playing"
          onPress={() => PlayerService.stop()}
          style={styles.close}
        >
          <CloseIcon size={11} color={ink} />
        </Pressable>
        <View style={styles.progress}>
          <View
            style={[
              styles.bar,
              styles.buffered,
              { width: `${buffered * 100}%` },
            ]}
          />
          <View
            style={[
              styles.bar,
              { width: `${played * 100}%`, backgroundColor: ink },
            ]}
          />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Swipe the mini player left or right to stop, like its ✕. It follows the
 * finger and fades; past a third of its width (or a quick flick) it slides
 * off, otherwise it springs back. Only clearly sideways drags count, so taps
 * and scrolling are untouched.
 */
function useSwipeToStop() {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(1);

  const responder = useRef(
    PanResponder.create({
      // Capture: win over the buttons inside once the drag is clearly sideways.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      // One driver for the drag and the release (JS: the drag is a JS event).
      onPanResponderMove: Animated.event([null, { dx: x }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, g) => {
        const out =
          Math.abs(g.dx) > width.current / 3 ||
          (Math.abs(g.vx) > 0.8 && Math.abs(g.dx) > 30);
        if (!out) {
          Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
          return;
        }
        haptic('confirm');
        Animated.timing(x, {
          toValue: Math.sign(g.dx) * width.current,
          duration: 160,
          useNativeDriver: false,
        }).start(() => {
          PlayerService.stop();
          x.setValue(0); // ready for the next song
        });
      },
      onPanResponderTerminate: () =>
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(),
    }),
  ).current;

  return {
    handlers: responder.panHandlers,
    onLayout: (e: { nativeEvent: { layout: { width: number } } }) =>
      (width.current = e.nativeEvent.layout.width || 1),
    style: {
      transform: [{ translateX: x }],
      opacity: x.interpolate({
        inputRange: [-300, 0, 300],
        outputRange: [0.2, 1, 0.2],
        extrapolate: 'clamp',
      }),
    },
  };
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingBottom: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow:
      '0px 8px 24px rgba(20,18,14,0.12), 0px 0px 0px 1px rgba(0,0,0,0.04)',
  },
  info: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.8 },
  radio: {
    width: 30,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    position: 'absolute',
    top: 9,
    right: 3,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heart: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    width: 22,
    height: 40,
    marginLeft: -4,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 3,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  buffered: { backgroundColor: 'rgba(0,0,0,0.15)' },
});
