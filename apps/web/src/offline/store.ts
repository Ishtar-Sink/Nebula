/**
 * The offline library, stored entirely in this browser.
 *
 * Files picked from disk are kept as Blobs in IndexedDB — they are never uploaded, and no
 * other device ever learns they exist. IndexedDB (rather than an in-memory list) is what
 * makes the library survive a reload without asking the listener to pick the files again.
 *
 * Offline playlists live here too, for the same reason: they reference files that only this
 * device has, so a server copy of them could never be played anywhere else.
 *
 * Metadata and audio are deliberately in separate stores. Listing the library reads only the
 * metadata store; keeping the blobs there would mean pulling every byte of audio into memory
 * on each refresh, which on a real library is gigabytes.
 */

import type { Playlist, PlaylistDetail, Track } from '@nebula/protocol';
import { paletteFor } from '@nebula/theme';
import { randomId } from '../identity.ts';

const DB_NAME = 'nebula-offline';
const DB_VERSION = 2;
const TRACKS = 'tracks';
const FILES = 'files';
const PLAYLISTS = 'playlists';

/** Metadata row — small, read on every refresh. */
interface TrackRow {
  id: string;
  track: Track;
  fileName: string;
  sizeBytes: number;
  addedAt: number;
}

/** Audio row — read only when a track is about to play. */
interface FileRow {
  id: string;
  blob: Blob;
}

/** A playlist row. Only track ids are stored; everything else is derived on read. */
interface PlaylistRow {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  trackIds: string[];
  /** Data URL of a cover chosen by the listener. Inline, like everything else offline. */
  coverUrl?: string | null;
}

/** The v1 shape, when metadata and audio shared one store. */
interface LegacyRow extends TrackRow {
  blob?: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PLAYLISTS)) db.createObjectStore(PLAYLISTS, { keyPath: 'id' });

      // v1 kept the Blob inside the track row. Move it across rather than making the
      // listener pick their files again.
      if (event.oldVersion === 1 && req.transaction) {
        const tracks = req.transaction.objectStore(TRACKS);
        const files = req.transaction.objectStore(FILES);
        tracks.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (!cursor) return;
          const row = cursor.value as LegacyRow;
          if (row.blob) {
            files.put({ id: row.id, blob: row.blob });
            const { blob, ...rest } = row;
            cursor.update({ ...rest, sizeBytes: rest.sizeBytes ?? blob.size });
          }
          cursor.continue();
        };
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
  return dbPromise;
}

function txOn<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const req = run(transaction.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('falha ao acessar a biblioteca offline'));
  }));
}

/**
 * Runs writes across several stores in one transaction, so metadata and audio can never end
 * up out of step — an orphan blob would waste space nobody could see or free.
 */
function writeAcross(stores: string[], run: (get: (name: string) => IDBObjectStore) => void): Promise<void> {
  return open().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('falha ao gravar a biblioteca offline'));
    run((name) => transaction.objectStore(name));
  }));
}

const txTracks = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) =>
  txOn<T>(TRACKS, mode, run);
const txPlaylists = <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) =>
  txOn<T>(PLAYLISTS, mode, run);

// ---------------------------------------------------------------- metadata

/**
 * Reads the duration straight from the browser's own decoder. It is the only reliable way
 * to get it without shipping a tag parser, and it works for every format the browser plays.
 */
function readDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const probe = new Audio();
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      probe.removeAttribute('src');
      resolve(ms);
    };
    // A file the browser cannot decode still gets added, just with an unknown length —
    // better than silently dropping it.
    probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration * 1000 : 0);
    probe.onerror = () => done(0);
    probe.preload = 'metadata';
    probe.src = url;
  });
}

/** "Artista - Título.mp3" is the near-universal convention; anything else becomes the title. */
function describe(fileName: string): { title: string; artist: string } {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const split = stem.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
  if (split) return { artist: split[1].trim(), title: split[2].trim() };
  return { artist: 'Arquivo local', title: stem || fileName };
}

// ---------------------------------------------------------------- tracks

async function trackRows(): Promise<TrackRow[]> {
  const rows = await txTracks<TrackRow[]>('readonly', (s) => s.getAll() as IDBRequest<TrackRow[]>);
  return rows.sort((a, b) => a.addedAt - b.addedAt);
}

export async function listOfflineTracks(): Promise<Track[]> {
  return (await trackRows()).map((r) => r.track);
}

/**
 * A file the listener picked but has not confirmed yet. The title and artist are guesses from
 * the filename, offered for correction before anything is stored.
 */
export interface OfflineDraft {
  file: File;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  /** Data URL of a cover the listener chose, if any. */
  coverUrl: string | null;
}

/** Reads a picked file well enough to show it in the confirmation dialog. Stores nothing. */
export async function draftFromFile(file: File): Promise<OfflineDraft> {
  const { title, artist } = describe(file.name);
  return { file, title, artist, album: 'Meus arquivos', durationMs: await readDuration(file), coverUrl: null };
}

export async function addOfflineDrafts(drafts: OfflineDraft[]): Promise<Track[]> {
  const added: Track[] = [];
  for (const draft of drafts) {
    const id = `local:${randomId()}`;
    const [colorA, colorB] = paletteFor(id);
    const track: Track = {
      id,
      title: draft.title.trim() || draft.file.name,
      artist: draft.artist.trim() || 'Arquivo local',
      album: draft.album.trim() || 'Meus arquivos',
      durationMs: draft.durationMs,
      source: 'local',
      coverUrl: draft.coverUrl,
      colorA,
      colorB,
    };
    await writeAcross([TRACKS, FILES], (store) => {
      store(TRACKS).put({
        id, track, fileName: draft.file.name, sizeBytes: draft.file.size, addedAt: Date.now(),
      });
      store(FILES).put({ id, blob: draft.file });
    });
    added.push(track);
  }
  return added;
}

/**
 * Corrects the title, artist or album of a local file. The name guessed from the filename is
 * wrong often enough that fixing it has to be possible — and since nothing here is shared,
 * the edit only ever touches this device.
 */
export async function updateOfflineTrack(
  id: string,
  patch: { title?: string; artist?: string; album?: string; coverUrl?: string | null },
): Promise<Track> {
  const row = await txTracks<TrackRow | undefined>(
    'readonly', (s) => s.get(id) as IDBRequest<TrackRow | undefined>,
  );
  if (!row) throw new Error('faixa não encontrada neste aparelho');

  const clean = (value: string | undefined, fallback: string) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : fallback;
  };
  const track: Track = {
    ...row.track,
    title: clean(patch.title, row.track.title),
    artist: clean(patch.artist, row.track.artist),
    album: clean(patch.album, row.track.album),
    // Explicit null clears the image; leaving the field out keeps whatever is there.
    coverUrl: patch.coverUrl === undefined ? row.track.coverUrl ?? null : patch.coverUrl,
  };
  await txTracks('readwrite', (s) => s.put({ ...row, track }));
  return track;
}

export async function removeOfflineTrack(id: string): Promise<void> {
  await writeAcross([TRACKS, FILES], (store) => {
    store(TRACKS).delete(id);
    store(FILES).delete(id);
  });
  // A playlist must never point at a file that is gone.
  await pruneOfflinePlaylists(new Set((await trackRows()).map((r) => r.id)));
}

export async function clearOfflineLibrary(): Promise<void> {
  await writeAcross([TRACKS, FILES], (store) => {
    store(TRACKS).clear();
    store(FILES).clear();
  });
  await pruneOfflinePlaylists(new Set());
}

/** Blob URL for a stored file. The caller owns it and must revoke it when done. */
export async function offlineTrackUrl(id: string): Promise<string | null> {
  const row = await txOn<FileRow | undefined>(
    FILES, 'readonly', (s) => s.get(id) as IDBRequest<FileRow | undefined>,
  );
  return row ? URL.createObjectURL(row.blob) : null;
}

export async function offlineLibrarySize(): Promise<number> {
  return (await trackRows()).reduce((sum, r) => sum + r.sizeBytes, 0);
}

// ---------------------------------------------------------------- playlists

/** Derives the display shape from the stored ids plus the tracks this device still holds. */
function toPlaylist(row: PlaylistRow, byId: Map<string, Track>): Playlist {
  const tracks = row.trackIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
  const [colorA, colorB] = paletteFor(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    trackCount: tracks.length,
    durationMs: tracks.reduce((sum, t) => sum + t.durationMs, 0),
    coverUrl: row.coverUrl ?? null,
    colorA,
    colorB,
  };
}

async function playlistRows(): Promise<PlaylistRow[]> {
  return txPlaylists<PlaylistRow[]>('readonly', (s) => s.getAll() as IDBRequest<PlaylistRow[]>);
}

async function trackMap(): Promise<Map<string, Track>> {
  return new Map((await trackRows()).map((r) => [r.id, r.track]));
}

export async function listOfflinePlaylists(): Promise<Playlist[]> {
  const [rows, byId] = await Promise.all([playlistRows(), trackMap()]);
  return rows.sort((a, b) => b.createdAt - a.createdAt).map((row) => toPlaylist(row, byId));
}

export async function getOfflinePlaylist(id: string): Promise<PlaylistDetail | null> {
  const [row, byId] = await Promise.all([
    txPlaylists<PlaylistRow | undefined>('readonly', (s) => s.get(id) as IDBRequest<PlaylistRow | undefined>),
    trackMap(),
  ]);
  if (!row) return null;
  return {
    ...toPlaylist(row, byId),
    // Duplicates are kept: the same file twice in a row is a legitimate playlist.
    tracks: row.trackIds.map((tid) => byId.get(tid)).filter((t): t is Track => Boolean(t)),
  };
}

export async function createOfflinePlaylist(name: string, description = ''): Promise<Playlist> {
  const row: PlaylistRow = {
    id: `offpl:${randomId()}`,
    name,
    description,
    createdAt: Date.now(),
    trackIds: [],
    coverUrl: null,
  };
  await txPlaylists('readwrite', (s) => s.put(row));
  return toPlaylist(row, new Map());
}

export async function deleteOfflinePlaylist(id: string): Promise<void> {
  await txPlaylists<undefined>('readwrite', (s) => s.delete(id));
}

/** Read-modify-write; every mutation goes through here so the shape stays in one place. */
async function mutate(id: string, fn: (row: PlaylistRow) => PlaylistRow): Promise<void> {
  const row = await txPlaylists<PlaylistRow | undefined>(
    'readonly', (s) => s.get(id) as IDBRequest<PlaylistRow | undefined>,
  );
  if (!row) throw new Error('playlist offline não encontrada');
  await txPlaylists('readwrite', (s) => s.put(fn(row)));
}

export function renameOfflinePlaylist(id: string, name: string): Promise<void> {
  return mutate(id, (row) => ({ ...row, name }));
}

export function addTrackToOfflinePlaylist(id: string, trackId: string): Promise<void> {
  return mutate(id, (row) => ({ ...row, trackIds: [...row.trackIds, trackId] }));
}

export function removeTrackFromOfflinePlaylist(id: string, trackId: string): Promise<void> {
  return mutate(id, (row) => {
    const at = row.trackIds.indexOf(trackId);
    if (at < 0) return row;
    return { ...row, trackIds: [...row.trackIds.slice(0, at), ...row.trackIds.slice(at + 1)] };
  });
}

export function reorderOfflinePlaylist(id: string, trackIds: string[]): Promise<void> {
  return mutate(id, (row) => ({ ...row, trackIds }));
}

/** `null` goes back to the generated gradient. */
export function setOfflinePlaylistCover(id: string, coverUrl: string | null): Promise<void> {
  return mutate(id, (row) => ({ ...row, coverUrl }));
}

/** Drops ids whose file is no longer in the library, from every playlist. */
async function pruneOfflinePlaylists(available: Set<string>): Promise<void> {
  for (const row of await playlistRows()) {
    const kept = row.trackIds.filter((id) => available.has(id));
    if (kept.length !== row.trackIds.length) {
      await txPlaylists('readwrite', (s) => s.put({ ...row, trackIds: kept }));
    }
  }
}
