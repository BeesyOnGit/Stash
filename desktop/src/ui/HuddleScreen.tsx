/** Huddle: the lobby (start or join) and the room (stage, shared playlist, chat), over the window below the title bar. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { DEFAULT_EMOS, EMO_LIB, huddle, huddleColor, useHuddle, type HuddleView, type RoomState, type SharedTrack } from '../core/huddle';
import { ago, chatText, errorText, lastText, sourceText, statusText } from '../core/huddle/labels';
import { tr, useLanguage } from '../core/i18n';
import { useLibrary } from '../core/player/hooks';
import { saveSettings, useSettings } from '../core/services/settings';
import { searchOnline } from '../core/sources';
import { toast } from '../core/state/ui';
import { formatTime, paletteFor } from '../core/theme';
import { artworkUri, type OnlineResult, type Track } from '../core/types';
import { setApp } from './appState';
import { CheckIcon, ChevronLeftIcon, CloseIcon, GripIcon, NextIcon, PauseIcon, PlayIcon, PlusIcon, PrevIcon, SearchIcon } from './icons';
import { ACCENT, Cover } from './kit';

const font = (w: number, s: number, fam = 'Geist') => `${w} ${s}px '${fam}',${fam === 'Geist' ? 'sans-serif' : 'monospace'}`;
const close = () => setApp({ huddle: false });

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
  const name = () => settings.huddleName.trim() || 'Guest';
  const create = () => !busy && huddle.create(name(), roomName.trim());
  const join = () => !busy && code.length === 6 && huddle.join(name(), code);
  const input: CSSProperties = { height: 44, padding: '0 14px', borderRadius: 12, border: '1px solid var(--line2)', outline: 0, background: 'var(--bg)', font: font(400, 15), color: 'var(--ink)' };
  const card: CSSProperties = { padding: 24, borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 };
  const iconBox: CSSProperties = { width: 44, height: 44, borderRadius: 12, background: 'var(--accentSoft)', color: ACCENT, display: 'grid', placeItems: 'center' };
  const bigBtn = (on: boolean): CSSProperties => ({ height: 44, border: 0, borderRadius: 12, background: on ? ACCENT : 'var(--fill2)', color: on ? '#fff' : 'var(--muted)', font: font(600, 15), cursor: on ? 'pointer' : 'default', transition: 'background .2s' });

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

        <label style={{ marginTop: 24, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 6, font: font(500, 13), color: 'var(--muted)' }}>
          {tr('huddle.yourName')}
          <input value={settings.huddleName} maxLength={24} onChange={e => saveSettings({ huddleName: e.target.value })} placeholder="Guest" style={input} />
        </label>

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

/** Re-renders a few times a second so the seek bar moves. */
function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

const artOf = (t: SharedTrack) => t.artwork;

function Room({ v, room }: { v: HuddleView; room: RoomState }) {
  const settings = useSettings();
  const deep = settings.playerStyle === 'deep';
  const cur = room.queue[room.index] ?? null;
  const pal = paletteFor(cur ?? { title: room.name, artist: null }, cur ? artOf(cur) : null);
  const bg = deep ? pal.deep : pal.soft;
  const ink = deep ? '#F4F3F0' : pal.softInk;
  const [editEmos, setEditEmos] = useState(false);

  return (
    <>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden', background: bg, color: ink, ['--sb' as any]: ink, display: 'flex', flexDirection: 'column', transition: 'background .7s' }}>
        {cur?.artwork && <img src={cur.artwork} alt="" style={{ position: 'absolute', left: '-30%', top: '-20%', width: '160%', height: '80%', objectFit: 'cover', filter: 'blur(80px) saturate(1.5)', opacity: deep ? 0.55 : 0.35, pointerEvents: 'none' }} />}
        <RoomHeader v={v} room={room} bg={bg} />
        <Stage v={v} room={room} cur={cur} ink={ink} bg={bg} artBg={pal.artBg} />
        <Floats v={v} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', padding: '14px 20px 22px' }}>
          <Tray v={v} room={room} ink={ink} bg={bg} deep={deep} editing={editEmos} onEdit={() => setEditEmos(e => !e)} />
          {editEmos && room.host === v.you && <EmoEditor room={room} onDone={() => setEditEmos(false)} />}
        </div>
      </div>
      <Playlist v={v} room={room} />
      <Chat v={v} room={room} />
    </>
  );
}

const fab: CSSProperties = { border: 0, background: 'color-mix(in srgb,currentColor 10%,transparent)', color: 'inherit', cursor: 'pointer', flex: 'none' };

function RoomHeader({ v, room, bg }: { v: HuddleView; room: RoomState; bg: string }) {
  const host = room.members.find(m => m.id === room.host);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px' }}>
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
        onClick={() => {
          navigator.clipboard?.writeText(room.code).catch(() => {});
          toast(tr('huddle.copied', { code: room.code }));
        }}
        title={tr('huddle.copy')}
        style={{ height: 30, padding: '0 10px', border: '1.5px dashed color-mix(in srgb,currentColor 40%,transparent)', borderRadius: 8, background: 'transparent', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8, font: font(600, 13, 'Geist Mono'), letterSpacing: '.14em', cursor: 'pointer', flex: 'none' }}
      >
        {room.code}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h8" /></svg>
      </button>
      <Avatars room={room} bg={bg} size={30} />
      <button
        onClick={() => {
          huddle.leave();
          close();
          toast(tr('huddle.left', { name: room.name }));
        }}
        style={{ ...fab, height: 32, padding: '0 14px', borderRadius: 999, font: font(500, 13) }}
      >
        {tr('huddle.leave')}
      </button>
    </div>
  );
}

export function Avatars({ room, bg, size }: { room: RoomState; bg: string; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingInlineStart: 7, flex: 'none' }}>
      {room.members.slice(0, 6).map(m => (
        <span key={m.id} title={m.name} style={{ width: size, height: size, marginInlineStart: -7, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', border: `2px solid ${bg}`, display: 'grid', placeItems: 'center', font: font(600, size * 0.4), animation: 'popIn .3s' }}>
          {m.name[0]?.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function Stage({ v, room, cur, ink, bg, artBg }: { v: HuddleView; room: RoomState; cur: SharedTrack | null; ink: string; bg: string; artBg: string }) {
  useTicker(500);
  const pos = huddle.position();
  const dur = cur?.duration ?? 0;
  const on = room.playing || room.pending;
  const pill = statusText(v) ?? (room.last ? lastText(room.last) : tr('huddle.shared'));
  const pillColor = room.last && !statusText(v) ? huddleColor(room.last.color) : 'currentColor';
  const ctl: CSSProperties = { width: 44, height: 44, border: 0, background: 'transparent', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer' };
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px' }}>
      <Cover src={cur ? artOf(cur) : null} size={280} radius={16} bg={artBg} style={{ boxShadow: '0 24px 60px rgba(0,0,0,.35)' }} />
      <div style={{ marginTop: 22, maxWidth: '100%', textAlign: 'center' }}>
        <div className="ellipsis" style={{ font: "700 28px/1.15 'Geist',sans-serif", letterSpacing: '-.03em' }}>{cur?.title ?? tr('huddle.empty')}</div>
        {cur && <div style={{ marginTop: 4, font: font(400, 16), opacity: 0.8 }}>{cur.artist}</div>}
      </div>
      {cur && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 7, font: font(500, 12), opacity: 0.9 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: huddleColor(cur.byColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 10) }}>{cur.byName[0]?.toUpperCase()}</span>
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
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 22 }}>
        <button onClick={huddle.remote.previous} style={ctl}><PrevIcon size={26} /></button>
        <button onClick={on ? huddle.remote.pause : huddle.remote.play} title={tr('huddle.playForAll')} style={{ width: 60, height: 60, borderRadius: '50%', border: 0, background: ink, color: bg, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          {on ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>
        <button onClick={huddle.remote.next} style={ctl}><NextIcon size={26} /></button>
      </div>
      <div style={{ marginTop: 14, minHeight: 28, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: 999, background: 'color-mix(in srgb,currentColor 9%,transparent)', font: font(500, 12) }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: pillColor, flex: 'none' }} />
        <span className="ellipsis">{pill}</span>
      </div>
    </div>
  );
}

function Floats({ v }: { v: HuddleView }) {
  return (
    <div style={{ position: 'absolute', left: 28, bottom: 90, width: 150, height: 420, pointerEvents: 'none', zIndex: 2 }}>
      {v.floats.map(f => (
        <div key={f.id} style={{ position: 'absolute', left: `${f.x}%`, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, animation: 'rmFloat 3.2s cubic-bezier(.25,.6,.35,1) forwards' }}>
          <span style={{ font: "34px/1 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif" }}>{f.emoji}</span>
          <span style={{ font: font(500, 11), padding: '3px 8px', borderRadius: 99, background: 'rgba(20,20,24,.62)', color: '#fff', whiteSpace: 'nowrap' }}>{f.name}</span>
        </div>
      ))}
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
          <span style={{ font: "24px/1 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif" }}>{e}</span>
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
                <span style={{ font: "20px/1 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif" }}>{e}</span>
              </button>
              {emos.length > 3 && (
                <button onClick={() => { huddle.setEmos(emos.filter((_, j) => j !== i)); setSlot(null); }} title={tr('huddle.remove')} style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--card)', background: 'var(--ink)', color: 'var(--onInk)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
                  <CloseIcon size={8} stroke={3.4} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(8,minmax(0,1fr))', gap: 2 }}>
          {EMO_LIB.map(e => (
            <button key={e} className="h-fill2" onClick={() => pickFromLib(e)} style={{ height: 38, border: 0, borderRadius: 10, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, opacity: emos.includes(e) ? 0.3 : 1 }}>
              <span style={{ font: "20px/1 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif" }}>{e}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { huddle.setEmos(DEFAULT_EMOS); setSlot(null); }} style={{ border: 0, background: 'transparent', font: font(500, 13), color: 'var(--muted)', cursor: 'pointer', padding: '6px 0' }}>{tr('huddle.reset')}</button>
          <button onClick={onDone} style={{ height: 34, padding: '0 16px', border: 0, borderRadius: 999, background: ACCENT, color: '#fff', font: font(600, 13), cursor: 'pointer' }}>{tr('huddle.done')}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- shared playlist ----------


function Playlist({ v, room }: { v: HuddleView; room: RoomState }) {
  const [adding, setAdding] = useState(false);
  const mins = Math.round(room.queue.reduce((a, t) => a + (t.duration ?? 0), 0) / 60);
  return (
    <div style={{ width: 350, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderInlineStart: '1px solid var(--line)', background: 'var(--bg)' }}>
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
        const isCur = i === room.index;
        const c = v.cache[t.key];
        const dy = !drag ? 0 : i === drag.i ? drag.dy : drag.i < i && i <= target ? -drag.h : target <= i && i < drag.i ? drag.h : 0;
        const canRemove = !isCur && (t.by === v.you || room.host === v.you);
        return (
          <div
            key={t.key}
            data-row
            className="h-fill"
            onClick={() => !moved.current && huddle.remote.skipTo(i)}
            title={tr('huddle.playForAll')}
            style={{ position: 'relative', zIndex: drag?.i === i ? 3 : 0, transform: `translateY(${dy}px)`, transition: drag?.i === i ? 'none' : 'transform .15s', boxShadow: drag?.i === i ? '0 10px 24px rgba(0,0,0,.16)' : 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 10, background: drag?.i === i ? 'var(--card)' : isCur ? 'var(--accentSoft)' : 'transparent', opacity: i < room.index ? 0.5 : 1, cursor: 'pointer' }}
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
                <span style={{ width: 14, height: 14, borderRadius: '50%', background: huddleColor(t.byColor), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 8), flex: 'none' }}>{t.byName[0]?.toUpperCase()}</span>
                <span className="ellipsis">{t.byName} · {sourceText(t)}</span>
              </div>
            </div>
            <span style={{ font: font(500, 12, 'Geist Mono'), color: 'var(--muted)', flex: 'none' }}>{formatTime(t.duration)}</span>
            {canRemove && (
              <button className="h-fill2" onClick={e => { e.stopPropagation(); huddle.remove(t.key); }} title={tr('huddle.remove')} style={{ width: 26, height: 26, border: 0, borderRadius: '50%', background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
                <CloseIcon size={11} stroke={3} />
              </button>
            )}
            <span onPointerDown={e => start(e, i)} onClick={e => e.stopPropagation()} title={tr('huddle.drag')} style={{ width: 24, height: 32, display: 'grid', placeItems: 'center', cursor: 'grab', color: 'var(--muted)', flex: 'none', touchAction: 'none' }}>
              <GripIcon size={16} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AddSongs({ room }: { room: RoomState }) {
  const { tracks } = useLibrary();
  const [tab, setTab] = useState<'device' | 'search'>('device');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<OnlineResult[]>([]);
  const inQueue = useMemo(() => new Set(room.queue.map(t => t.key)), [room.queue]);

  useEffect(() => {
    if (tab !== 'search' || !q.trim()) return setFound([]);
    let live = true;
    const id = setTimeout(() => searchOnline(q, (_, r) => live && setFound(r)).catch(() => {}), 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [tab, q]);

  const ql = q.trim().toLowerCase();
  const rows =
    tab === 'device'
      ? tracks
          .filter(t => t.status === 'ready' && t.source !== 'device' && (!ql || `${t.title} ${t.artist ?? ''} ${t.genre ?? ''}`.toLowerCase().includes(ql)))
          .slice(0, 60)
          .map(t => ({ id: t.id, title: t.title, artist: t.artist, art: artworkUri(t), tag: tr('huddle.onDevice'), added: inQueue.has(t.id), add: () => addLibrary(t) }))
      : found.map(r => ({ id: `${r.source}:${r.sourceId}`, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, added: inQueue.has(`${r.source}:${r.sourceId}`), add: () => addResult(r) }));

  const tabBtn = (k: 'device' | 'search', label: string) => (
    <button key={k} onClick={() => setTab(k)} style={{ flex: 1, height: 30, border: 0, borderRadius: 8, background: tab === k ? 'var(--card)' : 'transparent', font: font(tab === k ? 600 : 500, 13), cursor: 'pointer', boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>{label}</button>
  );
  return (
    <>
      <div style={{ padding: '0 18px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', padding: 3, borderRadius: 10, background: 'var(--fill2)' }}>
          {tabBtn('device', tr('huddle.onDevice'))}
          {tabBtn('search', tr('huddle.search'))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 10, background: 'var(--fill2)' }}>
          <SearchIcon size={15} color="var(--muted)" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'device' ? tr('huddle.filterLib') : tr('huddle.searchSources')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: font(400, 14), color: 'var(--ink)' }} />
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

function addResult(r: OnlineResult) {
  huddle.addOnline({ source: r.source, sourceId: r.sourceId, title: r.title, artist: r.artist, album: r.album, duration: r.duration, artwork: r.thumbnailUrl });
}

/** Library songs are shared by their link; everyone downloads them from the same source. */
function addLibrary(t: Track) {
  if (t.source === 'device') return;
  huddle.addOnline({ source: t.source, sourceId: t.sourceId, title: t.title, artist: t.artist, album: t.album, duration: t.duration, artwork: t.remoteArtworkUrl });
}

// ---------- chat ----------

function Chat({ v, room }: { v: HuddleView; room: RoomState }) {
  const [msg, setMsg] = useState('');
  useTicker(30_000);
  const send = () => {
    if (!msg.trim()) return;
    huddle.chat(msg);
    setMsg('');
  };
  return (
    <div style={{ width: 320, flex: 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderInlineStart: '1px solid var(--line)', background: 'var(--card)' }}>
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
              <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: '82%', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', background: ACCENT, color: '#fff', font: "400 14px/1.4 'Geist',sans-serif", overflowWrap: 'anywhere', userSelect: 'text', animation: 'popIn .25s' }}>{m.text}</div>
            ) : (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', animation: 'popIn .25s' }}>
                <span style={{ width: 26, height: 26, borderRadius: '50%', background: huddleColor(m.color), color: '#fff', display: 'grid', placeItems: 'center', font: font(600, 11), flex: 'none' }}>{m.name[0]?.toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ font: font(600, 13), color: huddleColor(m.color) }}>{m.name}</span>
                    <span style={{ font: font(400, 11, 'Geist Mono'), color: 'var(--muted)' }}>{ago(m.at)}</span>
                  </div>
                  <div style={{ marginTop: 2, font: "400 14px/1.4 'Geist',sans-serif", overflowWrap: 'anywhere', userSelect: 'text' }}>{m.text}</div>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={msg} maxLength={500} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={tr('huddle.say')} style={{ flex: 1, minWidth: 0, height: 40, padding: '0 14px', borderRadius: 999, border: 0, outline: 0, background: 'var(--fill2)', font: font(400, 14), color: 'var(--ink)' }} />
        <button onClick={send} title={tr('huddle.send')} style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: msg.trim() ? ACCENT : 'var(--fill2)', color: msg.trim() ? '#fff' : 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none', padding: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>
    </div>
  );
}
