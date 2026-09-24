import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { VinylStyle } from '../services/settings';
import type { Palette } from '../theme';

/** One turn, like the design (a slow 10 rpm spin reads better than a real 33). */
const PERIOD_MS = 6000;

/**
 * Disc colour and how much of it the cover takes. `big` is the player's record
 * (small centre hole), `small` the bubble's and the settings previews (a label).
 * Same values as the native bubble (bubble/VinylView.kt).
 */
export const VINYL: Record<
  VinylStyle,
  { label: string; disc: string | null; big: number; small: number; op: number }
> = {
  classic: { label: 'Classic', disc: '#141414', big: 12, small: 30, op: 1 },
  colour: { label: 'Colour', disc: null, big: 12, small: 30, op: 1 },
  picture: { label: 'Picture', disc: '#141414', big: 0, small: 0, op: 1 },
  clear: {
    label: 'Clear',
    disc: 'rgba(255,255,255,0.22)',
    big: 20,
    small: 32,
    op: 0.92,
  },
};

export const discColor = (style: VinylStyle, P: Palette | null) =>
  VINYL[style].disc ?? (P ? P.deep : 'hsl(30, 45%, 30%)');

/** A record with the cover in the middle; turns while `spinning`, keeps its angle when paused. */
export function Vinyl({
  uri,
  size,
  vinylStyle,
  palette,
  spinning,
  small,
  style,
  children,
}: {
  uri: string | null | undefined;
  size: number;
  vinylStyle: VinylStyle;
  palette: Palette | null;
  spinning: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning) {
      rot.stopAnimation();
      return;
    }
    let alive = true;
    // Continue from the current angle, so pausing doesn't snap the record back.
    const turn = () =>
      rot.stopAnimation(v => {
        if (!alive) return;
        Animated.timing(rot, {
          toValue: 1,
          duration: Math.max(1, (1 - v) * PERIOD_MS),
          easing: Easing.linear,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished && alive) {
            rot.setValue(0);
            turn();
          }
        });
      });
    turn();
    return () => {
      alive = false;
      rot.stopAnimation();
    };
  }, [spinning, rot]);

  const cfg = VINYL[vinylStyle];
  const inset = small ? cfg.small : cfg.big;
  const r = size / 2;
  const artR = r * (1 - (2 * inset) / 100);
  const step = small ? 3 : 6;
  const grooves: number[] = [];
  for (let g = r - step / 2; g > Math.max(artR, 4); g -= step) grooves.push(g);
  const spindle = small ? 4 : 6;
  const rotate = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: r,
          backgroundColor: discColor(vinylStyle, palette),
          transform: [{ rotate }],
        },
        styles.clip,
        style,
      ]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {grooves.map(g => (
          <Circle
            key={g}
            cx={r}
            cy={r}
            r={g}
            fill="none"
            stroke={`rgba(255,255,255,${small ? 0.08 : 0.05})`}
            strokeWidth={small ? 0.5 : 0.75}
          />
        ))}
      </Svg>
      {!!uri && (
        <Image
          source={{ uri }}
          style={{
            position: 'absolute',
            left: r - artR,
            top: r - artR,
            width: artR * 2,
            height: artR * 2,
            borderRadius: artR,
            opacity: cfg.op,
          }}
        />
      )}
      {!small && inset > 0 && (
        <View
          style={[styles.label, { backgroundColor: palette?.artBg ?? '#888' }]}
        />
      )}
      <View
        style={[
          styles.spindle,
          {
            width: spindle,
            height: spindle,
            borderRadius: spindle / 2,
            marginLeft: -spindle / 2,
            marginTop: -spindle / 2,
          },
        ]}
      />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  label: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 22,
    height: 22,
    marginLeft: -11,
    marginTop: -11,
    borderRadius: 11,
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.6)',
  },
  spindle: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    backgroundColor: '#0B0B0D',
  },
});
