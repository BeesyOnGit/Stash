import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrackRow } from '../components/TrackRow';
import { PlayerService } from '../player/PlayerService';
import { useDownloads, useLibrary } from '../player/hooks';
import {
  getActiveDownloadIds,
  getDownloadProgress,
} from '../services/downloader';
import { useSettings } from '../services/settings';
import { formatBytes } from '../services/storage';
import {
  ACCENT,
  GREEN,
  font,
  mono,
  paletteFor,
  sourceLabel,
  useTheme,
} from '../theme';
import { artworkUri } from '../types';
import { CheckCircleIcon } from '../ui/icons';
import { Cover, Note } from '../ui/primitives';

/** When the app started — "Saved this session" lists what finished since then. */
const SESSION_START = Date.now();

export function SavingScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tracks, byId } = useLibrary();
  const { storageLimitGB } = useSettings();
  useDownloads();

  const activeIds = getActiveDownloadIds();
  const saved = useMemo(
    () =>
      tracks
        .filter(
          x => x.savedAt && x.savedAt >= SESSION_START && x.status === 'ready',
        )
        .sort((a, b) => b.savedAt! - a.savedAt!),
    [tracks],
  );
  const used = tracks
    .filter(x => x.source !== 'device' && x.status === 'ready')
    .reduce((a, x) => a + (x.sizeBytes ?? 0), 0);
  const limit = storageLimitGB * 1024 ** 3;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.pad, { paddingTop: insets.top }]}
    >
      <View style={styles.head}>
        <Text style={[styles.h1, { color: t.ink }]}>Saving</Text>
        <View
          style={[
            styles.card,
            { backgroundColor: t.card, borderColor: t.line },
          ]}
        >
          <View style={styles.between}>
            <Text style={[font(600, 14), { color: t.ink }]}>
              Offline storage
            </Text>
            <Text style={[mono(400, 12), { color: t.muted }]}>
              {formatBytes(used)} of {storageLimitGB} GB
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: t.fill3 }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.min(100, Math.max(1, (used / limit) * 100))}%`,
                  backgroundColor: t.ink,
                },
              ]}
            />
          </View>
        </View>
      </View>

      <Text style={[font(600, 15), styles.section, { color: t.ink }]}>
        In progress
      </Text>
      {!activeIds.length && (
        <Note style={styles.mx20}>
          Nothing saving. Play something from Search and it lands here.
        </Note>
      )}
      {activeIds.map(id => {
        const x = byId.get(id);
        if (!x) return null;
        const pct = Math.round((getDownloadProgress(id) ?? 0) * 100);
        return (
          <View key={id} style={styles.active}>
            <Cover
              uri={artworkUri(x)}
              size={50}
              radius={11}
              bg={paletteFor(x).artBg}
            />
            <View style={styles.flex}>
              <View style={styles.between}>
                <Text
                  numberOfLines={1}
                  style={[font(500, 15, 1.25), styles.flex, { color: t.ink }]}
                >
                  {x.title}
                </Text>
                <Text style={[mono(500, 12), { color: t.accentInk }]}>
                  {pct}%
                </Text>
              </View>
              <View style={[styles.bar, { backgroundColor: t.accentSoft2 }]}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <Text style={[font(400, 12), styles.mt5, { color: t.muted }]}>
                from {sourceLabel[x.source]}
              </Text>
            </View>
          </View>
        );
      })}

      <Text style={[font(600, 15), styles.section, { color: t.ink }]}>
        Saved this session
      </Text>
      {!saved.length && (
        <Note style={styles.mx20}>
          Songs you save will show here, then live in your Library.
        </Note>
      )}
      {saved.map((x, i) => (
        <TrackRow
          key={x.id}
          track={x}
          showNew={false}
          subtitle={`${x.artist ?? 'Unknown artist'} · ${
            x.sizeBytes ? formatBytes(x.sizeBytes) : '—'
          }`}
          onPress={() =>
            PlayerService.playQueue(saved, i, 'Saved this session')
          }
          right={
            <View style={styles.check}>
              <CheckCircleIcon size={18} color={GREEN} />
            </View>
          }
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 24 },
  flex: { flex: 1, minWidth: 0 },
  head: { paddingHorizontal: 20, paddingTop: 14 },
  h1: { ...font(700, 34, 1.05), letterSpacing: -1 },
  card: { marginTop: 16, padding: 16, borderRadius: 18, borderWidth: 1 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  track: { marginTop: 10, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  section: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8 },
  mx20: { marginHorizontal: 20 },
  active: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  bar: { marginTop: 7, height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: ACCENT },
  mt5: { marginTop: 5 },
  check: { paddingRight: 8 },
});
