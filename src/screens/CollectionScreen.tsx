import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRow } from '../components/TrackRow';
import { deletePlaylist, setPlaylistOrder } from '../db/database';
import { tr } from '../i18n';
import type { LibraryStackParamList } from '../navigation/types';
import { PlayerService } from '../player/PlayerService';
import { useLibrary } from '../player/hooks';
import { smartListName, smartTracks } from '../services/smartLists';
import { openSheet, toast } from '../state/ui';
import { eyebrow, font, genreColors, paletteFor, useTheme } from '../theme';
import { artworkUri, type Track } from '../types';
import { ChevronLeftIcon, GripIcon, PlayIcon, ShuffleIcon } from '../ui/icons';
import { CoverGrid, Note } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';
import { useReorder } from '../ui/reorder';

type Props = NativeStackScreenProps<LibraryStackParamList, 'Collection'>;

export function CollectionScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tracks, byId, playlists } = useLibrary();
  const p = route.params;

  const {
    name,
    kind,
    list: saved,
    playlistId,
  } = useMemo(() => {
    const ready = tracks.filter(x => x.status !== 'streaming');
    if (p.kind === 'liked') {
      return {
        name: tr('library.likedSongs'),
        kind: tr('library.kindPlaylist'),
        list: ready.filter(x => x.liked),
      };
    }
    if (p.kind === 'smart') {
      return {
        name: smartListName(p.list),
        kind: tr('library.kindAuto'),
        list: smartTracks(p.list, tracks),
      };
    }
    if (p.kind === 'genre') {
      return {
        name: p.genre,
        kind: tr('library.kindGenre'),
        list: ready.filter(x => x.genre === p.genre),
      };
    }
    const pl = playlists.find(x => x.id === p.id);
    return {
      name: pl?.name ?? tr('library.kindPlaylist'),
      kind: tr('library.kindPlaylist'),
      playlistId: pl?.id,
      list: (pl?.trackIds ?? [])
        .map(id => byId.get(id))
        .filter(Boolean) as Track[],
    };
  }, [p, tracks, byId, playlists]);

  // A playlist's new order shows at once, before the library reloads with it.
  const [order, setOrder] = useState<string[] | null>(null);
  useEffect(() => setOrder(null), [saved]);
  const list = useMemo(
    () =>
      order
        ? (order
            .map(id => saved.find(x => x.id === id))
            .filter(Boolean) as Track[])
        : saved,
    [order, saved],
  );
  const reorder = useReorder(list.length, (from, to) => {
    const ids = list.map(x => x.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setOrder(ids);
    if (playlistId) setPlaylistOrder(playlistId, ids).catch(() => {});
  });

  // Header colour: the genre's colour, or the first song's palette.
  let bg = t.dark ? '#1C1C20' : '#EFEDE8';
  let ink = t.ink;
  if (p.kind === 'genre') {
    const c = genreColors(p.genre, t.dark);
    bg = c.bg;
    ink = c.ink;
  } else if (list[0]) {
    const pal = paletteFor(list[0]);
    bg = t.dark ? pal.deep2 : pal.soft;
    ink = t.dark ? '#F2F1EE' : pal.softInk;
  }
  const mins = Math.round(list.reduce((a, x) => a + (x.duration ?? 0), 0) / 60);

  const remove = () =>
    Alert.alert(name, tr('library.deletePlaylistBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deletePlaylist(playlistId!);
          navigation.goBack();
          toast(tr('library.playlistDeleted'));
        },
      },
    ]);

  const header = (
    <View>
      <View
        style={[
          styles.hero,
          { backgroundColor: bg, paddingTop: insets.top + 6 },
        ]}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.back, { backgroundColor: t.glass }]}
        >
          <ChevronLeftIcon color={t.ink} />
          <Text style={[font(500, 14), { color: t.ink }]}>
            {tr('library.title')}
          </Text>
        </Pressable>
        <View style={styles.heroRow}>
          <View style={styles.heroArt}>
            <CoverGrid
              uris={list.slice(0, 4).map(artworkUri)}
              size={128}
              radius={18}
            />
          </View>
          <View style={styles.heroText}>
            <Text style={[eyebrow(11), { color: ink }]}>{kind}</Text>
            <Text
              style={[font(700, 26, 1.1), styles.heroTitle, { color: ink }]}
            >
              {name}
            </Text>
            <Text style={[font(400, 13), styles.heroMeta, { color: ink }]}>
              {tr('common.songs', { count: list.length })} ·{' '}
              {tr('library.minutes', { count: mins })}
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <Pressable
            onPress={() => PlayerService.playQueue(list, 0, name, false)}
            style={[styles.btn, { backgroundColor: t.ink }]}
          >
            <PlayIcon color={t.onInk} />
            <Text style={[font(600, 14), { color: t.onInk }]}>
              {tr('common.play')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => list.length && PlayerService.shuffleAll(list, name)}
            style={[styles.btn, { backgroundColor: t.glass }]}
          >
            <ShuffleIcon color={t.ink} />
            <Text style={[font(600, 14), { color: t.ink }]}>
              {tr('common.shuffle')}
            </Text>
          </Pressable>
        </View>
      </View>
      {!list.length && (
        <Note style={styles.empty}>
          {p.kind === 'smart'
            ? p.list === 'most'
              ? tr('library.emptyMost')
              : tr('library.emptySaved')
            : tr('library.emptyPlaylist')}
        </Note>
      )}
    </View>
  );

  const footer = playlistId ? (
    <Pressable onPress={remove} style={styles.delete}>
      <Text style={[font(500, 14), { color: t.danger }]}>
        {tr('library.deletePlaylist')}
      </Text>
    </Pressable>
  ) : undefined;

  // Playlists: plain rows with drag handles (the order is theirs to choose).
  if (playlistId) {
    return (
      <View style={[styles.screen, { backgroundColor: t.bg }]}>
        <ScrollView
          scrollEnabled={!reorder.dragging}
          contentContainerStyle={styles.pad}
        >
          {header}
          {list.map((item, index) => (
            <Animated.View
              key={item.id}
              onLayout={index === 0 ? reorder.measure : undefined}
              style={[{ backgroundColor: t.bg }, reorder.rowStyle(index)]}
            >
              <TrackRow
                track={item}
                onPress={() => PlayerService.playQueue(list, index, name)}
                onMenu={() =>
                  openSheet({ kind: 'menu', track: item, playlistId })
                }
                trailing={
                  <View
                    {...reorder.handle(index)}
                    hitSlop={8}
                    accessibilityLabel={tr('library.dragToReorder')}
                    style={styles.grip}
                  >
                    <GripIcon color={t.muted2} />
                  </View>
                }
              />
            </Animated.View>
          ))}
          {footer}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <FlatList
        data={list}
        keyExtractor={x => x.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.pad}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            onPress={() => PlayerService.playQueue(list, index, name)}
            onMenu={() => openSheet({ kind: 'menu', track: item, playlistId })}
          />
        )}
        ListFooterComponent={footer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingBottom: 16 },
  grip: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
  },
  hero: { paddingHorizontal: 20, paddingBottom: 22 },
  back: {
    alignSelf: 'flex-start',
    height: 36,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-end',
    marginTop: 16,
  },
  heroArt: { borderRadius: 18, boxShadow: '0px 12px 30px rgba(20,18,14,0.18)' },
  heroText: { flex: 1, minWidth: 0, paddingBottom: 4 },
  heroTitle: { marginTop: 4, letterSpacing: -0.5 },
  heroMeta: { marginTop: 6, opacity: 0.8 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  empty: { margin: 20 },
  delete: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginBottom: 24,
    marginTop: 10,
  },
});
