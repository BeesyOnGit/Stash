import ReactNativeBlobUtil from 'react-native-blob-util';

const { fs } = ReactNativeBlobUtil;

/** App-private storage: survives restarts, removed on uninstall, not visible to other apps. */
export const MUSIC_DIR = `${fs.dirs.DocumentDir}/music`;
export const ARTWORK_DIR = `${fs.dirs.DocumentDir}/artwork`;

export async function ensureDirs() {
  for (const dir of [MUSIC_DIR, ARTWORK_DIR]) {
    if (!(await fs.exists(dir))) await fs.mkdir(dir);
  }
}

export const safeFileName = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

export async function removeFile(path: string | null) {
  if (path && (await fs.exists(path))) await fs.unlink(path);
}
