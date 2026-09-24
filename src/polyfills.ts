/**
 * Web APIs that youtubei.js expects and React Native/Hermes doesn't fully provide.
 * Imported first thing in index.js.
 */
import 'react-native-url-polyfill/auto'; // full URL + URLSearchParams (searchParams.set…)
import 'fast-text-encoding'; // TextDecoder
import 'event-target-polyfill'; // EventTarget / Event

const g = globalThis as any;

if (typeof g.CustomEvent !== 'function') {
  g.CustomEvent = class CustomEvent<T = unknown> extends g.Event {
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      super(type, init);
      this.detail = init?.detail as T;
    }
  };
}

// Only used for request ids / session UUIDs, not for anything security sensitive.
g.crypto = g.crypto ?? {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = <T extends ArrayBufferView>(arr: T): T => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  };
}
if (typeof g.crypto.randomUUID !== 'function') {
  g.crypto.randomUUID = () =>
    '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) =>
      (
        Number(c) ^
        (g.crypto.getRandomValues(new Uint8Array(1))[0] &
          (15 >> (Number(c) / 4)))
      ).toString(16),
    );
}
// meriyah (the JS parser youtubei.js uses on YouTube's player) clones plain AST nodes.
if (typeof g.structuredClone !== 'function') {
  const clone = (v: any, seen: Map<any, any>): any => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (ArrayBuffer.isView(v)) return (v as any).slice();
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (v instanceof Map) {
      const m = new Map();
      seen.set(v, m);
      v.forEach((val, key) => m.set(clone(key, seen), clone(val, seen)));
      return m;
    }
    if (v instanceof Set) {
      const s = new Set();
      seen.set(v, s);
      v.forEach(val => s.add(clone(val, seen)));
      return s;
    }
    const out: any = Array.isArray(v) ? [] : {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = clone(v[k], seen);
    return out;
  };
  g.structuredClone = (v: unknown) => clone(v, new Map());
}

g.window = g.window ?? g;
