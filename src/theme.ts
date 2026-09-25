/**
 * Design tokens from "Music App v2": light/dark themes, the per-song palette
 * derived from a hue, genre colours and the Geist type ramp.
 * (oklch values from the design are converted to hex/hsl — React Native has no oklch.)
 */
import type { TextStyle } from 'react-native';
import { tr } from './i18n';
import { useSettings } from './services/settings';

export interface ThemeTokens {
  dark: boolean;
  bg: string;
  card: string;
  ink: string;
  onInk: string;
  ink2: string;
  muted: string;
  muted2: string;
  fill: string;
  fill2: string;
  fill3: string;
  line: string;
  line2: string;
  bar: string;
  accentInk: string;
  accentSoft: string;
  accentSoft2: string;
  danger: string;
  glass: string;
}

export const THEMES: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    dark: false,
    bg: '#F7F6F3',
    card: '#FFFFFF',
    ink: '#16161A',
    onInk: '#FFFFFF',
    ink2: '#3A3940',
    muted: '#6B6A70',
    muted2: '#8B8A90',
    fill: 'rgba(0,0,0,0.035)',
    fill2: 'rgba(0,0,0,0.05)',
    fill3: '#E4E2DD',
    line: 'rgba(0,0,0,0.07)',
    line2: 'rgba(0,0,0,0.14)',
    bar: 'rgba(247,246,243,0.96)',
    accentInk: '#C2421F',
    accentSoft: '#FBE7DE',
    accentSoft2: '#F6DDD2',
    danger: '#B42318',
    glass: 'rgba(255,255,255,0.6)',
  },
  dark: {
    dark: true,
    bg: '#111113',
    card: '#1C1C20',
    ink: '#F2F1EE',
    onInk: '#141416',
    ink2: '#C9C8CE',
    muted: '#A2A1A9',
    muted2: '#8A8991',
    fill: 'rgba(255,255,255,0.05)',
    fill2: 'rgba(255,255,255,0.07)',
    fill3: '#2A2A2F',
    line: 'rgba(255,255,255,0.08)',
    line2: 'rgba(255,255,255,0.18)',
    bar: 'rgba(17,17,19,0.94)',
    accentInk: '#FF8A65',
    accentSoft: '#4E2619',
    accentSoft2: '#42251C',
    danger: '#FF6B5E',
    glass: 'rgba(255,255,255,0.12)',
  },
};

export const ACCENT = '#E0532F';
export const GREEN = '#2E9D62';
export const GREEN_LIGHT = '#6FD39A';
export const WARN = '#D99A2B';

export const useTheme = () => THEMES[useSettings().theme];

// ---- per-song palette ----

/** Stable hue for a song, so its colours are the same everywhere and every time. */
export function hueOf(str: string): number {
  let h = 7;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const hsl = (h: number, s: number, l: number, a?: number) =>
  a === undefined
    ? `hsl(${h}, ${s}%, ${l}%)`
    : `hsla(${h}, ${s}%, ${l}%, ${a})`;

export interface Palette {
  h: number;
  s: number;
  deep: string;
  deep2: string;
  glow: string;
  accent: string;
  soft: string;
  soft2: string;
  softInk: string;
  artBg: string;
  /** Same hue as softInk, with alpha — for the light player's waveform. */
  inkA: (a: number) => string;
}

export function paletteFor(t: {
  title: string;
  artist: string | null;
}): Palette {
  const h = hueOf(t.title + (t.artist ?? ''));
  const s = 55;
  return {
    h,
    s,
    deep: hsl(h, s, 12),
    deep2: hsl(h, s, 26),
    glow: hsl(h, Math.max(s, 60), 50),
    accent: hsl(h, Math.max(s, 60), 72),
    soft: hsl(h, Math.min(s, 55), 91),
    soft2: hsl(h, Math.min(s, 55), 82),
    softInk: hsl(h, Math.min(s, 50), 20),
    artBg: hsl(h, s, 78),
    inkA: a => hsl(h, Math.min(s, 50), 20, a),
  };
}

// ---- genres ----

const GENRE_HUE: Record<string, number> = {
  'R&B': 30,
  'R&B/Soul': 30,
  Soul: 75,
  Jazz: 75,
  Indie: 150,
  Alternative: 150,
  Rock: 15,
  Pop: 340,
  Electronic: 270,
  Dance: 270,
  'Hip-Hop/Rap': 45,
  Classical: 220,
};

export function genreColors(genre: string, dark: boolean) {
  const h = GENRE_HUE[genre] ?? hueOf(genre);
  return dark
    ? { bg: hsl(h, 35, 22), ink: hsl(h, 55, 90), h }
    : { bg: hsl(h, 60, 88), ink: hsl(h, 50, 24), h };
}

// ---- type ----

type Weight = 400 | 500 | 600 | 700;
const SANS: Record<Weight, string> = {
  400: 'Geist-Regular',
  500: 'Geist-Medium',
  600: 'Geist-SemiBold',
  700: 'Geist-Bold',
};
const MONO: Record<Weight, string> = {
  400: 'GeistMono-Regular',
  500: 'GeistMono-Medium',
  600: 'GeistMono-SemiBold',
  700: 'GeistMono-Bold',
};

/** Geist at a weight and size. Weight comes from the font file, never fontWeight (Android). */
export const font = (
  weight: Weight,
  size: number,
  lineHeight?: number,
): TextStyle => ({
  fontFamily: SANS[weight],
  fontSize: size,
  ...(lineHeight ? { lineHeight: size * lineHeight } : null),
});

export const mono = (weight: Weight, size: number): TextStyle => ({
  fontFamily: MONO[weight],
  fontSize: size,
});

/** Small uppercase mono label ("ON THIS DEVICE", "PLAYING FROM"). */
export const eyebrow = (size = 12): TextStyle => ({
  ...mono(600, size),
  letterSpacing: size * 0.06,
  textTransform: 'uppercase',
});

export const formatTime = (s: number | null | undefined) => {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const sourceLabel: Record<string, string> = {
  // A getter, so it's read in the current language.
  get device() {
    return tr('common.device');
  },
  youtube: 'YouTube',
  jamendo: 'Jamendo',
};
