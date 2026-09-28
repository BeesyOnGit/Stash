/**
 * Online / offline, for hiding what needs a connection (online search,
 * downloads, "Save offline", web links, YouTube suggestions).
 */
import { useSyncExternalStore } from 'react';

let online = navigator.onLine !== false;
const listeners = new Set<() => void>();

const update = () => {
  const next = navigator.onLine !== false;
  if (next === online) return;
  online = next;
  listeners.forEach(fn => fn());
};
window.addEventListener('online', update);
window.addEventListener('offline', update);

export const isOnline = () => online;

export function subscribeNetwork(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True while the computer has a connection; re-renders when that changes. */
export const useOnline = () => useSyncExternalStore(subscribeNetwork, isOnline);
