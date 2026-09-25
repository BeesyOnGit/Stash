/**
 * App-wide UI state that isn't tied to one screen: the toast banner and the
 * bottom sheets (song menu, add to playlist, new playlist, queue, speed, similar).
 */
import { useSyncExternalStore } from 'react';
import type { Release } from '../services/updater';
import type { QueueItem } from '../types';

export type Sheet =
  | { kind: 'menu'; track: QueueItem; playlistId?: string }
  | { kind: 'add'; track: QueueItem }
  | { kind: 'new' }
  | { kind: 'queue' }
  | { kind: 'speed' }
  | { kind: 'sleep' }
  | { kind: 'addMany'; trackIds: string[] }
  | { kind: 'similar'; track: QueueItem }
  | { kind: 'update'; release: Release };

interface UiState {
  toast: { text: string; at: number } | null;
  sheet: Sheet | null;
}

let state: UiState = { toast: null, sheet: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<UiState>) => {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string) {
  const at = Date.now();
  set({ toast: { text, at } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast?.at === at) set({ toast: null });
  }, 3000);
}

export const openSheet = (sheet: Sheet) => set({ sheet });
export const closeSheet = () => set({ sheet: null });

export const useUi = () => useSyncExternalStore(subscribe, () => state);
