jest.mock('../src/db/database', () => ({
  getLyricsRow: jest.fn(async () => null),
  saveLyricsRow: jest.fn(async () => {}),
}));
jest.mock('react-native-blob-util', () => ({ fs: {} }));
jest.mock('../src/sources/innertube', () => ({
  innertubeFindVideo: jest.fn(async () => null),
  innertubeLyrics: jest.fn(async () => null),
}));
jest.mock('../src/services/network', () => ({ isOnline: () => true }));

import { parseLrc } from '../src/services/lyrics';

describe('timed lyrics (LRC)', () => {
  test('reads [mm:ss.xx] lines in order and skips tags', () => {
    const lines = parseLrc(
      '[ar:Stromae]\n[00:12.50] Dites-moi\n[00:05.00]Intro\n[01:02.123] Fin\n',
    );
    expect(lines).toEqual([
      { time: 5, text: 'Intro' },
      { time: 12.5, text: 'Dites-moi' },
      { time: 62.123, text: 'Fin' },
    ]);
  });

  test('a line with several timestamps is repeated at each', () => {
    expect(parseLrc('[00:10.00][00:40.00] Chorus')).toEqual([
      { time: 10, text: 'Chorus' },
      { time: 40, text: 'Chorus' },
    ]);
  });

  test('empty timed lines are kept (instrumental breaks)', () => {
    expect(parseLrc('[00:30.00]')).toEqual([{ time: 30, text: '' }]);
  });
});
