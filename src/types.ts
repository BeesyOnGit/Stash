export type TrackSource = 'device' | 'youtube' | 'jamendo';

/**
 * - `ready`: the audio file is on the phone.
 * - `downloading`: being saved (in the library, streams until finished).
 * - `streaming`: stream-only, never written to the library (in-memory queue item).
 */
export type TrackStatus = 'downloading' | 'ready' | 'streaming';

/** A song stored in the internal library (SQLite). */
export interface Track {
  /** `${source}:${sourceId}` — stable, so the same song is never downloaded twice. */
  id: string;
  source: TrackSource;
  sourceId: string;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  /** Seconds. */
  duration: number | null;
  /** Absolute path of the audio file on the phone (null while downloading). */
  filePath: string | null;
  /** Absolute path of the cover art saved on the phone. */
  artworkPath: string | null;
  /** Remote cover art URL, used until/unless the local copy exists. */
  remoteArtworkUrl: string | null;
  status: TrackStatus;
  liked: boolean;
  /** Size of the audio file in bytes (null when unknown). */
  sizeBytes: number | null;
  /** Real loudness shape for the player (bar heights 0..100), once computed. */
  waveform: number[] | null;
  addedAt: number;
  /** When a download finished (null for device files). */
  savedAt: number | null;
  lastPlayedAt: number | null;
}

/** A song found on an online platform (not necessarily in the library). */
export interface OnlineResult {
  source: Exclude<TrackSource, 'device'>;
  sourceId: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  thumbnailUrl: string | null;
}

export interface ResolvedStream {
  url: string;
  /** e.g. audio/mp4, audio/mpeg — used to pick the file extension. */
  mimeType: string | null;
  /** Bits per second when the source reports it. */
  bitrate?: number;
  /** File size in bytes when the source reports it. */
  contentLength?: number;
  /** Download in ranged chunks (YouTube throttles a single big request). */
  chunked?: boolean;
  headers?: Record<string, string>;
}

/** A track in the play queue. `streamUrl` is set while the file isn't on the phone. */
export interface QueueItem extends Track {
  streamUrl?: string;
  streamHeaders?: Record<string, string>;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export const trackIdFor = (source: TrackSource, sourceId: string) =>
  `${source}:${sourceId}`;

export const artworkUri = (
  t: Pick<Track, 'artworkPath' | 'remoteArtworkUrl'>,
) => (t.artworkPath ? `file://${t.artworkPath}` : t.remoteArtworkUrl);

/** A track built from an online result, before it's saved anywhere. */
export function trackFromResult(r: OnlineResult, status: TrackStatus): Track {
  return {
    id: trackIdFor(r.source, r.sourceId),
    source: r.source,
    sourceId: r.sourceId,
    title: r.title,
    artist: r.artist,
    album: r.album,
    genre: null,
    duration: r.duration,
    filePath: null,
    artworkPath: null,
    remoteArtworkUrl: r.thumbnailUrl,
    status,
    liked: false,
    sizeBytes: null,
    waveform: null,
    addedAt: Date.now(),
    savedAt: null,
    lastPlayedAt: null,
  };
}
