import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRow } from '../components/TrackRow';
import { deletePlaylist } from '../db/database';
import type { LibraryStackParamList } from '../navigation/types';
import { PlayerService } from '../player/PlayerService';
import { useLibrary } from '../player/hooks';
import { openSheet, toast } from '../state/ui';
import { eyebrow, font, genreColors, paletteFor, useTheme } from '../theme';
import { artworkUri, type Track } from '../types';
import { ChevronLeftIcon, PlayIcon, ShuffleIcon } from '../ui/icons';
import { CoverGrid, Note } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

type Props = NativeStackScreenProps<LibraryStackParamList, 'Collection'>;

export function CollectionScreen({ route, navigation }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tracks, byId, playlists } = useLibrary();
  const p = route.params;

  const { name, kind, list, playlistId } = useMemo(() => {
    const ready = tracks.filter(x => x.status !== 'streaming');
    if (p.kind === 'liked') {
      return {
        name: 'Liked songs',
        kind: 'Playlist',
        list: ready.filter(x => x.liked),
      };
    }
    if (p.kind === 'genre') {
      return {
        name: p.genre,
        kind: 'Genre',
        list: ready.filter(x => x.genre === p.genre),
      };
    }
    const pl = playlists.find(x => x.id === p.id);
    return {
      name: pl?.name ?? 'Playlist',
      kind: 'Playlist',
      playlistId: pl?.id,
      list: (pl?.trackIds ?? [])
        .map(id => byId.get(id))
        .filter(Boolean) as Track[],
    };
  }, [p, tracks, byId, playlists]);

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
    Alert.alert(name, 'Delete this playlist? The songs stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePlaylist(playlistId!);
          navigation.goBack();
          toast('Playlist deleted');
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
          <Text style={[font(500, 14), { color: t.ink }]}>Library</Text>
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
              {list.length} songs · {mins} min
            </Text>
          </View>
        </View>
        <View style={styles.buttons}>
          <Pressable
            onPress={() => PlayerService.playQueue(list, 0, name, false)}
            style={[styles.btn, { backgroundColor: t.ink }]}
          >
            <PlayIcon color={t.onInk} />
            <Text style={[font(600, 14), { color: t.onInk }]}>Play</Text>
          </Pressable>
          <Pressable
            onPress={() => list.length && PlayerService.shuffleAll(list, name)}
            style={[styles.btn, { backgroundColor: t.glass }]}
          >
            <ShuffleIcon color={t.ink} />
            <Text style={[font(600, 14), { color: t.ink }]}>Shuffle</Text>
          </Pressable>
        </View>
      </View>
      {!list.length && (
        <Note style={styles.empty}>
          No songs yet. Use the ••• menu on any song, or the add button in the
          player.
        </Note>
      )}
    </View>
  );

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
        ListFooterComponent={
          playlistId ? (
            <Pressable onPress={remove} style={styles.delete}>
              <Text style={[font(500, 14), { color: t.danger }]}>
                Delete playlist
              </Text>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingBottom: 16 },
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
