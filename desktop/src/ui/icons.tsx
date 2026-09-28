/** The design's icons (24×24 grid, drawn with the current text colour). */
import type { CSSProperties, ReactNode } from 'react';

interface P {
  size?: number;
  color?: string;
  style?: CSSProperties;
  stroke?: number;
}

const S = ({
  size = 18,
  color,
  style,
  stroke = 2.2,
  children,
  fill = 'none',
}: P & { children: ReactNode; fill?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={fill === 'none' ? 'currentColor' : undefined}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ color, flex: 'none', ...style }}
  >
    {children}
  </svg>
);

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={{ flex: 'none' }}>
    <rect width="64" height="64" rx="15" fill="#E0532F" />
    <path d="M26 15.5v22l17-11z" fill="#fff" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
    <path d="M19 47h26" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </S>
);
export const CloseIcon = (p: P) => (
  <S stroke={2.4} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);
export const MinusIcon = (p: P) => (
  <S stroke={2} {...p}>
    <path d="M5 12h14" />
  </S>
);
export const SquareIcon = (p: P) => (
  <S stroke={2} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </S>
);
export const LibraryIcon = (p: P) => (
  <S stroke={2} {...p}>
    <path d="M5 4v16M10 4v16M15 4.5l5 15" />
  </S>
);
export const StatsIcon = (p: P) => (
  <S {...p}>
    <path d="M5 20V11M12 20V4M19 20v-6" />
  </S>
);
export const DownloadIcon = (p: P) => (
  <S {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </S>
);
export const SlidersIcon = (p: P) => (
  <S stroke={2} {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </S>
);
export const PlusIcon = (p: P) => (
  <S stroke={2.4} {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <S stroke={2} fill={filled ? 'currentColor' : 'none'} {...p}>
    <path
      d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"
      stroke={filled ? 'none' : 'currentColor'}
    />
  </S>
);
export const CheckCircleIcon = (p: P) => (
  <S stroke={2.4} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </S>
);
export const CheckIcon = (p: P) => (
  <S stroke={3.5} {...p}>
    <path d="M5 12l5 5 9-10" />
  </S>
);
export const PlayIcon = (p: P) => (
  <S fill="currentColor" {...p}>
    <path d="M8 5v14l11-7z" />
  </S>
);
export const PauseIcon = (p: P) => (
  <S fill="currentColor" {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </S>
);
export const PrevIcon = (p: P) => (
  <S fill="currentColor" {...p}>
    <path d="M18 5v14l-9-7z" />
    <rect x="5" y="5" width="2.5" height="14" rx="1" />
  </S>
);
export const NextIcon = (p: P) => (
  <S fill="currentColor" {...p}>
    <path d="M6 5v14l9-7z" />
    <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
  </S>
);
export const ShuffleIcon = (p: P) => (
  <S {...p}>
    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </S>
);
export const RepeatIcon = (p: P) => (
  <S {...p}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 013-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 01-3 3H3" />
  </S>
);
export const DotsIcon = (p: P) => (
  <S fill="currentColor" {...p}>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </S>
);
export const TrashIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </S>
);
export const AddToListIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M3 6h12M3 12h12M3 18h7M18 14v7M14.5 17.5h7" />
  </S>
);
export const ChevronLeftIcon = (p: P) => (
  <S {...p}>
    <path d="M15 6l-6 6 6 6" />
  </S>
);
export const GripIcon = (p: P) => (
  <S {...p}>
    <path d="M5 8h14M5 12h14M5 16h14" />
  </S>
);
export const GlobeIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </S>
);
export const FolderIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </S>
);
export const PencilIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
  </S>
);
export const ShareIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5" />
  </S>
);
export const MoonIcon = (p: P) => (
  <S {...p}>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </S>
);
export const LyricsIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M4 6h11M4 11h11M4 16h6" />
    <circle cx="17.5" cy="17.5" r="2.5" />
    <path d="M20 17.5V7" />
  </S>
);
export const MicIcon = ({ off, ...p }: P & { off?: boolean }) => (
  <S stroke={2.1} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d={off ? 'M5 11a7 7 0 0014 0M12 18v3M3 3l18 18' : 'M5 11a7 7 0 0014 0M12 18v3'} />
  </S>
);
export const HeadphonesIcon = (p: P) => (
  <S stroke={2.1} {...p}>
    <path d="M4 15v-3a8 8 0 0116 0v3" />
    <rect x="3" y="14" width="4" height="6" rx="1.5" />
    <rect x="17" y="14" width="4" height="6" rx="1.5" />
  </S>
);
export const SpeedIcon = (p: P) => (
  <S stroke={2.4} {...p}>
    <path d="M4 16a8 8 0 1116 0" />
    <path d="M12 16l4-5" />
  </S>
);
export const SimilarIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8" />
  </S>
);
export const QueueIcon = (p: P) => (
  <S {...p}>
    <path d="M3 6h13M3 12h13M3 18h8" />
    <path d="M17 15l5 3-5 3z" fill="currentColor" />
  </S>
);
/** A speaker with 0–2 waves for the level, or a cross when muted. */
export const VolumeIcon = ({ level, ...p }: P & { level: number }) => (
  <S {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {level <= 0 ? (
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    ) : (
      <>
        <path d="M15.5 9a4 4 0 010 6" />
        {level > 0.5 && <path d="M18.5 6.5a8 8 0 010 11" />}
      </>
    )}
  </S>
);
export const ExpandIcon = (p: P) => (
  <S {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </S>
);
export const CollapseIcon = (p: P) => (
  <S {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </S>
);
export const PanelIcon = (p: P) => (
  <S stroke={2} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M15 4v16" />
  </S>
);
export const ArrowOutIcon = (p: P) => (
  <S stroke={2.4} {...p}>
    <path d="M7 17L17 7M9 7h8v8" />
  </S>
);
