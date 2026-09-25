import { pluralForm, setLanguagePref, tr } from '../src/i18n';
import { STRINGS } from '../src/i18n/strings';
import type { Entry, Lang } from '../src/i18n/types';

const LANGS: Lang[] = ['en', 'fr', 'ar', 'es', 'de'];

/** Every text of an entry (each plural form). */
const texts = (e: Entry) => (typeof e === 'string' ? [e] : Object.values(e));
const placeholders = (e: Entry) =>
  new Set(texts(e).flatMap(s => (s ?? '').match(/\{\w+\}/g) ?? []));

afterEach(() => setLanguagePref('en'));

describe('translations', () => {
  test('every language has exactly the English keys', () => {
    const keys = Object.keys(STRINGS.en).sort();
    for (const l of LANGS) expect(Object.keys(STRINGS[l]).sort()).toEqual(keys);
  });

  test('no empty texts, and the same {placeholders} as English', () => {
    for (const l of LANGS) {
      for (const [key, entry] of Object.entries(STRINGS[l])) {
        for (const s of texts(entry)) {
          if (!s?.trim()) throw new Error(`${l} ${key} is empty`);
        }
        const en = placeholders(STRINGS.en[key as keyof typeof STRINGS.en]);
        // A plural form may spell the number out ("أغنيتان"), so {count} is optional there.
        en.delete('{count}');
        const own = placeholders(entry);
        for (const p of en) {
          if (!own.has(p)) throw new Error(`${l} ${key} is missing ${p}`);
        }
      }
    }
  });

  test('Arabic plurals give all six forms', () => {
    for (const [key, entry] of Object.entries(STRINGS.ar)) {
      if (typeof entry === 'string') continue;
      for (const form of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        if (!(form in entry)) throw new Error(`ar ${key} has no ${form}`);
      }
    }
  });

  test('plural forms per language', () => {
    expect(pluralForm('en', 0)).toBe('other');
    expect(pluralForm('en', 1)).toBe('one');
    expect(pluralForm('fr', 0)).toBe('one');
    expect(pluralForm('fr', 2)).toBe('other');
    expect([0, 1, 2, 3, 10, 11, 99, 100, 103].map(n => pluralForm('ar', n))).toEqual(
      ['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'few'],
    );
  });

  test('picks the language and fills placeholders', () => {
    setLanguagePref('en');
    expect(tr('common.songs', { count: 1 })).toBe('1 song');
    expect(tr('common.songs', { count: 3 })).toBe('3 songs');
    expect(tr('system.downloadSaved', { title: 'X' })).toBe(
      '“X” saved — plays offline now',
    );
    setLanguagePref('fr');
    expect(tr('common.songs', { count: 0 })).toBe('0 titre');
    setLanguagePref('ar');
    expect(tr('common.songs', { count: 2 })).toBe('أغنيتان');
    expect(tr('common.songs', { count: 5 })).toBe('5 أغانٍ');
    setLanguagePref('de');
    expect(tr('common.cancel')).toBe('Abbrechen');
  });
});
