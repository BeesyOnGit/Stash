/**
 * The merge rules, as pure functions (no database, no platform):
 *
 * - tracks: last writer wins per field (play count and last played: the larger)
 * - a playlist with its ordered songs: one unit, last writer wins
 * - listens: union (each device writes only its own rows)
 * - lyrics, karaoke recordings, the language: last writer wins per row
 * - deleted vs edited: the newer stamp wins
 *
 * Every rule is idempotent: applying the same change twice changes nothing.
 *
 * SHARED FILE: canonical copy in src/sync/core, byte-identical copy in
 * desktop/src/core/sync/core.
 */
import { hlcDevice, isGenesis, maxHlc } from './hlc';
import {
  MAX_FIELDS,
  TRACK_DEFAULTS,
  TRACK_FIELDS,
  type Scalar,
  type TrackField,
  type TrackRow,
} from './model';

const same = (a: Scalar | undefined, b: Scalar | undefined) =>
  (a ?? null) === (b ?? null) ||
  (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** Every synced field's stamp (fields without their own use the row's). */
export function fieldStamps(
  r: Pick<TrackRow, 'field_hlc' | 'updated_at'>,
): Record<TrackField, string> {
  const out = {} as Record<TrackField, string>;
  for (const f of TRACK_FIELDS) out[f] = r.field_hlc?.[f] || r.updated_at;
  return out;
}

const maxValue = (a: Scalar, b: Scalar): Scalar => {
  if (a == null) return b;
  if (b == null) return a;
  return Number(b) > Number(a) ? b : a;
};

/**
 * Two rows that both existed before sync (no edit times): liked if liked on
 * either, a value rather than nothing, else the higher stamp's value. The
 * same answer on both devices, whichever side runs it.
 */
function genesisValue(
  f: TrackField,
  a: Scalar,
  ah: string,
  b: Scalar,
  bh: string,
): Scalar {
  if (f === 'liked') return Number(a) || Number(b) ? 1 : 0;
  if (a == null || a === '') return b;
  if (b == null || b === '') return a;
  return bh > ah ? b : a;
}

function withDefaults(r: TrackRow): TrackRow {
  const out = { ...r };
  for (const [f, v] of Object.entries(TRACK_DEFAULTS) as [TrackField, Scalar][]) {
    if (out[f] == null) out[f] = v;
  }
  return out;
}

/**
 * A track from the other device merged into ours. Returns the row to store,
 * or null when nothing changes (ours is already as new, or it was deleted
 * here after that version).
 */
export function mergeTrack(
  local: TrackRow | null,
  remote: TrackRow,
  tombstone: string | null,
): TrackRow | null {
  if (!local) {
    if (tombstone && tombstone >= remote.updated_at) return null;
    const stamps = fieldStamps(remote);
    return withDefaults({
      ...remote,
      field_hlc: stamps,
      updated_at: maxHlc(...Object.values(stamps)),
      updated_by: hlcDevice(maxHlc(...Object.values(stamps))),
    });
  }
  const ours = fieldStamps(local);
  const theirs = fieldStamps(remote);
  const out = { ...local };
  const stamps = { ...ours };
  let changed = false;
  for (const f of TRACK_FIELDS) {
    const a = ours[f];
    const b = theirs[f];
    let value = local[f];
    let stamp = a;
    if (MAX_FIELDS.has(f)) {
      value = maxValue(local[f], remote[f]);
      stamp = maxHlc(a, b);
    } else if (isGenesis(a) && isGenesis(b)) {
      value = genesisValue(f, local[f], a, remote[f], b);
      stamp = maxHlc(a, b);
    } else if (b > a) {
      value = remote[f];
      stamp = b;
    }
    if (!same(value, local[f]) || stamp !== a) changed = true;
    out[f] = value;
    stamps[f] = stamp;
  }
  if (!changed) return null;
  const top = maxHlc(...Object.values(stamps));
  return withDefaults({
    ...out,
    field_hlc: stamps,
    updated_at: top,
    updated_by: hlcDevice(top),
  });
}

/**
 * Whole-row last writer wins (playlists with their songs, listens, lyrics,
 * recordings, the language). Returns the row to store, or null.
 */
export function mergeRow<T extends { updated_at: string }>(
  local: T | null,
  remote: T,
  tombstone: string | null,
): T | null {
  if (tombstone && tombstone >= remote.updated_at) return null;
  if (!local || remote.updated_at > local.updated_at) return remote;
  return null;
}

/**
 * A deletion from the other device. `localStamp` is our row's newest stamp
 * (null if we don't have it). An edit made after the deletion keeps the row.
 */
export function mergeTombstone(
  localStamp: string | null,
  localTombstone: string | null,
  hlc: string,
): { deleteRow: boolean; storeTombstone: boolean } {
  if (localStamp && localStamp > hlc) {
    return { deleteRow: false, storeTombstone: false };
  }
  return {
    deleteRow: !!localStamp,
    storeTombstone: !localTombstone || hlc > localTombstone,
  };
}
