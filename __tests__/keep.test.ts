jest.mock('react-native-blob-util', () => ({
  fs: { dirs: { LegacyMusicDir: '/music', DocumentDir: '/docs' } },
}));
jest.mock('../src/db/database', () => ({}));

import { parseKeptFileName } from '../src/services/keep';

describe('downloads kept in Music/stash', () => {
  test('the download file name tells which song it is', () => {
    expect(parseKeptFileName('youtube_dQw4w9WgXcQ.m4a')).toEqual({
      source: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
    });
    expect(parseKeptFileName('youtube_ab-cd_EF.mp3')).toEqual({
      source: 'youtube',
      sourceId: 'ab-cd_EF',
    });
    expect(parseKeptFileName('jamendo_12345.mp3')).toEqual({
      source: 'jamendo',
      sourceId: '12345',
    });
  });

  test('other music files are not taken for kept downloads', () => {
    expect(parseKeptFileName('Idir - A vava inouva.mp3')).toBeNull();
    expect(parseKeptFileName('device_song.mp3')).toBeNull();
  });
});
