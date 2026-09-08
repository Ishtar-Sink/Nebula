import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const SERVER_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');

export const PORT = Number(process.env.NEBULA_PORT ?? 4000);
export const HOST = process.env.NEBULA_HOST ?? '0.0.0.0';

export const DATA_DIR = process.env.NEBULA_DATA_DIR ?? join(SERVER_ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'nebula.db');
/** Cover images uploaded for playlists and albums. Written by the app, served read-only. */
export const COVER_DIR = join(DATA_DIR, 'covers');
/** Generated demo catalog (original synthesized audio, shipped with the repo). */
export const CATALOG_DIR = process.env.NEBULA_CATALOG_DIR ?? join(REPO_ROOT, 'media', 'catalog');

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);

/** Cover images are stored in whatever the uploader sent, within this allow-list. */
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};
