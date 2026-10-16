/** Texts for the huddle screens, from the room's codes. Same file in both apps. */
import { tr, type Key } from '../i18n';
import { sourceName } from '../sources';
import { tasteMatch, vibeOf, type HuddleChat, type HuddleError, type HuddleLast, type HuddleMember, type HuddleView, type RoomState, type SharedTrack, type VoiceView } from './core';

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
    case 'round':
      return tr('huddle.sysRound', { name, n: m.text });
    case 'game':
      return name ? tr('huddle.sysGame', { name, title: m.text }) : tr('huddle.sysGameNone', { title: m.text });
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

/** "Dreamy vibe", from the song's genre. */
export const vibeText = (t: SharedTrack | null) => tr(`huddle.vibe.${vibeOf(t?.genre)}` as Key);

/** A member's line in the members list: taste match, songs added, reactions. */
/** Talking, Muted or In voice; null when they're not in the call. Talking and Muted are only known from inside the call. */
export function voiceStatus(voice: VoiceView | null, m: HuddleMember): string | null {
  if (voice?.speaking.includes(m.id)) return tr('huddle.talking');
  if (voice?.mutedIds.includes(m.id)) return tr('huddle.muted');
  return m.voice || voice?.ids.includes(m.id) ? tr('huddle.inVoice') : null;
}

/** The header button: "Voice Â· N" when others are already in the call. */
export function joinVoiceText(room: RoomState, you: string | null): string {
  const n = room.members.filter(m => m.voice && m.id !== you).length;
  return n ? tr('huddle.voiceCount', { count: n }) : tr('huddle.joinVoice');
}

/** The voice bar's second line. */
export function callStatus(room: RoomState, you: string | null, voice: VoiceView): string {
  if (!voice.live) return tr('huddle.voiceJoining');
  const talker = room.members.find(m => m.id !== you && voice.speaking.includes(m.id));
  if (talker) return tr(voice.duck ? 'huddle.talkingDucked' : 'huddle.talkingName', { name: talker.name });
  if (voice.muted) return tr('huddle.youMuted');
  return tr(voice.duck ? 'huddle.micDuck' : 'huddle.micFull');
}

export function memberSub(room: RoomState, you: string | null, m: HuddleMember): string {
  const pct = m.id === you ? null : tasteMatch(room, you, m.id);
  const added = room.queue.filter(t => t.by === m.id).length;
  return [
    pct != null && tr('huddle.tasteMatch', { pct }),
    tr('huddle.songsAdded', { count: added }),
    tr('huddle.reactCount', { count: m.reacts }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The line under Guess the song's answers. */
export function gameText(v: HuddleView): string {
  const r = v.room!;
  const g = r.game!;
  const mine = g.by === v.you;
  const total = r.members.filter(m => m.id !== g.by).length;
  const n = g.answered.length;
  const answered = !!v.you && g.answered.includes(v.you);
  if (g.phase === 'ask') {
    if (!g.start) return tr('huddle.gettingReady');
    if (mine) return tr('huddle.waitingGuesses', { n, total });
    return answered ? tr('huddle.lockedIn', { n, total }) : tr('huddle.pickFast');
  }
  if (mine) return g.results.length ? tr('huddle.gotYours', { n: g.results.length, total }) : tr('huddle.nobodyGotYours');
  const me = g.results.find(x => x.who === v.you);
  if (me) return tr(g.results[0].who === v.you ? 'huddle.gotFirst' : 'huddle.niceEar', { pts: me.pts });
  return answered ? tr('huddle.notThisTime') : tr('huddle.timeUp');
}

/** Everything the recap card shows. */
export function recapOf(room: RoomState) {
  const r = room.recap;
  const mins = Math.max(1, Math.round((Date.now() - r.started) / 60000));
  const byKey = new Map(room.queue.map(t => [t.key, t]));
  const played = r.played.map(k => byKey.get(k)).filter((t): t is SharedTrack => !!t);
  const pool = (played.length ? played : room.queue).map(t => t.artwork);
  const covers = pool.length ? [0, 1, 2, 3].map(i => pool[i % pool.length]) : [];
  const top = r.topKey ? byKey.get(r.topKey) ?? null : null;
  const champ = room.scores[0] ?? null;
  const minsText = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
  return {
    covers,
    mins: minsText,
    songs: String(Math.max(1, r.played.length)),
    msgs: String(r.msgs),
    top,
    topSub: top ? tr('huddle.reactCount', { count: r.topN }) : '',
    topEmoji: r.topEmoji ?? '🎶',
    topEmojiSub: r.topEmoji ? `${r.topEmoji}  ${tr('huddle.sentTimes', { count: r.topEmojiN })}` : tr('huddle.noneYet'),
    streak: r.bestStreak ? `${r.bestStreak}×` : '—',
    mvp: r.mvp,
    mvpSub: r.mvp ? tr('huddle.mvpSub', { count: r.mvp.n }) : '',
    champ,
    champSub: champ ? tr('huddle.points', { count: champ.pts }) : '',
    share: tr('huddle.recapShare', { name: room.name, mins: minsText, songs: Math.max(1, r.played.length), msgs: r.msgs, top: top?.title ?? '—' }),
  };
}
