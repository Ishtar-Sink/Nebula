/**
 * Hardware and OS media controls.
 *
 * Play/pause already works without any of this — the browser wires it to the audio element
 * itself. Next/previous do not: without an explicit `nexttrack`/`previoustrack` handler the
 * key does nothing at all, which is exactly what a headset's skip button hits.
 */

import { useEffect, useRef } from 'react';
import type { Command, PlaybackState, Track } from '@nebula/protocol';
import { coverSrc } from './api.ts';

interface Options {
  state: PlaybackState;
  track: Track | null;
  positionMs: number;
  /** Only the device producing sound should claim the OS controls. */
  active: boolean;
  send: (cmd: Command) => void;
  seek: (positionMs: number) => void;
}

/**
 * `stop` is deliberately absent: registering it makes the browser surface a stop button whose
 * default behaviour rewinds the element, so the play/pause key ended up restarting the track.
 */
const MANAGED = [
  'play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'seekbackward', 'seekforward',
] as const;

export function useMediaSession({ state, track, positionMs, active, send, seek }: Options): void {
  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;

  // The seek handlers need the current position, but re-registering them four times a second
  // makes the OS drop and re-take the controls — and a press landing in that gap is lost.
  // A ref gives the handlers a live value while the registration stays put.
  const positionRef = useRef(positionMs);
  positionRef.current = positionMs;

  // Handlers are re-registered whenever `send` changes, so the offline player and the synced
  // one can hand the controls over cleanly when the listener switches modes.
  useEffect(() => {
    if (!session) return;

    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      // A browser that does not know an action throws instead of ignoring it.
      try { session.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };

    if (!active) {
      for (const action of MANAGED) set(action, null);
      return;
    }

    set('play', () => send({ type: 'play' }));
    set('pause', () => send({ type: 'pause' }));
    set('nexttrack', () => send({ type: 'next' }));
    set('previoustrack', () => send({ type: 'previous' }));
    set('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime * 1000);
    });
    set('seekbackward', (details) => seek(positionRef.current - (details.seekOffset ?? 10) * 1000));
    set('seekforward', (details) => seek(positionRef.current + (details.seekOffset ?? 10) * 1000));

    return () => { for (const action of MANAGED) set(action, null); };
  }, [session, active, send, seek]);

  // What the OS shows on the lock screen / media popup.
  useEffect(() => {
    if (!session) return;
    // A device that is only remote-controlling must not advertise itself: Windows would list
    // it alongside the real one and route the keys to whichever it saw last, which is how a
    // second open tab ends up swallowing every press.
    if (!track || !active) {
      session.metadata = null;
      session.playbackState = 'none';
      return;
    }

    const artwork = coverSrc(track.coverUrl);
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: artwork ? [{ src: artwork, sizes: '640x640', type: 'image/jpeg' }] : [],
    });
    session.playbackState = state.isPlaying ? 'playing' : 'paused';
  }, [session, track, active, state.isPlaying]);

  // The scrubber in the OS popup needs the position to move on its own.
  useEffect(() => {
    if (!session?.setPositionState || !active || state.durationMs <= 0) return;
    try {
      session.setPositionState({
        duration: state.durationMs / 1000,
        position: Math.min(positionMs, state.durationMs) / 1000,
        playbackRate: 1,
      });
    } catch {
      // Some builds reject a position past the duration mid-transition; the next tick fixes it.
    }
  }, [session, active, state.durationMs, positionMs]);
}
