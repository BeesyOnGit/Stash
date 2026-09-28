export type Lang = 'en' | 'fr' | 'ar' | 'es' | 'de';

/**
 * A text that changes with a number (`{count}`). English, Spanish and German
 * use one/other, French one (0 and 1)/other; Arabic uses all six.
 */
export interface Plural {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Entry = string | Plural;

/** Same keys as English; a plural in English is a plural everywhere. */
export type Translation<E> = {
  [K in keyof E]: E[K] extends string ? string : Plural;
};

/**
 * One part of the app's strings, in every language. English sets the keys;
 * a missing or extra key in another language is a type error.
 */
export function defineStrings<E extends Record<string, Entry>>(s: {
  en: E;
  fr: NoInfer<Translation<E>>;
  ar: NoInfer<Translation<E>>;
  es: NoInfer<Translation<E>>;
  de: NoInfer<Translation<E>>;
}) {
  return s;
}
