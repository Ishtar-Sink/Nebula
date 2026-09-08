/**
 * Who this client is and which server it talks to — resolved once at startup, before the
 * websocket opens, because both answers come from storage that may be asynchronous.
 */
import { isDesktop, invoke } from './tauri.ts';

const SERVER_KEY = 'nebula.serverUrl';
const DEVICE_KEY = 'nebula.deviceId';

interface DesktopConfig { serverUrl: string }

let override: string | null = null;
let configLocation = 'navegador (armazenamento local)';
let deviceLabel = 'Navegador';

/**
 * `crypto.randomUUID` only exists in a secure context, so it is missing over plain http on a
 * LAN address — which is exactly how phones and other machines reach this app.
 * `getRandomValues` has no such restriction; Math.random is the last resort.
 */
export function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readLocal(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null; // private window or blocked storage
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not persisted, but still applies for this session.
  }
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Navegador';
  const os = /Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}

/**
 * In the browser the address is derived from the page's own host, which is what makes
 * opening http://192.168.x.x:5173 on a phone work with no setup. The desktop app is served
 * from its own internal origin, so there is nothing to derive — it defaults to localhost.
 */
export function defaultUrl(): string {
  if (isDesktop()) return 'http://localhost:4000';
  const envUrl = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL;
  if (envUrl && envUrl.length > 0) return envUrl.replace(/\/$/, '');
  return `${location.protocol}//${location.hostname}:4000`;
}

export const apiUrl = (): string => override ?? defaultUrl();
export const wsUrl = (): string => apiUrl().replace(/^http/, 'ws') + '/ws';
export const isOverridden = (): boolean => override !== null;
export const settingsLocation = (): string => configLocation;
export const platform = (): 'web' | 'desktop' => (isDesktop() ? 'desktop' : 'web');
export const deviceName = (): string => deviceLabel;

export function deviceId(): string {
  let id = readLocal(DEVICE_KEY);
  if (!id) {
    id = randomId();
    writeLocal(DEVICE_KEY, id);
  }
  return id;
}

/** Must finish before the first request or websocket; main.tsx awaits it. */
export async function initIdentity(): Promise<void> {
  if (isDesktop()) {
    const config = await invoke<DesktopConfig>('get_config');
    override = config?.serverUrl ?? null;
    configLocation = (await invoke<string>('config_path')) ?? 'config.json';
    deviceLabel = (await invoke<string>('device_name')) ?? 'Desktop';
    return;
  }
  override = readLocal(SERVER_KEY);
  deviceLabel = browserLabel();
}

/** Persists the address: a JSON file on the desktop, local storage in the browser. */
export async function setServerUrl(url: string | null): Promise<void> {
  const cleaned = url && url.trim() ? url.trim().replace(/\/$/, '') : null;

  if (isDesktop()) {
    // The desktop always keeps an explicit value — there is no host to fall back to.
    const config = await invoke<DesktopConfig>('set_server_url', {
      url: cleaned ?? defaultUrl(),
    });
    override = config?.serverUrl ?? cleaned;
    return;
  }

  override = cleaned;
  writeLocal(SERVER_KEY, cleaned);
}
