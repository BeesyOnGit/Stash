import type { ListenRow } from '../src/db/database';
import { setLanguagePref, tr } from '../src/i18n';
import { computeStats, formatListened, streakOf } from '../src/services/stats';

const now = new Date(2026, 8, 25, 18, 0); // 25 Sep 2026, 18:00

const row = (p: Partial<ListenRow>): ListenRow => ({
  trackId: 'a',
  day: '2026-09-25',
  hour: 20,
  seconds: 0,
  plays: 0,
  title: 'Song A',
  artist: 'PNL',
  genre: 'Hip-Hop/Rap',
  ...p,
});

describe('listening stats', () => {
  // The expectations below are in English, whatever the machine's locale.
  beforeAll(() => setLanguagePref('en'));

  test('streak counts days in a row up to today, or yesterday', () => {
    expect(streakOf(['2026-09-23', '2026-09-24', '2026-09-25'], now)).toBe(3);
    expect(streakOf(['2026-09-23', '2026-09-24'], now)).toBe(2);
    expect(streakOf(['2026-09-20', '2026-09-24'], now)).toBe(1);
    expect(streakOf([], now)).toBe(0);
  });

  test('totals, top songs and artists, the busiest hour', () => {
    const rows = [
      row({ trackId: 'a', seconds: 600, plays: 3, hour: 22 }),
      row({
        trackId: 'b',
        title: 'Song B',
        artist: 'Booba',
        seconds: 200,
        plays: 1,
        hour: 9,
      }),
      row({
        trackId: 'c',
        title: 'Song C',
        artist: 'pnl',
        seconds: 100,
        plays: 1,
        hour: 22,
        day: '2026-09-24',
      }),
    ];
    const s = computeStats('week', rows, ['2026-09-24', '2026-09-25'], [], now);
    expect(s.seconds).toBe(900);
    expect(s.plays).toBe(5);
    expect(s.songs).toBe(3);
    expect(s.activeDays).toBe(2);
    expect(s.topHour).toBe(22);
    expect(s.topSongs.map(x => x.key)).toEqual(['a', 'b', 'c']);
    // "PNL" and "pnl" are the same artist.
    expect(s.topArtists[0]).toMatchObject({
      label: 'PNL',
      seconds: 700,
      plays: 4,
    });
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets[6]).toEqual({ key: '2026-09-25', seconds: 800 });
    expect(s.buckets[5]).toEqual({ key: '2026-09-24', seconds: 100 });
  });

  test('all time is shown by month', () => {
    const s = computeStats(
      'all',
      [row({ seconds: 60 }), row({ day: '2026-07-02', seconds: 120 })],
      ['2026-07-02', '2026-09-25'],
      [],
      now,
    );
    expect(s.buckets).toHaveLength(12);
    expect(s.buckets[11]).toEqual({ key: '2026-09', seconds: 60 });
    expect(s.buckets[9]).toEqual({ key: '2026-07', seconds: 120 });
  });

  test('time formats', () => {
    expect(formatListened(40)).toBe('40 s');
    expect(formatListened(45 * 60)).toBe('45 min');
    expect(formatListened(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
    expect(formatListened(2 * 3600)).toBe('2 h');
  });

  test('time formats and plurals follow the app language', () => {
    try {
      setLanguagePref('fr');
      expect(formatListened(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
      expect(tr('stats.plays', { count: 0 })).toBe('0 écoute');
      expect(tr('stats.plays', { count: 4 })).toBe('4 écoutes');
      setLanguagePref('de');
      expect(formatListened(3 * 3600 + 12 * 60)).toBe('3 Std. 12 Min.');
      setLanguagePref('ar');
      expect(formatListened(45 * 60)).toBe('45 د');
      expect(tr('stats.days', { count: 2 })).toBe('يومان');
      expect(tr('stats.days', { count: 5 })).toBe('5 أيام');
      expect(tr('stats.days', { count: 14 })).toBe('14 يومًا');
    } finally {
      setLanguagePref('en');
    }
    expect(formatListened(40)).toBe('40 s');
  });
});
