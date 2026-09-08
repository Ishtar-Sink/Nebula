/**
 * The offline library, stored entirely on this phone.
 *
 * Picked files are copied into the app's document directory — a place the system will not
 * clear — and their metadata into AsyncStorage. Nothing is uploaded and no other device
 * ever learns these tracks exist.
 *
 * Offline playlists live here too, for the same reason: they reference files that only this
 * phone has, so a server copy of them could never be played anywhere else.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { createAudioPlayer, type AudioStatus } from 'expo-audio';
import type { Playlist, PlaylistDetail, Track } from '@nebula/protocol';
import { paletteFor } from '@nebula/theme';

const INDEX_KEY = 'nebula.offline.tracks';
const PLAYLISTS_KEY = 'nebula.offline.playlists';
const FOLDER = 'offline-audio';

export interface OfflineEntry {
  track: Track;
  /** File name inside the offline folder. The full URI is rebuilt on read, never stored. */
  file: string;
  addedAt: number;
}

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileFor(name: string): File {
  return new File(folder(), name);
}

/** Absolute URI for playback. Rebuilt each time because the sandbox path changes per install. */
export function offlineTrackUri(entry: OfflineEntry): string {
  return fileFor(entry.file).uri;
}

async function readIndex(): Promise<OfflineEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as OfflineEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: OfflineEntry[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------- metadata

/**
 * Asks the audio engine itself how long the file is. It is the only reliable answer for
 * every format the phone can play, and it needs no tag parser.
 */
function readDuration(uri: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const player = createAudioPlayer({ uri }, { updateInterval: 100 });
    const finish = (ms: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.remove();
      try { player.remove(); } catch { /* already released */ }
      resolve(Math.max(0, Math.round(ms)));
    };
    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.isLoaded && status.duration > 0) finish(status.duration * 1000);
    });
    // A file whose length never resolves is still worth keeping — it just shows 0:00.
    const timer = setTimeout(() => finish(player.duration > 0 ? player.duration * 1000 : 0), 5000);
  });
}

/** "Artista - Título.mp3" is the near-universal convention; anything else becomes the title. */
function describe(fileName: string): { title: string; artist: string } {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const split = stem.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
  if (split) return { artist: split[1].trim(), title: split[2].trim() };
  return { artist: 'Arquivo local', title: stem || fileName };
}

function safeName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-70) || 'audio.mp3';
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${cleaned}`;
}

// ---------------------------------------------------------------- api

export async function listOfflineEntries(): Promise<OfflineEntry[]> {
  const entries = await readIndex();
  // A file the user deleted outside the app must not linger as a dead row.
  const alive = entries.filter((e) => fileFor(e.file).exists);
  if (alive.length !== entries.length) await writeIndex(alive);
  return alive.sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * A file the listener picked but has not confirmed yet. Nothing is copied or stored until
 * they accept the list — the title and artist here are guesses from the filename.
 */
export interface OfflineDraft {
  uri: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  /** Local URI of a cover image already copied into the app's folder, if one was chosen. */
  coverUrl: string | null;
}

export async function draftFromFile(uri: string, name: string): Promise<OfflineDraft> {
  const { title, artist } = describe(name);
  return {
    uri, name, title, artist,
    album: 'Meus arquivos',
    durationMs: await readDuration(uri),
    coverUrl: null,
  };
}

/**
 * Copies a picked image into the app's own folder and returns its URI.
 *
 * The URI is stored rather than the bytes: AsyncStorage holds the index, and a base64 image
 * inlined there would blow through its (small) budget after a handful of covers.
 */
export async function saveCoverImage(uri: string, name: string): Promise<string> {
  const file = safeName(name || 'cover.jpg');
  await new File(uri).copy(fileFor(file));
  return fileFor(file).uri;
}

export async function addOfflineDrafts(drafts: OfflineDraft[]): Promise<Track[]> {
  const added: Track[] = [];
  const entries = await readIndex();

  for (const draft of drafts) {
    const file = safeName(draft.name);
    await new File(draft.uri).copy(fileFor(file));

    const id = `local:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const [colorA, colorB] = paletteFor(id);
    const track: Track = {
      id,
      title: draft.title.trim() || draft.name,
      artist: draft.artist.trim() || 'Arquivo local',
      album: draft.album.trim() || 'Meus arquivos',
      durationMs: draft.durationMs,
      source: 'local',
      coverUrl: draft.coverUrl,
      colorA,
      colorB,
    };
    entries.push({ track, file, addedAt: Date.now() });
    added.push(track);
  }

  await writeIndex(entries);
  return added;
}

/**
 * Corrects the title, artist or album of a local file. The name guessed from the filename is
 * wrong often enough that fixing it has to be possible — and since nothing here is shared,
 * the edit only ever touches this phone.
 */
export async function updateOfflineTrack(
  id: string,
  patch: { title?: string; artist?: string; album?: string; coverUrl?: string | null },
): Promise<Track> {
  const entries = await readIndex();
  const at = entries.findIndex((e) => e.track.id === id);
  if (at < 0) throw new Error('faixa não encontrada neste aparelho');

  const clean = (value: string | undefined, fallback: string) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : fallback;
  };
  const track: Track = {
    ...entries[at].track,
    title: clean(patch.title, entries[at].track.title),
    artist: clean(patch.artist, entries[at].track.artist),
    album: clean(patch.album, entries[at].track.album),
    // Explicit null clears the image; leaving the field out keeps whatever is there.
    coverUrl: patch.coverUrl === undefined ? entries[at].track.coverUrl ?? null : patch.coverUrl,
  };
  const next = [...entries];
  next[at] = { ...entries[at], track };
  await writeIndex(next);
  return track;
}

export async function removeOfflineTrack(id: string): Promise<void> {
  const entries = await readIndex();
  const gone = entries.find((e) => e.track.id === id);
  if (gone) {
    try { fileFor(gone.file).delete(); } catch { /* already gone from disk */ }
  }
  const kept = entries.filter((e) => e.track.id !== id);
  await writeIndex(kept);
  // A playlist must never point at a file that is gone.
  await prunePlaylists(new Set(kept.map((e) => e.track.id)));
}

export async function clearOfflineLibrary(): Promise<void> {
  for (const entry of await readIndex()) {
    try { fileFor(entry.file).delete(); } catch { /* already gone from disk */ }
  }
  await writeIndex([]);
  await prunePlaylists(new Set());
}

export async function offlineLibrarySize(): Promise<number> {
  let total = 0;
  for (const entry of await readIndex()) {
    const f = fileFor(entry.file);
    if (f.exists) total += f.size ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------- playlists

/** Only track ids are stored; counts, duration and cover colours are derived on read. */
interface PlaylistRow {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  trackIds: string[];
  /** Local URI of a cover image copied into the app's folder. */
  coverUrl?: string | null;
}

async function readPlaylists(): Promise<PlaylistRow[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAYLISTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as PlaylistRow[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePlaylists(rows: PlaylistRow[]): Promise<void> {
  await AsyncStorage.setItem(PLAYLISTS_KEY, JSON.stringify(rows));
}

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

async function trackMap(): Promise<Map<string, Track>> {
  return new Map((await listOfflineEntries()).map((e) => [e.track.id, e.track]));
}

export async function listOfflinePlaylists(): Promise<Playlist[]> {
  const [rows, byId] = await Promise.all([readPlaylists(), trackMap()]);
  return rows.sort((a, b) => b.createdAt - a.createdAt).map((row) => toPlaylist(row, byId));
}

export async function getOfflinePlaylist(id: string): Promise<PlaylistDetail | null> {
  const [rows, byId] = await Promise.all([readPlaylists(), trackMap()]);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return {
    ...toPlaylist(row, byId),
    // Duplicates are kept: the same file twice in a row is a legitimate playlist.
    tracks: row.trackIds.map((tid) => byId.get(tid)).filter((t): t is Track => Boolean(t)),
  };
}

export async function createOfflinePlaylist(name: string, description = ''): Promise<Playlist> {
  const row: PlaylistRow = {
    id: `offpl:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    createdAt: Date.now(),
    trackIds: [],
    coverUrl: null,
  };
  await writePlaylists([...(await readPlaylists()), row]);
  return toPlaylist(row, new Map());
}

export async function deleteOfflinePlaylist(id: string): Promise<void> {
  await writePlaylists((await readPlaylists()).filter((r) => r.id !== id));
}

/** Read-modify-write; every mutation goes through here so the shape stays in one place. */
async function mutate(id: string, fn: (row: PlaylistRow) => PlaylistRow): Promise<void> {
  const rows = await readPlaylists();
  const at = rows.findIndex((r) => r.id === id);
  if (at < 0) throw new Error('playlist offline não encontrada');
  const next = [...rows];
  next[at] = fn(rows[at]);
  await writePlaylists(next);
}

export function renameOfflinePlaylist(id: string, name: string): Promise<void> {
  return mutate(id, (row) => ({ ...row, name }));
}

export function addTrackToOfflinePlaylist(id: string, trackId: string): Promise<void> {
  return mutate(id, (row) => ({ ...row, trackIds: [...row.trackIds, trackId] }));
}

/** `null` goes back to the generated gradient. */
export function setOfflinePlaylistCover(id: string, coverUrl: string | null): Promise<void> {
  return mutate(id, (row) => ({ ...row, coverUrl }));
}

export function removeTrackFromOfflinePlaylist(id: string, trackId: string): Promise<void> {
  return mutate(id, (row) => {
    const at = row.trackIds.indexOf(trackId);
    if (at < 0) return row;
    return { ...row, trackIds: [...row.trackIds.slice(0, at), ...row.trackIds.slice(at + 1)] };
  });
}

/** Drops ids whose file is no longer in the library, from every playlist. */
async function prunePlaylists(available: Set<string>): Promise<void> {
  const rows = await readPlaylists();
  const next = rows.map((row) => {
    const kept = row.trackIds.filter((id) => available.has(id));
    return kept.length === row.trackIds.length ? row : { ...row, trackIds: kept };
  });
  await writePlaylists(next);
}
