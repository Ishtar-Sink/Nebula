/**
 * Bridge to the Tauri shell.
 *
 * The same bundle runs in a browser and inside the desktop app, so everything here degrades
 * to `null`/`false` when the Tauri globals are absent. `withGlobalTauri` is enabled in
 * tauri.conf.json, which is why no @tauri-apps/api dependency is needed — it would be dead
 * weight in the browser build.
 */

interface TauriGlobal {
  core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

function tauri(): TauriGlobal | null {
  const g = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return g && typeof g.core?.invoke === 'function' ? g : null;
}

export const isDesktop = (): boolean => tauri() !== null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const g = tauri();
  if (!g?.core?.invoke) return null;
  try {
    return await g.core.invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[tauri] ${cmd} falhou:`, err);
    return null;
  }
}
