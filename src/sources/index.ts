import type { OnlineResult } from '../types';
import { jamendoSource } from './jamendo';
import type { MusicSource } from './types';
import { youtubeSource } from './youtube';

export const SOURCES: MusicSource[] = [youtubeSource, jamendoSource];

export const sourceFor = (id: OnlineResult['source']) => {
  const s = SOURCES.find(x => x.id === id);
  if (!s) throw new Error(`Unknown source ${id}`);
  return s;
};

export const sourceName = (id: string) =>
  SOURCES.find(x => x.id === id)?.name ?? id;

export type SourceStatus = 'off' | 'searching' | 'done' | 'failed';

export interface SourceProgress {
  id: OnlineResult['source'];
  name: string;
  status: SourceStatus;
  count: number;
  error?: string;
}

/**
 * Searches every enabled platform in parallel and reports each one's progress,
 * so a slow or dead source never hides the others' results.
 */
export async function searchOnline(
  query: string,
  onProgress: (sources: SourceProgress[], results: OnlineResult[]) => void,
): Promise<OnlineResult[]> {
  const progress: SourceProgress[] = SOURCES.map(s => ({
    id: s.id,
    name: s.name,
    status: s.isEnabled() ? 'searching' : 'off',
    count: 0,
  }));
  const results: OnlineResult[] = [];
  onProgress([...progress], []);

  await Promise.all(
    SOURCES.map(async (s, i) => {
      if (!s.isEnabled()) return;
      try {
        const found = await s.search(query);
        results.push(...found);
        progress[i] = { ...progress[i], status: 'done', count: found.length };
      } catch (e: any) {
        const message = String(e?.message ?? e);
        progress[i] = {
          ...progress[i],
          status: 'failed',
          // React Native's fetch reports "no connection" as this generic message.
          error: /Network request failed/i.test(message)
            ? 'no internet connection — turn on Wi-Fi or mobile data'
            : message,
        };
      }
      onProgress([...progress], [...results]);
    }),
  );
  return results;
}
