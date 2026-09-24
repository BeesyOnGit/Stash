import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRow } from '../components/TrackRow';
import { searchLibrary } from '../db/database';
import { openCollection } from '../navigation/ref';
import { PlayerService } from '../player/PlayerService';
import { useDownloads, useLibrary } from '../player/hooks';
import { getDownloadProgress } from '../services/downloader';
import { isOnline, useOnline } from '../services/network';
import { searchOnline, type SourceProgress } from '../sources';
import { openSheet } from '../state/ui';
import {
  ACCENT,
  GREEN,
  eyebrow,
  font,
  formatTime,
  genreColors,
  mono,
  sourceLabel,
  useTheme,
} from '../theme';
import {
  trackFromResult,
  trackIdFor,
  type OnlineResult,
  type Track,
} from '../types';
import {
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  GlobeIcon,
  PlayIcon,
  SearchIcon,
} from '../ui/icons';
import { Note, Spinner } from '../ui/primitives';
import { useGenres } from './LibraryScreen';
import { Pressable } from '../ui/Pressable';

type Scan = 'idle' | 'scanning' | 'done';
const FALLBACK_SUGGESTIONS = [
  'Daft Punk',
  'Tame Impala',
  'Frank Ocean',
  'Clair de Lune',
];

/**
 * Search order from the design: the library first; if the song isn't there,
 * free sources are searched automatically (or on demand with "Also search").
 */
export function SearchScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tracks, byId } = useLibrary();
  const genres = useGenres();
  useDownloads(); // re-render as saves progress
  const online = useOnline();

  const [query, setQuery] = useState('');
  const [locals, setLocals] = useState<Track[]>([]);
  const [scan, setScan] = useState<Scan>('idle');
  const [sources, setSources] = useState<SourceProgress[]>([]);
  const [results, setResults] = useState<OnlineResult[]>([]);
  const token = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasQuery = !!query.trim();

  const suggestions = useMemo(() => {
    const count = new Map<string, number>();
    for (const x of tracks) {
      if (x.artist) count.set(x.artist, (count.get(x.artist) ?? 0) + 1);
    }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return (top.length >= 2 ? top : FALLBACK_SUGGESTIONS).slice(0, 4);
  }, [tracks]);

  const startScan = (q: string, tok = token.current) => {
    if (!q.trim() || !isOnline()) return;
    setScan('scanning');
    setResults([]);
    searchOnline(q.trim(), (progress, found) => {
      if (tok !== token.current) return;
      setSources(progress);
      if (progress.every(s => s.status !== 'searching')) {
        setResults(found);
        setScan('done');
      }
    });
  };

  const onQuery = (v: string) => {
    setQuery(v);
    setScan('idle');
    setResults([]);
    const tok = ++token.current;
    if (debounce.current) clearTimeout(debounce.current);
    if (!v.trim()) {
      setLocals([]);
      return;
    }
    searchLibrary(v).then(found => {
      if (tok === token.current) setLocals(found);
    });
    debounce.current = setTimeout(async () => {
      const found = await searchLibrary(v);
      if (tok === token.current && !found.length) startScan(v, tok);
    }, 450);
  };

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  // Back online with a search the library couldn't answer: look online now.
  useEffect(() => {
    if (online && hasQuery && !locals.length && scan === 'idle') {
      startScan(query);
    }
    // Only when the connection comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const clear = () => onQuery('');

  return (
    <View
      style={[styles.screen, { backgroundColor: t.bg, paddingTop: insets.top }]}
    >
      <View style={styles.head}>
        <Text style={[styles.h1, { color: t.ink }]}>Search</Text>
        <View
          style={[styles.box, { backgroundColor: t.card, borderColor: t.line }]}
        >
          <SearchIcon color={t.muted} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Songs, artists, anything"
            placeholderTextColor={t.muted2}
            returnKeyType="search"
            autoCorrect={false}
            onSubmitEditing={() => !locals.length || startScan(query)}
            style={[font(400, 16), styles.input, { color: t.ink }]}
          />
          {hasQuery && (
            <Pressable
              onPress={clear}
              style={[styles.clear, { backgroundColor: t.fill3 }]}
            >
              <CloseIcon color="#fff" />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.pad}
      >
        {!hasQuery && (
          <View style={styles.idle}>
            <Text style={[font(600, 16), styles.label, { color: t.ink }]}>
              Try
            </Text>
            <View style={styles.wrap}>
              {suggestions.map(s => (
                <Pressable
                  key={s}
                  onPress={() => onQuery(s)}
                  style={[
                    styles.suggestion,
                    { backgroundColor: t.card, borderColor: t.line },
                  ]}
                >
                  <Text style={[font(500, 14), { color: t.ink }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            {genres.length > 0 && (
              <>
                <Text
                  style={[
                    font(600, 16),
                    styles.label,
                    styles.mt26,
                    { color: t.ink },
                  ]}
                >
                  Browse by genre
                </Text>
                <View style={styles.wrap}>
                  {genres.map(g => {
                    const c = genreColors(g.name, t.dark);
                    return (
                      <Pressable
                        key={g.name}
                        onPress={() =>
                          openCollection({ kind: 'genre', genre: g.name })
                        }
                        style={[styles.genre, { backgroundColor: c.bg }]}
                      >
                        <Text style={[font(600, 14), { color: c.ink }]}>
                          {g.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            <View
              style={[
                styles.how,
                { backgroundColor: t.card, borderColor: t.line },
              ]}
            >
              <Text style={[eyebrow(), styles.howTitle, { color: t.muted }]}>
                How search works
              </Text>
              <Step
                n="1"
                title="Your library first."
                text="Saved songs play instantly, no connection needed."
              />
              <Step
                n="2"
                title="Then free sources."
                text="YouTube Music and Jamendo."
              />
              <Step
                n="3"
                accent
                title="Stream once, keep forever."
                text="It saves while you listen the first time."
              />
            </View>
          </View>
        )}

        {hasQuery && (
          <View style={styles.results}>
            <View style={styles.sectionHead}>
              <CheckCircleIcon size={15} color={GREEN} />
              <Text style={[font(600, 15), { color: t.ink }]}>
                In your library
              </Text>
              <Text style={[mono(400, 13), { color: t.muted2 }]}>
                {locals.length}
              </Text>
            </View>
            {locals.map((x, i) => (
              <TrackRow
                key={x.id}
                track={x}
                showLiked={false}
                subtitle={`${x.artist ?? 'Unknown artist'} · Offline`}
                onPress={() => PlayerService.playQueue(locals, i, 'Search')}
                onMenu={() => openSheet({ kind: 'menu', track: x })}
              />
            ))}
            {!locals.length && (
              <Note style={styles.mx20}>
                {online
                  ? 'Not on this device yet — looking online.'
                  : 'Not on this device — you’re offline, so only your library is searched.'}
              </Note>
            )}
            {!online && locals.length > 0 && (
              <Text
                style={[font(400, 12, 1.4), styles.srcNote, { color: t.muted }]}
              >
                You’re offline — only your library is searched.
              </Text>
            )}

            {online && locals.length > 0 && scan === 'idle' && (
              <Pressable
                onPress={() => startScan(query)}
                style={[styles.alsoBtn, { borderColor: t.line2 }]}
              >
                <GlobeIcon color={t.ink} />
                <Text style={[font(500, 14), { color: t.ink }]}>
                  Also search free sources
                </Text>
              </Pressable>
            )}

            {online && scan === 'scanning' && (
              <View
                style={[
                  styles.scanCard,
                  { backgroundColor: t.card, borderColor: t.line },
                ]}
              >
                <View style={styles.scanHead}>
                  <Spinner color={ACCENT} track={t.accentSoft2} />
                  <Text style={[font(600, 14), { color: t.ink }]}>
                    Searching free sources
                  </Text>
                </View>
                {sources.map(s => (
                  <SourceLine key={s.id} s={s} />
                ))}
              </View>
            )}

            {online && scan === 'done' && (
              <>
                <View style={[styles.sectionHead, styles.mt22]}>
                  <GlobeIcon size={15} color={ACCENT} />
                  <Text style={[font(600, 15), { color: t.ink }]}>
                    Found online
                  </Text>
                  <Text style={[mono(400, 13), { color: t.muted2 }]}>
                    {results.length}
                  </Text>
                </View>
                {sources
                  .filter(s => s.status === 'failed' || s.status === 'off')
                  .map(s => (
                    <Text
                      key={s.id}
                      style={[
                        font(400, 12, 1.4),
                        styles.srcNote,
                        { color: t.muted },
                      ]}
                    >
                      {s.status === 'off'
                        ? `${s.name} is off — set it up in Settings.`
                        : `${s.name} didn't answer: ${s.error}`}
                    </Text>
                  ))}
                {results.map(r => {
                  const id = trackIdFor(r.source, r.sourceId);
                  const lib = byId.get(id);
                  const pct = getDownloadProgress(id);
                  const saved = lib?.status === 'ready';
                  const saving =
                    !saved &&
                    (pct !== undefined || lib?.status === 'downloading');
                  return (
                    <TrackRow
                      key={id}
                      track={lib ?? trackFromResult(r, 'streaming')}
                      artwork={r.thumbnailUrl}
                      showNew={false}
                      subtitle={[
                        r.artist ?? 'Unknown artist',
                        sourceLabel[r.source],
                        r.duration ? formatTime(r.duration) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      onPress={() => PlayerService.playOnline(r)}
                      right={
                        saved ? (
                          <CheckCircleIcon size={18} color={GREEN} />
                        ) : saving ? (
                          <View style={styles.saving}>
                            <View
                              style={[
                                styles.miniBar,
                                { backgroundColor: t.accentSoft2 },
                              ]}
                            >
                              <View
                                style={[
                                  styles.miniFill,
                                  { width: `${Math.round((pct ?? 0) * 100)}%` },
                                ]}
                              />
                            </View>
                            <Text
                              style={[mono(500, 12), { color: t.accentInk }]}
                            >
                              {Math.round((pct ?? 0) * 100)}%
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.actions}>
                            <Pressable
                              accessibilityLabel="Download only"
                              hitSlop={4}
                              onPress={() => PlayerService.downloadOnly(r)}
                              style={[
                                styles.dlBtn,
                                {
                                  backgroundColor: t.card,
                                  borderColor: t.line2,
                                },
                              ]}
                            >
                              <DownloadIcon color={t.ink} />
                            </Pressable>
                            <View
                              style={[
                                styles.playPill,
                                { backgroundColor: t.ink },
                              ]}
                            >
                              <PlayIcon size={12} color={t.onInk} />
                              <Text style={[font(500, 12), { color: t.onInk }]}>
                                Play
                              </Text>
                            </View>
                          </View>
                        )
                      }
                    />
                  );
                })}
                {results.length > 0 && (
                  <Text
                    style={[
                      font(400, 12, 1.45),
                      styles.footnote,
                      { color: t.muted },
                    ]}
                  >
                    Tap to play — it saves as it streams. Or use ↓ to just
                    download.
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Step({
  n,
  title,
  text,
  accent,
}: {
  n: string;
  title: string;
  text: string;
  accent?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={styles.step}>
      <View
        style={[styles.stepNum, { backgroundColor: accent ? ACCENT : t.ink }]}
      >
        <Text style={[mono(600, 12), { color: accent ? '#fff' : t.onInk }]}>
          {n}
        </Text>
      </View>
      <Text style={[font(400, 14, 1.4), styles.flex, { color: t.ink2 }]}>
        <Text style={[font(600, 14), { color: t.ink }]}>{title}</Text> {text}
      </Text>
    </View>
  );
}

function SourceLine({ s }: { s: SourceProgress }) {
  const t = useTheme();
  const label =
    s.status === 'done'
      ? `${s.count} found`
      : s.status === 'searching'
      ? 'searching…'
      : s.status === 'failed'
      ? 'no answer'
      : 'off';
  const color =
    s.status === 'done'
      ? t.ink
      : s.status === 'searching'
      ? t.accentInk
      : t.muted2;
  return (
    <View style={styles.srcLine}>
      <Text style={[font(400, 14), { color }]}>{s.name}</Text>
      <Text style={[mono(400, 12), { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pad: { paddingBottom: 20 },
  head: { paddingHorizontal: 20, paddingTop: 14 },
  h1: { ...font(700, 34, 1.05), letterSpacing: -1, marginBottom: 14 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    boxShadow: '0px 1px 2px rgba(0,0,0,0.04)',
  },
  input: { flex: 1, minWidth: 0, padding: 0 },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idle: { paddingHorizontal: 20, paddingVertical: 22 },
  label: { marginBottom: 10 },
  mt26: { marginTop: 26 },
  mt22: { paddingTop: 22 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  genre: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  how: {
    marginTop: 28,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
  },
  howTitle: { marginBottom: 0 },
  step: { flexDirection: 'row', gap: 12 },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: { paddingTop: 22 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  mx20: { marginHorizontal: 20 },
  alsoBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scanCard: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    gap: 9,
  },
  scanHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 3,
  },
  srcLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  srcNote: { paddingHorizontal: 20, paddingBottom: 6 },
  saving: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  miniBar: { width: 34, height: 4, borderRadius: 2, overflow: 'hidden' },
  miniFill: { height: '100%', backgroundColor: ACCENT },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  dlBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
  },
  footnote: { paddingHorizontal: 20, paddingTop: 10 },
});
