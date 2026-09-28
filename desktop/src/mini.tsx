/**
 * The mini vinyl player window (and, as mini.html#dismiss, its ✕ target).
 * A spinning record with a progress ring floats above other windows while
 * stash is minimised or in the tray: drag it anywhere (it settles against the
 * nearest side), drop it on ✕ to hide it, click it for a card with controls,
 * favorites and suggestions. What it shows comes from the main window
 * (ui/miniBridge.ts); what it does goes back there.
 */
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  Window,
} from '@tauri-apps/api/window';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MiniCommand, MiniItem, MiniState } from './ui/miniBridge';
import { ArrowOutIcon, CloseIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from './ui/icons';

const BUBBLE = 58;
const BOX = 84; // the bubble's window, with room for its shadow
const CARD_W = 266;
const CARD_H = 420;
const WIDE = CARD_W + 26;
const MARGIN = 14;

const cmd = (c: MiniCommand) => emit('mini-cmd', c);
const win = getCurrentWindow();

// ---- the ✕ target shown while dragging ----

function Dismiss() {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const un = listen<boolean>('dismiss-near', e => setNear(e.payload));
    return () => {
      un.then(f => f());
    };
  }, []);
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'grid', placeItems: 'center' }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: near ? '#E0532F' : 'rgba(0,0,0,.55)',
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          transform: `scale(${near ? 1.15 : 1})`,
          transition: 'background .15s, transform .15s',
          boxShadow: '0 8px 20px rgba(0,0,0,.3)',
        }}
      >
        <CloseIcon size={24} />
      </div>
    </div>
  );
}

// ---- the bubble and its card ----

/** Where the ✕ target sits: bottom middle of the screen. */
const target = (a: { x: number; y: number; w: number; h: number; scale: number }) => ({ x: a.x + a.w / 2, y: a.y + a.h - 110 * a.scale });

async function workArea() {
  const m = await currentMonitor();
  if (!m) return null;
  const wa = m.workArea ?? { position: m.position, size: m.size };
  return { x: wa.position.x, y: wa.position.y, w: wa.size.width, h: wa.size.height, scale: m.scaleFactor };
}

function Mini() {
  const [s, setS] = useState<MiniState | null>(null);
  const [card, setCard] = useState(false);
  /** Where the card is, relative to the bubble. */
  const [layout, setLayout] = useState<{ side: 'left' | 'right'; above: boolean }>({ side: 'right', above: false });
  const placed = useRef(false);
  /** The bubble's window position (physical px) when the card isn't open. */
  const home = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const un = listen<MiniState>('mini-state', e => setS(e.payload));
    cmd({ type: 'ready' });
    return () => {
      un.then(f => f());
    };
  }, []);

  // First time it shows: against the right side, a third of the way down.
  useEffect(() => {
    if (!s?.visible || placed.current) return;
    placed.current = true;
    (async () => {
      const a = await workArea();
      if (!a) return;
      let saved: { x: number; y: number } | null = null;
      try {
        saved = JSON.parse(localStorage.getItem('stash-mini-pos') || 'null');
      } catch {}
      const box = BOX * a.scale;
      const x = saved && saved.x >= a.x && saved.x <= a.x + a.w - box ? saved.x : a.x + a.w - box - MARGIN * a.scale;
      const y = saved && saved.y >= a.y && saved.y <= a.y + a.h - box ? saved.y : a.y + Math.round(a.h / 3);
      home.current = { x, y };
      await win.setPosition(new PhysicalPosition(x, y));
    })();
  }, [s?.visible]);

  // Hidden (back in the app): the card closes.
  useEffect(() => {
    if (s && !s.visible && card) closeCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && card && closeCard();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const openCard = async () => {
    const a = await workArea();
    const pos = await win.outerPosition();
    if (!a) return;
    home.current = { x: pos.x, y: pos.y };
    const side = pos.x + (BOX * a.scale) / 2 < a.x + a.w / 2 ? 'left' : 'right';
    const above = pos.y + (BOX + CARD_H) * a.scale > a.y + a.h;
    setLayout({ side, above });
    const x = side === 'right' ? pos.x - (WIDE - BOX) * a.scale : pos.x;
    const y = above ? pos.y - CARD_H * a.scale : pos.y;
    await win.setSize(new LogicalSize(WIDE, BOX + CARD_H));
    await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    setCard(true);
    win.setFocus().catch(() => {});
  };

  const closeCard = async () => {
    setCard(false);
    await win.setSize(new LogicalSize(BOX, BOX));
    if (home.current) await win.setPosition(new PhysicalPosition(home.current.x, home.current.y));
  };

  /**
   * Press on the bubble: a click opens / closes the card, a drag moves it.
   * The listeners go on right away (a quick click can end before any await
   * returns); the screen, position and ✕ window load alongside. Moves are sent
   * one at a time, and the drag also ends if the pointer is cancelled or lost.
   */
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    const sx = e.screenX;
    const sy = e.screenY;
    let lx = sx;
    let ly = sy;
    let moved = false;
    let near = false;
    let ended = false;
    let cur: { x: number; y: number } | null = null;
    let sending = false;
    let queued: { x: number; y: number } | null = null;
    const info = Promise.all([workArea(), win.outerPosition(), Window.getByLabel('dismiss')]).catch(() => null);
    let ctx: { a: NonNullable<Awaited<ReturnType<typeof workArea>>>; pos: { x: number; y: number }; dismiss: Window | null } | null = null;
    info.then(r => {
      if (r && r[0]) ctx = { a: r[0], pos: { x: r[1].x, y: r[1].y }, dismiss: r[2] };
      if (!ended) follow();
    });

    const place = (p: { x: number; y: number }) => {
      if (sending) {
        queued = p;
        return;
      }
      sending = true;
      win
        .setPosition(new PhysicalPosition(p.x, p.y))
        .catch(() => {})
        .finally(() => {
          sending = false;
          if (queued) {
            const q = queued;
            queued = null;
            place(q);
          }
        });
    };

    const follow = () => {
      const c = ctx;
      if (!c) return;
      const { a, pos, dismiss } = c;
      const scale = a.scale;
      const box = BOX * scale;
      const dx = (lx - sx) * scale;
      const dy = (ly - sy) * scale;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) <= 5 * scale) return;
        moved = true;
        if (card) closeCard();
        const t = target(a);
        dismiss?.setPosition(new PhysicalPosition(Math.round(t.x - 48 * scale), Math.round(t.y - 48 * scale))).then(() => dismiss.show()).catch(() => {});
      }
      cur = {
        x: Math.round(Math.min(Math.max(pos.x + dx, a.x), a.x + a.w - box)),
        y: Math.round(Math.min(Math.max(pos.y + dy, a.y), a.y + a.h - box)),
      };
      place(cur);
      const t = target(a);
      const isNear = Math.hypot(cur.x + box / 2 - t.x, cur.y + box / 2 - t.y) < 70 * scale;
      if (isNear !== near) {
        near = isNear;
        emitTo('dismiss', 'dismiss-near', near).catch(() => {});
      }
    };

    const move = (ev: PointerEvent) => {
      lx = ev.screenX;
      ly = ev.screenY;
      follow();
    };

    const end = async () => {
      if (ended) return;
      ended = true;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (!moved) {
        if (card) closeCard();
        else openCard();
        return;
      }
      await info;
      const c = ctx;
      c?.dismiss?.hide().catch(() => {});
      emitTo('dismiss', 'dismiss-near', false).catch(() => {});
      if (near) {
        cmd({ type: 'dismiss' });
        return;
      }
      if (!c || !cur) return;
      // Settle against the nearest side.
      const { a } = c;
      const box = BOX * a.scale;
      const left = cur.x + box / 2 < a.x + a.w / 2;
      const x = left ? a.x + MARGIN * a.scale : a.x + a.w - box - MARGIN * a.scale;
      home.current = { x: Math.round(x), y: cur.y };
      queued = null;
      place(home.current);
      try {
        localStorage.setItem('stash-mini-pos', JSON.stringify(home.current));
      } catch {}
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  };

  if (!s) return null;
  const dash = `${(s.progress * 166.5).toFixed(1)} 166.5`;

  const bubble = (
    <div
      onPointerDown={startDrag}
      title={s.words.hint}
      style={{
        position: 'relative',
        width: BUBBLE,
        height: BUBBLE,
        borderRadius: '50%',
        cursor: 'grab',
        touchAction: 'none',
        boxShadow: '0 6px 14px rgba(0,0,0,.35),0 0 0 3px rgba(255,255,255,.95)',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          background: s.disc,
          animation: 'spin 6s linear infinite',
          animationPlayState: s.spinning ? 'running' : 'paused',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'repeating-radial-gradient(circle at 50% 50%,rgba(255,255,255,0) 0,rgba(255,255,255,0) 2px,rgba(255,255,255,.07) 2.5px,rgba(255,255,255,.07) 3px)' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 30deg,rgba(255,255,255,0) 0deg,rgba(255,255,255,.14) 40deg,rgba(255,255,255,0) 80deg,rgba(255,255,255,0) 210deg,rgba(255,255,255,.1) 250deg,rgba(255,255,255,0) 290deg)' }} />
        {s.art && (
          <img
            src={s.art}
            alt=""
            draggable={false}
            style={{ position: 'absolute', left: `${s.inset}%`, top: `${s.inset}%`, width: `${100 - 2 * s.inset}%`, height: `${100 - 2 * s.inset}%`, opacity: s.imageOpacity, borderRadius: '50%', objectFit: 'cover', display: 'block', boxShadow: '0 0 0 1.5px rgba(0,0,0,.6)' }}
          />
        )}
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 4, height: 4, margin: -2, borderRadius: '50%', background: '#0B0B0D' }} />
      </div>
      <svg width="58" height="58" viewBox="0 0 58 58" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <circle cx="29" cy="29" r="26.5" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="2.5" />
        <circle cx="29" cy="29" r="26.5" fill="none" stroke={s.ring} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dash} transform="rotate(-90 29 29)" />
      </svg>
      <div style={{ position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%', background: '#16161A', color: '#fff', display: 'grid', placeItems: 'center', boxShadow: '0 0 0 2px #fff' }}>
        {s.playing ? <PauseIcon size={9} /> : <PlayIcon size={9} />}
      </div>
    </div>
  );

  const bubbleBox = (
    <div style={{ width: BOX, height: BOX, display: 'grid', placeItems: 'center', flex: 'none' }}>{bubble}</div>
  );

  if (!card) return bubbleBox;

  const ink = '#F2F1EE';
  return (
    <div
      style={{
        width: WIDE,
        height: BOX + CARD_H,
        display: 'flex',
        flexDirection: layout.above ? 'column-reverse' : 'column',
        alignItems: layout.side === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {bubbleBox}
      <div
        style={{
          width: CARD_W,
          height: CARD_H - 12,
          margin: layout.side === 'right' ? '0 13px 0 0' : '0 0 0 13px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 22,
          background: '#1F1F22',
          color: ink,
          boxShadow: '0 10px 30px rgba(0,0,0,.45)',
          animation: 'popIn .2s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        <div style={{ flex: 'none', padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 46, height: 46, borderRadius: 11, overflow: 'hidden', flex: 'none', background: s.artBg }}>
              {s.art && <img src={s.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ellipsis" style={{ font: "600 14px/1.25 'Geist',sans-serif" }}>{s.title}</div>
              <div className="ellipsis" style={{ font: "400 12px/1.3 'Geist',sans-serif", opacity: 0.7 }}>{s.artist}</div>
            </div>
            <button onClick={() => cmd({ type: 'open' })} aria-label={s.words.open} title={s.words.open} style={roundBtn(32, 'rgba(255,255,255,.12)', ink)}>
              <ArrowOutIcon size={15} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 12 }}>
            <button onClick={() => cmd({ type: 'prev' })} style={roundBtn(38, 'transparent', ink)}>
              <PrevIcon size={24} />
            </button>
            <button onClick={() => cmd({ type: 'toggle' })} style={roundBtn(48, ink, '#1F1F22')}>
              {s.playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
            </button>
            <button onClick={() => cmd({ type: 'next' })} style={roundBtn(38, 'transparent', ink)}>
              <NextIcon size={24} />
            </button>
          </div>
          <div style={{ marginTop: 10, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${s.progress * 100}%`, background: ink }} />
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '2px 14px 14px', ['--sb' as string]: ink }}>
          {s.favorites.length > 0 && (
            <>
              <Label>{s.words.favorites}</Label>
              <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 8 }}>
                {s.favorites.map(f => (
                  <div key={f.key} onClick={() => cmd({ type: 'play', key: f.key })} title={`${f.title} · ${f.artist}`} style={{ width: 52, height: 52, flex: 'none', borderRadius: 12, overflow: 'hidden', background: f.artBg, cursor: 'pointer' }}>
                    {f.art && <img src={f.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                  </div>
                ))}
              </div>
            </>
          )}
          {s.suggestions.length > 0 && (
            <>
              <Label top={16}>{s.words.suggested}</Label>
              <div style={{ marginTop: 6 }}>
                {s.suggestions.map(x => (
                  <Row key={x.key} item={x} />
                ))}
              </div>
            </>
          )}
          {!s.favorites.length && !s.suggestions.length && (
            <div style={{ marginTop: 14, font: "400 12px/1.45 'Geist',sans-serif", opacity: 0.7 }}>{s.words.empty}</div>
          )}
        </div>
      </div>
    </div>
  );
}

const roundBtn = (size: number, bg: string, color: string): React.CSSProperties => ({
  width: size,
  height: size,
  border: 0,
  borderRadius: '50%',
  background: bg,
  color,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flex: 'none',
  padding: 0,
});

const Label = ({ children, top = 12 }: { children: React.ReactNode; top?: number }) => (
  <div style={{ marginTop: top, font: "600 11px 'Geist Mono',monospace", letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.55 }}>{children}</div>
);

function Row({ item }: { item: MiniItem }) {
  return (
    <div onClick={() => cmd({ type: 'play', key: item.key })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, overflow: 'hidden', flex: 'none', background: item.artBg }}>
        {item.art && <img src={item.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ellipsis" style={{ font: "500 13px/1.25 'Geist',sans-serif" }}>{item.title}</div>
        <div className="ellipsis" style={{ font: "400 11px/1.3 'Geist',sans-serif", opacity: 0.6 }}>{item.artist}</div>
      </div>
      {item.tag && (
        <span style={{ flex: 'none', font: "500 10px 'Geist Mono',monospace", padding: '3px 7px', borderRadius: 999, background: item.local ? 'rgba(120,200,150,.18)' : 'rgba(255,255,255,.1)', color: item.local ? 'oklch(0.82 0.12 155)' : '#C9C8CE' }}>
          {item.tag}
        </span>
      )}
    </div>
  );
}

document.documentElement.dir = 'ltr';
createRoot(document.getElementById('root')!).render(
  <StrictMode>{location.hash === '#dismiss' ? <Dismiss /> : <Mini />}</StrictMode>,
);
