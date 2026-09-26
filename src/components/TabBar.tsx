import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tr, type Key } from '../i18n';
import { useDownloads } from '../player/hooks';
import { getActiveDownloadIds } from '../services/downloader';
import { ACCENT, mono, useTheme } from '../theme';
import {
  DownloadIcon,
  LibraryTabIcon,
  SearchIcon,
  SettingsTabIcon,
  StatsTabIcon,
} from '../ui/icons';
import { MiniPlayer } from './MiniPlayer';
import { Pressable } from '../ui/Pressable';

const ICONS: Record<string, (c: string) => React.ReactNode> = {
  Library: c => <LibraryTabIcon color={c} />,
  Search: c => <SearchIcon size={24} color={c} strokeWidth={2} />,
  Saving: c => <DownloadIcon size={24} color={c} strokeWidth={2} />,
  Stats: c => <StatsTabIcon color={c} />,
  Settings: c => <SettingsTabIcon color={c} />,
};

const LABELS: Record<string, Key> = {
  Library: 'settings.tabLibrary',
  Search: 'settings.tabSearch',
  Saving: 'settings.tabSaving',
  Stats: 'settings.tabStats',
  Settings: 'settings.tabSettings',
};

/** Mini player + the five-tab bar, icons only (with the Saving badge). */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  useDownloads();
  const active = getActiveDownloadIds().length;

  return (
    <View>
      <MiniPlayer />
      <View
        style={[
          styles.bar,
          {
            paddingBottom: Math.max(insets.bottom, 10),
            borderTopColor: t.line,
            backgroundColor: t.bar,
          },
        ]}
      >
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const color = focused ? t.ink : t.muted2;
          const label = LABELS[route.name]
            ? tr(LABELS[route.name])
            : route.name;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const e = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (focused && route.name === 'Library') {
                  // Tapping Library again returns to its home, like the design's goLib.
                  navigation.navigate('Library', { screen: 'LibraryHome' });
                } else if (!e.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={styles.tab}
            >
              {/* Icons only: the names don't fit in every language (they're still read out). */}
              {ICONS[route.name]?.(color)}
              {route.name === 'Saving' && active > 0 && (
                <View style={styles.badge}>
                  <Text style={[mono(600, 10), styles.badgeText]}>
                    {active}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingTop: 6,
    borderTopWidth: 1,
  },
  tab: {
    width: 72,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    left: 46,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', lineHeight: 16 },
});
