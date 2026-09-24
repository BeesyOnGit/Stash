import { cleanVideoTitle, splitArtistTitle } from '../src/sources/http';

describe('video title parsing', () => {
  test('strips "(Official Video)" style suffixes', () => {
    expect(cleanVideoTitle('Daft Punk - One More Time (Official Video)')).toBe(
      'Daft Punk - One More Time',
    );
    expect(cleanVideoTitle('Song [Lyrics] (HD)')).toBe('Song');
  });

  test('splits "Artist - Title"', () => {
    expect(
      splitArtistTitle(
        'Stromae - Alors on danse (Official Music Video)',
        'StromaeVEVO',
      ),
    ).toEqual({
      artist: 'Stromae',
      title: 'Alors on danse',
    });
  });

  test('falls back to the channel name, without "- Topic" / VEVO', () => {
    expect(splitArtistTitle('Around the World', 'Daft Punk - Topic')).toEqual({
      artist: 'Daft Punk',
      title: 'Around the World',
    });
  });
});
