import { useSyncExternalStore } from 'react';
import { getSettingSync, setSettingSync } from '../db/database';
import {
  currentLanguage,
  setLanguagePref,
  type LanguagePref,
} from '../i18n';

/** `device`: straight from the phone (youtubei.js); otherwise via a front-end API instance. */
export type YoutubeBackend = 'device' | 'piped' | 'invidious';

export interface Settings {
  /** Bumped when a default changes and saved settings must be migrated. */
  version: number;
  /** How YouTube is searched and streamed. */
  youtubeBackend: YoutubeBackend;
  /** Base URL of the Piped API or Invidious instance (self-hosting is the most reliable). */
  youtubeInstance: string;
  /** Free key from https://devportal.jamendo.com — leave empty to disable Jamendo. */
  jamendoClientId: string;
  /** Look up songs' official details and covers (services/metadata). */
  fetchCoverArt: boolean;
  /** Keep songs found online after the first play. */
  saveWhileStreaming: boolean;
  /** Space the app may use for downloaded music. */
  storageLimitGB: number;
  theme: 'light' | 'dark';
  /** Full-screen player: dark tinted ("deep") or pastel ("light"). */
  playerStyle: 'deep' | 'light';
  /** How the player animates from one song to the next. */
  songChange: SongChange;
  /** Android: the screen doesn't turn off while the full player is open. */
  keepScreenOn: boolean;
  /** Playback speed for everything you play (pitch stays the same). */
  playbackSpeed: number;
  /** Android: seconds each song fades into the next (0 = off: back to back, no gap). */
  crossfadeSeconds: number;
  /** Adds a Similar button to the player (and "For you" in the car). */
  suggestSimilar: boolean;
  /** Android: a floating bubble over other apps while stash plays in the background. */
  floatingBubble: boolean;
  /** Colour of the bubble's progress ring ("cover" follows the song's colours). */
  bubbleRingColor: RingColor;
  /** Full-screen player: the cover on a record, or the plain square cover. */
  playerArt: 'vinyl' | 'cover';
  /** Spin the record while playing (player and bubble). */
  rotateArt: boolean;
  /** How the record looks in the player and the bubble. */
  vinylStyle: VinylStyle;
  /** Android: a light buzz when pressing buttons. */
  haptics: boolean;
  /** How strong the haptics are ("light" is the phone's own touch feedback). */
  hapticStrength: HapticStrength;
  /** App language; "system" follows the phone (English if we don't have it). */
  language: LanguagePref;
}

export type HapticStrength = 'light' | 'medium' | 'strong';

/**
 * - `slide`: the page swipes toward the next / previous song
 * - `fade`: the old song fades out, then the new one fades in
 * - `zoom`: the old song shrinks away, the new one settles in
 * - `flip`: cover, title and waveform flip over like a card
 */
export type SongChange = 'slide' | 'fade' | 'zoom' | 'flip';

export type RingColor = 'white' | 'orange' | 'cover' | 'green' | 'blue';
export type VinylStyle = 'classic' | 'colour' | 'picture' | 'clear';

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** "1.25×", with a decimal comma where the language uses one ("1,25×"). */
export const speedLabel = (v: number) =>
  `${currentLanguage() === 'en' ? v : String(v).replace('.', ',')}×`;

export const CROSSFADES = [0, 2, 4, 6, 8, 12];

const VERSION = 2;

const DEFAULTS: Settings = {
  version: VERSION,
  youtubeBackend: 'device',
  youtubeInstance: '',
  jamendoClientId: '',
  fetchCoverArt: true,
  saveWhileStreaming: true,
  storageLimitGB: 8,
  theme: 'light',
  playerStyle: 'deep',
  songChange: 'slide',
  keepScreenOn: true,
  playbackSpeed: 1,
  crossfadeSeconds: 0,
  suggestSimilar: true,
  floatingBubble: false,
  bubbleRingColor: 'white',
  playerArt: 'vinyl',
  rotateArt: true,
  vinylStyle: 'classic',
  haptics: true,
  hapticStrength: 'medium',
  language: 'system',
};

let cache: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (!cache) {
    const raw = getSettingSync('app');
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    cache = { ...DEFAULTS, ...saved };
    if ((saved.version ?? 1) < 2) {
      // v2: public Piped/Invidious instances stopped serving audio; use the phone directly.
      cache.youtubeBackend = 'device';
    }
    cache.version = VERSION;
    setLanguagePref(cache.language);
  }
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  if (cache.youtubeInstance) {
    cache.youtubeInstance = cache.youtubeInstance.trim().replace(/\/+$/, '');
  }
  setSettingSync('app', JSON.stringify(cache));
  setLanguagePref(cache.language);
  listeners.forEach(fn => fn());
  return cache;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const subscribeSettings = subscribe;

/** Settings as React state: components re-render when any setting changes. */
export const useSettings = () => useSyncExternalStore(subscribe, getSettings);
