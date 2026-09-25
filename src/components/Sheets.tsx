/**
 * The design's bottom sheets: song menu, add to playlist, new playlist, queue,
 * playback speed, similar songs.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addTracksToPlaylist,
  createPlaylist,
  togglePlaylistTrack,
} from '../db/database';
import { navigationRef, openCollection } from '../navigation/ref';
import { PlayerService } from '../player/PlayerService';
import { sourceName } from '../sources';
import { useLibrary, usePlayerState, useSleepLeft } from '../player/hooks';
import { deleteFromLibrary } from '../services/library';
import { useOnline } from '../services/network';
import { SPEEDS, speedLabel, useSettings } from '../services/settings';
import {
  similarFor,
  similarInLibrary,
  type Similar,
} from '../services/similar';
import { formatBytes } from '../services/storage';
import {
  downloadAndInstall,
  installedVersion,
  type InstallStep,
  type Release,
} from '../services/updater';
import {
  closeSheet,
  openSheet,
  toast,
  useUi,
  type Sheet as SheetState,
} from '../state/ui';
import {
  ACCENT,
  GREEN,
  eyebrow,
  font,
  formatTime,
  mono,
  paletteFor,
  useTheme,
} from '../theme';
import { artworkUri, type QueueItem } from '../types';
import {
  CheckCircleIcon,
  CheckIcon,
  GlobeIcon,
  ShuffleIcon,
} from '../ui/icons';
import { Cover, CoverGrid, Equalizer, Spinner } from '../ui/primitives';
import { Sheet } from '../ui/Sheet';
import { Pressable } from '../ui/Pressable';

export function Sheets() {
  const { sheet } = useUi();
  return (
    <Sheet visible={!!sheet} onClose={closeSheet}>
      {sheet?.kind === 'menu' && <MenuSheet sheet={sheet} />}
      {sheet?.kind === 'add' && <AddSheet track={sheet.track} />}
      {sheet?.kind === 'new' && <NewPlaylistSheet />}
      {sheet?.kind === 'queue' && <QueueSheet />}
      {sheet?.kind === 'speed' && <SpeedSheet />}
      {sheet?.kind === 'sleep' && <SleepSheet />}
      {sheet?.kind === 'addMany' && <AddManySheet trackIds={sheet.trackIds} />}
      {sheet?.kind === 'similar' && <SimilarSheet track={sheet.track} />}
      {sheet?.kind === 'update' && <UpdateSheet release={sheet.release} />}
    </Sheet>
  );
}

function SongHeader({ track }: { track: QueueItem }) {
  const t = useTheme();
  return (
    <View style={[styles.songHead, { borderBottomColor: t.line }]}>
      <Cover
        uri={artworkUri(track)}
        size={52}
        radius={11}
        bg={paletteFor(track).artBg}
      />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[font(600, 16), { color: t.ink }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={[font(400, 13), { color: t.muted }]}>
          {[track.artist, track.genre].filter(Boolean).join(' · ') ||
            'Unknown artist'}
        </Text>
      </View>
    </View>
  );
}

function MenuSheet({
  sheet,
}: {
  sheet: Extract<SheetState, { kind: 'menu' }>;
}) {
  const t = useTheme();
  const { byId, playlists } = useLibrary();
  const { queue, index } = usePlayerState();
  const sleepLeft = useSleepLeft();
  const online = useOnline();
  // Prefer the live library copy (liked/saved may have changed since the sheet opened).
  const track: QueueItem = {
    ...sheet.track,
    ...(byId.get(sheet.track.id) ?? {}),
  };
  const isCurrent = queue[index]?.id === track.id;
  const inPlaylist = sheet.playlistId
    ? playlists.find(p => p.id === sheet.playlistId)
    : undefined;

  const actions: Array<{
    label: string;
    hint?: string;
    danger?: boolean;
    onPress: () => void;
  }> = [
    {
      label: 'Play next',
      onPress: () => {
        PlayerService.playNext(track);
        closeSheet();
      },
    },
  ];
  if (track.status !== 'streaming') {
    actions.push(
      {
        label: 'Add to playlist…',
        onPress: () => openSheet({ kind: 'add', track }),
      },
      {
        label: track.liked ? 'Remove from Liked' : 'Like',
        onPress: () => {
          PlayerService.toggleLike(track);
          closeSheet();
        },
      },
    );
  }
  if (isCurrent) {
    actions.push({
      label: 'Sleep timer…',
      hint: sleepLeft ?? undefined,
      onPress: () => openSheet({ kind: 'sleep' }),
    });
  }
  if (track.genre) {
    const genre = track.genre;
    actions.push({
      label: 'Go to genre',
      hint: genre,
      onPress: () => {
        closeSheet();
        if (navigationRef.getCurrentRoute()?.name === 'Player') {
          navigationRef.goBack();
        }
        openCollection({ kind: 'genre', genre });
      },
    });
  }
  if (inPlaylist?.trackIds.includes(track.id)) {
    actions.push({
      label: `Remove from “${inPlaylist.name}”`,
      onPress: () => {
        togglePlaylistTrack(inPlaylist.id, track.id);
        closeSheet();
      },
    });
  }
  if (track.status === 'streaming' && online) {
    actions.push({
      label: 'Save offline',
      onPress: () => {
        PlayerService.saveOffline(track);
        closeSheet();
      },
    });
  }
  if (track.status === 'ready' && !isCurrent) {
    actions.push({
      label:
        track.source === 'device' ? 'Hide from library' : 'Remove from device',
      hint: track.sizeBytes ? formatBytes(track.sizeBytes) : undefined,
      danger: true,
      onPress: () => {
        deleteFromLibrary(track);
        closeSheet();
        toast(
          track.source === 'device'
            ? 'Hidden until the next scan'
            : 'Removed from device',
        );
      },
    });
  }

  return (
    <View>
      <SongHeader track={track} />
      <View style={styles.actions}>
        {actions.map(a => (
          <Pressable
            key={a.label}
            onPress={a.onPress}
            style={({ pressed }) => [
              styles.action,
              pressed && { backgroundColor: t.fill },
            ]}
          >
            <Text
              style={[font(500, 16), { color: a.danger ? t.danger : t.ink }]}
            >
              {a.label}
            </Text>
            {!!a.hint && (
              <Text style={[font(400, 13), { color: t.muted2 }]}>{a.hint}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PlaylistPick({
  name,
  meta,
  covers,
  checked,
  onPress,
}: {
  name: string;
  meta: string;
  covers: Array<string | null>;
  checked: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pick,
        pressed && { backgroundColor: t.fill },
      ]}
    >
      <CoverGrid uris={covers} size={46} radius={10} />
      <View style={styles.flex}>
        <Text style={[font(500, 15), { color: t.ink }]}>{name}</Text>
        <Text style={[font(400, 12), { color: t.muted }]}>{meta}</Text>
      </View>
      <View
        style={[
          styles.check,
          checked
            ? { backgroundColor: t.ink }
            : { borderWidth: 2, borderColor: t.line2 },
        ]}
      >
        {checked && <CheckIcon color={t.onInk} />}
      </View>
    </Pressable>
  );
}

function NameInput({
  value,
  onChange,
  placeholder,
  big,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  big?: boolean;
  /** Only where typing a name is the whole point of the sheet. */
  autoFocus?: boolean;
}) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.muted2}
      autoFocus={autoFocus}
      style={[
        font(400, big ? 16 : 15),
        styles.input,
        {
          height: big ? 50 : 46,
          borderRadius: big ? 14 : 12,
          borderColor: t.line2,
          backgroundColor: t.bg,
          color: t.ink,
        },
        !big && styles.flex,
      ]}
    />
  );
}

function AddSheet({ track }: { track: QueueItem }) {
  const t = useTheme();
  const { playlists, byId } = useLibrary();
  const [name, setName] = useState('');
  const covers = (ids: string[]) =>
    ids.slice(0, 4).map(id => {
      const x = byId.get(id);
      return x ? artworkUri(x) : null;
    });

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    await createPlaylist(n, [track.id]);
    closeSheet();
    toast(`Added to “${n}”`);
  };

  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        Add to playlist
      </Text>
      <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
        {track.title}
        {track.artist ? ` · ${track.artist}` : ''}
      </Text>
      <View style={styles.createRow}>
        <NameInput
          value={name}
          onChange={setName}
          placeholder="New playlist name"
        />
        <Pressable
          onPress={create}
          style={[
            styles.createBtn,
            { backgroundColor: name.trim() ? t.ink : t.muted2 },
          ]}
        >
          <Text style={[font(600, 14), { color: t.onInk }]}>Create</Text>
        </Pressable>
      </View>
      <View style={styles.pickList}>
        {playlists.map(p => (
          <PlaylistPick
            key={p.id}
            name={p.name}
            meta={`${p.trackIds.length} songs`}
            covers={covers(p.trackIds)}
            checked={p.trackIds.includes(track.id)}
            onPress={() => togglePlaylistTrack(p.id, track.id)}
          />
        ))}
      </View>
    </View>
  );
}

function AddManySheet({ trackIds }: { trackIds: string[] }) {
  const t = useTheme();
  const { playlists, byId } = useLibrary();
  const [name, setName] = useState('');
  const covers = (ids: string[]) =>
    ids.slice(0, 4).map(id => {
      const x = byId.get(id);
      return x ? artworkUri(x) : null;
    });
  const songs = `${trackIds.length} song${trackIds.length === 1 ? '' : 's'}`;

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    await createPlaylist(n, trackIds);
    closeSheet();
    toast(`Added ${songs} to “${n}”`);
  };

  const addTo = async (id: string, listName: string) => {
    const added = await addTracksToPlaylist(id, trackIds);
    closeSheet();
    toast(
      added ? `Added ${added} to “${listName}”` : `Already in “${listName}”`,
    );
  };

  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        Add to playlist
      </Text>
      <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
        {songs} selected
      </Text>
      <View style={styles.createRow}>
        <NameInput
          value={name}
          onChange={setName}
          placeholder="New playlist name"
        />
        <Pressable
          onPress={create}
          style={[
            styles.createBtn,
            { backgroundColor: name.trim() ? t.ink : t.muted2 },
          ]}
        >
          <Text style={[font(600, 14), { color: t.onInk }]}>Create</Text>
        </Pressable>
      </View>
      <View style={styles.pickList}>
        {playlists.map(p => (
          <PlaylistPick
            key={p.id}
            name={p.name}
            meta={`${p.trackIds.length} songs`}
            covers={covers(p.trackIds)}
            checked={trackIds.every(id => p.trackIds.includes(id))}
            onPress={() => addTo(p.id, p.name)}
          />
        ))}
      </View>
    </View>
  );
}

const SLEEP_MINUTES = [15, 30, 45, 60, 90];

function SleepSheet() {
  const t = useTheme();
  const left = useSleepLeft();
  const pick = (when: number | 'endOfSong') => {
    PlayerService.setSleep(when);
    closeSheet();
  };
  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        Sleep timer
      </Text>
      <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
        {left
          ? left === 'End of song'
            ? 'Pauses when this song ends'
            : `Pauses in ${left} · fades out first`
          : 'The music fades out, then pauses'}
      </Text>
      <View style={styles.speedGrid}>
        {SLEEP_MINUTES.map(m => (
          <Pressable
            key={m}
            onPress={() => pick(m)}
            style={[styles.speedBtn, { backgroundColor: t.fill2 }]}
          >
            <Text style={[mono(600, 18), { color: t.ink }]}>{m}</Text>
            <Text style={[font(400, 11), styles.speedHint, { color: t.ink }]}>
              min
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => pick('endOfSong')}
          style={[styles.speedBtn, { backgroundColor: t.fill2 }]}
        >
          <Text style={[font(600, 14), { color: t.ink }]}>End of song</Text>
        </Pressable>
      </View>
      {!!left && (
        <Pressable
          onPress={() => {
            PlayerService.cancelSleep();
            closeSheet();
          }}
          style={styles.laterBtn}
        >
          <Text style={[font(500, 14), { color: t.danger }]}>
            Turn off sleep timer
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function NewPlaylistSheet() {
  const t = useTheme();
  const [name, setName] = useState('');
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const id = await createPlaylist(n);
    closeSheet();
    openCollection({ kind: 'playlist', id });
  };
  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        New playlist
      </Text>
      <View style={styles.mt16}>
        <NameInput
          value={name}
          onChange={setName}
          placeholder="Give it a name"
          big
          autoFocus
        />
      </View>
      <Pressable
        onPress={create}
        style={[
          styles.bigBtn,
          { backgroundColor: name.trim() ? t.ink : t.muted2 },
        ]}
      >
        <Text style={[font(600, 15), { color: t.onInk }]}>Create playlist</Text>
      </Pressable>
    </View>
  );
}

function QueueSheet() {
  const t = useTheme();
  const { queue, index, shuffle, repeat, contextName, isPlaying } =
    usePlayerState();
  const cur = queue[index];
  const upNext = queue.slice(index + 1);
  const mode = [
    shuffle ? 'Shuffle on' : 'In order',
    repeat === 'one' ? 'repeat one' : repeat === 'all' ? 'repeat all' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (!cur) return null;

  return (
    <View>
      <View style={[styles.pad, styles.queueHead]}>
        <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
          Queue
        </Text>
        <Text style={[font(400, 13), { color: t.muted }]}>{mode}</Text>
      </View>
      <Text style={[eyebrow(11), styles.queueLabel, { color: t.muted }]}>
        Now playing
      </Text>
      <View style={styles.queueRow}>
        <View>
          <Cover
            uri={artworkUri(cur)}
            size={46}
            radius={10}
            bg={paletteFor(cur).artBg}
          />
          <View style={styles.eqOverlay}>
            <Equalizer color="#fff" playing={isPlaying} />
          </View>
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[font(600, 15), { color: t.ink }]}>
            {cur.title}
          </Text>
          <Text numberOfLines={1} style={[font(400, 13), { color: t.muted }]}>
            {cur.artist ?? 'Unknown artist'}
          </Text>
        </View>
      </View>
      <Text
        style={[
          eyebrow(11),
          styles.queueLabel,
          styles.mt10,
          { color: t.muted },
        ]}
      >
        Up next · {contextName}
      </Text>
      {!upNext.length && (
        <Text style={[font(400, 14), styles.endText, { color: t.muted }]}>
          End of queue.
        </Text>
      )}
      {upNext.map((q, k) => (
        <Pressable
          key={q.id + k}
          onPress={() => PlayerService.skipTo(index + 1 + k)}
          style={({ pressed }) => [
            styles.queueRow,
            pressed && { backgroundColor: t.fill },
          ]}
        >
          <Cover
            uri={artworkUri(q)}
            size={46}
            radius={10}
            bg={paletteFor(q).artBg}
          />
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[font(500, 15), { color: t.ink }]}>
              {q.title}
            </Text>
            <Text numberOfLines={1} style={[font(400, 13), { color: t.muted }]}>
              {q.artist ?? 'Unknown artist'}
            </Text>
          </View>
          {!!q.duration && (
            <Text style={[mono(400, 12), { color: t.muted2 }]}>
              {formatTime(q.duration)}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

/** "A new version is out": what's new, then download → check → install. */
function UpdateSheet({ release }: { release: Release }) {
  const t = useTheme();
  const [step, setStep] = useState<InstallStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = installedVersion()?.name;
  const busy = !!step && !error;

  const start = async () => {
    setError(null);
    try {
      await downloadAndInstall(release, setStep);
      closeSheet(); // Android's installer takes it from here
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStep(null);
    }
  };

  const label = !step
    ? 'Update'
    : step.step === 'downloading'
    ? `Downloading ${Math.round(step.progress * 100)}%`
    : step.step === 'verifying'
    ? 'Checking the download…'
    : step.step === 'permission'
    ? 'Allow installing, then come back'
    : 'Opening the installer…';

  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        Update available
      </Text>
      <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
        stash {release.version}
        {current ? ` · you have ${current}` : ''}
        {release.size ? ` · ${formatBytes(release.size)}` : ''}
      </Text>
      {!!release.notes && (
        <ScrollView
          style={[styles.notes, { backgroundColor: t.fill }]}
          contentContainerStyle={styles.notesPad}
        >
          <Text style={[font(400, 14, 1.45), { color: t.ink2 }]}>
            {release.notes}
          </Text>
        </ScrollView>
      )}
      <Text style={[font(400, 12, 1.4), styles.mt10, { color: t.muted }]}>
        Your library, downloads and settings stay as they are.
      </Text>
      {!!error && (
        <Text style={[font(500, 13), styles.mt10, { color: t.danger }]}>
          {error}
        </Text>
      )}
      <Pressable
        haptic="confirm"
        disabled={busy}
        onPress={start}
        style={({ pressed }) => [
          styles.randomBtn,
          { backgroundColor: t.ink, opacity: pressed || busy ? 0.85 : 1 },
        ]}
      >
        {busy && step?.step !== 'downloading' && (
          <Spinner color={t.onInk} track="rgba(255,255,255,0.3)" />
        )}
        <Text style={[font(600, 14), { color: t.onInk }]}>
          {error ? 'Try again' : label}
        </Text>
      </Pressable>
      {step?.step === 'downloading' && (
        <View style={[styles.updateBar, { backgroundColor: t.fill3 }]}>
          <View
            style={[
              styles.updateFill,
              { width: `${step.progress * 100}%`, backgroundColor: t.ink },
            ]}
          />
        </View>
      )}
      {!busy && (
        <Pressable onPress={closeSheet} style={styles.laterBtn}>
          <Text style={[font(500, 14), { color: t.muted }]}>Later</Text>
        </Pressable>
      )}
    </View>
  );
}

function SpeedSheet() {
  const t = useTheme();
  const { playbackSpeed } = useSettings();
  return (
    <View style={styles.pad}>
      <Text style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}>
        Playback speed
      </Text>
      <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
        Applies to everything you play · pitch stays the same
      </Text>
      <View style={styles.speedGrid}>
        {SPEEDS.map(v => {
          const on = v === playbackSpeed;
          return (
            <Pressable
              key={v}
              onPress={() => {
                PlayerService.setSpeed(v);
                closeSheet();
              }}
              style={[
                styles.speedBtn,
                { backgroundColor: on ? t.ink : t.fill2 },
              ]}
            >
              <Text style={[mono(600, 18), { color: on ? t.onInk : t.ink }]}>
                {speedLabel(v)}
              </Text>
              <Text
                style={[
                  font(400, 11),
                  styles.speedHint,
                  { color: on ? t.onInk : t.ink },
                ]}
              >
                {v === 1 ? 'Normal' : v < 1 ? 'Slower' : 'Faster'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SimilarSheet({ track }: { track: QueueItem }) {
  const t = useTheme();
  const { tracks } = useLibrary();
  // YouTube's recommendations for this song; same-artist/genre songs until they arrive.
  const [found, setFound] = useState<Similar | null>(null);
  const local = found?.local ?? similarInLibrary(track, tracks);
  const connected = useOnline();
  // Web suggestions can't play without a connection.
  const online = !connected ? [] : found ? found.online : null;

  useEffect(() => {
    let live = true;
    setFound(null);
    similarFor(track, tracks).then(r => {
      if (live) setFound(r);
    });
    return () => {
      live = false;
    };
    // Only when the song changes — not on every library update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const ctx = `Similar to ${track.title}`;
  const basis = [track.artist, track.genre].filter(Boolean).join(' and ');
  const reason = found?.fromYoutube
    ? 'What YouTube recommends after this song'
    : found
    ? `Offline — based on ${basis || 'what you’re playing'}`
    : 'Asking YouTube…';
  const empty = !local.length && online !== null && !online.length;

  return (
    <View>
      <View style={styles.pad}>
        <Text
          numberOfLines={1}
          style={[font(700, 20), { color: t.ink, letterSpacing: -0.2 }]}
        >
          {ctx}
        </Text>
        <Text style={[font(400, 13), styles.mt3, { color: t.muted }]}>
          {reason}
        </Text>
        {!!(local.length || online?.length) && (
          <Pressable
            haptic="confirm"
            onPress={() => {
              const pool = [
                ...local.map(x => ({ track: x })),
                ...(online ?? []).map(r => ({ result: r })),
              ];
              closeSheet();
              PlayerService.startRadio(
                pool[Math.floor(Math.random() * pool.length)],
              );
            }}
            style={({ pressed }) => [
              styles.randomBtn,
              { backgroundColor: t.ink, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <ShuffleIcon color={t.onInk} />
            <Text style={[font(600, 14), { color: t.onInk }]}>
              Play random suggestions
            </Text>
          </Pressable>
        )}
      </View>
      {empty && (
        <View style={[styles.note, { backgroundColor: t.fill }]}>
          <Text style={[font(400, 14, 1.4), { color: t.ink2 }]}>
            Nothing similar yet. Search to find more.
          </Text>
        </View>
      )}
      <View style={styles.mt10}>
        {local.map(x => (
          <SimilarRow
            key={x.id}
            title={x.title}
            sub={`${x.artist ?? 'Unknown artist'} · On device`}
            art={artworkUri(x)}
            bg={paletteFor(x).artBg}
            icon={<CheckCircleIcon size={18} color={GREEN} />}
            onPress={() => {
              closeSheet();
              PlayerService.playQueue(local, local.indexOf(x), ctx, false);
            }}
          />
        ))}
        {online?.map(r => (
          <SimilarRow
            key={r.source + r.sourceId}
            title={r.title}
            sub={`${r.artist ?? 'Unknown artist'} · ${sourceName(r.source)}`}
            art={r.thumbnailUrl}
            bg={paletteFor(r).artBg}
            icon={<GlobeIcon size={18} color={ACCENT} />}
            onPress={() => {
              closeSheet();
              PlayerService.playOnline(r, 'Suggested');
            }}
          />
        ))}
        {online === null && (
          <View style={styles.looking}>
            <Spinner color={ACCENT} track={t.accentSoft2} />
            <Text style={[font(400, 13), { color: t.muted }]}>
              Getting YouTube’s recommendations…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function SimilarRow({
  title,
  sub,
  art,
  bg,
  icon,
  onPress,
}: {
  title: string;
  sub: string;
  art: string | null | undefined;
  bg: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.queueRow,
        pressed && { backgroundColor: t.fill },
      ]}
    >
      <Cover uri={art} size={46} radius={10} bg={bg} />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[font(500, 15), { color: t.ink }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[font(400, 13), { color: t.muted }]}>
          {sub}
        </Text>
      </View>
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pad: { paddingHorizontal: 20 },
  mt3: { marginTop: 3 },
  mt10: { marginTop: 10 },
  mt16: { marginTop: 16 },
  songHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  actions: { paddingVertical: 6 },
  action: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  createRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  input: { borderWidth: 1, paddingHorizontal: 14 },
  createBtn: {
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickList: { marginTop: 14, marginHorizontal: -20 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  queueHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  queueLabel: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  eqOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: 10,
    backgroundColor: 'rgba(22,22,26,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endText: { paddingHorizontal: 20, paddingVertical: 6 },
  speedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  speedBtn: {
    width: '31.5%',
    flexGrow: 1,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  speedHint: { opacity: 0.7 },
  notes: { marginTop: 14, maxHeight: 220, borderRadius: 14 },
  notesPad: { padding: 14 },
  updateBar: { height: 4, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  updateFill: { height: '100%' },
  laterBtn: { alignItems: 'center', paddingVertical: 14 },
  randomBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  note: {
    marginHorizontal: 20,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  looking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
