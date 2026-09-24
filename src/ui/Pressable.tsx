import React from 'react';
import { Pressable as RNPressable, type PressableProps } from 'react-native';
import { haptic, type HapticKind } from '../services/haptics';

/**
 * React Native's Pressable with haptic feedback on press (when it's on in
 * Settings). `haptic` picks the feel; `false` for taps that shouldn't buzz,
 * like closing a sheet by tapping outside it.
 */
export const Pressable = React.forwardRef<
  React.ComponentRef<typeof RNPressable>,
  PressableProps & { haptic?: HapticKind | false }
>(({ haptic: kind = 'tap', onPress, ...rest }, ref) => (
  <RNPressable
    ref={ref}
    {...rest}
    onPress={
      onPress &&
      (e => {
        onPress(e);
        // After the press, so a new strength (or turning haptics on) is felt at once.
        if (kind) haptic(kind);
      })
    }
  />
));
