/**
 * Offline player for the phone: same interface as the synced client, but the authority is
 * the local reducer and the audio comes from a file in the app's own storage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { Command, Track } from '@nebula/protocol';
import {
  initialOfflineSession, reduceOffline, pruneOfflineSession, observeOfflinePosition,
  OFFLINE_DEVICE_ID,
} from '@nebula/protocol';
import type { NebulaClient } from '../useNebula';
import { offlineTrackUri, type OfflineEntry } from './store';

export function useOfflinePlayer(entries: OfflineEntry[]): NebulaClient {
  const [session, setSession] = useState(() => initialOfflineSession());
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedTrackRef = useRef<string | null>(null);
  const lastRevRef = useRef(-1);
  /** Latest audio clock, folded into the session before any command is applied. */
  const observedRef = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const tracks = useMemo(() => entries.map((e) => e.track), [entries]);
  const uriById = useMemo(
    () => new Map(entries.map((e) => [e.track.id, offlineTrackUri(e)])),
    [entries],
  );
  const durationById = useMemo(
    () => new Map(tracks.map((t) => [t.id, t.durationMs])),
    [tracks],
  );
  const durationRef = useRef(durationById);
  durationRef.current = durationById;

  /** -1 marks a track this phone no longer holds, which is what the reducer checks for. */
  const durationOf = useCallback((id: string) => durationRef.current.get(id) ?? -1, []);

  const send = useCallback((cmd: Command) => {
    // Without folding the audio clock in first, the reducer works from a stale position and
    // the reconciler then "fixes" the track back to it — restarting it on every command.
    setSession((prev) => reduceOffline(observeOfflinePosition(prev, observedRef.current), cmd, durationOf));
  }, [durationOf]);

  // ---------------------------------------------------------------- player lifecycle

  useEffect(() => {
    const player = createAudioPlayer(null, { updateInterval: 400 });
    playerRef.current = player;
    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.didJustFinish) send({ type: 'trackEnded' });
    });
    return () => {
      sub.remove();
      try { player.remove(); } catch { /* already released */ }
    };
  }, [send]);

  useEffect(() => {
    setSession((prev) => pruneOfflineSession(prev, new Set(durationById.keys())));
  }, [durationById]);

  // ---------------------------------------------------------------- reconciliation

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const s = session.state;
    if (s.rev === lastRevRef.current) return;
    lastRevRef.current = s.rev;

    if (!s.trackId) {
      try { player.pause(); } catch { /* nothing loaded */ }
      loadedTrackRef.current = null;
      return;
    }

    player.volume = s.muted ? 0 : s.volume;

    if (loadedTrackRef.current !== s.trackId) {
      const uri = uriById.get(s.trackId);
      if (!uri) {
        setError('Arquivo não encontrado neste aparelho.');
        return;
      }
      loadedTrackRef.current = s.trackId;
      player.replace({ uri });
      if (s.positionMs > 0) void player.seekTo(s.positionMs / 1000).catch(() => { /* seek before load */ });
    } else if (Math.abs(player.currentTime * 1000 - s.positionMs) > 1500) {
      void player.seekTo(s.positionMs / 1000).catch(() => { /* not seekable yet */ });
    }

    if (s.isPlaying) player.play();
    else player.pause();
  }, [session, uriById]);

  // ---------------------------------------------------------------- clock

  useEffect(() => {
    const tick = () => {
      const player = playerRef.current;
      const s = sessionRef.current.state;
      if (player && loadedTrackRef.current === s.trackId) {
        observedRef.current = player.currentTime * 1000;
        setPositionMs(observedRef.current);
      } else {
        observedRef.current = s.positionMs;
        setPositionMs(s.positionMs);
      }
    };
    tick();
    const id = setInterval(tick, 400);
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
    libraryRev: 0,
    send,
    error,
  };
}
