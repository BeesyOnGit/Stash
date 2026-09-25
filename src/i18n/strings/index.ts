import type { Entry, Lang } from '../types';
import common from './common';
import library from './library';
import player from './player';
import settings from './settings';
import sheets from './sheets';
import stats from './stats';
import system from './system';

const PARTS = [common, settings, player, sheets, library, stats, system];

export type Key =
  | keyof typeof common.en
  | keyof typeof settings.en
  | keyof typeof player.en
  | keyof typeof sheets.en
  | keyof typeof library.en
  | keyof typeof stats.en
  | keyof typeof system.en;

const LANGS: Lang[] = ['en', 'fr', 'ar', 'es', 'de'];

export const STRINGS = Object.fromEntries(
  LANGS.map(l => [l, Object.assign({}, ...PARTS.map(p => p[l]))]),
) as Record<Lang, Record<Key, Entry>>;
