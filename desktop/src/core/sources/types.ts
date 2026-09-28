import type { OnlineResult, ResolvedStream } from '../types';

/** Add a new platform by implementing this and registering it in sources/index.ts. */
export interface MusicSource {
  id: OnlineResult['source'];
  name: string;
  isEnabled(): boolean;
  search(query: string): Promise<OnlineResult[]>;
  resolveStream(result: OnlineResult): Promise<ResolvedStream>;
  /** True when the source's thumbnails aren't real album covers (e.g. video frames). */
  preferCoverLookup: boolean;
}
