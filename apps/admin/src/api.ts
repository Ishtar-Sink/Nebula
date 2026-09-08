export interface AdminTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  file: string;
  sizeBytes: number;
  /** How many listener playlists reference this track — deleting it removes it from them. */
  inPlaylists: number;
  /** Path to the cover image, or null when the generated gradient is used. */
  coverUrl: string | null;
  /** Attribution, when it was recorded. Imported tracks usually carry both. */
  license?: string;
  sourceUrl?: string;
  sourceId?: string;
}

export interface ToolStatus {
  ready: boolean;
  ytdlp: { found: boolean; version: string | null };
  ffmpeg: { found: boolean; version: string | null };
  hint: string;
}

export interface ProbeEntry {
  url: string;
  sourceId: string;
  title: string;
  uploader: string;
  durationMs: number;
  thumbnail: string | null;
  /** Title it already has in the catalog, or null when it is new. */
  duplicateOf: string | null;
}

export interface ProbeResult {
  provider: { id: string; name: string; notes: string };
  kind: 'track' | 'collection';
  title: string;
  uploader: string;
  suggestedLicense: string;
  entries: ProbeEntry[];
}

export interface ImportItem {
  url: string;
  title: string;
  status: 'pendente' | 'baixando' | 'ok' | 'erro' | 'cancelada' | 'duplicada';
  detail?: string;
  trackId?: string;
}

export interface ImportJob {
  id: string;
  createdAt: number;
  finishedAt: number | null;
  cancelled: boolean;
  items: ImportItem[];
}

export interface AdminAlbum {
  name: string; artist: string; count: number; durationMs: number; coverUrl: string | null;
}

/** Covers arrive as a server path; the browser needs it absolute. */
export const coverSrc = (coverUrl: string | null | undefined) =>
  (coverUrl ? `${API_URL}${coverUrl}` : null);

export interface Overview {
  tracks: AdminTrack[];
  albums: AdminAlbum[];
  totals: { tracks: number; sizeBytes: number; durationMs: number; playlists: number };
  catalogDir: string;
  protected: boolean;
}

const envUrl = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
export const API_URL =
  envUrl && envUrl.length > 0
    ? envUrl.replace(/\/$/, '')
    : `${location.protocol}//${location.hostname}:4000`;

const TOKEN_KEY = 'nebula.adminToken';
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return { ...extra, ...(token ? { 'X-Admin-Token': token } : {}) };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: headers({ 'Content-Type': 'application/json', ...((init?.headers as Record<string, string>) ?? {}) }),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const streamUrl = (id: string) => `${API_URL}/stream/${encodeURIComponent(id)}`;

export const admin = {
  overview: () => request<Overview>('/api/admin/overview'),

  update: (
    id: string,
    patch: { title?: string; artist?: string; album?: string; license?: string; sourceUrl?: string },
  ) =>
    request<AdminTrack>(`/api/admin/catalog/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  remove: (id: string) =>
    request<void>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Sets the image for every track of an album; `null` clears it. */
  setAlbumCover: async (album: string, image: Blob | null): Promise<{ changed: number }> => {
    const url = `${API_URL}/api/admin/albums/cover?album=${encodeURIComponent(album)}`;
    const res = image
      ? await fetch(url, {
          method: 'PUT',
          headers: headers({ 'Content-Type': image.type || 'image/jpeg' }),
          body: image,
        })
      : await fetch(url, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error(`falha ao enviar a imagem: ${res.status}`);
    return (await res.json()) as { changed: number };
  },

  renameAlbum: (from: string, patch: { album?: string; artist?: string }) =>
    request<{ changed: number }>('/api/admin/albums', {
      method: 'PATCH',
      body: JSON.stringify({ from, ...patch }),
    }),

  /** Streams the raw file up as the request body — no multipart parsing needed server-side. */
  upload: async (
    file: File,
    meta: { title?: string; artist?: string; album?: string; license?: string; sourceUrl?: string },
  ): Promise<AdminTrack> => {
    const params = new URLSearchParams({ name: file.name });
    for (const key of ['title', 'artist', 'album', 'license', 'sourceUrl'] as const) {
      if (meta[key]) params.set(key, meta[key]);
    }

    const res = await fetch(`${API_URL}/api/admin/catalog?${params}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': file.type || 'application/octet-stream' }),
      body: file,
    });
    if (!res.ok) {
      let message = `${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch { /* non-JSON body */ }
      throw new Error(message);
    }
    return (await res.json()) as AdminTrack;
  },

  // ------------------------------------------------------------------ importer
  importTools: (refresh = false) =>
    request<ToolStatus>(`/api/admin/import/tools${refresh ? '?refresh=1' : ''}`),

  probe: (url: string) =>
    request<ProbeResult>('/api/admin/import/probe', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  startImport: (items: {
    url: string; sourceId?: string; title?: string; artist?: string; album?: string; license?: string;
  }[]) =>
    request<ImportJob>('/api/admin/import', { method: 'POST', body: JSON.stringify({ items }) }),

  importJob: (id: string) => request<ImportJob>(`/api/admin/import/${id}`),

  cancelImport: (id: string) =>
    request<{ cancelled: boolean }>(`/api/admin/import/${id}`, { method: 'DELETE' }),
};
