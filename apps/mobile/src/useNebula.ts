import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { Command, DeviceInfo, PlaybackState } from '@nebula/protocol';
import { INITIAL_STATE } from '@nebula/protocol';
import { wsUrl, streamUrl, persistentDeviceId } from './api';

export interface NebulaClient {
  state: PlaybackState;
  devices: DeviceInfo[];
  connected: boolean;
  deviceId: string;
  isActive: boolean;
  /** True for the local-files player, which has no server and no other devices behind it. */
  offline: boolean;
  positionMs: number;
  libraryRev: number;
  send: (cmd: Command) => void;
  error: string | null;
}

/**
 * Mobile counterpart of the web hook: same reconciliation model, expo-audio instead of
 * HTMLAudioElement. The phone is a full playback device *and* a remote for the others.
 */
export function useNebula(deviceName: string): NebulaClient {
  const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [libraryRev, setLibraryRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [deviceId, setDeviceId] = useState('');

  const playerRef = useRef<AudioPlayer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastRevRef = useRef(-1);
  const loadedTrackRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  const deviceIdRef = useRef('');
  stateRef.current = state;

  const isActive = Boolean(deviceId) && state.activeDeviceId === deviceId;

  // ---------------------------------------------------------------- setup

  useEffect(() => {
    void persistentDeviceId().then((id) => {
      deviceIdRef.current = id;
      setDeviceId(id);
    });

    // Keeping audio alive in the background is what makes the phone a real playback target
    // rather than something that stops the moment the screen locks.
    void setAudioModeAsync({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    }).catch(() => { /* older runtimes fall back to foreground-only audio */ });

    const player = createAudioPlayer(null, { updateInterval: 500 });
    playerRef.current = player;

    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.didJustFinish) {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'command', cmd: { type: 'trackEnded' } }));
        }
      }
    });

    return () => {
      sub.remove();
      try { player.remove(); } catch { /* already released */ }
    };
  }, []);

  const send = useCallback((cmd: Command) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'command', cmd }));
    else setError('Sem conexão com o servidor.');
  }, []);

  // ---------------------------------------------------------------- websocket

  useEffect(() => {
    if (!deviceId) return;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const params = new URLSearchParams({ deviceId, name: deviceName, platform: 'mobile' });
      const ws = new WebSocket(`${wsUrl()}?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => { retry = 0; setConnected(true); setError(null); };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        switch (msg.t) {
          case 'welcome': setState(msg.state); setDevices(msg.devices); break;
          case 'state': setState(msg.state); break;
          case 'devices': setDevices(msg.devices); break;
          case 'library': setLibraryRev((n) => n + 1); break;
          case 'error': setError(msg.message); break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = setTimeout(connect, Math.min(500 * 2 ** retry++, 8000));
      };

      ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
    };

    connect();
    return () => { closed = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [deviceId, deviceName]);

  // ---------------------------------------------------------------- reconciliation

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !deviceId) return;

    if (!isActive) {
      // Another device owns the audio: stay silent, keep rendering the shared state.
      if (player.playing) player.pause();
      loadedTrackRef.current = null;
      lastRevRef.current = state.rev;
      return;
    }

    if (state.rev === lastRevRef.current) return;
    lastRevRef.current = state.rev;

    if (!state.trackId) {
      try { player.pause(); } catch { /* nothing loaded */ }
      loadedTrackRef.current = null;
      return;
    }

    player.volume = state.muted ? 0 : state.volume;

    if (loadedTrackRef.current !== state.trackId) {
      loadedTrackRef.current = state.trackId;
      player.replace({ uri: streamUrl(state.trackId) });
      if (state.positionMs > 0) void player.seekTo(state.positionMs / 1000).catch(() => { /* seek before load */ });
    } else if (Math.abs(player.currentTime * 1000 - state.positionMs) > 1500) {
      void player.seekTo(state.positionMs / 1000).catch(() => { /* not seekable yet */ });
    }

    if (state.isPlaying) player.play();
    else player.pause();
  }, [state, isActive, deviceId]);

  // ---------------------------------------------------------------- clock

  useEffect(() => {
    const tick = () => {
      const player = playerRef.current;
      const s = stateRef.current;
      const active = Boolean(deviceIdRef.current) && s.activeDeviceId === deviceIdRef.current;

      if (active && player && loadedTrackRef.current) {
        const pos = player.currentTime * 1000;
        setPositionMs(pos);
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            t: 'progress',
            positionMs: pos,
            durationMs: player.duration > 0 ? player.duration * 1000 : s.durationMs,
            isPlaying: player.playing,
          }));
        }
      } else if (s.isPlaying) {
        // Not the active device: extrapolate from the last server report so the seek bar moves.
        const elapsed = Date.now() - s.positionUpdatedAt;
        setPositionMs(s.durationMs ? Math.min(s.positionMs + elapsed, s.durationMs) : s.positionMs + elapsed);
      } else {
        setPositionMs(s.positionMs);
      }
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);

  return {
    state, devices, connected, deviceId, isActive, offline: false,
    positionMs, libraryRev, send, error,
  };
}
