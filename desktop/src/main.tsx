/**
 * stash for desktop. Opens the library, reads the settings (language, theme),
 * then shows the window; background work (details lookup, update check) starts
 * a little later, like on the phone.
 */
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initDatabase } from './core/db/database';
import { layoutDirection, onLanguageChange, tr } from './core/i18n';
import { initNative, quitApp, traySetPlaying } from './core/native';
import { PlayerService } from './core/player/PlayerService';
import { startDetailsLookup } from './core/services/artwork';
import { cleanupInterruptedDownloads, onDownloadFinished } from './core/services/downloader';
import { ensureDirs } from './core/services/paths';
import { getSettings, subscribeSettings } from './core/services/settings';
import { startUpdateChecks } from './core/services/updater';
import { openSheet, toast } from './core/state/ui';
import { applyTheme } from './core/theme';
import { App } from './ui/App';
import { startMiniBridge } from './ui/miniBridge';

/** Development only: console errors go to <app data>/debug.log (there's no console to look at). */
function devLog() {
  if (!import.meta.env.DEV) return;
  const lines: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const add = (kind: string, args: unknown[]) => {
    lines.push(`${new Date().toISOString()} ${kind} ${args.map(a => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      const { fs, getDirs, pathJoin } = await import('./core/native');
      fs.writeText(pathJoin(getDirs().data, 'debug.log'), lines.join('\n')).catch(() => {});
    }, 500);
  };
  for (const k of ['error', 'warn', 'log'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      orig(...a);
      add(k, a);
    };
  }
  window.addEventListener('error', e => add('uncaught', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', e => add('rejection', [e.reason]));
}

async function start() {
  await initNative();
  devLog();
  await initDatabase();
  const settings = getSettings(); // also sets the language
  applyTheme(settings.theme === 'dark');
  subscribeSettings(() => applyTheme(getSettings().theme === 'dark'));
  document.documentElement.dir = layoutDirection();
  document.documentElement.lang = navigator.language;

  // Right-clicks are the app's own (song menus), not the web view's.
  window.addEventListener('contextmenu', e => {
    const t = e.target as HTMLElement;
    if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') e.preventDefault();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await getCurrentWindow().show();

  (async () => {
    await ensureDirs();
    await cleanupInterruptedDownloads();
  })().catch(e => console.warn('Startup failed', e));

  onDownloadFinished((track, ok) =>
    toast(ok ? tr('system.downloadSaved', { title: track.title }) : tr('system.downloadFailed', { title: track.title })),
  );
  setTimeout(() => startDetailsLookup(), 5000);
  setTimeout(() => startUpdateChecks(release => openSheet({ kind: 'update', release })), 3000);
  startMiniBridge();

  // The tray menu: play/pause, previous, next, quit.
  listen<string>('tray', e => {
    if (e.payload === 'toggle') PlayerService.togglePlay();
    else if (e.payload === 'next') PlayerService.next();
    else if (e.payload === 'previous') PlayerService.previous();
    else if (e.payload === 'quit') {
      PlayerService.saveListening();
      setTimeout(() => quitApp(), 300);
    }
  });
  const syncTray = () => {
    const { isPlaying } = PlayerService.getState();
    const cur = PlayerService.current;
    traySetPlaying(isPlaying, cur ? `${cur.title}${cur.artist ? ` — ${cur.artist}` : ''}` : null, tr('common.play'), tr('common.pause'));
  };
  let last = '';
  PlayerService.subscribe(() => {
    const cur = PlayerService.current;
    const key = `${PlayerService.getState().isPlaying}|${cur?.id}|${cur?.title}`;
    if (key !== last) {
      last = key;
      syncTray();
    }
  });
  onLanguageChange(syncTray);
  window.addEventListener('beforeunload', () => PlayerService.saveListening());
}

start().catch(e => {
  console.error(e);
  document.body.textContent = `stash couldn't start: ${e?.message ?? e}`;
  getCurrentWindow().show();
});
