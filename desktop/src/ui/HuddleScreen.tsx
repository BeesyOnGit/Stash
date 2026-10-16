/** Huddle: the lobby (start or join) and the room (stage or Guess the song, shared playlist, chat), over the window below the title bar. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  DEFAULT_EMOS,
  EMO_CATS,
  HUDDLE_COLORS,
  QUICK_EMOS,
  huddle,
  huddleColor,
  pickDecoys,
  saveToLibrary,
  tasteMatch,
  useHuddle,
  type HuddleChat,
  type HuddleView,
  type RoomState,
  type SharedTrack,
} from '../core/huddle';
import { ago, chatText, errorText, gameText, lastText, memberSub, recapOf, sourceText, statusText, vibeText } from '../core/huddle/labels';
import { tr, useLanguage, type Key } from '../core/i18n';
import { useDownloadProgress, useLibrary } from '../core/player/hooks';
import { saveSettings, useSettings } from '../core/services/settings';
import { searchOnline } from '../core/sources';
import { toast } from '../core/state/ui';
import { formatTime, paletteFor } from '../core/theme';
import { artworkUri, type OnlineResult, type Track } from '../core/types';
import { setApp } from './appState';
import { CheckIcon, ChevronLeftIcon, CloseIcon, DotsIcon, DownloadIcon, GripIcon, MicIcon, NextIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, PrevIcon, SearchIcon, VolumeIcon } from './icons';
import { ACCENT, Cover } from './kit';
import { VolumeControl } from './player/PlayerBar';

const font = (w: number, s: number, fam = 'Geist') => `${w} ${s}px '${fam}',${fam === 'Geist' ? 'sans-serif' : 'monospace'}`;
/** Google's emoji, like the phone. */
const EMOJI = "'Noto Color Emoji','Segoe UI Emoji','Apple Color Emoji',sans-serif";
const emo = (size: number): CSSProperties => ({ font: `${size}px/1 ${EMOJI}` });
const close = () => setApp({ huddle: false });
const initial = (name: string) => name[0]?.toUpperCase() ?? '?';

const QuestionIcon = ({ size = 19 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01" /></svg>
);

export function HuddleScreen() {
  useLanguage();
  const v = useHuddle();
  return (
    <div style={{ position: 'absolute', top: 48, left: 0, right: 0, bottom: 0, zIndex: 40, background: 'var(--bg)', color: 'var(--ink)', animation: 'fadeIn .2s', display: 'flex' }}>
      {v.room ? <Room v={v} room={v.room} /> : <Lobby v={v} />}
    </div>
  );
}

// ---------- lobby ----------

function Lobby({ v }: { v: HuddleView }) {
  const settings = useSettings();
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const busy = v.status !== 'idle';
  const me = () => ({ name: settings.huddleName.trim() || 'Guest', color: settings.huddleColor });
  const create = () => !busy && huddle.create(me(), roomName.trim());
  const join = () => !busy && code.length === 6 && huddle.join(me(), code);
  const input: CSSProperties = { height: 44, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line2)', outline: 0, background: 'var(--bg)', font: font(400, 15), color: 'var(--ink)' };
  const card: CSSProperties = { padding: 24, borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 };
  const iconBox: CSSProperties = { width: 44, height: 44, borderRadius: 12, background: 'var(--accentSoft)', color: ACCENT, display: 'grid', placeItems: 'center' };
  const bigBtn = (on: boolean): CSSProperties => ({ height: 44, border: 0, borderRadius: 12, background: on ? ACCENT : 'var(--fill2)', color: on ? '#fff' : 'var(--muted)', font: font(600, 15), cursor: on ? 'pointer' : 'default', transition: 'background .2s' });
  const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, font: font(500, 13), color: 'var(--muted)' };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 32px 40px' }}>
        <button onClick={close} className="h-fill2" style={{ height: 32, padding: '0 12px 0 6px', border: 0, borderRadius: 999, background: 'var(--fill2)', display: 'flex', alignItems: 'center', gap: 2, font: font(500, 13), cursor: 'pointer' }}>
          <ChevronLeftIcon size={18} />
          {tr('huddle.back')}
        </button>
        <div className="eyebrow" style={{ marginTop: 44 }}>{tr('huddle.nav')}</div>
        <h1 style={{ margin: '6px 0 0', font: "700 48px/1.02 'Geist',sans-serif", letterSpacing: '-.04em' }}>{tr('huddle.title')}</h1>
        <p style={{ margin: '14px 0 0', maxWidth: 560, font: "400 16px/1.5 'Geist',sans-serif", color: 'var(--ink2)' }}>{tr('huddle.intro')}</p>

        <div style={{ marginTop: 24, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ ...label, width: 320 }}>
            {tr('huddle.yourName')}
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: huddleColor(settings.huddleColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 17), flex: 'none', transition: 'background .2s' }}>{initial(settings.huddleName.trim() || 'Guest')}</span>
              <input value={settings.huddleName} maxLength={24} onChange={e => saveSettings({ huddleName: e.target.value })} placeholder="Guest" style={{ ...input, flex: 1, minWidth: 0 }} />
            </span>
          </label>
          <div style={label}>
            {tr('huddle.yourColor')}
            <div style={{ display: 'flex', gap: 8, height: 44, alignItems: 'center' }}>
              {HUDDLE_COLORS.map((c, i) => (
                <button key={c} onClick={() => saveSettings({ huddleColor: i })} aria-label={`${tr('huddle.yourColor')} ${i + 1}`} style={{ width: 30, height: 30, borderRadius: '50%', border: 0, padding: 0, background: c, color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: settings.huddleColor === i ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ink)' : 'none' }}>
                  {settings.huddleColor === i && <CheckIcon size={14} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {v.error && <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: 'var(--accentSoft)', color: 'var(--accentInk)', font: font(500, 13) }}>{errorText(v.error)}</div>}

        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 16 }}>
          <div style={card}>
            <div style={iconBox}><PlusIcon size={22} /></div>
            <div>
              <div style={{ font: font(600, 20), letterSpacing: '-.02em' }}>{tr('huddle.startTitle')}</div>
              <div style={{ marginTop: 4, font: "400 14px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('huddle.startSub')}</div>
            </div>
            <input value={roomName} onChange={e => setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder={tr('huddle.namePh')} maxLength={40} style={input} />
            <button onClick={create} style={bigBtn(!busy)}>{busy ? tr('huddle.connecting') : tr('huddle.start')}</button>
          </div>
          <div style={card}>
            <div style={iconBox}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" /></svg>
            </div>
            <div>
              <div style={{ font: font(600, 20), letterSpacing: '-.02em' }}>{tr('huddle.joinTitle')}</div>
              <div style={{ marginTop: 4, font: "400 14px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('huddle.joinSub')}</div>
            </div>
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && join()}
              placeholder="K7Q2MX"
              spellCheck={false}
              style={{ ...input, textAlign: 'center', font: font(600, 20, 'Geist Mono'), letterSpacing: '.35em' }}
            />
            <button onClick={join} style={bigBtn(code.length === 6 && !busy)}>{busy ? tr('huddle.connecting') : tr('huddle.join')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- room ----------

/** Re-renders a few times a second so the seek bar and countdown move. */
function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

type Panel = null | 'members' | 'recap' | 'game';

function Room({ v, room }: { v: HuddleView; room: RoomState }) {
  const settings = useSettings();
  const deep = settings.playerStyle === 'deep';
  const cur = room.queue[room.index] ?? null;
  const pal = paletteFor(cur ?? { title: room.name, artist: null }, cur?.artwork ?? null);
  const bg = deep ? pal.deep : pal.soft;
  const ink = deep ? '#F4F3F0' : pal.softInk;
  const [editEmos, setEditEmos] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const tint = (pct: number, base: string) => `color-mix(in srgb,${pal.glow} ${pct}%,${base})`;

  return (
    <>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden', background: bg, color: ink, ['--sb' as any]: ink, display: 'flex', flexDirection: 'column', transition: 'background .7s' }}>
        {cur?.artwork && <img src={cur.artwork} alt="" style={{ position: 'absolute', left: '-30%', top: '-20%', width: '160%', height: '80%', objectFit: 'cover', filter: 'blur(80px) saturate(1.5)', opacity: deep ? 0.55 : 0.35, pointerEvents: 'none' }} />}
        <RoomHeader v={v} room={room} bg={bg} ink={ink} onPanel={setPanel} />
        {room.game ? <GameStage v={v} room={room} ink={ink} bg={bg} /> : <Stage v={v} room={room} cur={cur} ink={ink} bg={bg} artBg={pal.artBg} glow={pal.glow} />}
        <Floats v={v} />
        {v.burst && <Burst key={`${v.burst.id}-${v.burst.n}`} emoji={v.burst.emoji} n={v.burst.n} />}
        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 20px 22px' }}>
          <Tray v={v} room={room} ink={ink} bg={bg} deep={deep} editing={editEmos} onEdit={() => setEditEmos(e => !e)} />
          {!room.game && (
            <button onClick={() => setPanel('game')} title={tr('huddle.pickTitle')} style={{ height: 52, padding: '0 18px 0 14px', border: 0, borderRadius: 999, background: deep ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.6)', backdropFilter: 'blur(14px)', boxShadow: '0 6px 20px rgba(0,0,0,.12)', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8, font: font(600, 14), cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <QuestionIcon />
              {tr('huddle.guess')}
            </button>
          )}
          {editEmos && room.host === v.you && <EmoEditor room={room} onDone={() => setEditEmos(false)} />}
        </div>
        {v.voice && <VoiceBar v={v} room={room} deep={deep} />}
      </div>
      <Playlist v={v} room={room} bg={tint(10, 'var(--bg)')} />
      <Chat v={v} room={room} bg={tint(6, 'var(--card)')} />
      {panel === 'game' && <GamePicker room={room} onClose={() => setPanel(null)} />}
      {panel === 'members' && <Members v={v} room={room} onClose={() => setPanel(null)} />}
      {panel === 'recap' && <RecapCard room={room} deep={pal.deep} glow={pal.glow} onClose={() => setPanel(null)} />}
    </>
  );
}

const fab: CSSProperties = { border: 0, background: 'color-mix(in srgb,currentColor 10%,transparent)', color: 'inherit', cursor: 'pointer', flex: 'none' };

function RoomHeader({ v, room, bg, ink, onPanel }: { v: HuddleView; room: RoomState; bg: string; ink: string; onPanel: (p: Panel) => void }) {
  const host = room.members.find(m => m.id === room.host);
  const [menu, setMenu] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(room.code).catch(() => {});
    toast(tr('huddle.copied', { code: room.code }));
  };
  const leave = () => {
    huddle.leave();
    close();
    toast(tr('huddle.left', { name: room.name }));
  };
  const items: [string, () => void, boolean?][] = [
    [tr('huddle.members'), () => onPanel('members')],
    [tr('huddle.recap'), () => onPanel('recap')],
    [tr('huddle.copy'), copy],
    [tr('huddle.leave'), leave, true],
  ];
  return (
    <div style={{ position: 'relative', zIndex: 8, display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px' }}>
      <button onClick={close} title={tr('huddle.back')} style={{ ...fab, width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
        <ChevronLeftIcon size={18} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ font: font(600, 16), letterSpacing: '-.02em' }}>{room.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: font(500, 12, 'Geist Mono'), opacity: 0.8, whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: v.status === 'live' ? ACCENT : '#888' }} />
          {v.status === 'live' ? tr('huddle.live') : tr('huddle.reconnecting')} · {room.host === v.you ? tr('huddle.host') : tr('huddle.hostName', { name: host?.name ?? '' })}
        </div>
      </div>
      <button
        onClick={copy}
        title={tr('huddle.copy')}
        style={{ height: 30, padding: '0 10px', border: '1.5px dashed color-mix(in srgb,currentColor 40%,transparent)', borderRadius: 8, background: 'transparent', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8, font: font(600, 13, 'Geist Mono'), letterSpacing: '.14em', cursor: 'pointer', flex: 'none' }}
      >
        {room.code}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h8" /></svg>
      </button>
      {huddle.canVoice && (
        <button
          onClick={() => (v.voice ? onPanel('members') : joinVoice())}
          style={{ ...fab, height: 34, padding: '0 14px 0 11px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 6, font: font(600, 13), whiteSpace: 'nowrap', background: v.voice?.live ? TALKING : fab.background, color: v.voice?.live ? '#fff' : 'inherit' }}
        >
          <MicIcon size={16} />
          {!v.voice ? tr('huddle.joinVoice') : v.voice.live ? tr('huddle.voiceCount', { count: v.voice.ids.length }) : tr('huddle.voiceJoining')}
        </button>
      )}
      <button onClick={() => onPanel('members')} title={tr('huddle.members')} style={{ border: 0, background: 'transparent', color: 'inherit', padding: '0 0 6px', cursor: 'pointer', flex: 'none' }}>
        <Avatars v={v} room={room} bg={bg} ink={ink} size={30} />
      </button>
      <div style={{ position: 'relative', flex: 'none' }}>
        <button onClick={() => setMenu(m => !m)} title={tr('huddle.more')} style={{ ...fab, width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', padding: 0 }}>
          <DotsIcon size={18} />
        </button>
        {menu && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0 }} />
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', insetInlineEnd: 0, width: 200, padding: 6, borderRadius: 14, background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 18px 44px rgba(0,0,0,.28)', animation: 'hdUp .16s', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {items.map(([label, fn, danger]) => (
                <button key={label} className="h-fill2" onClick={() => { setMenu(false); fn(); }} style={{ height: 40, padding: '0 12px', border: 0, borderRadius: 9, background: 'transparent', color: danger ? 'var(--danger)' : 'var(--ink)', font: font(500, 14), textAlign: 'start', cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const TALKING = '#2EB86B';

async function joinVoice() {
  if (await huddle.joinVoice()) toast(tr('huddle.btHint'));
  else if (huddle.getView().room) toast(tr('huddle.voiceFailed'));
}

/** Who's in the call (a green ring on whoever is talking), mute, ducking and leave. */
function VoiceBar({ v, room, deep }: { v: HuddleView; room: RoomState; deep: boolean }) {
  const voice = v.voice!;
  const pill: CSSProperties = { height: 36, padding: '0 14px 0 11px', border: 0, borderRadius: 999, background: 'color-mix(in srgb,currentColor 10%,transparent)', color: 'inherit', display: 'flex', alignItems: 'center', gap: 7, font: font(600, 13), cursor: 'pointer', whiteSpace: 'nowrap' };
  return (
    <div style={{ position: 'relative', zIndex: 5, margin: '0 20px 18px', padding: '8px 8px 8px 14px', borderRadius: 999, background: deep ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.62)', backdropFilter: 'blur(14px)', boxShadow: '0 6px 20px rgba(0,0,0,.12)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {voice.ids.map(id => {
          const m = room.members.find(x => x.id === id);
          const talking = voice.speaking.includes(id);
          return (
            <span key={id} title={m?.name} style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', background: huddleColor(m?.color ?? 7), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 12), flex: 'none', boxShadow: talking ? `0 0 0 2px ${TALKING}` : 'none', transition: 'box-shadow .15s' }}>
              {initial(m?.name ?? '?')}
              {voice.mutedIds.includes(id) && (
                <span style={{ position: 'absolute', right: -3, bottom: -3, width: 15, height: 15, borderRadius: '50%', background: 'var(--danger)', display: 'grid', placeItems: 'center' }}><MicIcon off size={9} /></span>
              )}
            </span>
          );
        })}
        {!voice.live && <span style={{ font: font(500, 13), opacity: 0.75 }}>{tr('huddle.voiceJoining')}</span>}
      </div>
      <button onClick={() => huddle.toggleMute()} disabled={!voice.live} style={{ ...pill, background: voice.muted ? 'var(--danger)' : pill.background, color: voice.muted ? '#fff' : 'inherit' }}>
        <MicIcon off={voice.muted} size={16} />
        {voice.muted ? tr('huddle.unmute') : tr('huddle.mute')}
      </button>
      <button onClick={() => huddle.toggleDuck()} title={tr('huddle.duck')} aria-pressed={voice.duck} style={{ ...pill, background: voice.duck ? 'color-mix(in srgb,currentColor 22%,transparent)' : pill.background, opacity: voice.duck ? 1 : 0.7 }}>
        <VolumeIcon level={voice.duck ? 0.3 : 1} size={16} />
        {tr('huddle.duck')}
      </button>
      <button onClick={() => huddle.leaveVoice()} style={{ ...pill, background: 'var(--danger)', color: '#fff' }}>{tr('huddle.leave')}</button>
    </div>
  );
}

/** The members' faces, with how well your tastes match. */
export function Avatars({ v, room, bg, ink, size }: { v: HuddleView; room: RoomState; bg: string; ink: string; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingInlineStart: 7, flex: 'none' }}>
      {room.members.slice(0, 6).map(m => {
        const pct = m.id === v.you ? null : tasteMatch(room, v.you, m.id);
        return (
          <span key={m.id} title={pct == null ? m.name : `${m.name} · ${tr('huddle.tasteMatch', { pct })}`} style={{ position: 'relative', width: size, height: size, marginInlineStart: -7, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', border: `2px solid ${bg}`, display: 'grid', placeItems: 'center', font: font(600, size * 0.4), animation: 'popIn .3s' }}>
            {initial(m.name)}
            {pct != null && (
              <span style={{ position: 'absolute', left: '50%', bottom: -8, transform: 'translateX(-50%)', padding: '0 4px', height: 14, borderRadius: 7, background: ink, color: bg, font: font(600, 9, 'Geist Mono'), lineHeight: '14px', whiteSpace: 'nowrap' }}>{pct}%</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

const chipStyle: CSSProperties = { minHeight: 28, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderRadius: 999, background: 'color-mix(in srgb,currentColor 9%,transparent)', font: font(500, 12), boxSizing: 'border-box' };

function Stage({ v, room, cur, ink, bg, artBg, glow }: { v: HuddleView; room: RoomState; cur: SharedTrack | null; ink: string; bg: string; artBg: string; glow: string }) {
  useTicker(500);
  const pos = huddle.position();
  const dur = cur?.duration ?? 0;
  const on = room.playing || room.pending;
  const pill = statusText(v) ?? (room.last ? lastText(room.last) : tr('huddle.shared'));
  const pillColor = room.last && !statusText(v) ? huddleColor(room.last.color) : 'currentColor';
  const ctl: CSSProperties = { width: 44, height: 44, border: 0, background: 'transparent', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer' };
  const lib = useLibraryStatus();
  const shout = cur?.shout && v.shout?.key === cur.key && Date.now() - v.shout.at < 8000 ? cur : null;
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px' }}>
      {shout && (
        <div style={{ position: 'absolute', top: 2, left: 24, right: 24, zIndex: 5, display: 'flex', justifyContent: 'center' }}>
          <div onClick={huddle.closeShout} style={{ maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 10px', borderRadius: 16, background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 14px 36px rgba(0,0,0,.25)', animation: 'hdUp .3s', cursor: 'pointer' }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', background: huddleColor(shout.byColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 12), flex: 'none' }}>{initial(shout.byName)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: font(600, 10, 'Geist Mono'), letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{shout.by === v.you ? tr('huddle.yourShout') : tr('huddle.shoutBy', { name: shout.byName })}</div>
              <div style={{ marginTop: 1, font: "500 14px/1.35 'Geist',sans-serif" }}>“{shout.shout}”</div>
            </div>
          </div>
        </div>
      )}
      <div style={{ position: 'relative', width: 240, height: 240, flex: 'none' }}>
        <div style={{ position: 'absolute', inset: -44, borderRadius: '50%', background: `radial-gradient(closest-side,${glow},transparent)`, opacity: 0.7, animation: room.playing ? 'rmPulse 1.9s ease-in-out infinite' : 'none', pointerEvents: 'none' }} />
        <Cover src={cur?.artwork} size={240} radius={16} bg={artBg} style={{ position: 'relative', boxShadow: '0 24px 60px rgba(0,0,0,.35)' }} />
      </div>
      <div style={{ marginTop: 22, maxWidth: '100%', textAlign: 'center' }}>
        <div className="ellipsis" style={{ font: "700 28px/1.15 'Geist',sans-serif", letterSpacing: '-.03em' }}>{cur?.title ?? tr('huddle.empty')}</div>
        {cur && <div style={{ marginTop: 4, font: font(400, 16), opacity: 0.8 }}>{cur.artist}</div>}
      </div>
      {cur && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 7, font: font(500, 12), opacity: 0.9 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: huddleColor(cur.byColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 10) }}>{initial(cur.byName)}</span>
          <span>{tr('huddle.addedBy', { name: cur.by === v.you ? tr('huddle.you') : cur.byName, source: sourceText(cur) })}</span>
        </div>
      )}
      <div style={{ marginTop: 22, width: '100%', maxWidth: 440 }}>
        <div
          onClick={e => {
            if (!dur) return;
            const b = e.currentTarget.getBoundingClientRect();
            huddle.remote.seek(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * dur);
          }}
          style={{ height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'color-mix(in srgb,currentColor 18%,transparent)', position: 'relative', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%`, borderRadius: 2, background: 'currentColor' }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: font(500, 12, 'Geist Mono'), opacity: 0.75 }}>
          <span>{formatTime(pos)}</span>
          <span>{formatTime(dur)}</span>
        </div>
      </div>
      <div style={{ marginTop: 6, width: '100%', maxWidth: 460, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', alignItems: 'center', gap: 12 }}>
        <div style={{ justifySelf: 'start' }}>{cur && <DlButton t={cur} status={lib.get(cur.key)} big />}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <button onClick={huddle.remote.previous} style={ctl}><PrevIcon size={26} /></button>
          <button onClick={on ? huddle.remote.pause : huddle.remote.play} title={tr('huddle.playForAll')} style={{ width: 60, height: 60, borderRadius: '50%', border: 0, background: ink, color: bg, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            {on ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
          </button>
          <button onClick={huddle.remote.next} style={ctl}><NextIcon size={26} /></button>
        </div>
        <div style={{ justifySelf: 'end' }}>
          <VolumeControl track="color-mix(in srgb,currentColor 18%,transparent)" played="currentColor" color="inherit" panel="var(--card)" />
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%' }}>
        <div style={{ ...chipStyle, whiteSpace: 'nowrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: glow, boxShadow: `0 0 8px ${glow}`, flex: 'none' }} />
          {vibeText(cur)}
        </div>
        <div style={{ ...chipStyle, maxWidth: '100%' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: pillColor, flex: 'none' }} />
          <span className="ellipsis">{pill}</span>
        </div>
      </div>
    </div>
  );
}

function GameStage({ v, room, ink, bg }: { v: HuddleView; room: RoomState; ink: string; bg: string }) {
  useTicker(250);
  const g = room.game!;
  const cur = room.queue[room.index] ?? null;
  const ask = g.phase === 'ask';
  const mine = g.by === v.you;
  const hide = ask && !mine;
  const [myPick, setMyPick] = useState<{ round: number; opt: number } | null>(null);
  const picked = g.picks?.find(p => p.who === v.you)?.opt ?? (myPick?.round === g.round ? myPick.opt : null);
  const now = huddle.serverNow();
  const left = g.start ? Math.max(0, Math.ceil((g.end - now) / 1000)) : 20;
  const pct = g.start ? Math.max(0, Math.min(1, (g.end - now) / (g.end - g.start))) : 1;
  const guess = (i: number) => {
    if (!ask || mine || picked != null || !g.start) return;
    setMyPick({ round: g.round, opt: i });
    huddle.guess(i);
  };
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', animation: 'fadeIn .25s' }}>
      <div style={{ font: font(600, 12, 'Geist Mono'), letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.85 }}>{tr('huddle.round', { n: g.round })} · {tr('huddle.guess')}</div>
      <div style={{ marginTop: 4, font: font(400, 13), opacity: 0.75 }}>{mine ? (ask ? tr('huddle.yourPickSecret') : tr('huddle.yourPick')) : tr('huddle.pickedBy', { name: g.byName })}</div>
      <div style={{ position: 'relative', marginTop: 18, width: 200, height: 200, borderRadius: 16, overflow: 'hidden', background: 'color-mix(in srgb,currentColor 15%,transparent)', boxShadow: '0 24px 60px rgba(0,0,0,.35)' }}>
        {cur?.artwork && <img src={cur.artwork} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: hide ? 'blur(18px) saturate(1.3)' : 'none', transform: `scale(${hide ? 1.25 : 1})`, transition: 'filter .6s, transform .6s' }} />}
        {ask && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(10,10,12,.5)', backdropFilter: 'blur(6px)', color: '#fff', display: 'grid', placeItems: 'center', font: font(700, 30, 'Geist Mono') }}>{left}</div>
          </div>
        )}
      </div>
      {ask && (
        <div style={{ marginTop: 12, width: 200, height: 4, borderRadius: 2, background: 'color-mix(in srgb,currentColor 18%,transparent)' }}>
          <div style={{ height: '100%', width: `${pct * 100}%`, borderRadius: 2, background: 'currentColor', transition: 'width .25s linear' }} />
        </div>
      )}
      {!hide && cur && (
        <div style={{ marginTop: 12, maxWidth: '100%', textAlign: 'center', animation: 'hdUp .3s' }}>
          <div className="ellipsis" style={{ font: "700 22px/1.2 'Geist',sans-serif", letterSpacing: '-.02em' }}>{cur.title}</div>
          <div style={{ marginTop: 2, font: font(400, 14), opacity: 0.8 }}>{cur.artist}</div>
        </div>
      )}
      <div style={{ marginTop: 18, width: '100%', maxWidth: 460, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
        {g.opts.map((o, i) => {
          let back = 'color-mix(in srgb,currentColor 11%,transparent)', fore = 'inherit', op = 1;
          if (ask) {
            if (picked === i) [back, fore] = [ink, bg];
            else if (picked != null || mine) op = 0.6;
          } else if (g.answer === i) [back, fore] = ['#23804F', '#fff'];
          else if (picked === i) [back, fore] = ['#C2421F', '#fff'];
          else op = 0.5;
          const votes = (g.picks ?? []).filter(p => p.opt === i).map(p => room.members.find(m => m.id === p.who)).filter(m => !!m);
          return (
            <button key={i} onClick={() => guess(i)} style={{ position: 'relative', minHeight: 58, padding: '9px 12px', border: 0, borderRadius: 14, background: back, color: fore, opacity: op, textAlign: 'start', cursor: ask && !mine && picked == null ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, minWidth: 0, transition: 'background .2s,opacity .2s' }}>
              <span className="ellipsis" style={{ font: "600 14px/1.25 'Geist',sans-serif", maxWidth: '100%' }}>{o.title}</span>
              <span className="ellipsis" style={{ font: font(400, 12), opacity: 0.75, maxWidth: '100%' }}>{o.artist}</span>
              {votes.length > 0 && (
                <span style={{ position: 'absolute', top: -7, insetInlineEnd: 8, display: 'flex', gap: 2 }}>
                  {votes.map(m => (
                    <span key={m.id} title={m.name} style={{ width: 18, height: 18, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', border: `1.5px solid ${bg}`, display: 'grid', placeItems: 'center', font: font(600, 9) }}>{initial(m.name)}</span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ ...chipStyle, marginTop: 14, textAlign: 'center' }}>{gameText(v)}</div>
      {!ask && room.scores.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {room.scores.slice(0, 4).map(s => {
            const won = g.results.find(r => r.who === s.id);
            return (
              <div key={s.id} style={{ ...chipStyle, paddingInlineStart: 4, gap: 6, whiteSpace: 'nowrap' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: huddleColor(s.color), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 10) }}>{initial(s.name)}</span>
                {s.id === v.you ? tr('huddle.you') : s.name} · {s.pts}{won ? ` (+${won.pts})` : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Floats({ v }: { v: HuddleView }) {
  return (
    <div style={{ position: 'absolute', left: 28, bottom: 90, width: 150, height: 420, pointerEvents: 'none', zIndex: 2 }}>
      {v.floats.map(f => (
        <div key={f.id} style={{ position: 'absolute', left: `${f.x}%`, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, animation: 'rmFloat 3.2s cubic-bezier(.25,.6,.35,1) forwards' }}>
          <span style={emo(34)}>{f.emoji}</span>
          <span style={{ font: font(500, 11), padding: '3px 8px', borderRadius: 99, background: 'rgba(20,20,24,.62)', color: '#fff', whiteSpace: 'nowrap' }}>{f.name}</span>
        </div>
      ))}
    </div>
  );
}

/** A reaction streak: the emoji big in the middle, shards flying out, "4× streak". */
function Burst({ emoji, n }: { emoji: string; n: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 6 }}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'rmBurst 2s cubic-bezier(.2,.9,.3,1) forwards' }}>
        <span style={{ ...emo(88), filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.35))' }}>{emoji}</span>
        <span style={{ font: font(700, 17), padding: '6px 14px', borderRadius: 999, background: ACCENT, color: '#fff', boxShadow: '0 8px 20px rgba(0,0,0,.25)', whiteSpace: 'nowrap' }}>{tr('huddle.streak', { n })}</span>
      </div>
    </div>
  );
}

function Tray({ v, room, ink, bg, deep, editing, onEdit }: { v: HuddleView; room: RoomState; ink: string; bg: string; deep: boolean; editing: boolean; onEdit: () => void }) {
  const counts = room.reactions ?? {};
  const hover = 'color-mix(in srgb,currentColor 14%,transparent)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 5, borderRadius: 999, background: deep ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.6)', backdropFilter: 'blur(14px)', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
      {room.emos.map(e => (
        <button key={e} onClick={() => huddle.react(e)} title={tr('huddle.react')} style={{ position: 'relative', width: 42, height: 42, border: 0, borderRadius: '50%', background: v.mine[e] ? 'color-mix(in srgb,currentColor 16%,transparent)' : 'transparent', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
          <span style={emo(24)}>{e}</span>
          {!!counts[e] && (
            <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: ink, color: bg, font: font(600, 10, 'Geist Mono'), lineHeight: '17px', textAlign: 'center' }}>{counts[e]}</span>
          )}
        </button>
      ))}
      {room.host === v.you && (
        <>
          <span style={{ width: 1, height: 22, background: 'color-mix(in srgb,currentColor 22%,transparent)', margin: '0 3px' }} />
          <button onClick={onEdit} title={tr('huddle.customize')} style={{ width: 42, height: 42, border: 0, borderRadius: '50%', background: editing ? hover : 'transparent', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="13" r="8" /><path d="M7 15c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M7.5 10.5h.01M12.5 10.5h.01M19 2v6M16 5h6" /></svg>
          </button>
        </>
      )}
    </div>
  );
}

/** Emoji by category: the chat's picker and the host's reaction editor. */
function EmojiGrid({ onPick, dim, height }: { onPick: (e: string) => void; dim?: (e: string) => boolean; height: number }) {
  const [cat, setCat] = useState(0);
  return (
    <>
      <div style={{ display: 'flex', gap: 2 }}>
        {EMO_CATS.map(([name, icon], i) => (
          <button key={name} onClick={() => setCat(i)} title={tr(`huddle.cat.${name}` as Key)} style={{ flex: 1, height: 32, border: 0, borderRadius: 8, background: i === cat ? 'var(--fill2)' : 'transparent', opacity: i === cat ? 1 : 0.6, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
            <span style={emo(17)}>{icon}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 6, height, overflowY: 'auto', scrollbarWidth: 'thin', display: 'grid', gridTemplateColumns: 'repeat(8,minmax(0,1fr))', gridAutoRows: 38, gap: 2, alignContent: 'start' }}>
        {EMO_CATS[cat][2].map(e => (
          <button key={e} className="h-fill2" onClick={() => onPick(e)} style={{ border: 0, borderRadius: 10, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, opacity: dim?.(e) ? 0.3 : 1 }}>
            <span style={emo(21)}>{e}</span>
          </button>
        ))}
      </div>
    </>
  );
}

const MAX_EMOS = 8;

function EmoEditor({ room, onDone }: { room: RoomState; onDone: () => void }) {
  const [slot, setSlot] = useState<number | null>(null);
  const emos = room.emos;
  const pickFromLib = (e: string) => {
    if (emos.includes(e)) return;
    if (slot != null) {
      huddle.setEmos(emos.map((x, i) => (i === slot ? e : x)));
      setSlot(null);
    } else if (emos.length < MAX_EMOS) huddle.setEmos([...emos, e]);
    else toast(tr('huddle.maxEmos'));
  };
  return (
    <div style={{ position: 'absolute', left: 12, right: 12, bottom: 'calc(100% - 4px)', zIndex: 5, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ width: 356, maxWidth: '100%', pointerEvents: 'auto', padding: 14, borderRadius: 18, background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 20px 50px rgba(0,0,0,.3)', animation: 'popIn .2s' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ font: font(600, 15) }}>{tr('huddle.reactions')}</div>
          <div style={{ font: font(400, 12), color: 'var(--muted)', textAlign: 'end' }}>{slot != null ? tr('huddle.pick') : emos.length < MAX_EMOS ? tr('huddle.tapToAdd') : tr('huddle.tapToSwap')}</div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {emos.map((e, i) => (
            <div key={e} style={{ position: 'relative' }}>
              <button onClick={() => setSlot(slot === i ? null : i)} style={{ width: 38, height: 38, borderRadius: 12, border: `2px solid ${slot === i ? ACCENT : 'transparent'}`, background: 'var(--fill2)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
                <span style={emo(20)}>{e}</span>
              </button>
              {emos.length > 3 && (
                <button onClick={() => { huddle.setEmos(emos.filter((_, j) => j !== i)); setSlot(null); }} title={tr('huddle.remove')} style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--card)', background: 'var(--ink)', color: 'var(--onInk)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
                  <CloseIcon size={8} stroke={3.4} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          <EmojiGrid onPick={pickFromLib} dim={e => emos.includes(e)} height={180} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { huddle.setEmos(DEFAULT_EMOS); setSlot(null); }} style={{ border: 0, background: 'transparent', font: font(500, 13), color: 'var(--muted)', cursor: 'pointer', padding: '6px 0' }}>{tr('huddle.reset')}</button>
          <button onClick={onDone} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 999, background: ACCENT, color: '#fff', font: font(600, 13), cursor: 'pointer' }}>{tr('huddle.done')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- downloads ----------

/** Library status by track id (a huddle song's key is its library id). */
function useLibraryStatus() {
  const { tracks } = useLibrary();
  return useMemo(() => new Map(tracks.map(t => [t.id, t.status])), [tracks]);
}

function DlButton({ t, status, big }: { t: SharedTrack; status: string | undefined; big?: boolean }) {
  const p = useDownloadProgress(t.key);
  const pct = Math.round((p ?? 0) * 100);
  if (status === 'ready')
    return (
      <span title={tr('huddle.downloaded')} style={{ height: big ? 34 : 26, minWidth: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, font: font(500, 13), opacity: 0.8, flex: 'none' }}>
        <CheckIcon size={14} />
        {big && tr('huddle.downloaded')}
      </span>
    );
  if (status === 'downloading' || p != null)
    return (
      <span title={tr('huddle.downloading', { pct })} style={{ height: big ? 34 : 26, minWidth: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, font: font(500, 13, 'Geist Mono'), color: big ? 'inherit' : ACCENT, flex: 'none' }}>
        <span style={{ width: big ? 18 : 16, height: big ? 18 : 16, borderRadius: '50%', background: `conic-gradient(currentColor ${pct}%,color-mix(in srgb,currentColor 20%,transparent) 0)`, WebkitMask: 'radial-gradient(circle,transparent 5px,#000 6px)', mask: 'radial-gradient(circle,transparent 5px,#000 6px)' }} />
        {big && `${pct}%`}
      </span>
    );
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        saveToLibrary(t);
        toast(tr('huddle.downloadStarted', { title: t.title }));
      }}
      title={tr('huddle.download')}
      className={big ? undefined : 'h-fill2'}
      style={big
        ? { height: 34, padding: '0 12px 0 9px', border: 0, borderRadius: 999, background: 'color-mix(in srgb,currentColor 10%,transparent)', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6, font: font(500, 13), cursor: 'pointer', whiteSpace: 'nowrap' }
        : { width: 26, height: 26, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', padding: 0 }}
    >
      <DownloadIcon size={big ? 16 : 15} />
      {big && tr('huddle.download')}
    </button>
  );
}

// ---------- shared playlist ----------

function Playlist({ v, room, bg }: { v: HuddleView; room: RoomState; bg: string }) {
  const [adding, setAdding] = useState(false);
  const mins = Math.round(room.queue.reduce((a, t) => a + (t.duration ?? 0), 0) / 60);
  return (
    <div style={{ width: 350, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderInlineStart: '1px solid var(--line)', background: bg, transition: 'background .7s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '18px 18px 12px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: font(600, 17), letterSpacing: '-.02em' }}>{tr('huddle.playlist')}</div>
          <div style={{ font: font(400, 12), color: 'var(--muted)' }}>{tr('common.songs', { count: room.queue.length })} · {tr('huddle.minutes', { min: mins })}</div>
        </div>
        {adding ? (
          <button onClick={() => setAdding(false)} style={{ height: 32, padding: '0 14px', border: 0, borderRadius: 999, background: 'var(--fill2)', font: font(500, 13), cursor: 'pointer' }}>{tr('huddle.done')}</button>
        ) : (
          <button onClick={() => setAdding(true)} style={{ height: 32, padding: '0 12px 0 9px', border: 0, borderRadius: 999, background: 'var(--ink)', color: 'var(--onInk)', display: 'flex', alignItems: 'center', gap: 5, font: font(500, 13), cursor: 'pointer' }}>
            <PlusIcon size={14} />
            {tr('huddle.addSongs')}
          </button>
        )}
      </div>
      {adding ? <AddSongs room={room} /> : <Queue v={v} room={room} />}
    </div>
  );
}

function Queue({ v, room }: { v: HuddleView; room: RoomState }) {
  const [drag, setDrag] = useState<{ i: number; dy: number; h: number } | null>(null);
  const moved = useRef(false);
  const lib = useLibraryStatus();
  const g = room.game;
  // While others guess, the list doesn't give away which song is playing.
  const hideCur = !!g && g.phase === 'ask' && g.by !== v.you;
  const start = (e: RPointerEvent, i: number) => {
    if (e.button) return;
    e.preventDefault();
    e.stopPropagation();
    const row = (e.currentTarget as HTMLElement).closest('[data-row]') as HTMLElement | null;
    const h = row?.offsetHeight ?? 56;
    const sy = e.clientY;
    let dy = 0;
    const mv = (ev: PointerEvent) => {
      dy = ev.clientY - sy;
      if (Math.abs(dy) > 4) moved.current = true;
      setDrag({ i, dy, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const to = Math.max(0, Math.min(room.queue.length - 1, i + Math.round(dy / h)));
      if (to !== i) huddle.move(i, to);
      setTimeout(() => (moved.current = false), 60);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const target = drag ? Math.max(0, Math.min(room.queue.length - 1, drag.i + Math.round(drag.dy / drag.h))) : -1;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px' }}>
      {room.queue.map((t, i) => {
        const isCur = i === room.index && !hideCur;
        const c = v.cache[t.key];
        const dy = !drag ? 0 : i === drag.i ? drag.dy : drag.i < i && i <= target ? -drag.h : target <= i && i < drag.i ? drag.h : 0;
        // Everyone manages the songs they added; the host manages them all.
        const mine = t.by === v.you || room.host === v.you;
        const canRemove = mine && i !== room.index;
        return (
          <div
            key={t.key}
            data-row
            className="h-fill"
            onClick={() => !moved.current && !g && huddle.remote.skipTo(i)}
            title={tr('huddle.playForAll')}
            style={{ position: 'relative', zIndex: drag?.i === i ? 3 : 0, transform: `translateY(${dy}px)`, transition: drag?.i === i ? 'none' : 'transform .15s', boxShadow: drag?.i === i ? '0 10px 24px rgba(0,0,0,.16)' : 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 10, background: drag?.i === i ? 'var(--card)' : isCur ? 'var(--accentSoft)' : 'transparent', opacity: i < room.index && !hideCur ? 0.5 : 1, cursor: 'pointer', animation: 'popIn .25s' }}
          >
            <Cover src={t.artwork} size={42} bg={paletteFor(t, t.artwork).artBg}>
              {typeof c === 'number' && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(0,0,0,.3)' }}>
                  <div style={{ height: '100%', width: `${c * 100}%`, background: ACCENT }} />
                </div>
              )}
            </Cover>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: font(500, 14), color: isCur ? ACCENT : 'var(--ink)' }}>{t.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, font: font(400, 12), color: 'var(--muted)' }}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: huddleColor(t.byColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 8), flex: 'none' }}>{initial(t.byName)}</span>
                <span className="ellipsis">{t.byName} · {sourceText(t)}</span>
              </div>
              {t.shout && <div className="ellipsis" style={{ marginTop: 1, font: "italic 400 12px 'Geist',sans-serif", color: 'var(--ink2)' }}>“{t.shout}”</div>}
            </div>
            <span style={{ font: font(500, 12, 'Geist Mono'), color: 'var(--muted)', flex: 'none' }}>{formatTime(t.duration)}</span>
            <DlButton t={t} status={lib.get(t.key)} />
            {canRemove && (
              <button className="h-fill2" onClick={e => { e.stopPropagation(); huddle.remove(t.key); }} title={tr('huddle.remove')} style={{ width: 26, height: 26, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
                <CloseIcon size={11} stroke={3} />
              </button>
            )}
            {mine ? (
              <span onPointerDown={e => start(e, i)} onClick={e => e.stopPropagation()} title={tr('huddle.drag')} style={{ width: 24, height: 32, display: 'grid', placeItems: 'center', cursor: 'grab', color: 'var(--muted)', flex: 'none', touchAction: 'none' }}>
                <GripIcon size={16} />
              </span>
            ) : (
              <span style={{ width: 24, flex: 'none' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Free sources searched as you type (debounced). */
function useOnlineSearch(q: string) {
  const [found, setFound] = useState<OnlineResult[]>([]);
  useEffect(() => {
    if (!q.trim()) return setFound([]);
    let live = true;
    const id = setTimeout(() => searchOnline(q, (_, r) => live && setFound(r)).catch(() => {}), 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);
  return found;
}

const searchBox: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 10, background: 'var(--fill2)' };
const bareInput: CSSProperties = { flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: font(400, 14), color: 'var(--ink)' };

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--fill2)' }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{ flex: 1, height: 30, border: 0, borderRadius: 8, background: value === k ? 'var(--card)' : 'transparent', font: font(value === k ? 600 : 500, 13), cursor: 'pointer', boxShadow: value === k ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>{label}</button>
      ))}
    </div>
  );
}

function AddSongs({ room }: { room: RoomState }) {
  const { tracks } = useLibrary();
  const [tab, setTab] = useState<'device' | 'search'>('device');
  const [q, setQ] = useState('');
  const [shout, setShout] = useState('');
  const found = useOnlineSearch(tab === 'search' ? q : '');
  const inQueue = useMemo(() => new Set(room.queue.map(t => t.key)), [room.queue]);

  const ql = q.trim().toLowerCase();
  // The shoutout goes with the next song added, then clears.
  const withShout = (add: (shout: string) => void) => () => {
    add(shout.trim());
    setShout('');
  };
  const rows =
    tab === 'device'
      ? tracks
          .filter(t => t.status === 'ready' && t.source !== 'device' && (!ql || `${t.title} ${t.artist ?? ''} ${t.genre ?? ''}`.toLowerCase().includes(ql)))
          .slice(0, 60)
          .map(t => ({ id: t.id, title: t.title, artist: t.artist, art: artworkUri(t), tag: tr('huddle.onDevice'), added: inQueue.has(t.id), add: withShout(s => addLibrary(t, s)) }))
      : found.map(r => ({ id: `${r.source}:${r.sourceId}`, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, added: inQueue.has(`${r.source}:${r.sourceId}`), add: withShout(s => addResult(r, s)) }));

  return (
    <>
      <div style={{ padding: '0 18px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Tabs value={tab} onChange={setTab} options={[['device', tr('huddle.onDevice')], ['search', tr('huddle.search')]]} />
        <div style={searchBox}>
          <SearchIcon size={15} color="var(--muted)" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'device' ? tr('huddle.filterLib') : tr('huddle.searchSources')} style={bareInput} />
        </div>
        <div style={{ ...searchBox, background: 'transparent', border: '1.5px dashed var(--line2)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></svg>
          <input value={shout} maxLength={80} onChange={e => setShout(e.target.value)} placeholder={tr('huddle.shoutPh')} style={{ ...bareInput, font: font(400, 13) }} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 12px' }}>
        {rows.map(r => (
          <div key={r.id} className="h-fill" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 10 }}>
            <Cover src={r.art} size={40} bg="var(--fill3)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: font(500, 14) }}>{r.title}</div>
              <div className="ellipsis" style={{ font: font(400, 12), color: 'var(--muted)' }}>{r.artist} · {r.tag}</div>
            </div>
            {r.added ? (
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: ACCENT, color: '#fff', display: 'grid', placeItems: 'center', flex: 'none' }}><CheckIcon size={14} /></span>
            ) : (
              <button onClick={r.add} title={tr('huddle.addSongs')} style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid var(--line2)', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', padding: 0 }}>
                <PlusIcon size={14} />
              </button>
            )}
          </div>
        ))}
        {!rows.length && <div style={{ padding: '24px 8px', textAlign: 'center', font: font(400, 14), color: 'var(--muted)' }}>{tr('huddle.noMatches')}</div>}
      </div>
    </>
  );
}

function addResult(r: OnlineResult, shout = '') {
  huddle.addOnline({ source: r.source, sourceId: r.sourceId, title: r.title, artist: r.artist, album: r.album, duration: r.duration, artwork: r.thumbnailUrl, shout: shout || null });
}

/** Library songs are shared by their link; everyone downloads them from the same source. */
function addLibrary(t: Track, shout = '') {
  if (t.source === 'device') return;
  huddle.addOnline({ source: t.source, sourceId: t.sourceId, title: t.title, artist: t.artist, album: t.album, duration: t.duration, artwork: t.remoteArtworkUrl, genre: t.genre, shout: shout || null });
}

// ---------- Guess the song ----------

/** Starts a round: wrong answers come from the shared playlist and your library. */
function startRound(right: { key: string; title: string; artist: string | null; genre?: string | null }, library: Track[], add?: () => void) {
  const room = huddle.getView().room;
  if (!room) return false;
  const decoys = pickDecoys(right, [...room.queue, ...library]);
  if (!decoys.length) {
    toast(tr('huddle.needDecoys'));
    return false;
  }
  add?.();
  huddle.startGame(right.key, decoys);
  return true;
}

/** A dialog over the whole huddle. */
function Overlay({ onClose, children, dark }: { onClose: () => void; children: ReactNode; dark?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 30, background: `rgba(10,10,12,${dark ? 0.5 : 0.45})`, display: 'grid', placeItems: 'center', animation: 'fadeIn .15s' }}>
      <div onClick={e => e.stopPropagation()} style={{ animation: 'hdUp .22s', maxHeight: '88%', display: 'flex' }}>{children}</div>
    </div>
  );
}

const closeBtn = (onClose: () => void) => (
  <button onClick={onClose} title={tr('huddle.close')} style={{ width: 32, height: 32, border: 0, borderRadius: '50%', background: 'var(--fill2)', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
    <CloseIcon size={12} stroke={3} />
  </button>
);

function GamePicker({ room, onClose }: { room: RoomState; onClose: () => void }) {
  const { tracks } = useLibrary();
  const [tab, setTab] = useState<'list' | 'search'>('list');
  const [q, setQ] = useState('');
  const found = useOnlineSearch(tab === 'search' ? q : '');
  const ql = q.trim().toLowerCase();
  const match = (x: { title: string; artist: string | null }) => !ql || `${x.title} ${x.artist ?? ''}`.toLowerCase().includes(ql);
  const cur = room.queue[room.index]?.key;
  const inQueue = new Set(room.queue.map(x => x.key));
  const lib = tracks.filter(x => x.status === 'ready' && x.source !== 'device');
  const go = (ok: boolean) => ok && onClose();
  const rows: { id: string; title: string; artist: string | null; art: string | null; tag: string; pick: () => void }[] =
    tab === 'list'
      ? room.queue.filter(x => x.key !== cur && match(x)).map(x => ({ id: x.key, title: x.title, artist: x.artist, art: x.artwork, tag: tr('huddle.inPlaylist'), pick: () => go(startRound(x, lib)) }))
      : [
          ...lib.filter(x => x.id !== cur && match(x)).slice(0, 12).map(x => ({ id: x.id, title: x.title, artist: x.artist, art: artworkUri(x), tag: tr('huddle.onDevice'), pick: () => go(startRound({ ...x, key: x.id }, lib, inQueue.has(x.id) ? undefined : () => addLibrary(x))) })),
          ...found.map(r => {
            const key = `${r.source}:${r.sourceId}`;
            return { id: key, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, pick: () => go(startRound({ ...r, key }, lib, inQueue.has(key) ? undefined : () => addResult(r))) };
          }),
        ];
  return (
    <Overlay onClose={onClose}>
      <div data-screen-label="Pick mystery song" style={{ width: 460, height: 580, maxHeight: '100%', borderRadius: 20, padding: 20, boxShadow: '0 30px 80px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', background: 'var(--card)', color: 'var(--ink)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: font(600, 18), letterSpacing: '-.02em' }}>{tr('huddle.pickTitle')}</div>
            <div style={{ marginTop: 3, font: "400 13px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('huddle.pickSub')}</div>
          </div>
          {closeBtn(onClose)}
        </div>
        <div style={{ marginTop: 14 }}><Tabs value={tab} onChange={setTab} options={[['list', tr('huddle.playlist')], ['search', tr('huddle.search')]]} /></div>
        <div style={{ ...searchBox, marginTop: 8, height: 38, flex: 'none' }}>
          <SearchIcon size={15} color="var(--muted)" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'list' ? tr('huddle.filterLib') : tr('huddle.searchSources')} style={bareInput} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'thin', margin: '8px -8px 0' }}>
          {rows.map(r => (
            <div key={r.id} className="h-fill" onClick={r.pick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 8px', borderRadius: 12, cursor: 'pointer' }}>
              <Cover src={r.art} size={44} bg="var(--fill3)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ellipsis" style={{ font: font(500, 14) }}>{r.title}</div>
                <div className="ellipsis" style={{ font: font(400, 12), color: 'var(--muted)' }}>{r.artist} · {r.tag}</div>
              </div>
              <span style={{ height: 30, padding: '0 12px', borderRadius: 999, background: ACCENT, color: '#fff', display: 'flex', alignItems: 'center', font: font(600, 12), flex: 'none' }}>{tr('huddle.pickBtn')}</span>
            </div>
          ))}
          {!rows.length && <div style={{ padding: '28px 8px', textAlign: 'center', font: font(400, 14), color: 'var(--muted)' }}>{tr('huddle.noMatches')}</div>}
        </div>
      </div>
    </Overlay>
  );
}

// ---------- members and recap ----------

function Members({ v, room, onClose }: { v: HuddleView; room: RoomState; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div style={{ width: 420, overflowY: 'auto', padding: 20, borderRadius: 20, background: 'var(--card)', color: 'var(--ink)', boxShadow: '0 30px 80px rgba(0,0,0,.35)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ font: font(600, 18), letterSpacing: '-.02em' }}>{tr('huddle.members')}</div>
            <div style={{ marginTop: 2, font: font(400, 13), color: 'var(--muted)' }}>{tr('huddle.inHuddle', { count: room.members.length })}</div>
          </div>
          {closeBtn(onClose)}
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {room.members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
              <span style={{ width: 40, height: 40, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 15), flex: 'none' }}>{initial(m.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: font(600, 15) }}>
                  {m.id === v.you ? tr('huddle.you') : m.name}
                  {room.host === m.id && <span style={{ padding: '2px 6px', borderRadius: 5, background: 'var(--accentSoft)', color: 'var(--accentInk)', font: font(600, 10, 'Geist Mono'), letterSpacing: '.06em', textTransform: 'uppercase' }}>{tr('huddle.host')}</span>}
                </div>
                <div style={{ marginTop: 2, font: "400 12px/1.4 'Geist',sans-serif", color: 'var(--muted)' }}>{memberSub(room, v.you, m, v.voice)}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, font: "400 12px/1.45 'Geist',sans-serif", color: 'var(--muted)' }}>{tr('huddle.tasteHint')}</div>
        <div style={{ marginTop: 14, padding: '12px 12px 12px 14px', borderRadius: 14, background: 'var(--fill)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: "400 13px/1.4 'Geist',sans-serif", color: 'var(--ink2)' }}>
            {tr('huddle.invite')} <span style={{ font: font(600, 13, 'Geist Mono'), letterSpacing: '.12em', color: 'var(--ink)' }}>{room.code}</span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(room.code).catch(() => {});
              toast(tr('huddle.copied', { code: room.code }));
            }}
            style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 999, background: 'var(--ink)', color: 'var(--onInk)', font: font(500, 13), cursor: 'pointer', flex: 'none' }}
          >
            {tr('huddle.copyShort')}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function RecapCard({ room, deep, glow, onClose }: { room: RoomState; deep: string; glow: string; onClose: () => void }) {
  const r = recapOf(room);
  const tile: CSSProperties = { padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.08)' };
  const lead: CSSProperties = { width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,.1)', display: 'grid', placeItems: 'center', flex: 'none' };
  const row = (icon: ReactNode, label: string, value: string, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, background: 'rgba(255,255,255,.08)' }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: font(600, 10, 'Geist Mono'), letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.7 }}>{label}</div>
        <div className="ellipsis" style={{ marginTop: 2, font: font(600, 15) }}>{value}</div>
      </div>
      {sub && <span style={{ font: font(400, 12), opacity: 0.75, flex: 'none', textAlign: 'end' }}>{sub}</span>}
    </div>
  );
  return (
    <Overlay onClose={onClose} dark>
      <div style={{ width: 390, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div data-screen-label="Huddle recap" style={{ position: 'relative', overflow: 'hidden', padding: 20, borderRadius: 24, background: deep, color: '#F4F3F0', boxShadow: '0 30px 80px rgba(0,0,0,.4)' }}>
          <div style={{ position: 'absolute', right: -70, top: -70, width: 240, height: 240, borderRadius: '50%', background: glow, filter: 'blur(70px)', opacity: 0.5, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 76, height: 76, borderRadius: 12, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 'none', boxShadow: '0 10px 24px rgba(0,0,0,.3)', background: 'rgba(255,255,255,.1)' }}>
              {r.covers.map((c, i) => (c ? <img key={i} src={c} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span key={i} />))}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: font(600, 11, 'Geist Mono'), letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.75 }}>{tr('huddle.recapTitle')}</div>
              <div style={{ marginTop: 4, font: "700 22px/1.1 'Geist',sans-serif", letterSpacing: '-.03em' }}>{room.name}</div>
              <div style={{ marginTop: 4, font: font(400, 13), opacity: 0.75 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            </div>
          </div>
          <div style={{ position: 'relative', marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
            {[[r.mins, tr('huddle.together')], [r.songs, tr('huddle.songsPlayed')], [r.msgs, tr('huddle.messages')]].map(([a, b]) => (
              <div key={b} style={tile}>
                <div style={{ font: "700 20px/1.1 'Geist',sans-serif", whiteSpace: 'nowrap' }}>{a}</div>
                <div style={{ marginTop: 3, font: font(500, 11), opacity: 0.72 }}>{b}</div>
              </div>
            ))}
          </div>
          <div style={{ position: 'relative', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {row(r.top?.artwork ? <img src={r.top.artwork} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: 'none' }} /> : <span style={lead}>🎶</span>, tr('huddle.mostLoved'), r.top?.title ?? tr('huddle.noneYet'), r.topSub)}
            {row(<span style={{ ...lead, ...emo(24) }}>{r.topEmoji}</span>, tr('huddle.topReaction', { n: r.streak }), r.topEmojiSub, '')}
            {row(<span style={{ ...lead, borderRadius: '50%', background: r.mvp ? huddleColor(r.mvp.color) : 'rgba(255,255,255,.2)', font: font(600, 15) }}>{r.mvp ? initial(r.mvp.name) : '?'}</span>, tr('huddle.mvp'), r.mvp?.name ?? '—', r.mvpSub)}
            {row(<span style={lead}><QuestionIcon size={20} /></span>, tr('huddle.champ'), r.champ?.name ?? tr('huddle.noneYet'), r.champSub)}
          </div>
          <div style={{ position: 'relative', marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', paddingInlineStart: 6 }}>
              {room.members.map(m => (
                <span key={m.id} style={{ width: 24, height: 24, marginInlineStart: -6, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', border: `2px solid ${deep}`, display: 'grid', placeItems: 'center', font: font(600, 10) }}>{initial(m.name)}</span>
              ))}
            </div>
            <span style={{ font: font(400, 12), opacity: 0.8 }}>{tr('huddle.listening', { count: room.members.length })}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(r.share).catch(() => {});
              toast(tr('huddle.copied', { code: tr('huddle.recapTitle') }));
            }}
            style={{ flex: 1, height: 46, border: 0, borderRadius: 999, background: ACCENT, color: '#fff', font: font(600, 15), cursor: 'pointer' }}
          >
            {tr('huddle.shareRecap')}
          </button>
          <button onClick={onClose} style={{ height: 46, padding: '0 20px', border: 0, borderRadius: 999, background: 'var(--card)', color: 'var(--ink)', font: font(500, 15), cursor: 'pointer' }}>{tr('huddle.close')}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- chat ----------

function Chat({ v, room, bg }: { v: HuddleView; room: RoomState; bg: string }) {
  const [msg, setMsg] = useState('');
  const [act, setAct] = useState<number | null>(null);
  const [editing, setEditing] = useState<HuddleChat | null>(null);
  const [picker, setPicker] = useState(false);
  useTicker(30_000);
  const send = () => {
    if (!msg.trim()) return;
    if (editing) huddle.chatEdit(editing.id, msg);
    else huddle.chat(msg);
    setMsg('');
    setEditing(null);
    setPicker(false);
  };
  const cancelEdit = () => {
    setEditing(null);
    setMsg('');
  };
  const nameOf = (id: string) => (id === v.you ? tr('huddle.you') : room.members.find(m => m.id === id)?.name ?? '?');
  const extras = (m: HuddleChat, mine: boolean) => (
    <>
      {m.edited && <span style={{ marginTop: 2, font: font(400, 11), color: 'var(--muted)' }}>{tr('huddle.edited')}</span>}
      {Object.keys(m.rx).length > 0 && (
        <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
          {Object.entries(m.rx).map(([e, who]) => {
            const me = !!v.you && who.includes(v.you);
            return (
              <button key={e} onClick={() => huddle.chatReact(m.id, e)} title={who.map(nameOf).join(', ')} style={{ height: 24, padding: '0 7px', borderRadius: 999, border: `1px solid ${me ? ACCENT : 'transparent'}`, background: me ? 'var(--accentSoft)' : 'var(--fill2)', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 4, font: font(600, 11, 'Geist Mono'), cursor: 'pointer' }}>
                <span style={emo(13)}>{e}</span>
                {who.length}
              </button>
            );
          })}
        </div>
      )}
      {act === m.id && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 1, padding: 3, borderRadius: 999, background: 'var(--card)', boxShadow: '0 6px 18px rgba(0,0,0,.14),0 0 0 1px var(--line)', animation: 'hdUp .15s', width: 'max-content', maxWidth: '100%' }}>
          {QUICK_EMOS.map(e => (
            <button key={e} className="h-fill2" onClick={() => { huddle.chatReact(m.id, e); setAct(null); }} style={{ width: 30, height: 30, border: 0, borderRadius: '50%', background: v.you && m.rx[e]?.includes(v.you) ? 'var(--accentSoft)' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
              <span style={emo(17)}>{e}</span>
            </button>
          ))}
          {mine && (
            <>
              <span style={{ width: 1, height: 18, background: 'var(--line2)', margin: '0 3px', flex: 'none' }} />
              <button className="h-fill2" onClick={() => { setEditing(m); setMsg(m.text); setAct(null); }} style={{ height: 30, padding: '0 10px 0 8px', border: 0, borderRadius: 999, background: 'transparent', color: 'var(--ink)', font: font(500, 12), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
                <PencilIcon size={13} />
                {tr('huddle.edit')}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
  return (
    <div style={{ width: 320, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderInlineStart: '1px solid var(--line)', background: bg, transition: 'background .7s' }}>
      <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ font: font(600, 17), letterSpacing: '-.02em' }}>{tr('huddle.chat')}</div>
        <div style={{ font: font(400, 12), color: 'var(--muted)' }}>{tr('huddle.listening', { count: room.members.length })}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', padding: '12px 14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {room.chat.map(m =>
            m.kind !== 'msg' ? (
              <div key={m.id} style={{ alignSelf: 'center', maxWidth: '90%', textAlign: 'center', font: "400 12px/1.4 'Geist',sans-serif", color: 'var(--muted)' }}>{chatText(m)}</div>
            ) : m.who === v.you ? (
              <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', animation: 'hdUp .25s' }}>
                <div onClick={() => setAct(act === m.id ? null : m.id)} title={tr('huddle.edit')} style={{ maxWidth: 240, padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: ACCENT, color: '#fff', font: "400 14px/1.4 'Geist',sans-serif", overflowWrap: 'anywhere', userSelect: 'text', cursor: 'pointer' }}>{m.text}</div>
                {extras(m, true)}
              </div>
            ) : (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', animation: 'hdUp .25s' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 11), flex: 'none' }}>{initial(m.name)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ font: font(600, 13), color: huddleColor(m.color) }}>{m.name}</span>
                    <span style={{ font: font(400, 11, 'Geist Mono'), color: 'var(--muted)' }}>{ago(m.at)}</span>
                  </div>
                  <div onClick={() => setAct(act === m.id ? null : m.id)} title={tr('huddle.react')} style={{ marginTop: 3, width: 'max-content', maxWidth: '100%', padding: '8px 12px', borderRadius: '4px 14px 14px 14px', background: 'color-mix(in srgb,var(--ink) 7%,var(--card))', font: "400 14px/1.4 'Geist',sans-serif", overflowWrap: 'anywhere', userSelect: 'text', cursor: 'pointer', boxSizing: 'border-box' }}>{m.text}</div>
                  {extras(m, false)}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
      <div style={{ position: 'relative', flex: 'none', borderTop: '1px solid var(--line)' }}>
        {picker && (
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 'calc(100% + 6px)', zIndex: 8, padding: 8, borderRadius: 16, background: 'var(--card)', boxShadow: '0 18px 44px rgba(0,0,0,.24),0 0 0 1px var(--line)', animation: 'hdUp .16s' }}>
            <EmojiGrid onPick={e => setMsg(x => x + e)} height={200} />
          </div>
        )}
        {editing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 0', font: font(500, 12), color: 'var(--muted)' }}>
            <span style={{ color: ACCENT, display: 'grid', flex: 'none' }}><PencilIcon size={13} /></span>
            <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{tr('huddle.editing', { text: editing.text })}</span>
            <button onClick={cancelEdit} style={{ border: 0, background: 'transparent', color: 'var(--ink)', font: font(600, 12), cursor: 'pointer', padding: '4px 0' }}>{tr('huddle.cancel')}</button>
          </div>
        )}
        <div style={{ padding: '12px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0, height: 40, display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px 0 14px', borderRadius: 999, background: 'var(--fill2)' }}>
            <input value={msg} maxLength={500} onChange={e => setMsg(e.target.value)} onKeyDown={e => (e.key === 'Enter' ? send() : e.key === 'Escape' && editing && cancelEdit())} placeholder={editing ? tr('huddle.editPh') : tr('huddle.say')} style={{ ...bareInput, height: '100%' }} />
            <button onClick={() => setPicker(p => !p)} title={tr('huddle.emoji')} style={{ width: 32, height: 32, border: 0, borderRadius: '50%', background: picker ? 'var(--fill3)' : 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7M9 9.5h.01M15 9.5h.01" /></svg>
            </button>
          </div>
          <button onClick={send} title={editing ? tr('huddle.saveEdit') : tr('huddle.send')} style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: msg.trim() ? ACCENT : 'var(--fill2)', color: msg.trim() ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', padding: 0 }}>
            {editing ? <CheckIcon size={18} /> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>}
          </button>
        </div>
      </div>
    </div>
  );
}
