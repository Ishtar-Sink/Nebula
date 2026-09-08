/**
 * Nebula sync protocol — shared by server, web, mobile and (mirrored) the Rust desktop app.
 *
 * Design: the server owns one authoritative PlaybackState. Every device receives the full
 * state on each change and *reconciles* its local audio engine against it. Exactly one
 * device is `activeDeviceId` and actually produces sound; every other device renders the
 * same state as a remote control. This is what makes "trocar de música no celular enquanto
 * toca no desktop" work without any peer-to-peer plumbing.
 */

export type Platform = 'web' | 'mobile' | 'desktop';
export type TrackSource = 'catalog' | 'local';
export type RepeatMode = 'off' | 'context' | 'track';

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  /** Device is online (websocket open). Offline devices linger briefly so the UI doesn't flicker. */
  online: boolean;
  lastSeen: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  /**
   * `catalog` tracks live on the server and stream to any device. `local` tracks are files the
   * listener picked from their own disk: they never reach the server and never leave the device
   * that opened them, so they only ever exist client-side (see the offline mode).
   */
  source: TrackSource;
  /**
   * A real cover image, when one was set. Server tracks carry a path relative to the API
   * (`/cover/<file>`); offline tracks carry a data URL, since they have no server. Null means
   * "no image", and every client falls back to the generated gradient below.
   */
  coverUrl?: string | null;
  /** Two hex colors used to render the generated cover art consistently on every platform. */
  colorA: string;
  colorB: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  trackCount: number;
  durationMs: number;
  /** Same contract as `Track.coverUrl`: a path for server playlists, a data URL offline. */
  coverUrl?: string | null;
  colorA: string;
  colorB: string;
}

export interface PlaylistDetail extends Playlist {
  tracks: Track[];
}

export interface PlaybackState {
  /** Monotonic revision. Bumped on every meaningful change (not on progress ticks). */
  rev: number;
  activeDeviceId: string | null;
  /** 'catalog' | 'playlist:<id>' | 'album:<name>' | 'search' — what the queue was built from. */
  contextId: string | null;
  contextName: string | null;
  queue: string[];
  queueIndex: number;
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** Server clock (epoch ms) when positionMs was last written. Lets idle devices extrapolate. */
  positionUpdatedAt: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
}

export type Command =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'volume'; volume: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'shuffle'; shuffle: boolean }
  | { type: 'repeat'; repeat: RepeatMode }
  | {
      type: 'playContext';
      contextId: string;
      contextName: string;
      trackIds: string[];
      startIndex: number;
    }
  | { type: 'queueAdd'; trackId: string }
  | { type: 'queueRemove'; index: number }
  | { type: 'transfer'; deviceId: string; play?: boolean }
  | { type: 'trackEnded' };

export type ClientMessage =
  | { t: 'hello'; device: { id: string; name: string; platform: Platform } }
  | { t: 'command'; cmd: Command }
  | { t: 'progress'; positionMs: number; durationMs: number; isPlaying: boolean }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; deviceId: string; state: PlaybackState; devices: DeviceInfo[] }
  | { t: 'state'; state: PlaybackState }
  | { t: 'devices'; devices: DeviceInfo[] }
  | { t: 'library'; reason: string }
  | { t: 'error'; message: string }
  | { t: 'pong' };

export const INITIAL_STATE: PlaybackState = {
  rev: 0,
  activeDeviceId: null,
  contextId: null,
  contextName: null,
  queue: [],
  queueIndex: -1,
  trackId: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  positionUpdatedAt: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
};

/**
 * Position a *non-active* device should display: the last reported position plus the time
 * that has elapsed since, clamped to the track duration. The active device uses its own
 * audio clock instead, which is always more accurate.
 */
export function estimatePosition(state: PlaybackState, now: number = Date.now()): number {
  if (!state.isPlaying) return state.positionMs;
  const elapsed = Math.max(0, now - state.positionUpdatedAt);
  const pos = state.positionMs + elapsed;
  return state.durationMs > 0 ? Math.min(pos, state.durationMs) : pos;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Fisher-Yates that always keeps `keepFirst` at index 0 (Spotify shuffles "the rest"). */
export function shuffleQueue(ids: string[], keepFirst?: string): string[] {
  const rest = keepFirst ? ids.filter((id) => id !== keepFirst) : [...ids];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return keepFirst ? [keepFirst, ...rest] : rest;
}

export type { OfflineSession } from './offline.ts';
export {
  OFFLINE_DEVICE_ID, initialOfflineSession, reduceOffline, pruneOfflineSession,
  observeOfflinePosition,
} from './offline.ts';
