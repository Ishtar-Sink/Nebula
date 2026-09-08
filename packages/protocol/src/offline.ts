/**
 * Offline playback engine.
 *
 * The "modo offline" plays files the listener picked from their own disk. Those files never
 * reach the server and no other device ever sees them, so there is no hub to reconcile
 * against: this reducer *is* the authority, running inside the client that holds the files.
 *
 * It deliberately reuses `PlaybackState` and `Command` so the whole player UI — transport,
 * scrubber, queue, shuffle and repeat — works unchanged in either mode.
 */

import type { Command, PlaybackState } from './index.ts';
import { INITIAL_STATE, shuffleQueue } from './index.ts';

export interface OfflineSession {
  state: PlaybackState;
  /** Queue order before shuffle was turned on, so turning it off restores the real order. */
  unshuffled: string[];
}

/** A local session owns its audio by definition — there is nothing to transfer it to. */
export const OFFLINE_DEVICE_ID = 'offline';

export function initialOfflineSession(volume = INITIAL_STATE.volume): OfflineSession {
  return {
    state: { ...INITIAL_STATE, activeDeviceId: OFFLINE_DEVICE_ID, volume },
    unshuffled: [],
  };
}

/**
 * Folds the audio clock back into the session, the way the server folds a device's `progress`
 * message into its state — and, like it, **without bumping `rev`**: this is an observation,
 * not an instruction.
 *
 * Skipping this is what made every command (pause, repeat, volume) yank the track back to the
 * start: the reconciler compares the element's clock against `state.positionMs`, and that
 * field was still holding the position from when the track was loaded.
 */
export function observeOfflinePosition(
  session: OfflineSession,
  positionMs: number,
  durationMs?: number,
): OfflineSession {
  const state = { ...session.state };
  state.positionMs = Math.max(0, Math.round(positionMs));
  if (durationMs && durationMs > 0) state.durationMs = Math.round(durationMs);
  state.positionUpdatedAt = Date.now();
  return { ...session, state };
}

/**
 * Applies one command, returning a new session. `durationOf` reports how long a track is and
 * returns -1 for a track the device no longer holds; it is a callback because the durations
 * come from the listener's own files, not from a catalog. Commands that make no sense
 * offline (`transfer`) are no-ops.
 */
export function reduceOffline(
  session: OfflineSession,
  cmd: Command,
  durationOf: (trackId: string) => number,
): OfflineSession {
  const s: PlaybackState = { ...session.state };
  let unshuffled = session.unshuffled;

  const loadTrackAt = (index: number): void => {
    if (index < 0 || index >= s.queue.length) {
      s.queueIndex = -1;
      s.trackId = null;
      s.durationMs = 0;
      s.positionMs = 0;
      return;
    }
    s.queueIndex = index;
    s.trackId = s.queue[index];
    s.durationMs = Math.max(0, durationOf(s.trackId));
    s.positionMs = 0;
  };

  /**
   * Moves to the next track. `auto` distinguishes the natural end of a track from a deliberate
   * skip: a press always moves (wrapping at the end), while autoplay stops there unless the
   * listener asked for repeat. A button that does nothing reads as broken.
   */
  const advance = (auto: boolean): boolean => {
    if (s.queue.length === 0) return false;
    if (s.queueIndex < s.queue.length - 1) {
      loadTrackAt(s.queueIndex + 1);
      if (auto) s.isPlaying = true;
      return true;
    }
    if (!auto || s.repeat === 'context') {
      loadTrackAt(0);
      if (auto) s.isPlaying = true;
      return true;
    }
    return false;
  };

  // A track sitting at its own end has nowhere to resume to, so play means replay.
  const rewindIfFinished = (): void => {
    if (s.durationMs > 0 && s.positionMs >= s.durationMs - 250) s.positionMs = 0;
  };

  switch (cmd.type) {
    case 'playContext': {
      const ids = cmd.trackIds.filter((id) => durationOf(id) >= 0);
      if (ids.length === 0) return session;
      const startIndex = Math.min(Math.max(0, cmd.startIndex), ids.length - 1);
      unshuffled = ids;
      if (s.shuffle) {
        s.queue = shuffleQueue(ids, ids[startIndex]);
        s.queueIndex = 0;
      } else {
        s.queue = ids;
        s.queueIndex = startIndex;
      }
      s.contextId = cmd.contextId;
      s.contextName = cmd.contextName;
      loadTrackAt(s.queueIndex);
      s.isPlaying = true;
      break;
    }

    case 'play':
      if (!s.trackId) return session;
      rewindIfFinished();
      s.isPlaying = true;
      break;

    case 'pause':
      s.isPlaying = false;
      break;

    case 'toggle':
      if (!s.trackId) return session;
      if (!s.isPlaying) rewindIfFinished();
      s.isPlaying = !s.isPlaying;
      break;

    case 'next': {
      // Skipping must not start playback on its own: paused stays paused, playing keeps going.
      const wasPlaying = s.isPlaying;
      if (!advance(false)) return session;
      s.isPlaying = wasPlaying;
      break;
    }

    case 'previous': {
      // Mirrors Spotify: past the 3s mark, "previous" restarts the current track.
      const wasPlaying = s.isPlaying;
      if (s.positionMs > 3000) s.positionMs = 0;
      else if (s.queueIndex > 0) loadTrackAt(s.queueIndex - 1);
      // At the top of the queue, wrap to the end rather than sitting there doing nothing.
      else if (s.queue.length > 1) loadTrackAt(s.queue.length - 1);
      else s.positionMs = 0;
      s.isPlaying = wasPlaying;
      break;
    }

    case 'seek':
      s.positionMs = Math.max(0, Math.min(Math.round(cmd.positionMs), s.durationMs || cmd.positionMs));
      break;

    case 'volume':
      s.volume = Math.max(0, Math.min(1, cmd.volume));
      s.muted = false;
      break;

    case 'mute':
      s.muted = cmd.muted;
      break;

    case 'shuffle': {
      s.shuffle = cmd.shuffle;
      const current = s.trackId;
      if (cmd.shuffle) {
        if (unshuffled.length === 0) unshuffled = [...s.queue];
        s.queue = shuffleQueue(unshuffled, current ?? undefined);
        s.queueIndex = current ? 0 : -1;
      } else if (unshuffled.length > 0) {
        s.queue = [...unshuffled];
        s.queueIndex = current ? s.queue.indexOf(current) : -1;
      }
      break;
    }

    case 'repeat':
      s.repeat = cmd.repeat;
      break;

    case 'queueAdd':
      if (durationOf(cmd.trackId) < 0) return session;
      s.queue = [...s.queue, cmd.trackId];
      unshuffled = [...unshuffled, cmd.trackId];
      break;

    case 'queueRemove': {
      if (cmd.index < 0 || cmd.index >= s.queue.length) return session;
      const removed = s.queue[cmd.index];
      s.queue = s.queue.filter((_, i) => i !== cmd.index);
      const u = unshuffled.indexOf(removed);
      if (u >= 0) unshuffled = [...unshuffled.slice(0, u), ...unshuffled.slice(u + 1)];
      if (cmd.index < s.queueIndex) s.queueIndex--;
      else if (cmd.index === s.queueIndex) loadTrackAt(Math.min(s.queueIndex, s.queue.length - 1));
      break;
    }

    case 'trackEnded':
      if (s.repeat === 'track') {
        s.positionMs = 0;
        s.isPlaying = true;
      } else if (!advance(true)) {
        s.isPlaying = false;
        s.positionMs = s.durationMs;
      }
      break;

    case 'transfer':
      // Nothing to hand the audio to: offline playback exists on this device only.
      return session;
  }

  s.rev = session.state.rev + 1;
  s.positionUpdatedAt = Date.now();
  s.activeDeviceId = OFFLINE_DEVICE_ID;
  return { state: s, unshuffled };
}

/**
 * Drops tracks that are no longer in the library (the listener removed the file) from a
 * live session, keeping the current track playing whenever it survived.
 */
export function pruneOfflineSession(session: OfflineSession, available: Set<string>): OfflineSession {
  const queue = session.state.queue.filter((id) => available.has(id));
  if (queue.length === session.state.queue.length) return session;

  const current = session.state.trackId;
  const keptCurrent = current !== null && available.has(current);
  const state: PlaybackState = {
    ...session.state,
    rev: session.state.rev + 1,
    queue,
    queueIndex: keptCurrent ? queue.indexOf(current) : -1,
    trackId: keptCurrent ? current : null,
    isPlaying: keptCurrent && session.state.isPlaying,
    positionMs: keptCurrent ? session.state.positionMs : 0,
    durationMs: keptCurrent ? session.state.durationMs : 0,
    positionUpdatedAt: Date.now(),
  };
  return { state, unshuffled: session.unshuffled.filter((id) => available.has(id)) };
}
