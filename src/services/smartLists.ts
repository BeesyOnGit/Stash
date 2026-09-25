import type { Track } from '../types';

export type SmartList = 'recent' | 'most' | 'downloaded';

export const SMART_LISTS: Array<{ id: SmartList; name: string }> = [
  { id: 'recent', name: 'Recently added' },
  { id: 'most', name: 'Most played' },
  { id: 'downloaded', name: 'Downloaded' },
];

const LIMIT = 100;

export const smartListName = (id: SmartList) =>
  SMART_LISTS.find(x => x.id === id)!.name;

/** The songs of an automatic playlist, from the whole library. */
export function smartTracks(id: SmartList, tracks: Track[]): Track[] {
  const ready = tracks.filter(x => x.status === 'ready');
  switch (id) {
    case 'recent':
      return [...ready].sort((a, b) => b.addedAt - a.addedAt).slice(0, LIMIT);
    case 'most':
      return ready
        .filter(x => (x.playCount ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.playCount ?? 0) - (a.playCount ?? 0) ||
            (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0),
        )
        .slice(0, LIMIT);
    case 'downloaded':
      return ready
        .filter(x => x.source !== 'device')
        .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  }
}
