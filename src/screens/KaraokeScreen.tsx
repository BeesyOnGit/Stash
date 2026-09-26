import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import React, {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LyricsPanel } from '../components/LyricsPanel';
import { tr } from '../i18n';
import { goToTab } from '../navigation/ref';
import type { RootStackParamList } from '../navigation/types';
import { PlayerService } from '../player/PlayerService';
import { useLibrary } from '../player/hooks';
import {
  MODEL,
  ensureModel,
  getJob,
  getKaraokeVersion,
  getModelState,
  headStartNeeded,
  instrumentalReady,
  releaseModel,
  saveMix,
  startKaraoke,
  subscribeKaraoke,
  watchJob,
} from '../services/karaoke';
import {
  DEFAULT_LATENCY_MS,
  KaraokeEngine,
  micAllowed,
  type Take,
} from '../services/karaokePlayer';
import { isPublic } from '../services/karaokeRecordings';
import { useOnline } from '../services/network';
import { keepScreenOn } from '../services/screen';
import { formatBytes } from '../services/storage';
import { toast } from '../state/ui';
import { ACCENT, font, formatTime, mono, paletteFor } from '../theme';
import { artworkUri } from '../types';
import {
  ChevronDownIcon,
  DownloadIcon,
  MicIcon,
  PauseIcon,
  PlayRoundIcon,
} from '../ui/icons';
import { Slider, Spinner } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';

const INK = '#fff';
const CHIP = 'rgba(255,255,255,0.12)';
const RED = '#E5484D';

/**
 * Karaoke for one song: the voice remover is downloaded (first time only),
 * the instrumental is made and plays as soon as enough of it is ready, the
 * lyrics follow it, and the singer can record a take, listen back (voice
 * volume, timing) and save it.
 */
export function KaraokeScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { trackId } =
    useRoute<RouteProp<RootStackParamList, 'Karaoke'>>().params;
  const { byId } = useLibrary();
  const track = byId.get(trackId) ?? null;
  useSyncExternalStore(subscribeKaraoke, getKaraokeVersion);
  const job = getJob(trackId);
  const model = getModelState();
  const online = useOnline();

  const engineRef = useRef<KaraokeEngine | null>(null);
  if (!engineRef.current) engineRef.current = new KaraokeEngine();
  const engine = engineRef.current;
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [position, setPosition] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [latency, setLatency] = useState(DEFAULT_LATENCY_MS);
  const [voiceGain, setVoiceGain] = useState(1);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  /** Sing over the instrumental (vocals removed) or the song as it is; asked first. */
  const [mode, setMode] = useState<'instrumental' | 'original' | null>(() => {
    const j = getJob(trackId);
    return j && j.status !== 'error' && j.status !== 'cancelled'
      ? 'instrumental'
      : null;
  });
  const [madeBefore, setMadeBefore] = useState(false);
  useEffect(() => {
    instrumentalReady(trackId).then(setMadeBefore);
  }, [trackId]);

  // Karaoke takes over the sound, keeps the screen on, and keeps its pieces.
  useEffect(() => {
    PlayerService.pause();
    keepScreenOn(true);
    const unwatch = watchJob(trackId);
    const unsub = engine.subscribe(rerender);
    return () => {
      unsub();
      unwatch();
      keepScreenOn(false);
      engine.close();
      releaseModel();
    };
  }, [engine, trackId]);

  // Feed the engine: pieces in order while it's made, or the finished file
  // when it was already made (its pieces are gone by then).
  const fed = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (mode !== 'instrumental' || !job || fed.current < 0) return;
    if (job.status === 'done' && fed.current === 0 && job.path) {
      fed.current = -1; // the whole file instead
      const path = job.path;
      chain.current = chain.current.then(() =>
        engine.setComplete(path).catch(e => console.warn(e)),
      );
      return;
    }
    while (fed.current < job.pieces.length) {
      const piece = job.pieces[fed.current++];
      chain.current = chain.current.then(() =>
        engine.addPiece(piece.path).catch(e => console.warn(e)),
      );
    }
    if (job.status === 'done' && !engine.complete) {
      chain.current = chain.current.then(() => engine.setComplete());
    }
  }, [mode, job, job?.pieces.length, job?.status, engine]);

  // The clock: a few times a second, for the lyrics and the "catching up" pause.
  useEffect(() => {
    const id = setInterval(() => {
      engine.needAhead = () =>
        job ? headStartNeeded(job, engine.position) ?? 8 : 8;
      engine.tick();
      setPosition(engine.position);
    }, 150);
    return () => clearInterval(id);
  }, [engine, job]);

  // The song ended while recording: on to listening back.
  useEffect(() => {
    if (engine.state === 'ended' && engine.recording) {
      engine
        .stopRecording()
        .then(t => t && setTake(t))
        .catch(e => toast(tr('karaoke.recordFailed', { reason: e.message })));
    }
  }, [engine, engine.state]);

  if (!track) return <View style={styles.fill} />;

  const P = paletteFor(track);
  const art = artworkUri(track);
  const need = mode === 'instrumental' && job ? headStartNeeded(job) : null;
  const canStart =
    engine.complete || (need !== null && engine.ready >= need - 0.01);
  const percent = job?.total
    ? Math.min(100, Math.floor((job.done / job.total) * 100))
    : 0;
  const active = engine.state === 'playing' || engine.state === 'waiting';
  const offsetMs = take ? take.musicAt * 1000 + latency : 0;
  // Over the instrumental, saving needs all of it.
  const waitingToSave = mode === 'instrumental' && job?.status !== 'done';

  const sing = async (record: boolean) => {
    if (starting) return;
    setStarting(true);
    try {
      if (record && !(await micAllowed())) {
        toast(tr('karaoke.micDenied'));
        return;
      }
      setTake(null);
      engine.forgetTake();
      await engine.start(record);
    } catch (e: any) {
      toast(tr('karaoke.recordFailed', { reason: e?.message ?? String(e) }));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (engine.recording) {
      try {
        const t = await engine.stopRecording();
        if (t) setTake(t);
      } catch (e: any) {
        toast(tr('karaoke.recordFailed', { reason: e?.message ?? String(e) }));
      }
    } else {
      engine.stop(false);
    }
  };

  const choose = (next: 'instrumental' | 'original') => {
    setMode(next);
    if (next === 'instrumental') {
      startKaraoke(track);
    } else {
      const path = track.filePath!;
      chain.current = chain.current.then(() =>
        engine
          .setComplete(path)
          .catch(e =>
            toast(tr('karaoke.recordFailed', { reason: e?.message ?? e })),
          ),
      );
    }
  };

  const save = async () => {
    if (!take || saving || !mode) return;
    setSaving(true);
    engine.stop(false);
    try {
      const rec = await saveMix(track, take.path, offsetMs, voiceGain, mode);
      toast(
        tr('karaoke.saved', {
          folder: isPublic(rec) ? 'Music/Karaoke' : tr('karaoke.privateFolder'),
        }),
      );
    } catch (e: any) {
      toast(tr('karaoke.saveFailed', { reason: e?.message ?? String(e) }));
    } finally {
      setSaving(false);
    }
  };

  // ---- what's shown under the lyrics ----
  let panel: React.ReactNode;
  const modelBusy =
    mode === 'instrumental' &&
    job?.status === 'waiting' &&
    model.status !== 'ready';
  if (!mode) {
    panel = (
      <View style={styles.panel}>
        <Text style={[font(600, 15), styles.center, { color: INK }]}>
          {tr('karaoke.chooseTitle')}
        </Text>
        <Choice
          title={tr('karaoke.removeVocals')}
          hint={
            madeBefore
              ? tr('karaoke.removeVocalsReady')
              : tr('karaoke.removeVocalsHint')
          }
          accent
          onPress={() => choose('instrumental')}
        />
        <Choice
          title={tr('karaoke.keepSong')}
          hint={tr('karaoke.keepSongHint')}
          onPress={() => choose('original')}
        />
      </View>
    );
  } else if (
    modelBusy ||
    (mode === 'instrumental' &&
      job?.status === 'error' &&
      model.status === 'error')
  ) {
    let line: string;
    let bar: number | null = null;
    if (model.status === 'downloading') {
      line = tr('karaoke.downloadingModel', {
        received: formatBytes(model.received),
        total: formatBytes(model.total),
      });
      bar = model.total ? model.received / model.total : 0;
    } else if (model.status === 'checking') {
      line = tr('karaoke.checkingModel');
    } else if (model.status === 'error') {
      line = online
        ? tr('karaoke.modelFailed')
        : tr('karaoke.offline', { size: formatBytes(MODEL.bytes) });
    } else {
      line = tr('karaoke.measuring');
    }
    panel = (
      <View style={styles.panel}>
        <Text style={[font(600, 15), styles.center, { color: INK }]}>
          {line}
        </Text>
        {bar !== null && <Progress value={bar} color={P.accent} />}
        {model.status === 'error' ? (
          <Pill
            label={tr('karaoke.retry')}
            onPress={async () => {
              await ensureModel();
              startKaraoke(track);
            }}
          />
        ) : (
          <Text
            style={[font(400, 13), styles.dim, styles.center, { color: INK }]}
          >
            {tr('karaoke.modelNote')}
          </Text>
        )}
      </View>
    );
  } else if (mode === 'instrumental' && job?.status === 'error') {
    panel = (
      <View style={styles.panel}>
        <Text style={[font(600, 15), styles.center, { color: INK }]}>
          {tr('karaoke.failed')}
        </Text>
        {!!job.error && (
          <Text
            style={[font(400, 12), styles.dim, styles.center, { color: INK }]}
          >
            {job.error}
          </Text>
        )}
        <Pill label={tr('karaoke.retry')} onPress={() => startKaraoke(track)} />
      </View>
    );
  } else if (take && !active) {
    panel = (
      <View style={styles.panel}>
        <Text style={[mono(600, 11), styles.eyebrow, { color: INK }]}>
          {tr('karaoke.yourTake')} · {formatTime(take.length)}
        </Text>
        <Label
          text={tr('karaoke.voiceVolume')}
          value={`${Math.round(voiceGain * 100)}%`}
        />
        <Slider
          value={voiceGain}
          min={0}
          max={2}
          step={0.05}
          color={P.accent}
          onChange={v => {
            setVoiceGain(v);
            engine.setVoiceGain(v);
          }}
        />
        <Label
          text={tr('karaoke.timing')}
          value={`${latency - DEFAULT_LATENCY_MS > 0 ? '+' : ''}${
            latency - DEFAULT_LATENCY_MS
          } ms`}
        />
        <Slider
          value={latency}
          min={DEFAULT_LATENCY_MS - 400}
          max={DEFAULT_LATENCY_MS + 400}
          step={10}
          color={P.accent}
          onChange={setLatency}
        />
        <Text style={[font(400, 12), styles.dim, { color: INK }]}>
          {tr('karaoke.timingHint')}
        </Text>
        <View style={styles.row}>
          <Pill
            label={
              engine.state === 'playing'
                ? tr('karaoke.pause')
                : tr('karaoke.play')
            }
            onPress={() =>
              engine.state === 'playing'
                ? engine.stop(false)
                : engine.playTake(take, offsetMs, voiceGain)
            }
          />
          <Pill
            label={saving ? tr('karaoke.saving') : tr('karaoke.save')}
            strong
            disabled={saving || waitingToSave}
            onPress={save}
          />
          <Pill label={tr('karaoke.again')} onPress={() => sing(true)} />
        </View>
        {waitingToSave && (
          <Text
            style={[font(400, 12), styles.dim, styles.center, { color: INK }]}
          >
            {tr('karaoke.saveWait', { percent })}
          </Text>
        )}
      </View>
    );
  } else if (active || engine.state === 'paused') {
    panel = (
      <View style={styles.panel}>
        <View style={styles.row}>
          {engine.recording && (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={[font(600, 12), { color: INK }]}>
                {tr('karaoke.recording')}
              </Text>
            </View>
          )}
          <Text style={[mono(500, 12), { color: INK }]}>
            {formatTime(position)} / {formatTime(job?.total || engine.length)}
          </Text>
        </View>
        {engine.state === 'waiting' && (
          <Text
            style={[font(500, 13), styles.dim, styles.center, { color: INK }]}
          >
            {tr('karaoke.catchingUp')} {percent}%
          </Text>
        )}
        <View style={styles.row}>
          {!engine.recording && (
            <Round
              onPress={() =>
                engine.state === 'paused' ? engine.resume() : engine.pause()
              }
            >
              {engine.state === 'paused' ? (
                <PlayRoundIcon color={INK} />
              ) : (
                <PauseIcon color={INK} />
              )}
            </Round>
          )}
          <Pill label={tr('karaoke.stop')} strong onPress={stop} />
        </View>
      </View>
    );
  } else {
    let status: string | null = null;
    if (mode === 'instrumental' && !engine.complete && job) {
      if (canStart) {
        status = tr('karaoke.removing', { percent });
      } else if (need === null || job.rate <= 0) {
        status = `${tr('karaoke.removing', { percent })} · ${tr(
          'karaoke.measuring',
        )}`;
      } else {
        const wait = Math.max(1, (need - engine.ready) / job.rate);
        status = `${tr('karaoke.removing', { percent })} · ${tr(
          'karaoke.startsIn',
          {
            time: formatTime(wait),
          },
        )}`;
      }
    }
    panel = (
      <View style={styles.panel}>
        {!!status && (
          <>
            <Text style={[font(500, 13), styles.center, { color: INK }]}>
              {status}
            </Text>
            <Progress value={percent / 100} color={P.accent} />
          </>
        )}
        <View style={styles.row}>
          <Pill
            label={tr('karaoke.listen')}
            disabled={!canStart || starting}
            onPress={() => sing(false)}
          />
          <Pressable
            disabled={!canStart || starting}
            onPress={() => sing(true)}
            style={({ pressed }) => [
              styles.singBtn,
              {
                opacity: canStart ? 1 : 0.4,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              },
            ]}
          >
            {starting ? (
              <Spinner color={INK} track="rgba(255,255,255,0.25)" />
            ) : (
              <MicIcon color={INK} size={22} />
            )}
            <Text style={[font(700, 16), { color: INK }]}>
              {tr('karaoke.sing')}
            </Text>
          </Pressable>
        </View>
        <Text
          style={[font(400, 12), styles.dim, styles.center, { color: INK }]}
        >
          {tr('karaoke.headphones')}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: P.deep }]}>
      {!!art && (
        <Image source={{ uri: art }} blurRadius={40} style={styles.blur} />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.1) 0%, ${P.deep} 60%)`,
          },
        ]}
      />
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={styles.top}>
          <Round onPress={() => nav.goBack()}>
            <ChevronDownIcon color={INK} />
          </Round>
          <View style={styles.topMid}>
            <Text style={[mono(500, 10), styles.dim, { color: INK }]}>
              {tr('karaoke.title').toUpperCase()}
            </Text>
            <Text numberOfLines={1} style={[font(600, 15), { color: INK }]}>
              {track.title}
            </Text>
            {!!track.artist && (
              <Text
                numberOfLines={1}
                style={[font(400, 12), styles.dim, { color: INK }]}
              >
                {track.artist}
              </Text>
            )}
          </View>
          <Round onPress={() => goToTab('Saving')}>
            <DownloadIcon color={INK} />
          </Round>
        </View>
        <LyricsPanel
          track={track}
          ink={INK}
          chip={CHIP}
          position={position}
          style={styles.lyrics}
        />
        {panel}
      </View>
    </View>
  );
}

/** One of the two ways to sing, asked when karaoke opens. */
function Choice({
  title,
  hint,
  accent,
  onPress,
}: {
  title: string;
  hint: string;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: accent ? ACCENT : CHIP,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Text style={[font(700, 16), { color: INK }]}>{title}</Text>
      <Text style={[font(400, 13, 1.35), styles.dim, { color: INK }]}>
        {hint}
      </Text>
    </Pressable>
  );
}

function Progress({ value, color }: { value: number; color: string }) {
  return (
    <View style={styles.progress}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: 2,
        }}
      />
    </View>
  );
}

function Pill({
  label,
  onPress,
  strong,
  disabled,
}: {
  label: string;
  onPress: () => void;
  strong?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: strong ? INK : CHIP,
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
    >
      <Text style={[font(600, 14), { color: strong ? '#111' : INK }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Round({
  onPress,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { transform: [{ scale: pressed ? 0.9 : 1 }] },
      ]}
    >
      {children}
    </Pressable>
  );
}

function Label({ text, value }: { text: string; value: string }) {
  return (
    <View style={styles.label}>
      <Text style={[font(600, 13), { color: INK }]}>{text}</Text>
      <Text style={[mono(500, 12), styles.dim, { color: INK }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  blur: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '70%',
    opacity: 0.5,
  },
  content: { flex: 1, paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  topMid: { flex: 1, alignItems: 'center', minWidth: 0 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CHIP,
  },
  lyrics: { flex: 1, marginTop: 12 },
  panel: { gap: 12, paddingTop: 12 },
  center: { textAlign: 'center' },
  dim: { opacity: 0.7 },
  eyebrow: { letterSpacing: 1, opacity: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
  },
  singBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  choice: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  progress: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(229,72,77,0.25)',
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RED },
  label: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
