import { createNavigationContainerRef } from '@react-navigation/native';
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

export function goToTab(tab: 'Library' | 'Search' | 'Saving' | 'Settings') {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Tabs', { screen: tab } as any);
}
