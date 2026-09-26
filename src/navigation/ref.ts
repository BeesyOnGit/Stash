import { createNavigationContainerRef } from '@react-navigation/native';
import { canKaraoke } from '../services/karaoke';
import type { Track } from '../types';
import type { CollectionParams, RootStackParamList } from './types';

/** Lets code outside screens (sheets, the player) navigate. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function openCollection(params: CollectionParams) {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Tabs', {
    screen: 'Library',
    params: { screen: 'Collection', params },
  });
}

/** Karaoke for a song on the phone (it asks how to sing it first). */
export function openKaraoke(track: Track) {
  if (!navigationRef.isReady() || !canKaraoke(track)) return;
  navigationRef.navigate('Karaoke', { trackId: track.id });
}

export function goToTab(tab: 'Library' | 'Search' | 'Saving' | 'Settings') {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Tabs', { screen: tab } as any);
}
