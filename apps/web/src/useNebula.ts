import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primeSilently } from './keepMediaSession.ts';
import type { Command, DeviceInfo, PlaybackState } from '@nebula/protocol';
import { INITIAL_STATE } from '@nebula/protocol';
import { wsUrl, streamUrl } from './api.ts';
import { deviceId as resolveDeviceId, deviceName, platform } from './identity.ts';

/** 40ms of silence — just enough to satisfy the browser's "played after a gesture" rule. */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export interface NebulaClient {
  state: PlaybackState;
  devices: DeviceInfo[];
  connected: boolean;
  deviceId: string;
  isActive: boolean;
  /** True for the local-files player, which has no server and no other devices behind it. */
  offline: boolean;
  /** Live position in ms: the audio clock when we own playback, extrapolated otherwise. */
  positionMs: number;
  /** Set when the browser blocked autoplay and needs a click before it will make sound. */
  needsGesture: boolean;
  /** Bumped whenever the server says the library changed, so views can refetch. */
  libraryRev: number;
  send: (cmd: Command) => void;
  /** Seeking goes through here so the bar can hold the target until the server echoes it. */
  seek: (positionMs: number) => void;
  error: string | null;
  dismissError: () => void;
}

export function useNebula(): NebulaClient {
  const [state, setState] = useState<PlaybackState>(INITIAL_STATE);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [libraryRev, setLibraryRev] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);

  const deviceId = useMemo(resolveDeviceId, []);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastRevRef = useRef(-1);
  const loadedTrackRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  /** Where the user just asked to jump to, held until the audio clock actually gets there. */
  const optimisticRef = useRef<{ positionMs: number; at: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const isActive = state.activeDeviceId === deviceId;

  // ---------------------------------------------------------------- audio element

  if (!audioRef.current && typeof Audio !== 'undefined') {
    const el = new Audio();
    el.preload = 'auto';
    audioRef.current = el;
  }

  const send = useCallback((cmd: Command) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'command', cmd }));
    } else {
      setError('Sem conexão com o servidor.');
    }
  }, []);

  // Browsers refuse to start audio that no gesture asked for. Priming the element with a
  // moment of silence on the first interaction means a later *remote* "transfer to this
  // browser" can start playing without the user having to click again.
  useEffect(() => {
    const prime = () => {
      const el = audioRef.current;
      // A source is already loaded: re-pointing `src` here would restart it from zero, and
      // an element that has a track is one the user already interacted with anyway.
      if (!el || el.src) return;
      el.muted = true;
      el.src = SILENCE;
      el.play()
        .then(() => {
          el.pause();
          el.muted = false;
          el.removeAttribute('src');
          loadedTrackRef.current = null;
          lastRevRef.current = -1; // force a fresh reconcile against the real track
        })
        .catch(() => { el.muted = false; });
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  const seek = useCallback((positionMs: number) => {
    const target = Math.max(0, positionMs);
    // Show the target immediately. Without this the bar snaps back to the old position for
    // the length of the server round trip, which reads as "the click did nothing".
    optimisticRef.current = { positionMs: target, at: Date.now() };
    setPositionMs(target);
    send({ type: 'seek', positionMs: target });
  }, [send]);

  // ---------------------------------------------------------------- websocket

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const params = new URLSearchParams({
        deviceId,
        name: deviceName(),
        platform: platform(),
      });
      const ws = new WebSocket(`${wsUrl()}?${params}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        switch (msg.t) {
          case 'welcome':
            setState(msg.state);
            setDevices(msg.devices);
            break;
          case 'state':
            setState(msg.state);
            break;
          case 'devices':
            setDevices(msg.devices);
            break;
          case 'library':
            setLibraryRev((n) => n + 1);
            break;
          case 'error':
            setError(msg.message);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        // Exponential backoff, capped: a laptop waking from sleep should reconnect fast,
        // but a server that is down shouldn't be hammered.
        const delay = Math.min(500 * 2 ** retry++, 8000);
        timer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [deviceId]);

  // ---------------------------------------------------------------- reconciliation

  // The single place where server state turns into actual sound. Runs only when `rev`
  // changes, so the progress messages this device itself emits never trigger a reload.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    if (!isActive) {
      // Another device owns the audio: go silent but keep the UI fully interactive.
      if (!el.paused) el.pause();
      loadedTrackRef.current = null;
      lastRevRef.current = state.rev;
      return;
    }

    if (state.rev === lastRevRef.current) return;
    lastRevRef.current = state.rev;

    if (!state.trackId) {
      el.pause();
      el.removeAttribute('src');
      loadedTrackRef.current = null;
      return;
    }

    el.volume = state.muted ? 0 : state.volume;

    const switched = loadedTrackRef.current !== state.trackId;
    if (switched) {
      loadedTrackRef.current = state.trackId;
      el.src = streamUrl(state.trackId);
      pendingSeekRef.current = state.positionMs;
      el.load();
    } else if (Math.abs(el.currentTime * 1000 - state.positionMs) > 1200) {
      // Only correct real drift; small differences are just clock jitter.
      if (el.readyState > 0) el.currentTime = state.positionMs / 1000;
      else pendingSeekRef.current = state.positionMs;
    }

    if (state.isPlaying) {
      el.play()
        .then(() => setNeedsGesture(false))
        .catch((err: DOMException) => {
          // AbortError just means a newer src replaced this one mid-load.
          if (err.name === 'NotAllowedError') setNeedsGesture(true);
        });
    } else {
      el.pause();
      // Skipping while paused: keep the OS controls attached to the new resource.
      if (switched) primeSilently(el, () => !stateRef.current.isPlaying);
    }
  }, [state, isActive]);

  // A new track must not inherit the previous one's clock: the old position would be drawn
  // against the new duration, which is why a fresh track could start mid-bar.
  useEffect(() => {
    optimisticRef.current = null;
    setPositionMs(state.trackId ? state.positionMs : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trackId]);

  // Apply a seek that arrived before the audio had any metadata to seek within.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onLoaded = () => {
      if (pendingSeekRef.current !== null) {
        el.currentTime = pendingSeekRef.current / 1000;
        pendingSeekRef.current = null;
      }
    };
    const onEnded = () => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'command', cmd: { type: 'trackEnded' } }));
      }
    };
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
    };
  }, []);

  // ---------------------------------------------------------------- clock

  // One timer drives both the progress bar and the reports the server relays to every
  // other device, so a remote's seek bar tracks the real audio and not a guess.
  useEffect(() => {
    const tick = () => {
      const el = audioRef.current;
      const s = stateRef.current;
      const active = s.activeDeviceId === deviceId;

      // Only trust the audio clock when the element actually holds the current track and has
      // metadata. Right after a track change it still reports the previous track's position.
      const audioReady =
        active && el !== null && el.readyState > 0 &&
        loadedTrackRef.current === s.trackId && !Number.isNaN(el.currentTime);
      const audioPos = audioReady && el ? el.currentTime * 1000 : null;

      const pending = optimisticRef.current;
      if (pending) {
        const observed = audioPos ?? s.positionMs;
        const landed = Math.abs(observed - pending.positionMs) < 900;
        // Bounded hold: a seek that never lands must not freeze the bar forever.
        if (!landed && Date.now() - pending.at < 2500) {
          setPositionMs(pending.positionMs);
          // Reporting the stale clock here would overwrite the seek on the server, and the
          // other devices would jump back to where the track was before the click.
          return;
        }
        optimisticRef.current = null;
      }

      if (audioPos !== null && el) {
        setPositionMs(audioPos);
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            t: 'progress',
            positionMs: audioPos,
            durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : s.durationMs,
            isPlaying: !el.paused,
          }));
        }
      } else if (s.isPlaying) {
        const elapsed = Date.now() - s.positionUpdatedAt;
        setPositionMs(Math.min(s.positionMs + elapsed, s.durationMs || Infinity));
      } else {
        setPositionMs(s.positionMs);
      }
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deviceId]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    state, devices, connected, deviceId, isActive, offline: false,
    positionMs, needsGesture, libraryRev, send, seek, error, dismissError,
  };
}
