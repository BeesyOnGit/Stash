import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { haptic } from '../services/haptics';
import { font, useTheme } from '../theme';
import { Pressable } from './Pressable';

// ---- cover art ----

export function Cover({
  uri,
  size,
  radius,
  bg,
  style,
}: {
  uri: string | null | undefined;
  size: number;
  radius: number;
  bg: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: bg,
        },
        styles.clip,
        style,
      ]}
    >
      {!!uri && !failed && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

/** 2×2 grid of covers for playlists and collections. */
export function CoverGrid({
  uris,
  size,
  radius,
}: {
  uris: Array<string | null>;
  size: number;
  radius: number;
}) {
  const t = useTheme();
  const cell = size / 2;
  const four = uris.length
    ? Array.from({ length: 4 }, (_, i) => uris[i % uris.length])
    : [];
  return (
    <View
      style={[
        styles.grid,
        styles.clip,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: t.fill3,
        },
      ]}
    >
      {four.map((u, i) =>
        u ? (
          <Image
            key={i}
            source={{ uri: u }}
            style={{ width: cell, height: cell }}
          />
        ) : (
          <View key={i} style={{ width: cell, height: cell }} />
        ),
      )}
    </View>
  );
}

// ---- animated bits ----

/** The three bouncing bars shown on the current song's cover. */
export function Equalizer({
  color,
  playing,
}: {
  color: string;
  playing: boolean;
}) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current;
  useEffect(() => {
    if (!playing) {
      bars.forEach(b => b.setValue(0.4));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(b, {
            toValue: 1,
            duration: 350 + i * 90,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(b, {
            toValue: 0.35,
            duration: 350 + i * 90,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [playing, bars]);
  return (
    <View style={styles.eq}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            styles.eqBar,
            {
              backgroundColor: color,
              transformOrigin: 'bottom',
              transform: [{ scaleY: b }],
            },
          ]}
        />
      ))}
    </View>
  );
}

export function Spinner({
  color,
  track,
  size = 14,
}: {
  color: string;
  track: string;
  size?: number;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: track,
        borderTopColor: color,
        transform: [{ rotate }],
      }}
    />
  );
}

// ---- controls ----

/** The rounded segmented control (Songs/Playlists/Genres, Light/Dark…). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  height = 36,
  compact,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  height?: number;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.segment,
        {
          backgroundColor: t.fill2,
          borderRadius: compact ? 11 : 14,
          padding: compact ? 3 : 4,
        },
      ]}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            haptic="tick"
            onPress={() => onChange(o.value)}
            style={[
              styles.segItem,
              {
                height,
                borderRadius: compact ? 8 : 10,
                paddingHorizontal: compact ? 12 : 0,
                flex: compact ? undefined : 1,
                backgroundColor: on ? t.card : 'transparent',
                boxShadow: on ? '0px 1px 3px rgba(0,0,0,0.12)' : undefined,
              },
            ]}
          >
            <Text
              style={[
                font(on ? 600 : 500, compact ? 13 : 14),
                { color: t.ink },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pill chip; `on` renders it filled with ink. */
export function Chip({
  label,
  on,
  onPress,
  size = 13,
}: {
  label: string;
  on?: boolean;
  onPress: () => void;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      haptic="tick"
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? t.ink : t.line2,
          backgroundColor: on ? t.ink : t.card,
        },
      ]}
    >
      <Text style={[font(500, size), { color: on ? t.onInk : t.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  const x = useRef(new Animated.Value(value ? 23 : 3)).current;
  useEffect(() => {
    Animated.timing(x, {
      toValue: value ? 23 : 3,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [value, x]);
  return (
    <Pressable
      haptic="toggle"
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={[styles.toggle, { backgroundColor: value ? '#E0532F' : t.fill3 }]}
    >
      <Animated.View
        style={[styles.knob, { transform: [{ translateX: x }] }]}
      />
    </Pressable>
  );
}

/** Horizontal slider built on the responder system (no extra native module). */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  color = '#E0532F',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  color?: string;
}) {
  const t = useTheme();
  const width = useRef(1);
  const ratio = (value - min) / (max - min);
  const pick = (x: number) => {
    const r = Math.min(1, Math.max(0, x / width.current));
    const v = Math.min(
      max,
      Math.max(min, Math.round((min + r * (max - min)) / step) * step),
    );
    if (v !== value) haptic('tick');
    onChange(v);
  };
  return (
    <View
      style={styles.sliderHit}
      onLayout={e => (width.current = e.nativeEvent.layout.width || 1)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={e => pick(e.nativeEvent.locationX)}
      onResponderMove={e => pick(e.nativeEvent.locationX)}
    >
      <View style={[styles.sliderTrack, { backgroundColor: t.fill3 }]}>
        <View
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            backgroundColor: color,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.sliderThumb,
          { left: `${ratio * 100}%`, borderColor: color },
        ]}
      />
    </View>
  );
}

/** Small uppercase badge ("NEW", "FROM THE WEB"). */
export function Badge({ label, size = 9 }: { label: string; size?: number }) {
  const t = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: t.accentSoft }]}>
      <Text
        style={{
          fontFamily: 'GeistMono-SemiBold',
          fontSize: size,
          letterSpacing: size * 0.05,
          textTransform: 'uppercase',
          color: t.accentInk,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Soft grey info box used for empty states. */
export function Note({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: t.fill }, style]}>
      <Text style={[font(400, 14, 1.4), { color: t.ink2 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  eq: { flexDirection: 'row', alignItems: 'flex-end', height: 14, gap: 2 },
  eqBar: { width: 3, height: 14, borderRadius: 1 },
  segment: { flexDirection: 'row' },
  segItem: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
  },
  toggle: { width: 50, height: 30, borderRadius: 15 },
  knob: {
    position: 'absolute',
    top: 3,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    boxShadow: '0px 1px 3px rgba(0,0,0,0.25)',
  },
  sliderHit: { height: 32, justifyContent: 'center', marginTop: 8 },
  sliderTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  sliderThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 2,
    boxShadow: '0px 1px 3px rgba(0,0,0,0.2)',
  },
  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },
  note: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14 },
});
