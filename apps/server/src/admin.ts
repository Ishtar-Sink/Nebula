import { createWriteStream } from 'node:fs';
import { rm, rename } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CATALOG_DIR, AUDIO_EXTENSIONS, MIME_BY_EXT } from './config.ts';
import { readManifest, writeManifest, getProbe, type CatalogEntry } from './library.ts';
import { upsertTrack, getTrack, getTrackFile, db } from './db.ts';
import { hub } from './hub.ts';

/**
 * Catalog administration used by the backoffice. Playlists are deliberately out of scope:
 * those belong to the listener, not to whoever curates the catalog.
 */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'faixa';
}

/** Refuses any path that would escape the catalog directory. */
function insideCatalog(file: string): boolean {
  const full = resolve(CATALOG_DIR, file);
  return full.startsWith(resolve(CATALOG_DIR) + '/');
}

async function syncEntry(entry: CatalogEntry): Promise<void> {
  const path = join(CATALOG_DIR, entry.file);
  upsertTrack({
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    durationMs: entry.durationMs,
    source: 'catalog',
    path,
    mime: MIME_BY_EXT[extname(path).toLowerCase()] ?? 'audio/mpeg',
  });
}

export interface AdminTrackView extends CatalogEntry {
  sizeBytes: number;
  inPlaylists: number;
  /** Set from the tracks table, which is where the cover lives — the manifest has no image. */
  coverUrl: string | null;
}

export async function catalogOverview(): Promise<{
  tracks: AdminTrackView[];
  albums: { name: string; artist: string; count: number; durationMs: number; coverUrl: string | null }[];
  totals: { tracks: number; sizeBytes: number; durationMs: number; playlists: number };
}> {
  const entries = await readManifest();
  const { statSync, existsSync } = await import('node:fs');

  const tracks: AdminTrackView[] = entries.map((e) => {
    const path = join(CATALOG_DIR, e.file);
    const usage = db.prepare('SELECT COUNT(*) AS c FROM playlist_tracks WHERE track_id = ?').get(e.id) as { c: number };
    return {
      ...e,
      sizeBytes: existsSync(path) ? statSync(path).size : 0,
      inPlaylists: usage.c,
      coverUrl: getTrack(e.id)?.coverUrl ?? null,
    };
  });

  const albumMap = new Map<
    string, { name: string; artist: string; count: number; durationMs: number; coverUrl: string | null }
  >();
  for (const t of tracks) {
    const existing = albumMap.get(t.album);
    if (existing) {
      existing.count++;
      existing.durationMs += t.durationMs;
      existing.coverUrl ??= t.coverUrl;
    } else {
      albumMap.set(t.album, {
        name: t.album, artist: t.artist, count: 1, durationMs: t.durationMs, coverUrl: t.coverUrl,
      });
    }
  }

  const playlists = db.prepare('SELECT COUNT(*) AS c FROM playlists').get() as { c: number };

  return {
    tracks,
    albums: [...albumMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    totals: {
      tracks: tracks.length,
      sizeBytes: tracks.reduce((sum, t) => sum + t.sizeBytes, 0),
      durationMs: tracks.reduce((sum, t) => sum + t.durationMs, 0),
      playlists: playlists.c,
    },
  };
}

export interface TrackMeta {
  name: string;
  title?: string;
  artist?: string;
  album?: string;
  /** Attribution fields. They live in the manifest only — playback never needs them. */
  license?: string;
  sourceUrl?: string;
  sourceId?: string;
}

/**
 * Turns a finished file into a catalog entry: probes its duration, gives it a stable name and
 * writes it into the manifest. Shared by the upload route and the importer, which both end up
 * with a file on disk and nothing else in common.
 *
 * `staging` is consumed — it is renamed into place, not copied.
 */
export async function publishCatalogFile(
  staging: string,
  ext: string,
  meta: TrackMeta,
): Promise<CatalogEntry> {
  const title = meta.title?.trim() || basename(meta.name, ext).replace(/[_-]+/g, ' ').trim();
  const artist = meta.artist?.trim() || 'Artista desconhecido';
  const album = meta.album?.trim() || 'Sem álbum';

  let durationMs = 0;
  try {
    const probe = await getProbe();
    const probed = await probe(staging);
    durationMs = probed.durationMs;
  } catch {
    durationMs = 0;
  }

  const entries = await readManifest();
  let slug = slugify(`${album} ${title}`);
  if (entries.some((e) => e.id === `cat:${slug}`)) slug = `${slug}-${Date.now().toString(36)}`;

  const file = `${slug}${ext}`;
  await rename(staging, join(CATALOG_DIR, file));

  const entry: CatalogEntry = { id: `cat:${slug}`, title, artist, album, durationMs, file };
  if (meta.license?.trim()) entry.license = meta.license.trim();
  if (meta.sourceUrl?.trim()) entry.sourceUrl = meta.sourceUrl.trim();
  if (meta.sourceId?.trim()) entry.sourceId = meta.sourceId.trim();
  entries.push(entry);
  await writeManifest(entries);
  await syncEntry(entry);
  hub.notifyLibraryChanged('catalog-add');
  return entry;
}

/** Where a download or an upload lands before it is accepted into the catalog. */
export function stagingPath(ext: string): string {
  return join(CATALOG_DIR, `.upload-${randomUUID()}${ext}`);
}

export function assertAudioExtension(ext: string): void {
  if (!AUDIO_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error(`formato não suportado: ${ext || 'sem extensão'}`), { status: 400 });
  }
}

export async function addCatalogTrack(
  req: IncomingMessage,
  meta: TrackMeta,
): Promise<CatalogEntry> {
  const ext = extname(basename(meta.name)).toLowerCase();
  assertAudioExtension(ext);

  // Upload to a temp name first so a failed transfer never lands in the manifest.
  const staging = stagingPath(ext);
  await pipeline(req, createWriteStream(staging));
  return publishCatalogFile(staging, ext, meta);
}


export async function updateCatalogTrack(
  id: string,
  patch: { title?: string; artist?: string; album?: string; license?: string; sourceUrl?: string },
): Promise<CatalogEntry> {
  const entries = await readManifest();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw Object.assign(new Error('faixa não encontrada no catálogo'), { status: 404 });

  if (patch.title !== undefined && patch.title.trim()) entry.title = patch.title.trim();
  if (patch.artist !== undefined && patch.artist.trim()) entry.artist = patch.artist.trim();
  if (patch.album !== undefined && patch.album.trim()) entry.album = patch.album.trim();
  // Attribution can legitimately be cleared, so an empty string is a value here, not a skip.
  if (patch.license !== undefined) entry.license = patch.license.trim() || undefined;
  if (patch.sourceUrl !== undefined) entry.sourceUrl = patch.sourceUrl.trim() || undefined;

  await writeManifest(entries);
  await syncEntry(entry);
  hub.notifyLibraryChanged('catalog-update');
  return entry;
}

export async function deleteCatalogTrack(id: string, keepFile = false): Promise<void> {
  const entries = await readManifest();
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) throw Object.assign(new Error('faixa não encontrada no catálogo'), { status: 404 });

  const [entry] = entries.splice(index, 1);
  await writeManifest(entries);

  // Drop the DB row first: ON DELETE CASCADE takes it out of every playlist that used it.
  const file = getTrackFile(id);
  db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
  hub.purgeTrack(id);

  if (!keepFile && file && insideCatalog(entry.file)) {
    await rm(join(CATALOG_DIR, entry.file), { force: true });
  }
  hub.notifyLibraryChanged('catalog-delete');
}

/** Bulk rename used to fix an album's metadata in one go. */
export async function renameAlbum(from: string, patch: { album?: string; artist?: string }): Promise<number> {
  const entries = await readManifest();
  let changed = 0;
  for (const entry of entries) {
    if (entry.album !== from) continue;
    if (patch.album?.trim()) entry.album = patch.album.trim();
    if (patch.artist?.trim()) entry.artist = patch.artist.trim();
    await syncEntry(entry);
    changed++;
  }
  if (changed > 0) {
    await writeManifest(entries);
    hub.notifyLibraryChanged('catalog-album-rename');
  }
  return changed;
}
