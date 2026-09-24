import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Splash } from './src/components/Splash';
import { RootNavigator } from './src/navigation/RootNavigator';
import { convertOldDownloads } from './src/services/convert';
import {
  cleanupInterruptedDownloads,
  onDownloadFinished,
} from './src/services/downloader';
import { ensureDirs } from './src/services/paths';
import { toast } from './src/state/ui';

export default function App() {
  useEffect(() => {
    (async () => {
      await ensureDirs();
      await cleanupInterruptedDownloads();
      await convertOldDownloads();
    })().catch(e => console.warn('Startup failed', e));

    return onDownloadFinished((track, ok) =>
      toast(
        ok
          ? `“${track.title}” saved — plays offline now`
          : `Couldn't save “${track.title}”`,
      ),
    );
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
      <Splash />
    </SafeAreaProvider>
  );
}
