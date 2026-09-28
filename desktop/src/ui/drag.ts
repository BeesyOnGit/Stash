/**
 * Dragging rows: by their ≡ handle to reorder (playlists, the queue), or the
 * row itself sideways to take it out (the queue). The row follows the pointer;
 * the change is applied when it's let go.
 */
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';

interface Drag {
  i: number;
  dx: number;
  dy: number;
  mode: 'move' | 'swipe';
}

export function useRowDrag(opts: {
  count: number;
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  /** A drag just ended: the click that follows it isn't a tap on the row. */
  const justDragged = useRef(false);

  const start = (e: PointerEvent, i: number, mode: 'move' | 'swipe') => {
    if (e.button !== 0) return;
    if (mode === 'move') {
      e.preventDefault();
      e.stopPropagation();
    }
    const row = (e.currentTarget as HTMLElement).closest('[data-drag-row]') as HTMLElement | null;
    const height = row?.offsetHeight || 54;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let last: Drag | null = null;
    const mv = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved) {
        if (mode === 'swipe' ? Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > 4) moved = true;
        else return;
      }
      last = { i, mode, dx: mode === 'swipe' ? dx : 0, dy: mode === 'move' ? dy : 0 };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moved || !last) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 60);
      if (mode === 'move') {
        const to = Math.max(0, Math.min(opts.count - 1, i + Math.round(last.dy / height)));
        if (to !== i) opts.onMove?.(i, to);
      } else if (Math.abs(last.dx) > 90) {
        opts.onRemove?.(i);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const rowStyle = (i: number): CSSProperties => {
    const d = drag && drag.i === i ? drag : null;
    if (!d) return {};
    return {
      transform: `translate(${d.dx}px, ${d.dy}px)`,
      opacity: d.dx ? Math.max(0.25, 1 - Math.abs(d.dx) / 220) : 1,
      zIndex: 2,
      position: 'relative',
      background: d.dy ? 'var(--dragBg, var(--card))' : undefined,
      boxShadow: d.dy ? '0 10px 24px rgba(0,0,0,.16)' : undefined,
    };
  };

  return {
    handle: (i: number) => ({
      onPointerDown: (e: PointerEvent) => start(e, i, 'move'),
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      style: { cursor: 'grab', touchAction: 'none' } as CSSProperties,
    }),
    swipe: (i: number) => ({
      onPointerDown: (e: PointerEvent) => start(e, i, 'swipe'),
    }),
    rowStyle,
    wasDrag: () => justDragged.current,
  };
}
