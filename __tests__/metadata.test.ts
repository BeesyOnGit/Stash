import { coreTitle, matchScore } from '../src/services/metadata';

describe('matching catalogue results to songs', () => {
  test('same song, same artist', () => {
    expect(
      matchScore(
        { title: 'Ajthets Adyaskar', artist: 'Kamel Raiah' },
        { title: 'Ajthets Adyaskar', artist: 'kamel raiah' },
      ),
    ).toBeGreaterThan(0);
  });

  test('rejects a same-titled song by someone else', () => {
    expect(
      matchScore(
        { title: 'Petite fille', artist: 'Booba' },
        { title: 'Petite fille', artist: 'Les Wampas' },
      ),
    ).toBe(0);
  });

  test('uploader that is not the artist: the artist is found in the channel name', () => {
    expect(
      matchScore(
        { title: 'Ainsi Bas La Vida', artist: 'IndilaMusic' },
        { title: 'Ainsi bas la vida', artist: 'Indila' },
      ),
    ).toBeGreaterThan(0);
  });

  test('artist only in the video title, uploader unrelated', () => {
    expect(
      matchScore(
        { title: "PNL A l'ammoniaque", artist: 'Some Lyrics Channel' },
        { title: "A l'Ammoniaque", artist: 'PNL' },
      ),
    ).toBeGreaterThan(0);
  });

  test('accents and word order in names', () => {
    expect(
      matchScore(
        { title: 'Aurifur', artist: 'Matoub Lounes' },
        { title: 'Aurifur', artist: 'Lounès Matoub' },
      ),
    ).toBeGreaterThan(0);
  });

  test('featured artists and versions are ignored in titles', () => {
    expect(coreTitle('Namek (feat. Omah Lay)')).toBe('namek');
    expect(coreTitle('One More Time - Remastered 2021')).toBe('one more time');
    expect(
      matchScore(
        { title: 'Namek (feat. Omah Lay)', artist: 'JuL' },
        { title: 'Namek', artist: 'Jul' },
      ),
    ).toBeGreaterThan(0);
  });

  test('a short title is not matched inside a longer one', () => {
    expect(
      matchScore(
        { title: 'DA', artist: 'PNL' },
        { title: 'Da Da Da', artist: 'PNL' },
      ),
    ).toBe(0);
  });

  test('an exact title with the same artist beats a partial one', () => {
    const known = { title: 'Bené', artist: 'PNL' };
    expect(matchScore(known, { title: 'Bené', artist: 'PNL' })).toBeGreaterThan(
      matchScore(known, { title: 'Bené (Remix)', artist: 'PNL' }) - 1,
    );
  });

  test('an instrumental or remix is not the original', () => {
    expect(
      matchScore(
        {
          title: 'Dernière Danse - Indila (Instrumental)',
          artist: 'in my space',
        },
        { title: 'Dernière danse', artist: 'Indila' },
      ),
    ).toBe(0);
    expect(
      matchScore(
        { title: 'Bené', artist: 'PNL' },
        { title: 'Bené (Remix)', artist: 'PNL' },
      ),
    ).toBe(0);
  });
});
