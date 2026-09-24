/** Icons from the "Music App v2" design, path for path. */
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ACCENT } from '../theme';

interface P {
  size?: number;
  color: string;
  fill?: string;
  strokeWidth?: number;
}

const stroke = (color: string, w: number) => ({
  fill: 'none',
  stroke: color,
  strokeWidth: w,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const PlayIcon = ({ size = 14, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M7 5v14l12-7z" fill={color} />
  </Svg>
);

/** The slightly offset triangle used in the big round buttons. */
export const PlayRoundIcon = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 5v14l11-7z" fill={color} />
  </Svg>
);

export const PauseIcon = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
    <Rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
  </Svg>
);

export const PrevIcon = ({ size = 32, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M18 5v14l-9-7z" fill={color} />
    <Rect x="5" y="5" width="2.5" height="14" rx="1" fill={color} />
  </Svg>
);

export const NextIcon = ({ size = 32, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M6 5v14l9-7z" fill={color} />
    <Rect x="16.5" y="5" width="2.5" height="14" rx="1" fill={color} />
  </Svg>
);

export const ShuffleIcon = ({ size = 16, color, strokeWidth = 2.2 }: P) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...stroke(color, strokeWidth)}
  >
    <Path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </Svg>
);

export const RepeatIcon = ({ size = 22, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M17 2l4 4-4 4" />
    <Path d="M3 11V9a3 3 0 013-3h15" />
    <Path d="M7 22l-4-4 4-4" />
    <Path d="M21 13v2a3 3 0 01-3 3H3" />
  </Svg>
);

const HEART =
  'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z';

export const HeartIcon = ({ size = 20, color, fill = 'none' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={HEART} fill={fill} stroke={color} strokeWidth={2} />
  </Svg>
);

export const HeartSolidIcon = ({ size = 14, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d={HEART} fill={color} />
  </Svg>
);

export const CheckCircleIcon = ({ size = 14, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.4)}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M8 12l3 3 5-6" />
  </Svg>
);

export const CheckIcon = ({ size = 12, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 3.5)}>
    <Path d="M5 12l5 5 9-10" />
  </Svg>
);

export const SearchIcon = ({ size = 18, color, strokeWidth = 2.2 }: P) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...stroke(color, strokeWidth)}
  >
    <Circle cx="11" cy="11" r="7" />
    <Path d="M20 20l-3.5-3.5" />
  </Svg>
);

export const GlobeIcon = ({ size = 16, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
  </Svg>
);

export const DownloadIcon = ({ size = 16, color, strokeWidth = 2.2 }: P) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    {...stroke(color, strokeWidth)}
  >
    <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const MoreIcon = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <Circle cx="5" cy="12" r="1.8" />
    <Circle cx="12" cy="12" r="1.8" />
    <Circle cx="19" cy="12" r="1.8" />
  </Svg>
);

export const ChevronLeftIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = ({ size = 16, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M9 6l6 6-6 6" />
  </Svg>
);

export const ChevronDownIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M6 9l6 6 6-6" />
  </Svg>
);

export const PlusIcon = ({ size = 22, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CloseIcon = ({ size = 10, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 4)}>
    <Path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const QueueIcon = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M3 6h13M3 12h13M3 18h8" />
    <Path d="M17 15l5 3-5 3z" fill={color} />
  </Svg>
);

export const AddToListIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M3 6h12M3 12h12M3 18h7M18 14v7M14.5 17.5h7" />
  </Svg>
);

/** Speedometer (playback speed chip). */
export const SpeedIcon = ({ size = 14, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.4)}>
    <Path d="M4 16a8 8 0 1116 0" />
    <Path d="M12 16l4-5" />
  </Svg>
);

/** Radiating waves (the Similar button). */
export const LyricsIcon = ({ size = 20, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Path d="M4 5h16v11H10l-5 4v-4H4z" />
    <Path d="M8 9h8M8 12.5h5" />
  </Svg>
);

export const SimilarIcon = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.6 5.6a9 9 0 000 12.8M18.4 5.6a9 9 0 010 12.8" />
  </Svg>
);

/**
 * The stash mark: a play button resting on a shelf — what you hear is what you keep.
 * `variant`: default (orange tile), dark (ink tile, orange shelf), tinted (white tile).
 */
export const LogoMark = ({
  size = 40,
  variant = 'default',
}: {
  size?: number;
  variant?: 'default' | 'dark' | 'tinted';
}) => {
  const tile =
    variant === 'dark' ? '#16161A' : variant === 'tinted' ? '#FFFFFF' : ACCENT;
  const play = variant === 'tinted' ? ACCENT : '#FFFFFF';
  const shelf =
    variant === 'dark' ? ACCENT : variant === 'tinted' ? '#16161A' : '#FFFFFF';
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width="64" height="64" rx="15" fill={tile} />
      <Path
        d="M26 15.5v22l17-11z"
        fill={play}
        stroke={play}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Path
        d="M19 47h26"
        stroke={shelf}
        strokeWidth={4.5}
        strokeLinecap="round"
      />
    </Svg>
  );
};

// ---- tab bar ----

export const LibraryTabIcon = ({ size = 24, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
    <Path d="M5 4v16M10 4v16M15 4.5l5 15" />
  </Svg>
);

export const SettingsTabIcon = ({ size = 24, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
    <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <Circle cx="16" cy="7" r="2" />
    <Circle cx="10" cy="17" r="2" />
  </Svg>
);

/** Circular progress ring (the save/download status chip in the player). */
export const RingIcon = ({
  size = 18,
  color,
  track,
  progress,
}: {
  size?: number;
  color: string;
  track: string;
  progress: number;
}) => {
  const c = 2 * Math.PI * 7;
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke={track}
        strokeWidth={2.4}
      />
      <Circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray={`${(Math.max(0, Math.min(1, progress)) * c).toFixed(
          1,
        )} ${c}`}
        transform="rotate(-90 9 9)"
      />
    </Svg>
  );
};
