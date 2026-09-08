/**
 * Offline player: the same interface the synced client exposes, but with no server behind
 * it. Sound comes from a Blob URL of a file stored in this browser, and the authoritative
 * state is the local reducer — nothing is sent anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Command, Track } from '@nebula/protocol';
import {
  initialOfflineSession, reduceOffline, pruneOfflineSession, observeOfflinePosition,
  OFFLINE_DEVICE_ID,
} from '@nebula/protocol';
import type { NebulaClient } from '../useNebula.ts';
import { primeSilently } from '../keepMediaSession.ts';
import { offlineTrackUrl } from './store.ts';

const VOLUME_KEY = 'nebula.offline.volume';

function storedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
  } catch {
    return 0.8;
  }
}

export function useOfflinePlayer(tracks: Track[]): NebulaClient {
  const [session, setSession] = useState(() => initialOfflineSession(storedVolume()));
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedTrackRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  /** Where to jump once the file has metadata — before that, currentTime is not writable. */
  const pendingSeekRef = useRef<number | null>(null);
  const lastRevRef = useRef(-1);
  /** Latest audio clock, folded into the session before any command is applied. */
  const observedRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  if (!audioRef.current && typeof Audio !== 'undefined') {
    const el = new Audio();
    el.preload = 'auto';
    audioRef.current = el;
  }

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  /** -1 marks a track this device no longer holds, which is what the reducer checks for. */
  const durationOf = useCallback((id: string) => byIdRef.current.get(id)?.durationMs ?? -1, []);

  const send = useCallback((cmd: Command) => {
    setSession((prev) => {
      // Without this the reducer works from a stale position and the reconciler then "fixes"
      // the element back to it — which is what made pause and repeat restart the track.
      const observed = observeOfflinePosition(prev, observedRef.current);
      const next = reduceOffline(observed, cmd, durationOf);
      if (cmd.type === 'volume') {
        try { localStorage.setItem(VOLUME_KEY, String(next.state.volume)); } catch { /* private mode */ }
      }
      return next;
    });
  }, [durationOf]);

  const seek = useCallback((target: number) => {
    const el = audioRef.current;
    const clamped = Math.max(0, target);
    // Local audio seeks instantly, so the bar can simply follow the element — no need for
    // the optimistic hold the networked client uses to survive a round trip.
    if (el && loadedTrackRef.current === sessionRef.current.state.trackId && el.readyState > 0) {
      el.currentTime = clamped / 1000;
    } else {
      pendingSeekRef.current = clamped;
    }
    observedRef.current = clamped;
    setPositionMs(clamped);
    send({ type: 'seek', positionMs: clamped });
  }, [send]);

  // Files removed from the library must not stay in a live queue.
  useEffect(() => {
    setSession((prev) => pruneOfflineSession(prev, new Set(byId.keys())));
  }, [byId]);

  // ---------------------------------------------------------------- reconciliation

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const s = session.state;
    if (s.rev === lastRevRef.current) return;
    lastRevRef.current = s.rev;

    if (!s.trackId) {
      el.pause();
      el.removeAttribute('src');
      loadedTrackRef.current = null;
      return;
    }

    el.volume = s.muted ? 0 : s.volume;

    if (loadedTrackRef.current !== s.trackId) {
      const trackId = s.trackId;
      loadedTrackRef.current = trackId;
      pendingSeekRef.current = s.positionMs;
      void offlineTrackUrl(trackId).then((url) => {
        // A newer track was asked for while this file was being read: drop this one. The ref
        // is the test rather than a cleanup flag, because every command re-runs this effect.
        if (loadedTrackRef.current !== trackId) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (!url) {
          setError('Arquivo não encontrado na biblioteca offline.');
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        el.src = url;
        el.load();
        if (sessionRef.current.state.isPlaying) {
          el.play().then(() => setNeedsGesture(false)).catch((err: DOMException) => {
            if (err.name === 'NotAllowedError') setNeedsGesture(true);
          });
        } else {
          primeSilently(el, () => !sessionRef.current.state.isPlaying);
        }
      });
      return;
    }

    if (el.readyState > 0 && Math.abs(el.currentTime * 1000 - s.positionMs) > 1200) {
      el.currentTime = s.positionMs / 1000;
    }

    if (s.isPlaying) {
      el.play().then(() => setNeedsGesture(false)).catch((err: DOMException) => {
        if (err.name === 'NotAllowedError') setNeedsGesture(true);
      });
    } else {
      el.pause();
    }
  }, [session]);

  useEffect(() => {
    observedRef.current = session.state.trackId ? session.state.positionMs : 0;
    setPositionMs(session.state.trackId ? session.state.positionMs : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.state.trackId]);

  // Release the last Blob URL when the player goes away, so the file can be freed.
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => send({ type: 'trackEnded' });
    const onLoaded = () => {
      if (pendingSeekRef.current !== null) {
        el.currentTime = pendingSeekRef.current / 1000;
        pendingSeekRef.current = null;
      }
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoaded);
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [send]);

  // ---------------------------------------------------------------- clock

  useEffect(() => {
    const tick = () => {
      const el = audioRef.current;
      const s = sessionRef.current.state;
      if (el && el.readyState > 0 && loadedTrackRef.current === s.trackId && !Number.isNaN(el.currentTime)) {
        const pos = el.currentTime * 1000;
        observedRef.current = pos;
        setPositionMs(pos);
      } else {
        observedRef.current = s.positionMs;
        setPositionMs(s.positionMs);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, []);

  return {
    state: session.state,
    devices: [],
    connected: true,
    deviceId: OFFLINE_DEVICE_ID,
    isActive: true,
    offline: true,
    positionMs,
    needsGesture,
    libraryRev: 0,
    send,
    seek,
    error,
    dismissError: () => setError(null),
  };
}
