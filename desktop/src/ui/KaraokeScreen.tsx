/**
 * Karaoke for one song: choose to remove the vocals or sing over the song; the
 * voice remover is downloaded the first time; the instrumental plays as soon as
 * enough of it is made, the lyrics follow it, and the singer records a take,
 * listens back (voice volume, timing), names it and saves it in Music/Karaoke.
 */
import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { tr } from '../core/i18n';
import { useLibrary } from '../core/player/hooks';
import { PlayerService } from '../core/player/PlayerService';
import {
  MODEL,
  ensureModel,
  getJob,
  getKaraokeVersion,
  getModelState,
  headStartNeeded,
  instrumentalReady,
  isPrepared,
  releaseModel,
  startKaraoke,
  subscribeKaraoke,
  watchJob,
} from '../core/services/karaoke';
import { KaraokeEngine, micAllowed, type Take } from '../core/services/karaokeEngine';
import { saveMix } from '../core/services/karaokeRecordings';
import { formatBytes } from '../core/services/storage';
import { useOnline } from '../core/services/network';
import { toast } from '../core/state/ui';
import { formatTime, paletteFor, useCoverColors } from '../core/theme';
import { artworkUri } from '../core/types';
import { setApp } from './appState';
import { CloseIcon, DownloadIcon, HeadphonesIcon, MicIcon, PauseIcon, PlayIcon } from './icons';
import { ACCENT, Cover } from './kit';
import { LyricsView, useLyrics } from './player/common';

type Mode = 'instrumental' | 'original';

export function KaraokeScreen({ trackId }: { trackId: string }) {
  useCoverColors();
  const { byId } = useLibrary();
  const track = byId.get(trackId) ?? null;
  useSyncExternalStore(subscribeKaraoke, getKaraokeVersion);
  const job = getJob(trackId);
  const model = getModelState();
  const online = useOnline();
  const lyrics = useLyrics(track);

  const engineRef = useRef<KaraokeEngine | null>(null);
  if (!engineRef.current) engineRef.current = new KaraokeEngine();
  const engine = engineRef.current;
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [position, setPosition] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [timing, setTiming] = useState(0);
  const [voice, setVoice] = useState(100);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState<Mode | null>(() => {
    const j = getJob(trackId);
    return j && j.status !== 'error' && j.status !== 'cancelled' ? 'instrumental' : null;
  });
  const [madeBefore, setMadeBefore] = useState(isPrepared(trackId));
  useEffect(() => {
    instrumentalReady(trackId).then(setMadeBefore);
  }, [trackId]);

  // Karaoke takes over the sound and keeps its pieces while it's open.
  useEffect(() => {
    PlayerService.pause();
    const unwatch = watchJob(trackId);
    const unsub = engine.subscribe(rerender);
    return () => {
      unsub();
      unwatch();
      engine.close();
      releaseModel();
    };
  }, [engine, trackId]);

  // Feed the engine: pieces in order while it's made, or the finished file.
  const fed = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (mode !== 'instrumental' || !job || fed.current < 0) return;
    if (job.status === 'done' && fed.current === 0 && job.path) {
      fed.current = -1;
      const path = job.path;
      chain.current = chain.current.then(() => engine.setComplete(path).catch(e => console.warn(e)));
      return;
    }
    while (fed.current < job.pieces.length) {
      const piece = job.pieces[fed.current++];
      chain.current = chain.current.then(() => engine.addPiece(piece.path).catch(e => console.warn(e)));
    }
    if (job.status === 'done' && !engine.complete) {
      chain.current = chain.current.then(() => engine.setComplete());
    }
  }, [mode, job, job?.pieces.length, job?.status, engine]);

  // The clock: a few times a second, for the lyrics and the "catching up" pause.
  useEffect(() => {
    const id = setInterval(() => {
      engine.needAhead = () => (job ? (headStartNeeded(job, engine.position) ?? 8) : 8);
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

  useEffect(() => {
    if (take && track && !name) {
      setName(tr('desktop.takeName', { title: track.title, n: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take]);

  const close = () => setApp({ karaoke: null });
  if (!track) return null;

  const art = artworkUri(track);
  const P = paletteFor(track, art);
  const need = mode === 'instrumental' && job ? headStartNeeded(job) : null;
  const canStart = mode === 'original' ? engine.complete : engine.complete || (need !== null && engine.ready >= need - 0.01);
  const percent = job?.total ? Math.min(100, Math.floor((job.done / job.total) * 100)) : 0;
  const singing = engine.state === 'playing' || engine.state === 'waiting' || engine.state === 'paused';
  const modelBusy = mode === 'instrumental' && job?.status === 'waiting' && model.status !== 'ready';
  const offsetMs = take ? take.musicAt * 1000 + engine.latencyMs - timing : 0;
  const waitingToSave = mode === 'instrumental' && job?.status !== 'done';
  const readyIn = need !== null ? Math.max(0, need - engine.ready) / Math.max(0.2, job?.rate || 1) : null;
  const modeLabel = mode === 'instrumental' ? tr('desktop.vocalsRemoved') : tr('desktop.originalSong');

  const choose = (next: Mode) => {
    setMode(next);
    if (next === 'instrumental') startKaraoke(track);
    else {
      const path = track.filePath!;
      chain.current = chain.current.then(() =>
        engine.setComplete(path).catch(e => toast(tr('karaoke.recordFailed', { reason: e?.message ?? e }))),
      );
    }
  };

  const sing = async () => {
    if (starting || !canStart) return;
    setStarting(true);
    try {
      if (!(await micAllowed())) {
        toast(tr('karaoke.micDenied'));
        return;
      }
      setTake(null);
      setName('');
      engine.forgetTake();
      await engine.start(true);
    } catch (e: any) {
      toast(tr('karaoke.recordFailed', { reason: e?.message ?? String(e) }));
    } finally {
      setStarting(false);
    }
  };

  const finish = async () => {
    try {
      const t = await engine.stopRecording();
      if (t) setTake(t);
    } catch (e: any) {
      toast(tr('karaoke.recordFailed', { reason: e?.message ?? String(e) }));
    }
  };

  const save = async () => {
    if (!take || saving || !mode) return;
    setSaving(true);
    engine.stop(false);
    try {
      await saveMix(track, take.path, offsetMs, voice / 100, mode, name.trim() || track.title);
      toast(tr('desktop.savedToast'));
      close();
    } catch (e: any) {
      toast(tr('karaoke.saveFailed', { reason: e?.message ?? String(e) }));
    } finally {
      setSaving(false);
    }
  };

  let body: React.ReactNode;
  if (!mode) {
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Cover src={art} size={150} radius={20} bg={P.artBg} style={{ margin: '24px auto 0', boxShadow: '0 18px 40px rgba(0,0,0,.45)' }} />
        <div style={{ marginTop: 22, textAlign: 'center', font: "700 24px/1.15 'Geist',sans-serif", letterSpacing: '-.02em' }}>{tr('karaoke.chooseTitle')}</div>
        <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
          <Choice
            accent
            icon={<MicIcon off size={20} />}
            title={tr('karaoke.removeVocals')}
            tag={madeBefore ? tr('desktop.tagInstant') : model.status === 'ready' ? tr('desktop.tagOffline') : tr('desktop.tagOnce', { size: formatBytes(MODEL.bytes) })}
            hint={tr('desktop.karaokeRemoveHint')}
            onClick={() => choose('instrumental')}
          />
          <Choice icon={<MicIcon size={20} />} title={tr('karaoke.keepSong')} hint={tr('karaoke.keepSongHint')} onClick={() => choose('original')} />
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.07)', font: "400 13px/1.4 'Geist',sans-serif" }}>
          <HeadphonesIcon size={20} />
          <span style={{ opacity: 0.85 }}>{tr('karaoke.headphones')}</span>
        </div>
      </div>
    );
  } else if (modelBusy || (mode === 'instrumental' && job?.status === 'error' && model.status === 'error')) {
    const received = model.status === 'downloading' ? model.received : 0;
    const total = model.status === 'downloading' ? model.total : MODEL.bytes;
    const pct = total ? Math.round((received / total) * 100) : 0;
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', margin: '0 auto' }}>
          <DownloadIcon size={26} />
        </div>
        <div style={{ marginTop: 20, textAlign: 'center', font: "700 22px/1.2 'Geist',sans-serif", letterSpacing: '-.02em' }}>
          {model.status === 'error' ? tr('karaoke.modelFailed') : model.status === 'checking' ? tr('karaoke.checkingModel') : tr('desktop.gettingRemover')}
        </div>
        <div style={{ marginTop: 6, textAlign: 'center', font: "400 13px/1.45 'Geist',sans-serif", opacity: 0.72 }}>
          {model.status === 'error' && !online ? tr('karaoke.offline', { size: formatBytes(MODEL.bytes) }) : tr('desktop.removerFrom', { name: MODEL.name })}
        </div>
        {model.status === 'error' ? (
          <button
            onClick={async () => {
              await ensureModel();
              startKaraoke(track);
            }}
            style={{ margin: '24px auto 0', border: 0, background: ACCENT, color: '#fff', font: "600 14px 'Geist',sans-serif", padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}
          >
            {tr('karaoke.retry')}
          </button>
        ) : (
          <>
            <div style={{ marginTop: 24, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: ACCENT, borderRadius: 3 }} />
            </div>
            <div className="mono" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', font: "500 12px 'Geist Mono',monospace", opacity: 0.75 }}>
              <span>{tr('desktop.ofSize', { received: formatBytes(received), total: formatBytes(total) })}</span>
              <span>{pct}%</span>
            </div>
          </>
        )}
        <div style={{ marginTop: 24, textAlign: 'center', font: "400 12px 'Geist',sans-serif", opacity: 0.6 }}>{tr('desktop.nothingSent')}</div>
      </div>
    );
  } else if (mode === 'instrumental' && job?.status === 'error') {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10, textAlign: 'center' }}>
        <div style={{ font: "700 22px 'Geist',sans-serif" }}>{tr('karaoke.failed')}</div>
        {job.error && <div style={{ font: "400 12px 'Geist',sans-serif", opacity: 0.7 }}>{job.error}</div>}
        <button onClick={() => startKaraoke(track)} style={{ marginTop: 10, border: 0, background: ACCENT, color: '#fff', font: "600 14px 'Geist',sans-serif", padding: '10px 18px', borderRadius: 999, cursor: 'pointer' }}>
          {tr('karaoke.retry')}
        </button>
      </div>
    );
  } else if (take && !singing) {
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginTop: 22, font: "700 26px/1.1 'Geist',sans-serif", letterSpacing: '-.02em' }}>{tr('karaoke.yourTake')}</div>
        <div style={{ marginTop: 4, font: "400 14px 'Geist',sans-serif", opacity: 0.7 }}>
          {tr('desktop.recordedLine', { time: formatTime(take.length), mode: modeLabel })}
        </div>
        <div style={{ marginTop: 18, padding: 14, borderRadius: 18, background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => (engine.state === 'playing' ? engine.stop(false) : engine.playTake(take, offsetMs, voice / 100))}
            aria-label={tr('desktop.listenBack')}
            style={{ width: 48, height: 48, borderRadius: '50%', border: 0, background: '#fff', color: '#141416', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
          >
            {engine.state === 'playing' ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "500 13px 'Geist',sans-serif", marginBottom: 8, opacity: 0.85 }}>{tr('desktop.listenBack')}</div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(position / (take.length || 1)) * 100}%`, background: ACCENT }} />
            </div>
            <div className="mono" style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', font: "500 12px 'Geist Mono',monospace", opacity: 0.75 }}>
              <span>{formatTime(position)}</span>
              <span>{formatTime(take.length)}</span>
            </div>
          </div>
        </div>
        <Slider
          label={tr('karaoke.voiceVolume')}
          value={`${voice}%`}
          min={0}
          max={150}
          step={5}
          v={voice}
          onChange={v => {
            setVoice(v);
            engine.setVoiceGain(v / 100);
          }}
        />
        <Slider
          label={tr('karaoke.timing')}
          value={!timing ? tr('desktop.inTime') : timing < 0 ? tr('desktop.msEarlier', { ms: -timing }) : tr('desktop.msLater', { ms: timing })}
          min={-300}
          max={300}
          step={10}
          v={timing}
          onChange={setTiming}
          ends={[tr('desktop.voiceEarlier'), tr('desktop.voiceLater')]}
        />
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={tr('desktop.nameTake')}
          style={{ marginTop: 14, height: 46, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.06)', color: '#fff', padding: '0 14px', font: "400 15px 'Geist',sans-serif", outline: 0 }}
        />
        <div style={{ marginTop: 'auto', paddingTop: 14, display: 'grid', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving || waitingToSave}
            style={{ height: 52, borderRadius: 16, border: 0, background: ACCENT, color: '#fff', font: "600 16px 'Geist',sans-serif", cursor: saving || waitingToSave ? 'default' : 'pointer', opacity: saving || waitingToSave ? 0.6 : 1 }}
          >
            {saving ? tr('karaoke.saving') : tr('desktop.saveRecording')}
          </button>
          {waitingToSave && <div style={{ textAlign: 'center', font: "400 12px 'Geist',sans-serif", opacity: 0.7 }}>{tr('karaoke.saveWait', { percent })}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button onClick={sing} style={{ height: 44, borderRadius: 14, border: 0, background: 'rgba(255,255,255,.12)', color: '#fff', font: "600 14px 'Geist',sans-serif", cursor: 'pointer' }}>
              {tr('karaoke.again')}
            </button>
            <button
              onClick={() => {
                engine.stop(false);
                setTake(null);
                toast(tr('desktop.takeDiscarded'));
              }}
              style={{ height: 44, borderRadius: 14, border: 0, background: 'transparent', color: '#fff', opacity: 0.75, font: "600 14px 'Geist',sans-serif", cursor: 'pointer' }}
            >
              {tr('desktop.discard')}
            </button>
          </div>
          <div style={{ textAlign: 'center', font: "400 11px 'Geist',sans-serif", opacity: 0.55 }}>{tr('desktop.savedHint')}</div>
        </div>
      </div>
    );
  } else {
    const prepping = mode === 'instrumental' && job?.status !== 'done';
    const headline = singing
      ? engine.state === 'waiting'
        ? tr('desktop.waitingMusic')
        : engine.state === 'paused'
          ? tr('desktop.paused')
          : tr('karaoke.recording')
      : !canStart
        ? readyIn !== null
          ? tr('karaoke.startsIn', { time: formatTime(readyIn) })
          : tr('karaoke.measuring')
        : tr('desktop.readyToSing');
    const subline =
      mode === 'original'
        ? tr('desktop.subOver')
        : !prepping
          ? madeBefore && !singing
            ? tr('desktop.subMadeBefore')
            : tr('desktop.subReady')
          : canStart
            ? tr('desktop.subEnough', { percent })
            : tr('desktop.subMaking');
    const total = job?.total || engine.length || track.duration || 0;
    body = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ font: "600 15px 'Geist',sans-serif" }}>{headline}</span>
            <Tag>{modeLabel}</Tag>
          </div>
          <div style={{ marginTop: 3, font: "400 12px/1.45 'Geist',sans-serif", opacity: 0.72 }}>{subline}</div>
          {prepping && (
            <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${percent}%`, background: ACCENT, transition: 'width .25s' }} />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0, marginTop: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {lyrics && !lyrics.lines && !lyrics.plain ? (
            <div style={{ textAlign: 'center', padding: '0 24px', font: "500 15px/1.45 'Geist',sans-serif", opacity: 0.75 }}>{tr('desktop.karaokeNoLyrics')}</div>
          ) : (
            <LyricsView track={track} lyrics={lyrics} size={21} lineHeight={52} height={300} ink="#fff" position={position} align="center" highlight={engine.recording ? '#FFB199' : undefined} />
          )}
        </div>
        {engine.state === 'waiting' && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 12, background: 'rgba(224,83,47,.22)', font: "500 12px/1.4 'Geist',sans-serif", textAlign: 'center' }}>
            {tr('desktop.catchingUp')}
          </div>
        )}
        <div style={{ marginTop: 10, position: 'relative', height: 4, borderRadius: 2, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${mode === 'instrumental' ? percent : 100}%`, background: 'rgba(255,255,255,.28)' }} />
          <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${total ? (position / total) * 100 : 0}%`, background: '#fff' }} />
        </div>
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, font: "500 12px 'Geist Mono',monospace", opacity: 0.75 }}>
          <span>{formatTime(position)}</span>
          <span>{formatTime(total)}</span>
        </div>
        {!singing ? (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <button
              onClick={sing}
              disabled={!canStart}
              style={{ width: '100%', height: 56, borderRadius: 18, border: 0, background: ACCENT, color: '#fff', font: "600 17px 'Geist',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: canStart ? 'pointer' : 'not-allowed', opacity: canStart ? 1 : 0.4, transition: 'opacity .3s' }}
            >
              <MicIcon size={20} />
              {tr('karaoke.sing')}
            </button>
            <div style={{ font: "400 12px 'Geist',sans-serif", opacity: 0.65 }}>{tr('karaoke.headphones')}</div>
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 56, borderRadius: 18, background: 'rgba(255,255,255,.1)', font: "600 15px 'Geist Mono',monospace", flex: 'none' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FF4D3D', display: 'inline-block', animation: engine.state === 'playing' ? 'recPulse 1s ease-in-out infinite' : 'none' }} />
              {formatTime(position)}
            </div>
            <button
              onClick={() => (engine.state === 'paused' ? engine.resume() : engine.pause())}
              aria-label={tr('karaoke.pause')}
              style={{ width: 56, height: 56, borderRadius: '50%', border: 0, background: '#fff', color: '#141416', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
            >
              {engine.state === 'paused' ? <PlayIcon size={22} /> : <PauseIcon size={22} />}
            </button>
            <button
              onClick={finish}
              style={{ flex: 1, height: 56, borderRadius: 18, border: 0, background: 'rgba(255,255,255,.14)', color: '#fff', font: "600 15px 'Geist',sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <span style={{ width: 12, height: 12, borderRadius: 3, background: '#FF4D3D' }} />
              {tr('desktop.finish')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-screen-label="Karaoke"
      style={{ position: 'absolute', inset: 0, zIndex: 45, overflow: 'hidden', background: `radial-gradient(130% 80% at 50% 0%, ${P.deep2} 0%, #0B0B0D 70%)`, color: '#F4F3F0', ['--sb' as string]: '#F4F3F0', animation: 'playerUp .3s cubic-bezier(.2,.8,.2,1)' }}
    >
      {art && <img src={art} alt="" style={{ position: 'absolute', left: '-25%', top: '-12%', width: '150%', height: '70%', objectFit: 'cover', filter: 'blur(70px) saturate(1.4)', opacity: 0.4, pointerEvents: 'none' }} />}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,.05) 0%,rgba(8,8,10,.7) 55%,rgba(8,8,10,.94) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '28px max(24px, calc(50% - 250px)) 28px', overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button
            onClick={close}
            aria-label={tr('desktop.closeKaraoke')}
            title={tr('desktop.closeKaraoke')}
            style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.12)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}
          >
            <CloseIcon size={16} />
          </button>
          <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div className="mono" style={{ font: "500 10px 'Geist Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.7 }}>{tr('karaoke.title')}</div>
            <div className="ellipsis" style={{ font: "600 13px 'Geist',sans-serif", marginTop: 2, maxWidth: 300 }}>
              {track.title} · {track.artist ?? tr('common.unknownArtist')}
            </div>
          </div>
          <div style={{ width: 40, flex: 'none' }} />
        </div>
        {body}
      </div>
    </div>
  );
}

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="mono" style={{ font: "600 10px 'Geist Mono',monospace", letterSpacing: '.04em', textTransform: 'uppercase', padding: '3px 6px', borderRadius: 5, background: 'rgba(255,255,255,.14)', flex: 'none' }}>
    {children}
  </span>
);

function Choice({ icon, title, hint, tag, accent, onClick }: { icon: React.ReactNode; title: string; hint: string; tag?: string; accent?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-white16"
      style={{ textAlign: 'start', border: 0, borderRadius: 18, padding: 16, background: 'rgba(255,255,255,.1)', color: 'inherit', cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start', width: '100%' }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 12, background: accent ? ACCENT : 'rgba(255,255,255,.16)', display: 'grid', placeItems: 'center', flex: 'none' }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: "600 16px 'Geist',sans-serif" }}>{title}</span>
          {tag && <Tag>{tag}</Tag>}
        </div>
        <div style={{ marginTop: 4, font: "400 13px/1.4 'Geist',sans-serif", opacity: 0.75 }}>{hint}</div>
      </div>
    </button>
  );
}

function Slider({ label, value, min, max, step, v, onChange, ends }: { label: string; value: string; min: number; max: number; step: number; v: number; onChange: (v: number) => void; ends?: [string, string] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: "500 14px 'Geist',sans-serif" }}>
        <span>{label}</span>
        <span className="mono" style={{ font: "600 13px 'Geist Mono',monospace" }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => onChange(+e.target.value)} style={{ width: '100%', marginTop: 8 }} />
      {ends && (
        <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', font: "400 11px 'Geist Mono',monospace", opacity: 0.55 }}>
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}
