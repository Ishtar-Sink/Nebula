import type { Track, Playlist, PlaylistDetail, PlaybackState, DeviceInfo } from '@nebula/protocol';
import { apiUrl } from './identity.ts';

export { apiUrl, wsUrl, defaultUrl, isOverridden, setServerUrl, settingsLocation } from './identity.ts';

/** Catalog audio only. Files from the listener's disk never go through the server — see offline/. */
export const streamUrl = (trackId: string) => `${apiUrl()}/stream/${encodeURIComponent(trackId)}`;

/**
 * Turns a `coverUrl` into something an `<img>` can load. Server covers arrive as a path, so
 * they follow whatever server this client is pointed at; offline covers are already data
 * URLs and pass straight through.
 */
export function coverSrc(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  return coverUrl.startsWith('/') ? `${apiUrl()}${coverUrl}` : coverUrl;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch reports a dead server as a bare "Failed to fetch", which tells the listener
    // nothing — least of all that the offline mode still works.
    throw new Error(`Sem conexão com ${apiUrl()}. O modo offline continua funcionando.`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; tracks: number; playlists: number; devices: number }>('/api/health'),

  tracks: (opts: { source?: string; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.source) p.set('source', opts.source);
    if (opts.q) p.set('q', opts.q);
    const qs = p.toString();
    return request<Track[]>(`/api/tracks${qs ? `?${qs}` : ''}`);
  },

  snapshot: () => request<{ state: PlaybackState; devices: DeviceInfo[] }>('/api/state'),

  playlists: () => request<Playlist[]>('/api/playlists'),
  playlist: (id: string) => request<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (name: string, description = '') =>
    request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description }) }),
  updatePlaylist: (id: string, patch: { name?: string; description?: string }) =>
    request<Playlist>(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePlaylist: (id: string) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),

  addToPlaylist: (id: string, trackId: string) =>
    request<PlaylistDetail>(`/api/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify({ trackId }) }),
  removeFromPlaylist: (id: string, trackId: string) =>
    request<PlaylistDetail>(`/api/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  reorderPlaylist: (id: string, trackIds: string[]) =>
    request<PlaylistDetail>(`/api/playlists/${id}/order`, { method: 'PUT', body: JSON.stringify({ trackIds }) }),

  /** Uploads a playlist cover. The image is downscaled client-side before it gets here. */
  setPlaylistCover: async (id: string, blob: Blob) => {
    const res = await fetch(`${apiUrl()}/api/playlists/${id}/cover`, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
    });
    if (!res.ok) throw new Error(`falha ao enviar a imagem: ${res.status}`);
    return (await res.json()) as PlaylistDetail;
  },

  clearPlaylistCover: (id: string) =>
    request<PlaylistDetail>(`/api/playlists/${id}/cover`, { method: 'DELETE' }),
};
