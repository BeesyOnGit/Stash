/** Small building blocks used across the screens, styled as in the design. */
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { VinylStyle } from '../core/services/settings';

export const ACCENT = '#E0532F';

/** A cover image on a coloured tile (the colour shows until it loads, or if there's none). */
export function Cover({
  src,
  size,
  radius = 8,
  bg,
  style,
  children,
}: {
  src: string | null | undefined;
  size: number | string;
  radius?: number | string;
  bg: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        background: bg,
        flex: 'none',
        ...style,
      }}
    >
      {src && failed !== src && (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(src)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {children}
    </div>
  );
}

/** Up to four covers in a 2×2 grid (playlists). */
export function CoverGrid({
  srcs,
  size,
  radius = 8,
  style,
}: {
  srcs: Array<string | null | undefined>;
  size: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  const list = srcs.filter(Boolean) as string[];
  const four = list.length
    ? Array.from({ length: 4 }, (_, i) => list[i % list.length])
    : [];
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'var(--fill3)',
        flex: 'none',
        ...style,
      }}
    >
      {four.map((c, i) => (
        <img
          key={i}
          src={c}
          alt=""
          draggable={false}
          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
        />
      ))}
    </div>
  );
}

/** Three bouncing bars over the cover of the song that's playing. */
export function Equalizer({ color = '#fff', playing }: { color?: string; playing: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 3,
            height: 14,
            borderRadius: 1,
            background: color,
            transformOrigin: 'bottom',
            animation: playing
              ? `eq ${0.7 + i * 0.18}s ease-in-out ${i * 0.12}s infinite`
              : 'none',
            transform: playing ? undefined : 'scaleY(.4)',
          }}
        />
      ))}
    </div>
  );
}

export const EqOverlay = ({ playing, radius = 0 }: { playing: boolean; radius?: number }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: radius,
      background: 'rgba(22,22,26,.5)',
      display: 'grid',
      placeItems: 'center',
    }}
  >
    <Equalizer playing={playing} />
  </div>
);

export const Spinner = ({ color = ACCENT, track = 'oklch(0.92 0.04 35)', size = 14 }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      border: `2px solid ${track}`,
      borderTopColor: color,
      animation: 'spin .8s linear infinite',
      display: 'inline-block',
      flex: 'none',
    }}
  />
);

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        position: 'relative',
        width: 50,
        height: 30,
        flex: 'none',
        borderRadius: 15,
        border: 0,
        padding: 0,
        background: on ? ACCENT : 'var(--fill3)',
        cursor: 'pointer',
        transition: 'background .2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          insetInlineStart: on ? 23 : 3,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
          transition: 'inset-inline-start .2s',
        }}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  height = 30,
  pad = 14,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  height?: number;
  pad?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: '1fr',
        padding: 3,
        borderRadius: 11,
        background: 'var(--fill2)',
        flex: 'none',
      }}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              border: 0,
              height,
              padding: `0 ${pad}px`,
              borderRadius: 8,
              background: on ? 'var(--card)' : 'transparent',
              boxShadow: on ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
              color: 'var(--ink)',
              font: `${on ? 600 : 500} 13px 'Geist',sans-serif`,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A rounded white box (settings groups, stat tiles). */
export const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      borderRadius: 16,
      background: 'var(--card)',
      border: '1px solid var(--line)',
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

export function SettingRow({
  title,
  sub,
  right,
  first,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  first?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: '14px 18px',
        borderTop: first ? 0 : '1px solid var(--line)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "500 15px 'Geist',sans-serif" }}>{title}</div>
          {sub && (
            <div
              style={{
                marginTop: 2,
                font: "400 13px/1.4 'Geist',sans-serif",
                color: 'var(--muted)',
              }}
            >
              {sub}
            </div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export const OutlineButton = ({
  children,
  onClick,
  mono,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  mono?: boolean;
  disabled?: boolean;
  title?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      border: '1px solid var(--line2)',
      background: 'transparent',
      color: 'var(--ink)',
      font: mono ? "600 13px 'Geist Mono',monospace" : "500 13px 'Geist',sans-serif",
      padding: '6px 12px',
      borderRadius: 999,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.55 : 1,
      flex: 'none',
      whiteSpace: 'nowrap',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}
  >
    {children}
  </button>
);

export const IconButton = ({
  children,
  onClick,
  title,
  size = 36,
  color,
  bg = 'transparent',
  hover = 'h-fill2',
  radius = 8,
  style,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  size?: number;
  color?: string;
  bg?: string;
  hover?: string;
  radius?: number | string;
  style?: CSSProperties;
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={hover}
    style={{
      width: size,
      height: size,
      border: 0,
      borderRadius: radius,
      background: bg,
      color: color ?? 'inherit',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      flex: 'none',
      padding: 0,
      ...style,
    }}
  >
    {children}
  </button>
);

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="eyebrow" style={{ padding: '26px 0 10px' }}>
    {children}
  </div>
);

export const Note = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      padding: '14px 16px',
      borderRadius: 14,
      background: 'var(--fill)',
      font: "400 14px/1.4 'Geist',sans-serif",
      color: 'var(--ink2)',
      ...style,
    }}
  >
    {children}
  </div>
);

// ---- the vinyl record ----

export const VINYLS: Record<
  VinylStyle,
  { disc: string | null; inset: number; bubbleInset: number; op: number }
> = {
  classic: { disc: '#141414', inset: 12, bubbleInset: 30, op: 1 },
  colour: { disc: null, inset: 12, bubbleInset: 30, op: 1 },
  picture: { disc: '#141414', inset: 0, bubbleInset: 0, op: 1 },
  clear: { disc: 'rgba(255,255,255,.22)', inset: 20, bubbleInset: 32, op: 0.92 },
};

export const discColor = (style: VinylStyle, deep: string) =>
  VINYLS[style].disc ?? deep;

/** The cover on a record, spinning while it plays (Now playing panel, settings preview). */
export function Vinyl({
  src,
  vinylStyle,
  deep,
  label,
  spinning,
  size = '100%',
  small,
}: {
  src: string | null | undefined;
  vinylStyle: VinylStyle;
  deep: string;
  label: string;
  spinning: boolean;
  size?: number | string;
  small?: boolean;
}) {
  const v = VINYLS[vinylStyle];
  const inset = small ? v.bubbleInset : v.inset;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: discColor(vinylStyle, deep),
        boxShadow: small
          ? '0 0 0 1px rgba(0,0,0,.2)'
          : '0 0 0 3px rgba(0,0,0,.55),0 10px 26px rgba(0,0,0,.3)',
        animation: 'spin 6s linear infinite',
        animationPlayState: spinning ? 'running' : 'paused',
      }}
    >
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${inset}%`,
            top: `${inset}%`,
            width: `${100 - 2 * inset}%`,
            height: `${100 - 2 * inset}%`,
            opacity: v.op,
            borderRadius: '50%',
            objectFit: 'cover',
            display: 'block',
            boxShadow: '0 0 0 2px rgba(0,0,0,.4)',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: small
            ? 'repeating-radial-gradient(circle at 50% 50%,rgba(255,255,255,0) 0,rgba(255,255,255,0) 2px,rgba(255,255,255,.08) 2.5px,rgba(255,255,255,.08) 3px)'
            : 'repeating-radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 0,rgba(0,0,0,0) 5px,rgba(255,255,255,.05) 6px,rgba(255,255,255,.05) 6.5px)',
          pointerEvents: 'none',
        }}
      />
      {!small && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 20,
            height: 20,
            margin: -10,
            borderRadius: '50%',
            background: label,
            boxShadow: '0 0 0 3px rgba(0,0,0,.6) inset',
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: small ? 4 : 6,
          height: small ? 4 : 6,
          margin: small ? -2 : -3,
          borderRadius: '50%',
          background: '#0B0B0D',
        }}
      />
    </div>
  );
}
