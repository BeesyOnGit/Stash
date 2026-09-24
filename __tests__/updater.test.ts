jest.mock('react-native-blob-util', () => ({
  fs: { dirs: { CacheDir: '/cache' } },
}));

import { versionCode } from '../src/services/updater';

// Must match the numbering in .github/workflows/release.yml.
describe('release version numbers', () => {
  test('tags become increasing version codes', () => {
    expect(versionCode('v1.2.3')).toBe(10203);
    expect(versionCode('1.0.0')).toBe(10000);
    expect(versionCode('v2')).toBe(20000);
    expect(versionCode('v1.10.0')!).toBeGreaterThan(versionCode('v1.9.9')!);
  });

  test('tags that are not versions are ignored', () => {
    expect(versionCode('nightly')).toBeNull();
    expect(versionCode('v1.2.3-beta')).toBeNull();
  });
});
