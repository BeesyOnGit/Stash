/**
 * Design tokens from "Music App Desktop v2": light/dark themes as CSS
 * variables, the per-song palette (from the cover's colours when they can be
 * read, else from a hue of the title) and genre colours.
 */
import { useSyncExternalStore } from 'react';
import { tr } from './i18n';

export interface ThemeTokens {
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
    bg: '#F7F6F3',
    card: '#fff',
    ink: '#16161A',
    onInk: '#fff',
    ink2: '#3A3940',
    muted: '#6B6A70',
    muted2: '#8B8A90',
    fill: 'rgba(0,0,0,.035)',
    fill2: 'rgba(0,0,0,.05)',
    fill3: '#E4E2DD',
    line: 'rgba(0,0,0,.07)',
    line2: 'rgba(0,0,0,.14)',
    bar: 'rgba(247,246,243,.96)',
    accentInk: '#C2421F',
    accentSoft: 'oklch(0.94 0.04 35)',
    accentSoft2: 'oklch(0.92 0.04 35)',
    danger: '#B42318',
    glass: 'rgba(255,255,255,.6)',
  },
  dark: {
    bg: '#111113',
    card: '#1C1C20',
    ink: '#F2F1EE',
    onInk: '#141416',
    ink2: '#C9C8CE',
    muted: '#A2A1A9',
    muted2: '#8A8991',
    fill: 'rgba(255,255,255,.05)',
    fill2: 'rgba(255,255,255,.07)',
    fill3: '#2A2A2F',
    line: 'rgba(255,255,255,.08)',
    line2: 'rgba(255,255,255,.18)',
    bar: 'rgba(17,17,19,.94)',
    accentInk: '#FF8A65',
    accentSoft: 'oklch(0.32 0.08 35)',
    accentSoft2: 'oklch(0.3 0.05 35)',
    danger: '#FF6B5E',
    glass: 'rgba(255,255,255,.12)',
  },
};

export const ACCENT = '#E0532F';
export const GREEN = 'oklch(0.58 0.13 155)';
export const GREEN_LIGHT = 'oklch(0.78 0.14 155)';

/** Applies a theme's tokens to the page (CSS variables used by every style). */
export function applyTheme(dark: boolean) {
  const t = dark ? THEMES.dark : THEMES.light;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t)) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.theme = dark ? 'dark' : 'light';
}

// ---- per-song palette ----

/** Stable hue for a song, so its colours are the same everywhere and every time. */
export function hueOf(str: string): number {
  let h = 7;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h =
      mx === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** Cover colours read so far, by image URL: [hue, saturation, lightness]. */
const colors = new Map<string, [number, number, number]>();
const pending = new Set<string>();
const colorListeners = new Set<() => void>();
let colorVersion = 0;

/** Reads the cover's main colour (vivid, mid-light pixels count most), once per image. */
export function extractColor(url: string | null | undefined) {
  if (!url || colors.has(url) || pending.has(url)) return;
  pending.add(url);
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const x = c.getContext('2d')!;
      x.drawImage(im, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const wt = 0.05 + (s / 100) * Math.max(0, 1 - Math.abs(l - 50) / 45);
        r += d[i] * wt;
        g += d[i + 1] * wt;
        b += d[i + 2] * wt;
        w += wt;
      }
      colors.set(url, rgbToHsl(r / w, g / w, b / w));
      colorVersion++;
      colorListeners.forEach(fn => fn());
    } catch {
      // A cover served without CORS: the title's hue is used instead.
    }
  };
  im.src = url;
}

/** Re-renders when a cover's colour has been read. */
export const useCoverColors = () =>
  useSyncExternalStore(
    fn => {
      colorListeners.add(fn);
      return () => {
        colorListeners.delete(fn);
      };
    },
    () => colorVersion,
  );

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
}

export function paletteFor(
  t: { title: string; artist: string | null },
  cover?: string | null,
): Palette {
  const c = cover ? colors.get(cover) : undefined;
  if (cover && !c) extractColor(cover);
  const h = c ? c[0] : hueOf(t.title + (t.artist ?? ''));
  const s = Math.max(22, Math.min(72, c ? c[1] + 10 : 45));
  return {
    h,
    s,
    deep: `hsl(${h} ${s}% 12%)`,
    deep2: `hsl(${h} ${s}% 26%)`,
    glow: `hsl(${h} ${Math.max(s, 60)}% 50%)`,
    accent: `hsl(${h} ${Math.max(s, 60)}% 72%)`,
    soft: `hsl(${h} ${Math.min(s, 55)}% 91%)`,
    soft2: `hsl(${h} ${Math.min(s, 55)}% 82%)`,
    softInk: `hsl(${h} ${Math.min(s, 50)}% 20%)`,
    artBg: `hsl(${h} ${s}% 78%)`,
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
    ? { bg: `oklch(0.3 0.07 ${h})`, ink: `oklch(0.93 0.04 ${h})`, h }
    : { bg: `oklch(0.9 0.06 ${h})`, ink: `oklch(0.3 0.08 ${h})`, h };
}

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
