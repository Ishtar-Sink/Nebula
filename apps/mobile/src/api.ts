import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Track, Playlist, PlaylistDetail } from '@nebula/protocol';

const OVERRIDE_KEY = 'nebula.serverUrl';
let overrideUrl: string | null = null;

/**
 * In Expo Go the Metro bundler already runs on the machine hosting the Nebula server, so
 * `hostUri` gives us the right LAN address with no configuration. A manual override is kept
 * for the cases where that guess is wrong (tunnels, a server on another machine).
 */
function derivedUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    '';
  const host = hostUri.split(':')[0];
  return host ? `http://${host}:4000` : 'http://localhost:4000';
}

export function apiUrl(): string {
  return overrideUrl ?? derivedUrl();
}

export function wsUrl(): string {
  return apiUrl().replace(/^http/, 'ws') + '/ws';
}

export async function loadOverride(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(OVERRIDE_KEY);
    if (stored) overrideUrl = stored;
  } catch { /* first run, or storage unavailable */ }
}

export async function setOverride(url: string | null): Promise<void> {
  overrideUrl = url && url.trim() ? url.trim().replace(/\/$/, '') : null;
  try {
    if (overrideUrl) await AsyncStorage.setItem(OVERRIDE_KEY, overrideUrl);
    else await AsyncStorage.removeItem(OVERRIDE_KEY);
  } catch { /* non-fatal: the override just won't survive a restart */ }
}

export const streamUrl = (trackId: string) => `${apiUrl()}/stream/${encodeURIComponent(trackId)}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  health: () => request<{ ok: boolean; tracks: number; playlists: number; devices: number }>('/api/health'),
  tracks: () => request<Track[]>('/api/tracks'),
  playlists: () => request<Playlist[]>('/api/playlists'),
  playlist: (id: string) => request<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (name: string) =>
    request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) }),
  deletePlaylist: (id: string) => request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (id: string, trackId: string) =>
    request<PlaylistDetail>(`/api/playlists/${id}/tracks`, {
      method: 'POST', body: JSON.stringify({ trackId }),
    }),
  removeFromPlaylist: (id: string, trackId: string) =>
    request<PlaylistDetail>(`/api/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    }),
};

export async function persistentDeviceId(): Promise<string> {
  const KEY = 'nebula.deviceId';
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) return stored;
  } catch { /* fall through to a fresh id */ }
  const id = `mob-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try { await AsyncStorage.setItem(KEY, id); } catch { /* ephemeral id this session */ }
  return id;
}
