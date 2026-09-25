/**
 * In-app updates from the project's GitHub Releases: on every start the app asks
 * GitHub for the latest release, and if it's newer offers to download it. The
 * APK is checked against the release's .sha256 before Android's installer opens
 * (the user confirms there; the library and settings are kept).
 *
 * Android only, release builds only: development builds are signed with another
 * key, so Android wouldn't accept a release over them.
 * Native side: update/UpdaterModule.kt. Releases: .github/workflows/release.yml.
 */
import {
  AppState,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { tr } from '../i18n';
import { removeFile } from './paths';

const REPO = 'BeesyOnGit/Stash';
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const APK_DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/updates`;

interface UpdaterNative {
  info(): { versionName: string; versionCode: number; debug: boolean };
  canInstall(): Promise<boolean>;
  openInstallPermission(): void;
  install(path: string): Promise<void>;
  showNotification(version: string, text: string): void;
  cancelNotification(): void;
  takeOpenRequest(): boolean;
}

const Native: UpdaterNative | undefined =
  Platform.OS === 'android' ? NativeModules.StashUpdater : undefined;

export interface Release {
  version: string;
  /** Same numbering as the release build: 1.2.3 → 10203. */
  code: number;
  notes: string;
  apkUrl: string;
  shaUrl: string | null;
  size: number | null;
}

export const updatesSupported = () => !!Native;

/** The installed version, e.g. { name: '1.2.0', debug: false }. */
export function installedVersion() {
  if (!Native) return null;
  const i = Native.info();
  return { name: i.versionName, code: i.versionCode, debug: i.debug };
}

/** "v1.2.3" → 10203 (null if the tag isn't a version). */
export function versionCode(tag: string): number | null {
  const m = tag.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2] ?? 0) * 100 + Number(m[3] ?? 0);
}

/**
 * The latest release if it's newer than this app, else null.
 * Throws when GitHub can't be reached (the manual check reports it).
 */
export async function checkForUpdate(): Promise<Release | null> {
  const me = installedVersion();
  if (!me || me.debug) return null;
  const res = await fetch(LATEST, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return null; // no release published yet
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = (await res.json()) as {
    tag_name: string;
    body?: string | null;
    assets?: { name: string; browser_download_url: string; size: number }[];
  };
  const code = versionCode(r.tag_name);
  const apk = r.assets?.find(a => a.name.toLowerCase().endsWith('.apk'));
  if (!code || !apk || code <= me.code) return null;
  const sha = r.assets?.find(a => a.name === `${apk.name}.sha256`);
  return {
    version: r.tag_name.replace(/^v/, ''),
    code,
    notes: cleanNotes(r.body ?? ''),
    apkUrl: apk.browser_download_url,
    shaUrl: sha?.browser_download_url ?? null,
    size: apk.size ?? null,
  };
}

// ---- checking at start, with a notification that stays until updated ----

let known: Release | null = null;

/**
 * On every start: ask GitHub, and if there's a newer version show the update
 * sheet and a notification that stays in the shade until the app is updated.
 * Tapping the notification (even much later) opens the sheet again.
 */
export function startUpdateChecks(show: (release: Release) => void) {
  if (!Native) return;
  const openIfAsked = () => {
    if (Native.takeOpenRequest() && known) show(known);
  };
  AppState.addEventListener('change', state => {
    if (state === 'active') openIfAsked();
  });
  checkForUpdate()
    .then(async release => {
      known = release;
      if (!release) {
        Native.cancelNotification(); // up to date (e.g. just updated)
        return;
      }
      show(release);
      if (await notificationsAllowed()) {
        Native.showNotification(
          release.version,
          tr('settings.updateNotification'),
        );
      }
      openIfAsked();
    })
    .catch(() => {}); // offline, or GitHub unreachable: try next start
}

/** Android 13+ asks the user once; before that notifications are always allowed. */
async function notificationsAllowed() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(perm)) return true;
  return (await PermissionsAndroid.request(perm)) === 'granted';
}

/** GitHub's generated notes are Markdown: keep them readable as plain text. */
function cleanNotes(md: string) {
  return md
    .replace(/\r/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https:\/\/github\.com\/\S+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type InstallStep =
  | { step: 'downloading'; progress: number }
  | { step: 'verifying' }
  | { step: 'permission' }
  | { step: 'installing' };

/**
 * Downloads the release, checks it and opens the installer. If stash may not
 * install apps yet, opens that setting first and carries on when the user
 * comes back.
 */
export async function downloadAndInstall(
  release: Release,
  onStep: (s: InstallStep) => void,
): Promise<void> {
  if (!Native) throw new Error('Updates work on Android only');
  const path = `${APK_DIR}/stash-${release.version}.apk`;
  await ReactNativeBlobUtil.fs.mkdir(APK_DIR).catch(() => {});
  await removeFile(path).catch(() => {});

  onStep({ step: 'downloading', progress: 0 });
  const task = ReactNativeBlobUtil.config({ path, overwrite: true }).fetch(
    'GET',
    release.apkUrl,
  );
  task.progress({ interval: 250 }, (received, total) => {
    const t = Number(total) || release.size || 0;
    onStep({
      step: 'downloading',
      progress: t > 0 ? Math.min(1, Number(received) / t) : 0,
    });
  });
  const res = await task;
  if (res.info().status >= 400) {
    throw new Error(
      tr('settings.updateDownloadFailed', { status: res.info().status }),
    );
  }

  if (release.shaUrl) {
    onStep({ step: 'verifying' });
    const expected = (await (await fetch(release.shaUrl)).text())
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase();
    const actual = (
      await ReactNativeBlobUtil.fs.hash(path, 'sha256')
    ).toLowerCase();
    if (!expected || expected !== actual) {
      await removeFile(path).catch(() => {});
      throw new Error(tr('settings.updateDamaged'));
    }
  }

  if (!(await Native.canInstall())) {
    onStep({ step: 'permission' });
    Native.openInstallPermission();
    await backInApp();
    if (!(await Native.canInstall())) {
      throw new Error(tr('settings.updateInstallPermission'));
    }
  }
  onStep({ step: 'installing' });
  await Native.install(path);
}

/** Resolves when the user comes back to the app (from a system settings screen). */
function backInApp(): Promise<void> {
  return new Promise(resolve => {
    let left = AppState.currentState !== 'active';
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') left = true;
      else if (left) {
        sub.remove();
        resolve();
      }
    });
  });
}
