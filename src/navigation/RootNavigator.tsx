import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type NavigationState,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { Sheets } from '../components/Sheets';
import { TabBar } from '../components/TabBar';
import { CollectionScreen } from '../screens/CollectionScreen';
import { KaraokeScreen } from '../screens/KaraokeScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { SavingScreen } from '../screens/SavingScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { useSettings } from '../services/settings';
import { useTheme } from '../theme';
import { Toast } from '../ui/Toast';
import { navigationRef } from './ref';
import type {
  LibraryStackParamList,
  RootStackParamList,
  TabParamList,
} from './types';

const Root = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const LibStack = createNativeStackNavigator<LibraryStackParamList>();

function LibraryTab() {
  return (
    <LibStack.Navigator screenOptions={{ headerShown: false }}>
      <LibStack.Screen name="LibraryHome" component={LibraryScreen} />
      <LibStack.Screen name="Collection" component={CollectionScreen} />
    </LibStack.Navigator>
  );
}

/** Where you are, so remounting (on a language change) brings you back there. */
let savedState: NavigationState | undefined;

const renderTabBar = (props: React.ComponentProps<typeof TabBar>) => (
  <TabBar {...props} />
);

function Tabs() {
  return (
    <Tab.Navigator tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Library" component={LibraryTab} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Saving" component={SavingScreen} />
      <Tab.Screen name="Stats" component={StatsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const t = useTheme();
  const { playerStyle } = useSettings();
  const [route, setRoute] = useState<string | undefined>();
  // Light status bar text on dark backgrounds (dark theme, or the deep player).
  const lightBar =
    t.dark ||
    route === 'Karaoke' ||
    (route === 'Player' && playerStyle === 'deep');

  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: t.bg,
      card: t.card,
      text: t.ink,
      border: t.line,
      primary: t.ink,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      initialState={savedState}
      onStateChange={state => {
        savedState = state;
        setRoute(navigationRef.getCurrentRoute()?.name);
      }}
    >
      <StatusBar barStyle={lightBar ? 'light-content' : 'dark-content'} />
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs" component={Tabs} />
        <Root.Screen
          name="Player"
          component={PlayerScreen}
          options={{
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
          }}
        />
        <Root.Screen
          name="Karaoke"
          component={KaraokeScreen}
          options={{
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
          }}
        />
      </Root.Navigator>
      <Sheets />
      <Toast />
    </NavigationContainer>
  );
}
