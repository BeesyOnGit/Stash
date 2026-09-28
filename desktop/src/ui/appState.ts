/**
 * Where the window is: the sidebar tab, the open collection, the Now playing
 * panel, lyrics, full screen and karaoke. A tiny store, like state/ui.
 */
import { useSyncExternalStore } from 'react';
import type { SmartList } from '../core/services/smartLists';

export type Tab = 'library' | 'search' | 'stats' | 'saving' | 'settings';
export type Seg = 'songs' | 'playlists' | 'genres';

export type Collection =
  | { kind: 'liked' }
  | { kind: 'playlist'; id: string }
  | { kind: 'genre'; genre: string }
  | { kind: 'smart'; id: SmartList };

export interface AppState {
  tab: Tab;
  seg: Seg;
  detail: Collection | null;
  query: string;
  /** The Now playing panel on the right. */
  panel: boolean;
  lyrics: boolean;
  fullScreen: boolean;
  /** The song karaoke is open for. */
  karaoke: string | null;
  /** Library multi-select. */
  selecting: boolean;
  selected: string[];
}

let state: AppState = {
  tab: 'library',
  seg: 'songs',
  detail: null,
  query: '',
  panel: true,
  lyrics: false,
  fullScreen: false,
  karaoke: null,
  selecting: false,
  selected: [],
};
const listeners = new Set<() => void>();

export function setApp(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach(fn => fn());
}
export const getApp = () => state;
export const useApp = () =>
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );

export const openCollection = (detail: Collection) =>
  setApp({ tab: 'library', detail, fullScreen: false, karaoke: null });
export const goTab = (tab: Tab) =>
  setApp({ tab, detail: null, selecting: false, selected: [], karaoke: null, fullScreen: false });
export const openKaraoke = (trackId: string) =>
  setApp({ karaoke: trackId, fullScreen: false });
