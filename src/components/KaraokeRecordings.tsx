/**
 * Saving tab → Karaoke recordings: saved performances grouped by song, to
 * play, rename, delete, find in the file manager or share.
 */
import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AudioBufferSourceNode,
  AudioContext,
  decodeAudioData,
} from 'react-native-audio-api';
import { tr } from '../i18n';
import { PlayerService } from '../player/PlayerService';
import { useLibrary } from '../player/hooks';
import {
  NameTakenError,
  deleteRecording,
  getRecordingList,
  isPublic,
  recordingName,
  renameRecording,
  shareRecording,
  showInFolder,
  subscribeRecordings,
  type Recording,
} from '../services/karaokeRecordings';
import { fileUri } from '../services/karaokePlayer';
import { formatBytes } from '../services/storage';
import { toast } from '../state/ui';
import { ACCENT, font, formatTime, mono, paletteFor, useTheme } from '../theme';
import { artworkUri } from '../types';
import { MicIcon, MoreIcon, PauseIcon, PlayRoundIcon } from '../ui/icons';
import { Cover, Note } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';
import { Sheet } from '../ui/Sheet';

// ---- listening to a recording (one at a time) ----

let ctx: AudioContext | null = null;
let node: AudioBufferSourceNode | null = null;
let playing: { id: string; startedAt: number; duration: number } | null = null;
const playListeners = new Set<() => void>();
const emitPlay = () => playListeners.forEach(fn => fn());

function stopRecording() {
  try {
    node?.stop();
  } catch {}
  node?.disconnect();
  node = null;
  playing = null;
  emitPlay();
}

async function playRecording(rec: Recording) {
  stopRecording();
  PlayerService.pause();
  ctx ??= new AudioContext();
  await ctx.resume().catch(() => {});
  const buffer = await decodeAudioData(fileUri(rec.path), ctx.sampleRate);
  const source = new AudioBufferSourceNode(ctx);
  // Set as a property: the constructor option hands native code the wrong object.
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onEnded = () => {
    if (node === source) stopRecording();
  };
  const at = ctx.currentTime + 0.05;
  source.start(at, 0);
  node = source;
  playing = { id: rec.id, startedAt: at, duration: buffer.duration };
  emitPlay();
}

/** The recording playing and how far along (0..1), refreshed while it plays. */
function usePlaying(): { id: string | null; progress: number } {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick(x => x + 1);
    playListeners.add(fn);
    const id = setInterval(() => playing && fn(), 250);
    return () => {
      playListeners.delete(fn);
      clearInterval(id);
    };
  }, []);
  if (!playing || !ctx) return { id: null, progress: 0 };
  const p = (ctx.currentTime - playing.startedAt) / (playing.duration || 1);
  return { id: playing.id, progress: Math.max(0, Math.min(1, p)) };
}

// ---- the section ----

const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

export function KaraokeRecordings() {
  const t = useTheme();
  const list = useSyncExternalStore(subscribeRecordings, getRecordingList);
  const { byId } = useLibrary();
  const now = usePlaying();
  const [menu, setMenu] = useState<Recording | null>(null);
  const [renaming, setRenaming] = useState<Recording | null>(null);

  useEffect(() => stopRecording, []);

  // One group per song, the most recently sung first (the list is newest first).
  const groups = useMemo(() => {
    const map = new Map<string, Recording[]>();
    for (const r of list) {
      const key = r.trackId ?? `title:${r.title}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.values()];
  }, [list]);

  const openFolder = async (rec?: Recording) => {
    const target = rec ?? list.find(isPublic);
    if (target && (await showInFolder(target))) return;
    toast(
      tr('karaoke.folderUnavailable', {
        folder:
          target && isPublic(target)
            ? 'Music/Karaoke'
            : tr('karaoke.privateFolder'),
      }),
    );
  };

  const confirmDelete = (rec: Recording) => {
    Alert.alert(
      tr('karaoke.deleteConfirm', { name: recordingName(rec) }),
      tr('karaoke.deleteHint'),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (now.id === rec.id) stopRecording();
            await deleteRecording(rec).catch(() => {});
            toast(tr('karaoke.deleted'));
          },
        },
      ],
    );
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={[font(600, 15), styles.flex, { color: t.ink }]}>
          {tr('karaoke.recordings')}
        </Text>
        {list.some(isPublic) && (
          <Pressable hitSlop={8} onPress={() => openFolder()}>
            <Text style={[font(600, 13), { color: t.accentInk }]}>
              {tr('karaoke.openFolder')}
            </Text>
          </Pressable>
        )}
      </View>
      {!list.length && (
        <Note style={styles.mx20}>{tr('karaoke.recordingsEmpty')}</Note>
      )}
      {groups.map(recs => {
        const first = recs[0];
        const track = first.trackId ? byId.get(first.trackId) : undefined;
        const song = track ?? { title: first.title, artist: first.artist };
        return (
          <View key={first.trackId ?? first.title} style={styles.group}>
            <View style={styles.songRow}>
              {track ? (
                <Cover
                  uri={artworkUri(track)}
                  size={40}
                  radius={9}
                  bg={paletteFor(track).artBg}
                />
              ) : (
                <View style={[styles.micArt, { backgroundColor: t.fill }]}>
                  <MicIcon color={t.muted} />
                </View>
              )}
              <View style={styles.flex}>
                <Text
                  numberOfLines={1}
                  style={[font(600, 15), { color: t.ink }]}
                >
                  {song.title}
                </Text>
                {!!song.artist && (
                  <Text
                    numberOfLines={1}
                    style={[font(400, 12), { color: t.muted }]}
                  >
                    {song.artist}
                  </Text>
                )}
              </View>
              <Text style={[mono(500, 12), { color: t.muted }]}>
                {recs.length}
              </Text>
            </View>
            {recs.map(rec => {
              const isPlaying = now.id === rec.id;
              return (
                <View key={rec.id} style={styles.rec}>
                  <Pressable
                    onPress={() =>
                      isPlaying
                        ? stopRecording()
                        : playRecording(rec).catch(e =>
                            toast(String(e?.message ?? e)),
                          )
                    }
                    style={[
                      styles.playBtn,
                      { backgroundColor: isPlaying ? ACCENT : t.fill },
                    ]}
                  >
                    {isPlaying ? (
                      <PauseIcon size={14} color="#fff" />
                    ) : (
                      <PlayRoundIcon size={14} color={t.ink} />
                    )}
                  </Pressable>
                  <View style={styles.flex}>
                    <Text
                      numberOfLines={1}
                      style={[font(500, 14), { color: t.ink }]}
                    >
                      {recordingName(rec)}
                    </Text>
                    <Text style={[font(400, 12), { color: t.muted }]}>
                      {[
                        when(rec.createdAt),
                        rec.duration ? formatTime(rec.duration) : null,
                        rec.sizeBytes ? formatBytes(rec.sizeBytes) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {isPlaying && (
                      <View style={[styles.bar, { backgroundColor: t.fill3 }]}>
                        <View
                          style={[
                            styles.barFill,
                            { width: `${now.progress * 100}%` },
                          ]}
                        />
                      </View>
                    )}
                  </View>
                  <Pressable hitSlop={10} onPress={() => setMenu(rec)}>
                    <MoreIcon color={t.muted} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        );
      })}

      <Sheet visible={!!menu} onClose={() => setMenu(null)}>
        {!!menu && (
          <View style={styles.sheet}>
            <Text numberOfLines={2} style={[font(600, 16), { color: t.ink }]}>
              {recordingName(menu)}
            </Text>
            {[
              {
                label: tr('karaoke.showInFolder'),
                onPress: () => openFolder(menu),
              },
              {
                label: tr('karaoke.share'),
                onPress: () =>
                  shareRecording(menu).catch(e =>
                    toast(String(e?.message ?? e)),
                  ),
              },
              { label: tr('karaoke.rename'), onPress: () => setRenaming(menu) },
              {
                label: tr('common.delete'),
                danger: true,
                onPress: () => confirmDelete(menu),
              },
            ].map(a => (
              <Pressable
                key={a.label}
                onPress={() => {
                  setMenu(null);
                  a.onPress();
                }}
                style={({ pressed }) => [
                  styles.action,
                  pressed && { backgroundColor: t.fill },
                ]}
              >
                <Text
                  style={[
                    font(500, 16),
                    { color: a.danger ? t.danger : t.ink },
                  ]}
                >
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Sheet>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)}>
        {!!renaming && (
          <RenameForm rec={renaming} onDone={() => setRenaming(null)} />
        )}
      </Sheet>
    </View>
  );
}

function RenameForm({ rec, onDone }: { rec: Recording; onDone: () => void }) {
  const t = useTheme();
  const [name, setName] = useState(recordingName(rec));
  const save = async () => {
    try {
      await renameRecording(rec, name);
      onDone();
    } catch (e) {
      toast(
        e instanceof NameTakenError
          ? tr('karaoke.nameTaken', { name: e.message })
          : String((e as Error)?.message ?? e),
      );
    }
  };
  return (
    <View style={styles.sheet}>
      <Text style={[font(600, 16), { color: t.ink }]}>
        {tr('karaoke.renameTitle')}
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        selectTextOnFocus
        onSubmitEditing={save}
        returnKeyType="done"
        style={[
          font(500, 15),
          styles.input,
          { backgroundColor: t.fill, color: t.ink },
        ]}
      />
      <View style={styles.formRow}>
        <Pressable hitSlop={8} onPress={onDone}>
          <Text style={[font(600, 14), { color: t.muted }]}>
            {tr('common.cancel')}
          </Text>
        </Pressable>
        <Pressable
          disabled={!name.trim()}
          onPress={save}
          style={[
            styles.saveBtn,
            { backgroundColor: t.ink, opacity: name.trim() ? 1 : 0.4 },
          ]}
        >
          <Text style={[font(600, 14), { color: t.bg }]}>
            {tr('common.save')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 8,
  },
  mx20: { marginHorizontal: 20 },
  group: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  micArt: {
    width: 40,
    height: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rec: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingLeft: 52,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: { marginTop: 6, height: 3, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: ACCENT },
  sheet: { paddingHorizontal: 20, paddingBottom: 12, gap: 6 },
  action: { paddingVertical: 14, borderRadius: 10 },
  input: { height: 46, borderRadius: 12, paddingHorizontal: 14, marginTop: 8 },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999 },
});
