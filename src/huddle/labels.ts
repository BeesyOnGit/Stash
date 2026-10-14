/** Texts for the huddle screens, from the room's codes. Same file in both apps. */
import { tr } from '../i18n';
import { sourceName } from '../sources';
import type { HuddleChat, HuddleError, HuddleLast, HuddleView, SharedTrack } from './core';

export const ago = (at: number) => {
  const m = Math.floor((Date.now() - at) / 60000);
  return m < 1 ? tr('huddle.now') : tr('huddle.minAgo', { count: m });
};

export function chatText(m: HuddleChat): string {
  const name = m.name;
  switch (m.kind) {
    case 'start':
      return tr('huddle.sysStart', { name, code: m.text });
    case 'join':
      return tr('huddle.sysJoin', { name });
    case 'leave':
      return tr('huddle.sysLeave', { name });
    case 'add':
      return tr('huddle.sysAdd', { name, title: m.text });
    case 'move':
      return tr('huddle.sysMove', { name, title: m.text });
    case 'emos':
      return tr('huddle.sysEmos', { name, emojis: m.text });
    default:
      return m.text;
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function lastText(l: HuddleLast): string {
  const name = l.name;
  const text = {
    played: () => tr('huddle.actPlayed', { name, arg: l.arg }),
    paused: () => tr('huddle.actPaused', { name }),
    resumed: () => tr('huddle.actResumed', { name }),
    skipped: () => tr('huddle.actSkipped', { name }),
    back: () => tr('huddle.actBack', { name }),
    seek: () => tr('huddle.actSeek', { name, arg: mmss(Number(l.arg) || 0) }),
  }[l.action]();
  return `${text} · ${ago(l.at)}`;
}

/** Where a shared song comes from: "YouTube". */
export const sourceText = (t: SharedTrack) => sourceName(t.source);

export function errorText(e: HuddleError): string {
  return {
    not_found: () => tr('huddle.errNotFound'),
    full: () => tr('huddle.errFull'),
    unreachable: () => tr('huddle.errUnreachable'),
  }[e]();
}

/** What's holding the music up, if anything (for the pill under the controls). */
export function statusText(v: HuddleView): string | null {
  const r = v.room;
  if (!r) return null;
  if (v.status === 'reconnecting') return tr('huddle.reconnecting');
  const cur = r.queue[r.index];
  if (!cur) return tr('huddle.empty');
  const mine = v.cache[cur.key];
  if (mine === 'failed') return tr('huddle.couldntGet');
  if (typeof mine === 'number') return tr('huddle.getting', { pct: Math.round(mine * 100) });
  if (r.pending) {
    const names = r.members.filter(m => !m.ready && m.id !== v.you).map(m => m.name);
    if (names.length) return tr('huddle.waitingFor', { names: names.join(', ') });
  }
  return null;
}
