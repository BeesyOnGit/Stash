import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRow } from '../components/TrackRow';
import { tr, type Key } from '../i18n';
import type { LibraryStackParamList } from '../navigation/types';
import { PlayerService } from '../player/PlayerService';
import { useLibrary } from '../player/hooks';
import { deleteFromLibrary } from '../services/library';
import {
  SMART_LISTS,
  smartListName,
  smartTracks,
} from '../services/smartLists';
import { formatBytes } from '../services/storage';
import { openSheet, toast } from '../state/ui';
import {
  ACCENT,
  GREEN,
  eyebrow,
  font,
  genreColors,
  mono,
  paletteFor,
  sourceLabel,
  useTheme,
} from '../theme';
import { artworkUri, type Track } from '../types';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CloseIcon,
  HeartSolidIcon,
  PlayIcon,
  PlusIcon,
  ShuffleIcon,
} from '../ui/icons';
import {
  Badge,
  Chip,
  Cover,
  CoverGrid,
  Note,
  Segmented,
} from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

type Seg = 'songs' | 'playlists' | 'genres';
type Sort = 'recent' | 'az' | 'artist';
const SORTS: { value: Sort; label: Key }[] = [
  { value: 'recent', label: 'library.sortRecent' },
  { value: 'az', label: 'library.sortAZ' },
  { value: 'artist', label: 'library.sortArtist' },
];
type Nav = NativeStackNavigationProp<LibraryStackParamList>;

export interface GenreInfo {
  name: string;
  tracks: Track[];
}

/** Genres present in the library, biggest first. */
export function useGenres(): GenreInfo[] {
  const { tracks } = useLibrary();
  return useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of tracks) {
      if (t.status !== 'ready' || !t.genre) continue;
      if (!map.has(t.genre)) map.set(t.genre, []);
      map.get(t.genre)!.push(t);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, tracks: list }))
      .sort((a, b) => b.tracks.length - a.tracks.length);
  }, [tracks]);
}

export function LibraryScreen() {
  const t = useTheme();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { tracks, playlists, byId, loading } = useLibrary();
  const genres = useGenres();
  const [seg, setSeg] = useState<Seg>('songs');
  const [sort, setSort] = useState<Sort>('recent');
  /** Ids of the songs picked by long-pressing; null when not choosing. */
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selecting = seg === 'songs' && !!selected;

  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  const toggleSelected = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next.size ? next : null;
    });

  const ready = useMemo(
    () => tracks.filter(x => x.status !== 'streaming'),
    [tracks],
  );
  const sorted = useMemo(() => {
    const list = [...ready];
    if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'artist')
      list.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? ''));
    return list;
  }, [ready, sort]);
  const recent = useMemo(
    () =>
      ready
        .filter(x => x.lastPlayedAt && x.status === 'ready')
        .sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
        .slice(0, 8),
    [ready],
  );
  const justSaved = useMemo(
    () =>
      ready
        .filter(x => x.savedAt && x.source !== 'device')
        .sort((a, b) => b.savedAt! - a.savedAt!)
        .slice(0, 8),
    [ready],
  );
  const liked = ready.filter(x => x.liked);
  const totalBytes = ready.reduce((a, x) => a + (x.sizeBytes ?? 0), 0);
  const smart = useMemo(
    () => SMART_LISTS.map(s => ({ ...s, tracks: smartTracks(s.id, tracks) })),
    [tracks],
  );
  // In the list's order, so Play keeps the order they're shown in.
  const picked = selected ? sorted.filter(x => selected.has(x.id)) : [];

  const done = () => setSelected(null);
  const allLiked = picked.length > 0 && picked.every(x => x.liked);

  const playPicked = () => {
    PlayerService.playQueue(picked, 0, tr('library.selectedQueue'), false);
    done();
  };
  const addPicked = () => {
    openSheet({ kind: 'addMany', trackIds: picked.map(x => x.id) });
    done();
  };
  const likePicked = async () => {
    for (const x of picked) {
      if (x.liked === allLiked) await PlayerService.toggleLike(x);
    }
    toast(
      allLiked
        ? tr('library.unliked')
        : tr('library.likedCount', { count: picked.length }),
    );
    done();
  };
  const deletePicked = () => {
    const playingId = PlayerService.current?.id;
    const removable = picked.filter(x => x.id !== playingId);
    if (!removable.length) {
      toast(tr('library.cantRemovePlaying'));
      return;
    }
    const n = removable.length;
    Alert.alert(
      tr('library.removeTitle', { count: n }),
      tr('library.removeBody') +
        (removable.length < picked.length
          ? '\n\n' + tr('library.removePlayingStays')
          : ''),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('common.remove'),
          style: 'destructive',
          onPress: async () => {
            done();
            for (const x of removable) await deleteFromLibrary(x);
            toast(tr('library.removedCount', { count: n }));
          },
        },
      ],
    );
  };

  const covers = (ids: string[]) =>
    ids.slice(0, 4).map(id => {
      const x = byId.get(id);
      return x ? artworkUri(x) : null;
    });

  const header = (
    <View>
      <View style={styles.head}>
        <View>
          <Text style={[eyebrow(), { color: t.muted }]}>
            {tr('library.eyebrow')}
          </Text>
          <Text style={[styles.h1, { color: t.ink }]}>
            {tr('library.title')}
          </Text>
        </View>
        <View
          style={[
            styles.countPill,
            { backgroundColor: t.card, borderColor: t.line },
          ]}
        >
          <CheckCircleIcon color={GREEN} />
          <Text style={[font(500, 12), { color: t.ink2 }]}>
            {tr('common.songs', { count: ready.length })} ·{' '}
            {formatBytes(totalBytes)}
          </Text>
        </View>
      </View>

      <View style={styles.segWrap}>
        <Segmented
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'songs', label: tr('library.segSongs') },
            { value: 'playlists', label: tr('library.segPlaylists') },
            { value: 'genres', label: tr('library.segGenres') },
          ]}
        />
      </View>

      {seg === 'songs' && (
        <View>
          {recent.length > 0 && (
            <Carousel
              title={tr('library.recentlyPlayed')}
              tracks={recent}
              onPlay={x =>
                PlayerService.playQueue(
                  [x],
                  0,
                  tr('library.recentlyPlayed'),
                  false,
                )
              }
            />
          )}
          {justSaved.length > 0 && (
            <Carousel
              title={tr('library.justSaved')}
              badge={tr('library.fromWeb')}
              tracks={justSaved}
              subtitle={x =>
                tr('library.fromSource', { source: sourceLabel[x.source] })
              }
              onPlay={x =>
                PlayerService.playQueue([x], 0, tr('library.justSaved'), false)
              }
            />
          )}
          <View style={styles.buttons}>
            <Pressable
              onPress={() =>
                PlayerService.playQueue(sorted, 0, tr('library.title'), false)
              }
              style={[styles.bigBtn, { backgroundColor: t.ink }]}
            >
              <PlayIcon color={t.onInk} />
              <Text style={[font(600, 14), { color: t.onInk }]}>
                {tr('common.play')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                sorted.length &&
                PlayerService.shuffleAll(sorted, tr('library.title'))
              }
              style={[
                styles.bigBtn,
                styles.outline,
                { backgroundColor: t.card, borderColor: t.line2 },
              ]}
            >
              <ShuffleIcon color={t.ink} />
              <Text style={[font(600, 14), { color: t.ink }]}>
                {tr('common.shuffle')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.sorts}>
            {SORTS.map(s => (
              <Chip
                key={s.value}
                label={tr(s.label)}
                on={sort === s.value}
                onPress={() => setSort(s.value)}
              />
            ))}
          </View>
          {!loading && !sorted.length && (
            <Note style={styles.noteMargin}>{tr('library.empty')}</Note>
          )}
        </View>
      )}

      {seg === 'playlists' && (
        <View style={styles.lists}>
          <ListRow
            onPress={() => openSheet({ kind: 'new' })}
            art={
              <View style={[styles.dashed, { borderColor: t.line2 }]}>
                <PlusIcon color={t.ink} />
              </View>
            }
            title={tr('library.newPlaylist')}
          />
          <ListRow
            onPress={() => nav.navigate('Collection', { kind: 'liked' })}
            art={
              <View style={[styles.likedArt, { backgroundColor: ACCENT }]}>
                <HeartSolidIcon size={26} color="#fff" />
              </View>
            }
            title={tr('library.likedSongs')}
            meta={`${tr('common.songs', { count: liked.length })} · ${tr(
              'library.autoPlaylistMeta',
            )}`}
          />
          {smart.map(s => (
            <ListRow
              key={s.id}
              onPress={() =>
                nav.navigate('Collection', { kind: 'smart', list: s.id })
              }
              art={
                <CoverGrid
                  uris={s.tracks.slice(0, 4).map(artworkUri)}
                  size={62}
                  radius={14}
                />
              }
              title={smartListName(s.id)}
              meta={`${tr('common.songs', { count: s.tracks.length })} · ${tr(
                'library.autoPlaylistMeta',
              )}`}
              chevron
            />
          ))}
          {playlists.map(p => (
            <ListRow
              key={p.id}
              onPress={() =>
                nav.navigate('Collection', { kind: 'playlist', id: p.id })
              }
              art={
                <CoverGrid uris={covers(p.trackIds)} size={62} radius={14} />
              }
              title={p.name}
              meta={tr('common.songs', { count: p.trackIds.length })}
              chevron
            />
          ))}
        </View>
      )}

      {seg === 'genres' && (
        <View style={styles.genreGrid}>
          {!genres.length && (
            <Note style={styles.fullWidth}>{tr('library.genresEmpty')}</Note>
          )}
          {genres.map(g => (
            <GenreTile
              key={g.name}
              genre={g}
              onPress={() =>
                nav.navigate('Collection', { kind: 'genre', genre: g.name })
              }
            />
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View
      style={[styles.screen, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <FlatList
        data={seg === 'songs' ? sorted : []}
        keyExtractor={x => x.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.listPad}
        extraData={selected}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            subtitle={[item.artist ?? tr('common.unknownArtist'), item.genre]
              .filter(Boolean)
              .join(' · ')}
            selected={selecting ? selected!.has(item.id) : undefined}
            onLongPress={() => toggleSelected(item.id)}
            onPress={() => {
              if (selecting) {
                toggleSelected(item.id);
                return;
              }
              const playable = sorted.filter(x => x.status !== 'streaming');
              PlayerService.playQueue(
                playable,
                playable.indexOf(sorted[index]),
                tr('library.title'),
              );
            }}
            onMenu={() => openSheet({ kind: 'menu', track: item })}
          />
        )}
      />
      {selecting && (
        <View
          style={[
            styles.selectBar,
            {
              paddingTop: insets.top + 8,
              backgroundColor: t.bg,
              borderBottomColor: t.line,
            },
          ]}
        >
          <View style={styles.selectHead}>
            <Pressable
              onPress={done}
              hitSlop={8}
              accessibilityLabel={tr('library.stopSelecting')}
              style={[styles.selectClose, { backgroundColor: t.fill }]}
            >
              <CloseIcon size={10} color={t.ink} />
            </Pressable>
            <Text style={[font(600, 17), styles.flex, { color: t.ink }]}>
              {tr('library.selectedCount', { count: picked.length })}
            </Text>
            <Pressable
              haptic="tick"
              hitSlop={8}
              onPress={() =>
                setSelected(
                  picked.length === sorted.length
                    ? null
                    : new Set(sorted.map(x => x.id)),
                )
              }
            >
              <Text style={[font(600, 14), { color: ACCENT }]}>
                {picked.length === sorted.length
                  ? tr('library.selectNone')
                  : tr('library.selectAll')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.selectActions}>
            <SelectAction label={tr('common.play')} onPress={playPicked} />
            <SelectAction
              label={tr('library.addToPlaylist')}
              onPress={addPicked}
            />
            <SelectAction
              label={allLiked ? tr('library.unlike') : tr('library.like')}
              onPress={likePicked}
            />
            <SelectAction
              label={tr('common.remove')}
              danger
              onPress={deletePicked}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function SelectAction({
  label,
  danger,
  onPress,
}: {
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectAction,
        { backgroundColor: pressed ? t.fill2 : t.fill },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[font(600, 13), { color: danger ? t.danger : t.ink }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Carousel({
  title,
  badge,
  tracks,
  subtitle,
  onPlay,
}: {
  title: string;
  badge?: string;
  tracks: Track[];
  subtitle?: (t: Track) => string;
  onPlay: (t: Track) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.carousel}>
      <View style={styles.carouselHead}>
        <Text style={[font(600, 16), { color: t.ink }]}>{title}</Text>
        {!!badge && <Badge label={badge} size={10} />}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carouselRow}
      >
        {tracks.map(x => (
          <Pressable key={x.id} onPress={() => onPlay(x)} style={styles.tile}>
            <Cover
              uri={artworkUri(x)}
              size={118}
              radius={16}
              bg={paletteFor(x).artBg}
            />
            <Text
              numberOfLines={1}
              style={[font(500, 14, 1.25), styles.mt8, { color: t.ink }]}
            >
              {x.title}
            </Text>
            <Text
              numberOfLines={1}
              style={[font(400, 12, 1.3), { color: t.muted }]}
            >
              {subtitle ? subtitle(x) : x.artist ?? tr('common.unknownArtist')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ListRow({
  art,
  title,
  meta,
  chevron,
  onPress,
}: {
  art: React.ReactNode;
  title: string;
  meta?: string;
  chevron?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        pressed && { backgroundColor: t.fill },
      ]}
    >
      {art}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[font(600, 15), { color: t.ink }]}>
          {title}
        </Text>
        {!!meta && (
          <Text style={[font(400, 13), styles.mt2, { color: t.muted }]}>
            {meta}
          </Text>
        )}
      </View>
      {chevron && <ChevronRightIcon color={t.muted2} />}
    </Pressable>
  );
}

export function GenreTile({
  genre,
  onPress,
}: {
  genre: GenreInfo;
  onPress: () => void;
}) {
  const t = useTheme();
  const c = genreColors(genre.name, t.dark);
  const a = genre.tracks[0];
  const b = genre.tracks[1] ?? a;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.genre, { backgroundColor: c.bg }]}
    >
      {a && artworkUri(a) && (
        <Image
          source={{ uri: artworkUri(a)! }}
          style={[styles.gImg1, styles.gShadow]}
        />
      )}
      {b && artworkUri(b) && (
        <Image
          source={{ uri: artworkUri(b)! }}
          style={[styles.gImg2, styles.gShadow]}
        />
      )}
      <Text
        style={[font(700, 18, 1.1), { color: c.ink, letterSpacing: -0.36 }]}
      >
        {genre.name}
      </Text>
      <Text style={[mono(500, 12), styles.gCount, { color: c.ink }]}>
        {tr('common.songs', { count: genre.tracks.length })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  listPad: { paddingBottom: 16 },
  mt2: { marginTop: 2 },
  mt8: { marginTop: 8 },
  head: {
    paddingHorizontal: 20,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  h1: { ...font(700, 34, 1.05), letterSpacing: -1, marginTop: 4 },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  segWrap: { marginHorizontal: 20, marginTop: 16 },
  carousel: { paddingTop: 22 },
  carouselHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  carouselRow: { gap: 12, paddingHorizontal: 20 },
  tile: { width: 118 },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  bigBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  outline: { borderWidth: 1 },
  sorts: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 6,
  },
  noteMargin: { marginHorizontal: 20, marginTop: 12 },
  lists: { paddingTop: 18, paddingBottom: 20 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  dashed: {
    width: 62,
    height: 62,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  likedArt: {
    width: 62,
    height: 62,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  fullWidth: { width: '100%' },
  genre: {
    width: '47.5%',
    flexGrow: 1,
    height: 112,
    borderRadius: 18,
    overflow: 'hidden',
    padding: 14,
    justifyContent: 'flex-end',
  },
  gImg1: {
    position: 'absolute',
    right: -10,
    top: -8,
    width: 62,
    height: 62,
    borderRadius: 10,
    transform: [{ rotate: '14deg' }],
  },
  gImg2: {
    position: 'absolute',
    right: 36,
    top: 10,
    width: 46,
    height: 46,
    borderRadius: 8,
    transform: [{ rotate: '-8deg' }],
  },
  gShadow: { boxShadow: '0px 6px 16px rgba(0,0,0,0.18)' },
  selectBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  selectHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  selectAction: {
    flexGrow: 1,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gCount: { marginTop: 3, opacity: 0.75 },
});
