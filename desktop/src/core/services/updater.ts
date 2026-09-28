/**
 * In-app updates from the project's GitHub Releases, like the phone app: on
 * every start stash asks for the latest release, and if it's newer offers it.
 *
 * The release's latest.json (made by the release workflow) lists a signed
 * installer per system; the updater checks the signature against the public
 * key in tauri.conf.json, installs it over this version (library, settings
 * and saved songs are kept) and stash restarts.
 * Releases: .github/workflows/release.yml.
 */
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export interface Release {
  version: string;
  notes: string;
  /** Unknown until the download starts. */
  size: number | null;
  update: Update;
}

export const updatesSupported = () => !import.meta.env.DEV;

let installed: string | null = null;
getVersion()
  .then(v => {
    installed = v;
  })
  .catch(() => {});

/** The installed version, e.g. { name: '1.2.0', debug: false }. */
export function installedVersion() {
  return installed ? { name: installed, debug: import.meta.env.DEV } : null;
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

/**
 * The latest release if it's newer than this app, else null.
 * Throws when GitHub can't be reached (the manual check reports it).
 */
export async function checkForUpdate(): Promise<Release | null> {
  if (!updatesSupported()) return null;
  const update = await check({ timeout: 20000 });
  if (!update) return null;
  return {
    version: update.version.replace(/^v/, ''),
    notes: cleanNotes(update.body ?? ''),
    size: null,
    update,
  };
}

/** Once per start, after the window has shown. Offline or unreachable: next start. */
export function startUpdateChecks(show: (release: Release) => void) {
  checkForUpdate()
    .then(r => r && show(r))
    .catch(() => {});
}

export type InstallStep =
  | { step: 'downloading'; progress: number }
  | { step: 'verifying' }
  | { step: 'installing' };

/** Downloads the release (its signature is checked), installs it and restarts stash. */
export async function downloadAndInstall(
  release: Release,
  onStep: (s: InstallStep) => void,
): Promise<void> {
  let total = 0;
  let received = 0;
  onStep({ step: 'downloading', progress: 0 });
  await release.update.downloadAndInstall(event => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
      release.size = total || null;
    } else if (event.event === 'Progress') {
      received += event.data.chunkLength;
      onStep({
        step: 'downloading',
        progress: total ? Math.min(1, received / total) : 0,
      });
    } else if (event.event === 'Finished') {
      onStep({ step: 'installing' });
    }
  });
  await relaunch();
}
