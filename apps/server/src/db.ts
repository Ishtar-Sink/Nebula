import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Track, Playlist, PlaylistDetail } from '@nebula/protocol';
import { paletteFor } from '@nebula/theme';
import { DATA_DIR, DB_PATH, COVER_DIR } from './config.ts';

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(COVER_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS tracks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    album       TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    source      TEXT NOT NULL,
    path        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    color_a     TEXT NOT NULL,
    color_b     TEXT NOT NULL,
    added_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    color_a     TEXT NOT NULL,
    color_b     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pt_playlist ON playlist_tracks(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_pt_track ON playlist_tracks(track_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);
`);


/**
 * node:sqlite types every column as SQLOutputValue, so casting a result straight to a row
 * interface is rejected. These keep the unavoidable double cast in one place.
 */
const many = <T>(value: unknown): T[] => value as T[];
const one = <T>(value: unknown): T | undefined => value as T | undefined;

/**
 * Added after the first release: a real cover image for a playlist or an album. Older
 * databases just gain an empty column, so no export/import is needed.
 */
for (const [table, column] of [['tracks', 'cover'], ['playlists', 'cover']] as const) {
  const columns = many<{ name: string }>(db.prepare(`PRAGMA table_info(${table})`).all());
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
}

interface TrackRow {
  id: string; title: string; artist: string; album: string;
  duration_ms: number; source: string; path: string; mime: string;
  color_a: string; color_b: string; added_at: number; cover: string | null;
}

interface PlaylistRow {
  id: string; name: string; description: string;
  created_at: number; color_a: string; color_b: string; cover: string | null;
}

/** Clients receive a path, never a filesystem location. `null` means "use the gradient". */
const coverUrl = (file: string | null | undefined) =>
  (file ? `/cover/${encodeURIComponent(file)}` : null);

function toTrack(r: TrackRow): Track {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    durationMs: r.duration_ms,
    source: r.source as Track['source'],
    coverUrl: coverUrl(r.cover),
    colorA: r.color_a,
    colorB: r.color_b,
  };
}

// ---------------------------------------------------------------- tracks

export function upsertTrack(t: {
  id: string; title: string; artist: string; album: string;
  durationMs: number; source: string; path: string; mime: string;
}): void {
  const [colorA, colorB] = paletteFor(t.album || t.id);
  db.prepare(
    `INSERT INTO tracks (id,title,artist,album,duration_ms,source,path,mime,color_a,color_b,added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, artist=excluded.artist, album=excluded.album,
       duration_ms=excluded.duration_ms, path=excluded.path, mime=excluded.mime,
       color_a=excluded.color_a, color_b=excluded.color_b`
    // `cover` is deliberately absent: re-reading the manifest must not drop an image the
    // backoffice set for the album.
  ).run(
    t.id, t.title, t.artist, t.album, Math.round(t.durationMs),
    t.source, t.path, t.mime, colorA, colorB, Date.now(),
  );
}

export function getTrack(id: string): Track | null {
  const r = one<TrackRow>(db.prepare('SELECT * FROM tracks WHERE id = ?').get(id));
  return r ? toTrack(r) : null;
}

export function getTrackFile(id: string): { path: string; mime: string } | null {
  const r = one<{ path: string; mime: string }>(
    db.prepare('SELECT path, mime FROM tracks WHERE id = ?').get(id),
  );
  return r ?? null;
}

export function listTracks(source?: string): Track[] {
  const r = source
    ? db.prepare('SELECT * FROM tracks WHERE source = ? ORDER BY artist, album, title').all(source)
    : db.prepare('SELECT * FROM tracks ORDER BY artist, album, title').all();
  return many<TrackRow>(r).map(toTrack);
}

export function searchTracks(q: string): Track[] {
  const like = `%${q.toLowerCase()}%`;
  const r = db.prepare(
    `SELECT * FROM tracks
     WHERE lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(album) LIKE ?
     ORDER BY artist, album, title LIMIT 100`
  ).all(like, like, like);
  return many<TrackRow>(r).map(toTrack);
}

/** Drops rows of `source` whose id is no longer present — the file or manifest entry is gone. */
export function deleteTracksNotIn(source: string, keepIds: string[]): number {
  const existing = many<{ id: string }>(
    db.prepare('SELECT id FROM tracks WHERE source = ?').all(source),
  );
  const keep = new Set(keepIds);
  const del = db.prepare('DELETE FROM tracks WHERE id = ?');
  let removed = 0;
  for (const r of existing) {
    if (!keep.has(r.id)) { del.run(r.id); removed++; }
  }
  return removed;
}

// ---------------------------------------------------------------- playlists

function toPlaylist(r: PlaylistRow): Playlist {
  const agg = one<{ c: number; d: number }>(
    db.prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(t.duration_ms),0) AS d
       FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?`
    ).get(r.id),
  )!;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    trackCount: agg.c,
    durationMs: agg.d,
    coverUrl: coverUrl(r.cover),
    colorA: r.color_a,
    colorB: r.color_b,
  };
}

function playlistRow(id: string): PlaylistRow | undefined {
  return one<PlaylistRow>(db.prepare('SELECT * FROM playlists WHERE id = ?').get(id));
}

export function listPlaylists(): Playlist[] {
  const r = db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all();
  return many<PlaylistRow>(r).map(toPlaylist);
}

export function createPlaylist(name: string, description = ''): Playlist {
  const id = randomUUID();
  const [colorA, colorB] = paletteFor(id);
  db.prepare(
    'INSERT INTO playlists (id,name,description,created_at,color_a,color_b) VALUES (?,?,?,?,?,?)'
  ).run(id, name, description, Date.now(), colorA, colorB);
  return toPlaylist(playlistRow(id)!);
}

export function getPlaylist(id: string): PlaylistDetail | null {
  const r = playlistRow(id);
  if (!r) return null;
  const trackRows = many<TrackRow>(
    db.prepare(
      `SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ? ORDER BY pt.position, pt.id`
    ).all(id),
  );
  return { ...toPlaylist(r), tracks: trackRows.map(toTrack) };
}

export function updatePlaylist(
  id: string,
  patch: { name?: string; description?: string },
): Playlist | null {
  const r = playlistRow(id);
  if (!r) return null;
  db.prepare('UPDATE playlists SET name = ?, description = ? WHERE id = ?')
    .run(patch.name ?? r.name, patch.description ?? r.description, id);
  return toPlaylist(playlistRow(id)!);
}

/**
 * Points a playlist at a cover file (or clears it), returning the file it used to have so the
 * caller can delete the orphan. Returns undefined when the playlist does not exist.
 */
export function setPlaylistCover(id: string, file: string | null): { previous: string | null } | undefined {
  const r = playlistRow(id);
  if (!r) return undefined;
  db.prepare('UPDATE playlists SET cover = ? WHERE id = ?').run(file, id);
  return { previous: r.cover };
}

/**
 * An album is just a metadata string, so its cover lives on every track that belongs to it.
 * Returns the replaced files, which are orphans once nothing else references them.
 */
export function setAlbumCover(album: string, file: string | null): { changed: number; previous: string[] } {
  const rows = many<{ cover: string | null }>(
    db.prepare('SELECT cover FROM tracks WHERE album = ?').all(album),
  );
  if (rows.length === 0) return { changed: 0, previous: [] };
  db.prepare('UPDATE tracks SET cover = ? WHERE album = ?').run(file, album);
  const previous = [...new Set(rows.map((r) => r.cover).filter((c): c is string => Boolean(c)))];
  return { changed: rows.length, previous: previous.filter((c) => c !== file) };
}

/** True when any row still points at this file — an orphan check before deleting it. */
export function coverInUse(file: string): boolean {
  return Boolean(
    one(db.prepare('SELECT 1 FROM tracks WHERE cover = ? LIMIT 1').get(file)) ??
    one(db.prepare('SELECT 1 FROM playlists WHERE cover = ? LIMIT 1').get(file)),
  );
}

export function deletePlaylist(id: string): { cover: string | null } | null {
  // playlist_tracks rows go with it via ON DELETE CASCADE (foreign_keys is ON).
  const r = playlistRow(id);
  if (!r) return null;
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return { cover: r.cover };
}

export function addTrackToPlaylist(playlistId: string, trackId: string): boolean {
  if (!playlistRow(playlistId)) return false;
  if (!one(db.prepare('SELECT id FROM tracks WHERE id = ?').get(trackId))) return false;

  const next = one<{ p: number }>(
    db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId),
  )!;
  db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)')
    .run(playlistId, trackId, next.p);
  return true;
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  // Remove one occurrence: a playlist may legitimately hold the same track twice.
  const r = one<{ id: number }>(
    db.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? ORDER BY position LIMIT 1')
      .get(playlistId, trackId),
  );
  if (!r) return false;
  db.prepare('DELETE FROM playlist_tracks WHERE id = ?').run(r.id);
  return true;
}

export function reorderPlaylist(playlistId: string, trackIds: string[]): boolean {
  const rows = many<{ id: number; track_id: string }>(
    db.prepare('SELECT id, track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position, id')
      .all(playlistId),
  );
  if (rows.length === 0) return false;

  // Map the requested order back onto concrete rows so duplicated tracks keep their identity.
  const byTrack = new Map<string, number[]>();
  for (const r of rows) {
    const list = byTrack.get(r.track_id) ?? [];
    list.push(r.id);
    byTrack.set(r.track_id, list);
  }

  const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ?');
  let pos = 0;
  for (const trackId of trackIds) {
    const ids = byTrack.get(trackId);
    if (!ids || ids.length === 0) continue;
    update.run(pos++, ids.shift()!);
  }
  return true;
}
