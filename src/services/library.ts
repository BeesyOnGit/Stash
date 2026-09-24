import { deleteTrackRow } from '../db/database';
import { PlayerService } from '../player/PlayerService';
import type { Track } from '../types';
import { cancelDownload } from './downloader';
import { removeFile } from './paths';

/**
 * Removes a downloaded song (file + cover) from the phone.
 * For device songs only the library entry is removed — the user's own file is never deleted.
 */
export async function deleteFromLibrary(track: Track) {
  cancelDownload(track.id);
  PlayerService.removeFromQueue(track.id);
  if (track.source !== 'device') await removeFile(track.filePath);
  await removeFile(track.artworkPath);
  await deleteTrackRow(track.id);
}
