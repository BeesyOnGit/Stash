/**
 * A buzz when a button is pressed (Settings → Appearance → Haptic feedback),
 * at the chosen strength. Android only: native side is haptics/Haptics.kt.
 */
import { NativeModules, Platform } from 'react-native';
import { getSettings } from './settings';

/**
 * - `tap`: buttons, rows, tabs
 * - `tick`: small choices (chips, segments, slider steps)
 * - `toggle`: switches
 * - `confirm`: like, save, create
 */
export type HapticKind = 'tap' | 'tick' | 'toggle' | 'confirm';

const Native:
  | { perform(kind: HapticKind, strength: string): void }
  | undefined =
  Platform.OS === 'android' ? NativeModules.StashHaptics : undefined;

export const hapticsSupported = () => !!Native;

export function haptic(kind: HapticKind = 'tap') {
  const s = getSettings();
  if (Native && s.haptics) Native.perform(kind, s.hapticStrength);
}
