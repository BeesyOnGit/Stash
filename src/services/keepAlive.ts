/**
 * Android pauses JS timers while the app is in the background, and resolving a
 * YouTube stream (youtubei.js) waits on one, so online songs started from the
 * background (the floating bubble, random suggestions after a song ends) would
 * wait until the app is opened. A headless JS task keeps timers running: hold
 * one for as long as the work takes (60 s at most).
 * Native side: holdJs in bubble/BubbleModule.kt.
 */
import { AppRegistry, AppState, NativeModules, Platform } from 'react-native';

const Native: { holdJs(timeoutMs: number): void } | undefined =
  Platform.OS === 'android' ? NativeModules.StashBubble : undefined;

/** Same name as KEEP_ALIVE_TASK in BubbleModule.kt. */
const TASK = 'StashBubbleKeepAlive';
const releases: (() => void)[] = [];
/** Work that finished before its task started: end that task right away. */
let finishedEarly = 0;

if (Native) {
  AppRegistry.registerHeadlessTask(
    TASK,
    () => () =>
      new Promise<void>(resolve => {
        if (finishedEarly > 0) {
          finishedEarly--;
          resolve();
        } else releases.push(resolve);
      }),
  );
}

export async function whileAway<T>(work: () => T | Promise<T>): Promise<T> {
  if (!Native || AppState.currentState === 'active') return work();
  Native.holdJs(60_000);
  try {
    return await work();
  } finally {
    const release = releases.shift();
    if (release) release();
    else finishedEarly++;
  }
}
