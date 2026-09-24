import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Splash } from './src/components/Splash';
import { RootNavigator } from './src/navigation/RootNavigator';
import { convertOldDownloads } from './src/services/convert';
import { keepOldDownloads } from './src/services/keep';
import {
  cleanupInterruptedDownloads,
  onDownloadFinished,
} from './src/services/downloader';
import { ensureDirs } from './src/services/paths';
import { startUpdateChecks } from './src/services/updater';
import { openSheet, toast } from './src/state/ui';

export default function App() {
  useEffect(() => {
    (async () => {
      await ensureDirs();
      await cleanupInterruptedDownloads();
      await convertOldDownloads();
      await keepOldDownloads(); // to Music/stash, so they survive an uninstall
    })().catch(e => console.warn('Startup failed', e));

    // New version on GitHub? Asked once per start, after the splash has gone.
    const updateTimer = setTimeout(
      () =>
        startUpdateChecks(release => openSheet({ kind: 'update', release })),
      3000,
    );

    const stopListening = onDownloadFinished((track, ok) =>
      toast(
        ok
          ? `“${track.title}” saved — plays offline now`
          : `Couldn't save “${track.title}”`,
      ),
    );
    return () => {
      clearTimeout(updateTimer);
      stopListening();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
      <Splash />
    </SafeAreaProvider>
  );
}
