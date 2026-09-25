/**
 * Keeping the screen on while the full player is open (Settings → Appearance).
 * Android only: native side is display/ScreenModule.kt.
 */
import { NativeModules, Platform } from 'react-native';

const Native: { keepOn(on: boolean): void } | undefined =
  Platform.OS === 'android' ? NativeModules.StashScreen : undefined;

export const keepScreenOnSupported = () => !!Native;

export function keepScreenOn(on: boolean) {
  Native?.keepOn(on);
}
