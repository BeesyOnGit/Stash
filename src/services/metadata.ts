/**
 * Official song details (title, artist, album, genre, cover) from free music
 * catalogues — Deezer first (best for French and recent music), then the
 * iTunes Search API — instead of whatever a YouTube video happened to be called.
 *
 * A catalogue result is only used when it's clearly the same song: its title
 * matches ours and its artist appears in what we know. Uploaders often aren't
 * the artist (labels, lyrics channels, "IndilaMusic"), and the artist is often
 * only in the video title, so the artist is looked for in the title and the
 * uploader name together, never trusted from the uploader alone.
 */
import { fold, getJson } from '../sources/http';

export interface SongDetails {
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  /** A large square cover. */
  coverUrl: string | null;
}

interface Candidate extends SongDetails {
  from: 'deezer' | 'itunes';
  /** Deezer album id, for its genre (not in search results). */
  albumId?: number;
}

/** Title without featured artists, versions and brackets: "Namek (feat. Omah Lay)" → "namek". */
export function coreTitle(title: string): string {
  return fold(
    title
      .replace(/[([][^)\]]*[)\]]/g, ' ')
      .replace(/\s[-–—]\s.*(remaster|version|edit|mix|live|remix).*$/i, ' ')
      .replace(/\s(feat|ft|featuring)\.?\s.*$/i, ' '),
  );
}

/** Other recordings of a song: never swapped for the original (or each other). */
const VERSIONS =
  /\b(instrumental|karaoke|cover|remix|live|acoustic|acoustique|sped up|slowed|nightcore|8d|piano version|reverb)\b/g;

/** "instrumental", "slowed reverb"… or "" for the song itself. */
const versionOf = (title: string) =>
  [...new Set(fold(title).match(VERSIONS) ?? [])].sort().join(' ');

const words = (s: string) => fold(s).split(' ').filter(Boolean);
const compact = (s: string) => fold(s).replace(/ /g, '');
const within = (small: string, big: string) =>
  !!small && ` ${big} `.includes(` ${small} `);

/**
 * Whether a catalogue artist is the one we have: its name shows up somewhere in
 * what we know, as words ("lounes matoub" in "matoub lounes aurifur") or glued
 * inside a channel name ("indila" in "indilamusic").
 */
export function artistFits(
  known: { title: string; artist: string | null },
  name: string,
): boolean {
  const knownText = `${known.artist ?? ''} ${known.title}`;
  const knownWords = new Set(words(knownText));
  const artistWords = words(name.split(/,|&| x | feat\.? /i)[0]);
  return (
    artistWords.length > 0 &&
    (artistWords.every(w => knownWords.has(w)) ||
      compact(knownText).includes(artistWords.join('')))
  );
}

/**
 * How well a catalogue result fits the song we have (0 = not the same song).
 * `title` / `artist` are what the source gave: the artist may be the uploader,
 * or missing, and the title may still hold the artist's name.
 */
export function matchScore(
  known: { title: string; artist: string | null },
  cand: { title: string; artist: string },
): number {
  const ours = coreTitle(known.title);
  const theirs = coreTitle(cand.title);
  if (!ours || !theirs) return 0;
  const titleFit =
    ours === theirs
      ? 3
      : within(theirs, ours) // ours has more in it: "pnl a l ammoniaque"
      ? 2
      : within(ours, theirs) && ours.length >= 4
      ? 1
      : 0;
  if (!titleFit) return 0;

  if (!artistFits(known, cand.artist)) return 0;
  if (versionOf(known.title) !== versionOf(cand.title)) return 0;

  const sameArtist = !!known.artist && fold(known.artist) === fold(cand.artist);
  // Their title has more words than ours: only when it's surely the same artist
  // (uploads named "Schubert Ave Maria?" by "Schubert Ave Maria?" are not Schubert).
  if (titleFit === 1 && !sameArtist) return 0;
  return titleFit * 2 + (sameArtist ? 1 : 0);
}

interface DeezerSearch {
  data?: Array<{
    title: string;
    artist: { name: string };
    album: { id: number; title: string; cover_xl?: string; cover_big?: string };
  }>;
}

async function searchDeezer(term: string): Promise<Candidate[]> {
  const res = await getJson<DeezerSearch>(
    `https://api.deezer.com/search?limit=10&q=${encodeURIComponent(term)}`,
    8000,
  );
  return (res.data ?? []).map(r => ({
    from: 'deezer' as const,
    title: r.title,
    artist: r.artist.name,
    album: r.album.title || null,
    albumId: r.album.id,
    genre: null,
    coverUrl: r.album.cover_xl ?? r.album.cover_big ?? null,
  }));
}

interface ItunesSearch {
  results: Array<{
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    primaryGenreName?: string;
    artworkUrl100?: string;
  }>;
}

async function searchItunes(term: string): Promise<Candidate[]> {
  const res = await getJson<ItunesSearch>(
    `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(
      term,
    )}`,
    8000,
  );
  return res.results
    .filter(r => r.trackName && r.artistName)
    .map(r => ({
      from: 'itunes' as const,
      title: r.trackName!,
      artist: r.artistName!,
      album: r.collectionName?.replace(/ - (Single|EP)$/, '') || null,
      genre: r.primaryGenreName ?? null,
      coverUrl: r.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
    }));
}

async function deezerGenre(albumId: number): Promise<string | null> {
  try {
    const res = await getJson<{ genres?: { data?: Array<{ name: string }> } }>(
      `https://api.deezer.com/album/${albumId}`,
      8000,
    );
    return res.genres?.data?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

/** Deezer's genre names, as iTunes spells them, so one genre isn't split in two. */
const DEEZER_TO_ITUNES: Record<string, string> = {
  'Rap/Hip Hop': 'Hip-Hop/Rap',
  'R&B': 'R&B/Soul',
  Soul: 'R&B/Soul',
  'Soul & Funk': 'R&B/Soul',
  Electro: 'Electronic',
  Dance: 'Dance',
  'Musique africaine': 'African',
  'Musique arabe': 'Arabic',
  'Musique asiatique': 'Asian',
  'Musique brésilienne': 'Brazilian',
  'Musique indienne': 'Indian',
  'Films/Jeux vidéo': 'Soundtrack',
  'Films/Games': 'Soundtrack',
  Classical: 'Classical',
  Jazz: 'Jazz',
  'Latin Music': 'Latin',
  'Musique latine': 'Latin',
  'Variété Internationale': 'Pop',
  'Chanson française': 'French Pop',
};

const itunesGenreName = (g: string | null) =>
  g ? DEEZER_TO_ITUNES[g] ?? g : null;

const quiet = (p: Promise<Candidate[]>) => p.catch(() => [] as Candidate[]);

/** Picks the nicer of two spellings of the same name ("kamel raiah" → "Kamel Raiah"). */
function bestCase(name: string, others: Array<string | null | undefined>) {
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return (
    others.find(
      o =>
        o &&
        fold(o) === fold(name) &&
        o !== o.toLowerCase() &&
        o !== o.toUpperCase(),
    ) ?? name
  );
}

/**
 * The official details of a song, or null when no catalogue has a result we're
 * sure about (the song then keeps the details it has).
 */
/**
 * Bump when the lookup gets better: songs checked with an older one are looked up again.
 */
export const LOOKUP_REVISION = 3;

/**
 * What to type in a catalogue's search box: the title up to the first bracket,
 * "~", "|", "•" or emoji ("Stromae Papaoutai~أبي أين أنت؟~ Paroles 🎵…" → "Stromae
 * Papaoutai"). The whole title stays for matching.
 */
export function searchTitle(title: string): string {
  const cut = title.split(
    /[([{~|•【「]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u,
  )[0];
  const t = cut
    .replace(/\s[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || title;
}

export async function lookupSong(
  title: string,
  artist: string | null,
): Promise<SongDetails | null> {
  const short = searchTitle(title);
  const terms = [artist ? `${artist} ${short}` : null, short].filter(
    (x, i, all): x is string => !!x && all.indexOf(x) === i,
  );
  const found: Candidate[] = [];
  for (const term of terms) {
    const [dz, it] = await Promise.all([
      quiet(searchDeezer(term)),
      quiet(searchItunes(term)),
    ]);
    found.push(...dz, ...it);
    // Searched with the artist and found an exact match: no need to try the title alone.
    if (found.some(c => matchScore({ title, artist }, c) >= 6)) break;
  }

  const scored = found
    .map(c => ({ c, score: matchScore({ title, artist }, c) }))
    .filter(x => x.score > 0)
    // Best fit first; then the plainest title (not the "Radio Edit"); then
    // Deezer, which knows French and recent music better.
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.c.title.length - b.c.title.length ||
        (a.c.from === 'deezer' ? -1 : 0) - (b.c.from === 'deezer' ? -1 : 0),
    );
  const best = scored[0]?.c;
  if (!best) return null;

  // The same song in the other catalogue fills in what the best one lacks.
  const twin = scored.find(
    x =>
      x.c.from !== best.from &&
      coreTitle(x.c.title) === coreTitle(best.title) &&
      fold(x.c.artist) === fold(best.artist),
  )?.c;
  // iTunes' genre names first: they're what the library already uses.
  const genre =
    (best.from === 'itunes' ? best.genre : twin?.genre) ??
    (best.albumId ? itunesGenreName(await deezerGenre(best.albumId)) : null);

  return {
    title: bestCase(best.title, [twin?.title, title]),
    artist: bestCase(best.artist, [twin?.artist, artist]),
    album: best.album ?? twin?.album ?? null,
    genre,
    coverUrl: best.coverUrl ?? twin?.coverUrl ?? null,
  };
}

interface DeezerArtists {
  data?: Array<{ name: string; picture_xl?: string; picture_big?: string }>;
}

/**
 * The artist's official picture, for a song no catalogue has: better than a
 * video frame. Only when the artist is clearly the one in the title or uploader.
 */
export async function lookupArtistPicture(
  title: string,
  artist: string | null,
): Promise<string | null> {
  const terms = [artist, title.split(/\s[-–—]\s/)[0]].filter(
    (x, i, all): x is string => !!x && all.indexOf(x) === i,
  );
  for (const term of terms) {
    try {
      const res = await getJson<DeezerArtists>(
        `https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(
          term,
        )}`,
        8000,
      );
      const hit = (res.data ?? []).find(a =>
        artistFits({ title, artist }, a.name),
      );
      const url = hit?.picture_xl ?? hit?.picture_big;
      // Deezer's stand-in for artists without a photo is a grey silhouette.
      if (url && !/\/artist\/\/|images\/artist\/\//.test(url)) return url;
    } catch {}
  }
  return null;
}
