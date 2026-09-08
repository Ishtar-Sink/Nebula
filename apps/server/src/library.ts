import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { upsertTrack, deleteTracksNotIn, listTracks } from './db.ts';
import { CATALOG_DIR, MIME_BY_EXT } from './config.ts';

export interface CatalogEntry {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  file: string;
  /** Free text, e.g. "CC BY 4.0" or "domínio público". Empty when nobody said. */
  license?: string;
  /** Where the file came from, when it was imported from the web. Kept for attribution. */
  sourceUrl?: string;
  /**
   * Stable identity at the source, as `<extrator>:<id>` — `youtube:dQw4w9WgXcQ`. URLs for the
   * same video vary (youtu.be, `?list=`, tracking parameters), so the URL is no good for
   * spotting something already imported; this is.
   */
  sourceId?: string;
}

/** Loaded lazily: music-metadata is only needed for user files, never for the generated catalog. */
type Probe = (path: string) => Promise<{ durationMs: number; title?: string; artist?: string; album?: string }>;

let probeImpl: Probe | null = null;

export async function getProbe(): Promise<Probe> {
  if (probeImpl) return probeImpl;
  try {
    const mm = await import('music-metadata');
    probeImpl = async (path: string) => {
      const meta = await mm.parseFile(path, { duration: true });
      return {
        durationMs: Math.round((meta.format.duration ?? 0) * 1000),
        title: meta.common.title ?? undefined,
        artist: meta.common.artist ?? undefined,
        album: meta.common.album ?? undefined,
      };
    };
  } catch (err) {
    // Degrade gracefully rather than losing the whole disk library: the file still plays,
    // it just shows a 0:00 duration until metadata parsing is available.
    console.warn('[library] music-metadata indisponível, usando apenas o nome do arquivo:', (err as Error).message);
    probeImpl = async () => ({ durationMs: 0 });
  }
  return probeImpl;
}

/**
 * The catalog manifest is the live registry of the curated catalog — not just the seed's
 * output. The backoffice edits it, so a track removed there stays removed across restarts.
 */
export async function readManifest(): Promise<CatalogEntry[]> {
  const manifestPath = join(CATALOG_DIR, 'catalog.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    return Array.isArray(parsed) ? (parsed as CatalogEntry[]) : [];
  } catch (err) {
    console.error('[library] catalog.json ilegível:', (err as Error).message);
    return [];
  }
}

export async function writeManifest(entries: CatalogEntry[]): Promise<void> {
  mkdirSync(CATALOG_DIR, { recursive: true });
  await writeFile(join(CATALOG_DIR, 'catalog.json'), JSON.stringify(entries, null, 2), 'utf8');
}

/** Syncs the tracks table with the manifest, dropping catalog rows the manifest no longer lists. */
export async function loadCatalog(): Promise<number> {
  const entries = await readManifest();
  if (entries.length === 0 && !existsSync(join(CATALOG_DIR, 'catalog.json'))) {
    console.warn(`[library] catálogo não encontrado em ${CATALOG_DIR} — rode "pnpm seed".`);
  }
  const ids: string[] = [];
  for (const e of entries) {
    const path = join(CATALOG_DIR, e.file);
    if (!existsSync(path)) {
      console.warn(`[library] arquivo ausente para "${e.title}": ${e.file}`);
      continue;
    }
    ids.push(e.id);
    upsertTrack({
      id: e.id,
      title: e.title,
      artist: e.artist,
      album: e.album,
      durationMs: e.durationMs,
      source: 'catalog',
      path,
      mime: MIME_BY_EXT[extname(path).toLowerCase()] ?? 'audio/mpeg',
    });
  }
  deleteTracksNotIn('catalog', ids);
  return ids.length;
}

export async function initLibrary(): Promise<void> {
  const catalog = await loadCatalog();

  // Files a listener picks from their own disk are played entirely client-side (offline
  // mode) and never reach the server. Rows left from the old upload flow are dropped.
  const stale = deleteTracksNotIn('local', []);

  console.log(
    `[library] catálogo: ${catalog} faixas` +
    (stale ? ` · ${stale} faixa(s) locais antigas removidas do banco` : '')
  );
  if (listTracks().length === 0) {
    console.warn('[library] catálogo vazio — rode "pnpm seed" ou use o backoffice.');
  }
}
