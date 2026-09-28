/**
 * Translations, shared with the phone app (./strings), plus the desktop's own
 * texts (./strings/desktop). The app speaks the computer's language when it's
 * one of ours (English, French, Arabic, Spanish, German), else English;
 * Settings → Language can pick one instead.
 *
 * - `tr('settings.title')` returns the text in the current language.
 * - `{name}` placeholders are filled from params: `tr('x', { name })`.
 * - Plural entries pick their form from `params.count`.
 *
 * Arabic lays the window out right to left. Like on the phone, the direction
 * changes on the next start (Settings offers to restart).
 */
import { useSyncExternalStore } from 'react';
import { STRINGS, type Key } from './strings';
import type { Entry, Lang, Plural } from './types';

export type { Lang, Key };
export type LanguagePref = 'system' | Lang;

/** Each language written in itself, for the language picker. */
export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
];

const SUPPORTED = new Set<string>(LANGUAGES.map(l => l.code));

/** "fr-FR", "ar_DZ", "de" → the language, or null. */
function parseLocale(id: unknown): string | null {
  if (typeof id !== 'string' || !id) return null;
  return id.split(/[-_]/)[0].toLowerCase();
}

/** The computer's language, if we have it; English otherwise. */
export function deviceLanguage(): Lang {
  const candidates = [...(navigator.languages ?? []), navigator.language];
  for (const c of candidates) {
    const l = parseLocale(c);
    if (l && SUPPORTED.has(l)) return l as Lang;
  }
  return 'en';
}

let pref: LanguagePref = 'system';
let lang: Lang | null = null;
const listeners = new Set<() => void>();

/** Called by services/settings when the Language setting is read or changed. */
export function setLanguagePref(next: LanguagePref | undefined) {
  pref = next && (next === 'system' || SUPPORTED.has(next)) ? next : 'system';
  const resolved = pref === 'system' ? deviceLanguage() : pref;
  if (resolved === lang) return;
  lang = resolved;
  listeners.forEach(fn => fn());
}

export function currentLanguage(): Lang {
  if (!lang) lang = pref === 'system' ? deviceLanguage() : pref;
  return lang;
}

export const isRTLLanguage = (l: Lang) => l === 'ar';

/** The layout direction the window started with (it changes on restart). */
let startDirection: 'rtl' | 'ltr' | null = null;
export function layoutDirection(): 'rtl' | 'ltr' {
  if (!startDirection) {
    startDirection = isRTLLanguage(currentLanguage()) ? 'rtl' : 'ltr';
  }
  return startDirection;
}

/** True when the language now wants the other direction (a restart applies it). */
export const directionPending = () =>
  (isRTLLanguage(currentLanguage()) ? 'rtl' : 'ltr') !== layoutDirection();

export function onLanguageChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current language as React state (the app root re-renders on change). */
export const useLanguage = () =>
  useSyncExternalStore(onLanguageChange, currentLanguage);

/** CLDR plural category for a count (only the forms our languages use). */
export function pluralForm(l: Lang, n: number): keyof Plural {
  const i = Math.abs(n);
  switch (l) {
    case 'fr':
      return i < 2 ? 'one' : 'other';
    case 'ar': {
      if (i === 0) return 'zero';
      if (i === 1) return 'one';
      if (i === 2) return 'two';
      const r = i % 100;
      if (Number.isInteger(i) && r >= 3 && r <= 10) return 'few';
      if (Number.isInteger(i) && r >= 11 && r <= 99) return 'many';
      return 'other';
    }
    default:
      return i === 1 ? 'one' : 'other';
  }
}

type Params = Record<string, string | number>;

function resolve(entry: Entry, l: Lang, params?: Params): string {
  if (typeof entry === 'string') return entry;
  const n = Number(params?.count ?? 0);
  return entry[pluralForm(l, n)] ?? entry.other;
}

/** The text for `key` in the current language, with `{placeholders}` filled in. */
export function tr(key: Key, params?: Params): string {
  const l = currentLanguage();
  const entry = STRINGS[l][key] ?? STRINGS.en[key];
  if (entry === undefined) return key;
  const text = resolve(entry, l, params);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] !== undefined ? String(params[name]) : m,
  );
}
