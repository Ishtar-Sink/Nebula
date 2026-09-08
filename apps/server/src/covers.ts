/**
 * Cover images for playlists and albums.
 *
 * Kept as plain files under `data/covers`, referenced by name from the database. A new upload
 * always gets a new filename, so a changed cover can never be served from a stale cache —
 * the URL itself changes.
 */

import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
import { COVER_DIR, IMAGE_EXT_BY_MIME } from './config.ts';
import { coverInUse } from './db.ts';

const MAX_BYTES = 6 * 1024 * 1024;

function fail(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Streams an uploaded image to disk and returns the stored filename. */
export async function saveCover(req: IncomingMessage, contentType: string | undefined): Promise<string> {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_EXT_BY_MIME[mime];
  if (!ext) {
    throw fail(`formato de imagem não aceito: ${mime || 'desconhecido'}`, 400);
  }

  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BYTES) throw fail('imagem grande demais (máx. 6 MB)', 413);

  const file = `${randomUUID()}${ext}`;
  const target = join(COVER_DIR, file);

  let written = 0;
  req.on('data', (chunk: Buffer) => {
    written += chunk.length;
    // A client that lies about content-length must not fill the disk.
    if (written > MAX_BYTES) req.destroy(fail('imagem grande demais (máx. 6 MB)', 413));
  });

  try {
    await pipeline(req, createWriteStream(target));
  } catch (err) {
    await rm(target, { force: true });
    throw err;
  }
  return file;
}

/** Deletes a cover file, but only once nothing in the database still points at it. */
export async function discardCover(file: string | null | undefined): Promise<void> {
  if (!file) return;
  if (coverInUse(file)) return;
  // basename keeps a crafted name from reaching outside the covers folder.
  await rm(join(COVER_DIR, basename(file)), { force: true });
}

/** Resolves a request path to a file inside the covers folder, or null if it escapes. */
export function coverPath(name: string): string | null {
  const safe = basename(name);
  return safe && safe !== '.' && safe !== '..' ? join(COVER_DIR, safe) : null;
}
