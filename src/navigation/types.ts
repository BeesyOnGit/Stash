import type { NavigatorScreenParams } from '@react-navigation/native';
import type { SmartList } from '../services/smartLists';

export type CollectionParams =
  | { kind: 'liked' }
  | { kind: 'smart'; list: SmartList }
  | { kind: 'genre'; genre: string }
  | { kind: 'playlist'; id: string };

export type LibraryStackParamList = {
  LibraryHome: undefined;
  Collection: CollectionParams;
};

export type TabParamList = {
  Library: NavigatorScreenParams<LibraryStackParamList>;
  Search: undefined;
  Saving: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  Player: undefined;
};
