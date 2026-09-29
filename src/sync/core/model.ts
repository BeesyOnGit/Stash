/**
 * What syncs, as it travels between the devices. Column names are the
 * database's own (both apps have the same tables).
 *
 * Never synced: file_path / artwork_path / path (each device's own files),
 * status and waveform (worked out locally), and settings except the language.
 *
 * SHARED FILE: canonical copy in src/sync/core, byte-identical copy in
 * desktop/src/core/sync/core.
 */

export type Scalar = string | number | null;

/** Track columns that sync, each one merged on its own (last writer wins per field). */
export const TRACK_FIELDS = [
  'source',
  'source_id',
  'title',
  'artist',
  'album',
  'genre',
  'duration',
  'remote_artwork_url',
  'liked',
  'size_bytes',
  'added_at',
  'saved_at',
  'last_played_at',
  'play_count',
  'meta_checked_at',
  'source_title',
  'source_artist',
  'content_hash',
  'artwork_hash',
] as const;
export type TrackField = (typeof TRACK_FIELDS)[number];

/** Only ever grow: the larger value wins whoever wrote it. */
export const MAX_FIELDS: ReadonlySet<TrackField> = new Set([
  'play_count',
  'last_played_at',
]);

/** Columns with NOT NULL in the tracks table, and what null becomes. */
export const TRACK_DEFAULTS: Partial<Record<TrackField, Scalar>> = {
  liked: 0,
  play_count: 0,
  title: '',
  source: 'device',
  source_id: '',
  added_at: 0,
};

export type TrackRow = { id: string } & Record<TrackField, Scalar> & {
    updated_at: string;
    updated_by: string;
    /** Stamp per field; null (or a missing field) means `updated_at`. */
    field_hlc: Partial<Record<TrackField, string>> | null;
  };

/** A playlist and its ordered songs are one unit. */
export interface PlaylistRow {
  id: string;
  name: string;
  created_at: number;
  tracks: string[];
  updated_at: string;
  updated_by: string;
}

/** Listening time; each device only writes its own rows, so they never conflict. */
export interface ListenRow {
  device_id: string;
  track_id: string;
  day: string;
  hour: number;
  seconds: number;
  plays: number;
  title: string | null;
  artist: string | null;
  updated_at: string;
  updated_by: string;
}

export interface LyricsRow {
  track_id: string;
  plain: string | null;
  synced: string | null;
  source: string | null;
  checked_at: number;
  updated_at: string;
  updated_by: string;
}

export const RECORDING_FIELDS = [
  'track_id',
  'title',
  'artist',
  'duration',
  'size_bytes',
  'created_at',
  'mode',
  'content_hash',
  'file_name',
] as const;

export type RecordingRow = { id: string } & Record<
  (typeof RECORDING_FIELDS)[number],
  Scalar
> & { updated_at: string; updated_by: string };

/** The one setting that syncs: the app language. */
export interface SettingRow {
  key: 'language';
  value: string;
  updated_at: string;
}

export type SyncTable =
  | 'tracks'
  | 'playlists'
  | 'listens'
  | 'lyrics'
  | 'karaoke_recordings';

export interface Tombstone {
  tbl: SyncTable;
  id: string;
  hlc: string;
}

export interface ChangeSet {
  tracks: TrackRow[];
  playlists: PlaylistRow[];
  listens: ListenRow[];
  lyrics: LyricsRow[];
  recordings: RecordingRow[];
  settings: SettingRow[];
  deleted: Tombstone[];
}

export const emptyChanges = (): ChangeSet => ({
  tracks: [],
  playlists: [],
  listens: [],
  lyrics: [],
  recordings: [],
  settings: [],
  deleted: [],
});

export const changeCount = (c: ChangeSet) =>
  c.tracks.length +
  c.playlists.length +
  c.listens.length +
  c.lyrics.length +
  c.recordings.length +
  c.settings.length +
  c.deleted.length;

/** A listens row's key as one string (tombstones): device|track|day|hour. */
export const listenKey = (r: {
  device_id: string;
  track_id: string;
  day: string;
  hour: number;
}) => `${r.device_id}|${r.track_id}|${r.day}|${r.hour}`;

export function parseListenKey(key: string) {
  const parts = key.split('|');
  if (parts.length < 4) return null;
  const device_id = parts[0];
  const hour = Number(parts[parts.length - 1]);
  const day = parts[parts.length - 2];
  const track_id = parts.slice(1, -2).join('|');
  return { device_id, track_id, day, hour };
}

/** A song scanned from the device's own folders: its id comes from its audio. */
export const localTrackId = (contentHash: string) => `device:${contentHash}`;
