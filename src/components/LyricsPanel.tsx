import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PlayerService } from '../player/PlayerService';
import { useProgress } from '../player/hooks';
import {
  chooseLyrics,
  lyricsFor,
  searchLyrics,
  type LyricLine,
  type Lyrics,
  type LyricsMatch,
} from '../services/lyrics';
import { useOnline } from '../services/network';
import { splitArtistTitle } from '../sources/http';
import { font, formatTime, mono } from '../theme';
import type { Track } from '../types';
import { Spinner } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

interface Colors {
  /** Text on the player background. */
  ink: string;
  /** Translucent chip background. */
  chip: string;
}

/**
 * The player's lyrics, in place of the cover. Timed lyrics follow the song
 * (the current line lit, tap a line to jump there); plain lyrics just scroll.
 */
export function LyricsPanel({
  track,
  ink,
  chip,
  style,
}: Colors & { track: Track; style?: StyleProp<ViewStyle> }) {
  const [lyrics, setLyrics] = useState<Lyrics | null>(null); // null: looking
  const [searching, setSearching] = useState(false);
  const online = useOnline();

  useEffect(() => {
    let live = true;
    setLyrics(null);
    setSearching(false);
    lyricsFor(track).then(l => live && setLyrics(l));
    return () => {
      live = false;
    };
    // Only when the song changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  if (searching) {
    return (
      <LyricsSearch
        track={track}
        ink={ink}
        chip={chip}
        style={style}
        onCancel={() => setSearching(false)}
        onPicked={l => {
          setLyrics(l);
          setSearching(false);
        }}
      />
    );
  }

  let body: React.ReactNode;
  if (!lyrics) {
    body = (
      <View style={styles.center}>
        <Spinner color={ink} track="rgba(255,255,255,0.25)" />
        <Text style={[font(500, 14), styles.dim, { color: ink }]}>
          Looking for lyrics…
        </Text>
      </View>
    );
  } else if (lyrics.lines) {
    body = <Synced key={track.id} lines={lyrics.lines} ink={ink} />;
  } else if (lyrics.plain) {
    body = (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.plainPad}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[font(600, 19, 1.5), { color: ink }]}>{lyrics.plain}</Text>
      </ScrollView>
    );
  } else {
    body = (
      <View style={styles.center}>
        <Text style={[font(600, 17), { color: ink }]}>No lyrics found</Text>
        <Text
          style={[
            font(400, 13, 1.4),
            styles.dim,
            styles.centerText,
            { color: ink },
          ]}
        >
          {online
            ? 'Search for them yourself — sometimes the song is listed under another name.'
            : 'Lyrics are looked up online the first time, then saved on the phone.'}
        </Text>
        {online && (
          <Pressable
            onPress={() => setSearching(true)}
            style={[styles.pill, { backgroundColor: chip }]}
          >
            <Text style={[font(600, 13), { color: ink }]}>Search lyrics</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.flex, style]}>
      {body}
      {!!lyrics && (lyrics.lines || lyrics.plain) && (
        <View style={styles.footer}>
          <Text
            numberOfLines={1}
            style={[mono(500, 11), styles.flex, styles.faint, { color: ink }]}
          >
            {lyrics.source ?? ''}
            {lyrics.lines ? ' · synced' : ''}
          </Text>
          {online && (
            <Pressable hitSlop={8} onPress={() => setSearching(true)}>
              <Text style={[font(600, 12), styles.dim, { color: ink }]}>
                Wrong lyrics?
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ---- timed lyrics ----

/** After the user scrolls, leave the list alone this long before following the song again. */
const HANDS_OFF_MS = 3500;

function Synced({ lines, ink }: { lines: LyricLine[]; ink: string }) {
  const { position } = useProgress();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const ys = useRef<number[]>([]);
  const height = useRef(0);
  const touchedAt = useRef(0);
  const dragging = useRef(false);
  // Stable, so each Line only re-renders when its own state changes.
  const setY = useCallback((i: number, y: number) => (ys.current[i] = y), []);

  // The line being sung: the last one that has started (a hair early feels in time).
  let current = -1;
  for (let i = 0; i < lines.length && lines[i].time <= position + 0.3; i++) {
    current = i;
  }

  useEffect(() => {
    if (
      current < 0 ||
      dragging.current ||
      Date.now() - touchedAt.current < HANDS_OFF_MS
    ) {
      return;
    }
    const y = ys.current[current];
    if (y === undefined) return;
    scroll.current?.scrollTo({
      y: Math.max(0, y - height.current * 0.35),
      animated: true,
    });
  }, [current]);

  return (
    <ScrollView
      ref={scroll}
      style={styles.flex}
      contentContainerStyle={styles.syncedPad}
      showsVerticalScrollIndicator={false}
      onLayout={e => (height.current = e.nativeEvent.layout.height)}
      onScrollBeginDrag={() => (dragging.current = true)}
      onScrollEndDrag={() => {
        dragging.current = false;
        touchedAt.current = Date.now();
      }}
      onMomentumScrollEnd={() => (touchedAt.current = Date.now())}
    >
      {lines.map((l, i) => (
        <Line
          key={i}
          line={l}
          ink={ink}
          state={i === current ? 'now' : i < current ? 'past' : 'next'}
          index={i}
          onY={setY}
        />
      ))}
    </ScrollView>
  );
}

const Line = memo(function Line({
  line,
  ink,
  state,
  index,
  onY,
}: {
  line: LyricLine;
  ink: string;
  state: 'past' | 'now' | 'next';
  index: number;
  onY: (index: number, y: number) => void;
}) {
  return (
    <Pressable
      haptic="tick"
      onLayout={e => onY(index, e.nativeEvent.layout.y)}
      onPress={() => PlayerService.seekTo(line.time)}
      style={styles.line}
    >
      <Text
        style={[
          font(700, 22, 1.3),
          {
            color: ink,
            opacity: state === 'now' ? 1 : state === 'past' ? 0.38 : 0.55,
          },
        ]}
      >
        {line.text || '♪'}
      </Text>
    </Pressable>
  );
});

// ---- "Wrong lyrics?" ----

function LyricsSearch({
  track,
  ink,
  chip,
  style,
  onCancel,
  onPicked,
}: Colors & {
  track: Track;
  style?: StyleProp<ViewStyle>;
  onCancel: () => void;
  onPicked: (l: Lyrics) => void;
}) {
  const clean = splitArtistTitle(track.title, track.artist);
  const [query, setQuery] = useState(
    [clean.artist, clean.title].filter(Boolean).join(' '),
  );
  const [results, setResults] = useState<LyricsMatch[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await searchLyrics(q.trim()));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    run(query);
    // Search once with the song's name when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.flex, style]}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => run(query)}
          returnKeyType="search"
          placeholder="Artist and title"
          placeholderTextColor="rgba(255,255,255,0.45)"
          autoCorrect={false}
          style={[
            font(500, 15),
            styles.input,
            { backgroundColor: chip, color: ink },
          ]}
        />
        <Pressable hitSlop={8} onPress={onCancel}>
          <Text style={[font(600, 13), { color: ink }]}>Cancel</Text>
        </Pressable>
      </View>
      {busy ? (
        <View style={styles.center}>
          <Spinner color={ink} track="rgba(255,255,255,0.25)" />
        </View>
      ) : (
        <ScrollView
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results?.length === 0 && (
            <Text
              style={[font(400, 14), styles.dim, styles.empty, { color: ink }]}
            >
              Nothing found. Try fewer words, or the original title.
            </Text>
          )}
          {results?.map(r => (
            <Pressable
              key={r.id}
              onPress={async () => onPicked(await chooseLyrics(track.id, r))}
              style={styles.result}
            >
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[font(600, 15), { color: ink }]}>
                  {r.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[font(400, 12), styles.dim, { color: ink }]}
                >
                  {[r.artist, r.album].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={[mono(500, 11), styles.dim, { color: ink }]}>
                {r.synced ? 'synced · ' : ''}
                {formatTime(r.duration)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={async () => onPicked(await chooseLyrics(track.id, null))}
            style={styles.result}
          >
            <Text style={[font(500, 13), styles.dim, { color: ink }]}>
              This song has no lyrics (instrumental)
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.75 },
  faint: { opacity: 0.55 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  centerText: { textAlign: 'center', paddingHorizontal: 24 },
  pill: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
  },
  plainPad: { paddingVertical: 16 },
  syncedPad: { paddingVertical: 24 },
  line: { paddingVertical: 7 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  empty: { paddingVertical: 20 },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
});
