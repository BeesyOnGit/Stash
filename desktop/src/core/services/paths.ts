/**
 * Where stash keeps things on the computer.
 *
 * Saved songs go straight into Music/stash, like on the phone: they're normal
 * files other players see, they stay if stash is uninstalled, and Settings →
 * Scan for music brings them back as the same songs ("youtube_<id>.m4a").
 * Covers, instrumentals and the karaoke model are app data.
 */
import { fs, getDirs, pathJoin, removeFile as remove } from '../native';

export const keepDir = () => pathJoin(getDirs().music, 'stash');
export const artworkDir = () => pathJoin(getDirs().data, 'artwork');
export const karaokePublicDir = () => pathJoin(getDirs().music, 'Karaoke');
export const modelDir = () => pathJoin(getDirs().data, 'models');
export const instrumentalDir = () => pathJoin(getDirs().data, 'karaoke');
export const pieceRoot = () => pathJoin(getDirs().cache, 'karaoke-pieces');
export const voiceDir = () => pathJoin(getDirs().cache, 'karaoke-voice');
export const updatesDir = () => pathJoin(getDirs().cache, 'updates');

export async function ensureDirs() {
  for (const dir of [keepDir(), artworkDir()]) await fs.mkdir(dir).catch(() => {});
}

export const safeFileName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

export const removeFile = remove;
