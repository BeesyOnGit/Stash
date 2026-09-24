/**
 * Online / offline, for hiding what needs a connection (online search,
 * downloads, "Save offline", web links, YouTube suggestions).
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

/** Unknown counts as online: better to show a button than hide it by mistake. */
let online = true;
const listeners = new Set<() => void>();

const isOnlineState = (s: NetInfoState) =>
  s.isConnected !== false && s.isInternetReachable !== false;

NetInfo.addEventListener(s => {
  const next = isOnlineState(s);
  if (next === online) return;
  online = next;
  listeners.forEach(fn => fn());
});

export const isOnline = () => online;

export function subscribeNetwork(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** True while the phone has a working connection; re-renders when that changes. */
export const useOnline = () => useSyncExternalStore(subscribeNetwork, isOnline);
