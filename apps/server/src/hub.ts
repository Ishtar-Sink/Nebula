import type { WebSocket } from 'ws';
import type {
  ClientMessage, ServerMessage, PlaybackState, Command, DeviceInfo, Platform,
} from '@nebula/protocol';
import { INITIAL_STATE, shuffleQueue } from '@nebula/protocol';
import { getTrack } from './db.ts';

interface Connection {
  ws: WebSocket;
  info: DeviceInfo;
}

/**
 * Owns the single authoritative PlaybackState and every connected device.
 *
 * Two rules keep the whole system coherent:
 *   1. Only `state.activeDeviceId` produces sound. Everyone else is a remote control.
 *   2. `rev` is bumped only for changes that require the active device to *act*
 *      (track change, seek, play/pause, volume). Progress ticks deliberately do not
 *      bump it, so the active device never reconciles against the echo of its own clock.
 */
export class Hub {
  private state: PlaybackState = { ...INITIAL_STATE };
  private connections = new Map<string, Connection>();
  /** Queue order before shuffle was turned on, so toggling it off restores the real order. */
  private unshuffledQueue: string[] = [];

  getState(): PlaybackState {
    return this.state;
  }

  getDevices(): DeviceInfo[] {
    return [...this.connections.values()].map((c) => c.info);
  }

  // ------------------------------------------------------------ connection lifecycle

  register(ws: WebSocket, device: { id: string; name: string; platform: Platform }): string {
    const info: DeviceInfo = {
      id: device.id,
      name: device.name,
      platform: device.platform,
      online: true,
      lastSeen: Date.now(),
    };

    // A reconnecting device reuses its id; drop the stale socket so we never double-send.
    const previous = this.connections.get(device.id);
    if (previous && previous.ws !== ws) {
      try { previous.ws.close(4000, 'replaced by newer connection'); } catch { /* already dead */ }
    }

    this.connections.set(device.id, { ws, info });
    this.send(ws, { t: 'welcome', deviceId: device.id, state: this.state, devices: this.getDevices() });
    this.broadcastDevices();
    console.log(`[hub] + ${device.platform}/${device.name} (${device.id.slice(0, 8)}) — ${this.connections.size} online`);
    return device.id;
  }

  unregister(deviceId: string): void {
    const conn = this.connections.get(deviceId);
    if (!conn) return;
    this.connections.delete(deviceId);
    console.log(`[hub] - ${conn.info.platform}/${conn.info.name} — ${this.connections.size} online`);

    // The device that was producing sound went away: pause and release the crown so the
    // next play command can land anywhere.
    if (this.state.activeDeviceId === deviceId) {
      this.state.activeDeviceId = null;
      this.state.isPlaying = false;
      this.state.positionUpdatedAt = Date.now();
      this.bump();
    }
    this.broadcastDevices();
  }

  handleMessage(deviceId: string, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const conn = this.connections.get(deviceId);
    if (conn) conn.info.lastSeen = Date.now();

    switch (msg.t) {
      case 'command':
        this.applyCommand(deviceId, msg.cmd);
        break;
      case 'progress':
        this.applyProgress(deviceId, msg);
        break;
      case 'ping':
        if (conn) this.send(conn.ws, { t: 'pong' });
        break;
    }
  }

  // ------------------------------------------------------------ progress

  private applyProgress(
    deviceId: string,
    p: { positionMs: number; durationMs: number; isPlaying: boolean },
  ): void {
    // Only the device actually rendering audio owns the clock. Ignoring everyone else
    // prevents a paused remote from dragging the position backwards.
    if (this.state.activeDeviceId !== deviceId) return;

    this.state.positionMs = Math.max(0, Math.round(p.positionMs));
    if (p.durationMs > 0) this.state.durationMs = Math.round(p.durationMs);
    this.state.positionUpdatedAt = Date.now();

    // No rev bump: this is an observation, not an instruction.
    this.broadcastState();
  }

  // ------------------------------------------------------------ commands

  private applyCommand(fromDeviceId: string, cmd: Command): void {
    const s = this.state;

    // A track sitting at its own end has nowhere to resume to, so play means replay.
    // Without this, pressing play after the queue finished looks like a dead button.
    const rewindIfFinished = () => {
      if (s.durationMs > 0 && s.positionMs >= s.durationMs - 250) s.positionMs = 0;
    };

    // Any command that starts audio claims an active device if nobody holds it.
    const claimIfIdle = () => {
      if (!s.activeDeviceId || !this.connections.has(s.activeDeviceId)) {
        s.activeDeviceId = fromDeviceId;
      }
    };

    switch (cmd.type) {
      case 'playContext': {
        claimIfIdle();
        const ids = cmd.trackIds.filter((id) => getTrack(id) !== null);
        if (ids.length === 0) return;
        const startIndex = Math.min(Math.max(0, cmd.startIndex), ids.length - 1);
        this.unshuffledQueue = ids;
        if (s.shuffle) {
          s.queue = shuffleQueue(ids, ids[startIndex]);
          s.queueIndex = 0;
        } else {
          s.queue = ids;
          s.queueIndex = startIndex;
        }
        s.contextId = cmd.contextId;
        s.contextName = cmd.contextName;
        this.loadTrackAt(s.queueIndex);
        s.isPlaying = true;
        break;
      }

      case 'play':
        if (!s.trackId) return;
        claimIfIdle();
        rewindIfFinished();
        s.isPlaying = true;
        break;

      case 'pause':
        s.isPlaying = false;
        break;

      case 'toggle':
        if (!s.trackId) return;
        claimIfIdle();
        if (!s.isPlaying) rewindIfFinished();
        s.isPlaying = !s.isPlaying;
        break;

      case 'next': {
        // Skipping must not start playback on its own: paused stays paused, playing keeps going.
        const wasPlaying = s.isPlaying;
        if (!this.advance(false)) return;
        s.isPlaying = wasPlaying;
        break;
      }

      case 'previous': {
        // Mirrors Spotify: past the 3s mark, "previous" restarts the current track.
        const wasPlaying = s.isPlaying;
        if (s.positionMs > 3000) {
          s.positionMs = 0;
        } else if (s.queueIndex > 0) {
          this.loadTrackAt(s.queueIndex - 1);
        } else if (s.queue.length > 1) {
          // At the top of the queue, wrap to the end rather than sitting there doing nothing.
          this.loadTrackAt(s.queue.length - 1);
        } else {
          s.positionMs = 0;
        }
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
          if (this.unshuffledQueue.length === 0) this.unshuffledQueue = [...s.queue];
          s.queue = shuffleQueue(this.unshuffledQueue, current ?? undefined);
          s.queueIndex = current ? 0 : -1;
        } else if (this.unshuffledQueue.length > 0) {
          s.queue = [...this.unshuffledQueue];
          s.queueIndex = current ? s.queue.indexOf(current) : -1;
        }
        break;
      }

      case 'repeat':
        s.repeat = cmd.repeat;
        break;

      case 'queueAdd': {
        if (!getTrack(cmd.trackId)) return;
        s.queue = [...s.queue, cmd.trackId];
        this.unshuffledQueue = [...this.unshuffledQueue, cmd.trackId];
        break;
      }

      case 'queueRemove': {
        if (cmd.index < 0 || cmd.index >= s.queue.length) return;
        const removed = s.queue[cmd.index];
        s.queue = s.queue.filter((_, i) => i !== cmd.index);
        const u = this.unshuffledQueue.indexOf(removed);
        if (u >= 0) this.unshuffledQueue.splice(u, 1);
        if (cmd.index < s.queueIndex) s.queueIndex--;
        else if (cmd.index === s.queueIndex) this.loadTrackAt(Math.min(s.queueIndex, s.queue.length - 1));
        break;
      }

      case 'transfer': {
        // The heart of the remote-control feature: hand the audio to another device at
        // exactly the position the old one had reached, then bump rev so both act on it.
        if (!this.connections.has(cmd.deviceId)) {
          this.sendTo(fromDeviceId, { t: 'error', message: 'Esse dispositivo não está mais online.' });
          return;
        }
        s.activeDeviceId = cmd.deviceId;
        if (cmd.play !== undefined) s.isPlaying = cmd.play && !!s.trackId;
        break;
      }

      case 'trackEnded': {
        if (this.state.activeDeviceId !== fromDeviceId) return;
        if (s.repeat === 'track') {
          s.positionMs = 0;
          s.isPlaying = true;
        } else if (!this.advance(true)) {
          s.isPlaying = false;
          s.positionMs = s.durationMs;
        }
        break;
      }
    }

    s.positionUpdatedAt = Date.now();
    this.bump();
  }

  /**
   * Moves to the next track. `auto` distinguishes the natural end of a track from a deliberate
   * skip: a press always moves (wrapping at the end), while autoplay stops there unless the
   * listener asked for repeat. A button that does nothing reads as broken.
   */
  private advance(auto: boolean): boolean {
    const s = this.state;
    if (s.queue.length === 0) return false;

    if (s.queueIndex < s.queue.length - 1) {
      this.loadTrackAt(s.queueIndex + 1);
      if (auto) s.isPlaying = true;
      return true;
    }
    if (!auto || s.repeat === 'context') {
      this.loadTrackAt(0);
      if (auto) s.isPlaying = true;
      return true;
    }
    // End of queue with repeat off: autoplay stops there.
    return false;
  }

  private loadTrackAt(index: number): void {
    const s = this.state;
    if (index < 0 || index >= s.queue.length) {
      s.queueIndex = -1;
      s.trackId = null;
      s.durationMs = 0;
      s.positionMs = 0;
      return;
    }
    s.queueIndex = index;
    s.trackId = s.queue[index];
    s.durationMs = getTrack(s.trackId)?.durationMs ?? 0;
    s.positionMs = 0;
  }

  // ------------------------------------------------------------ fan-out

  /** Bumps the revision and broadcasts. Devices hard-reconcile only when rev changes. */
  private bump(): void {
    this.state.rev++;
    this.broadcastState();
  }

  private broadcastState(): void {
    this.broadcast({ t: 'state', state: this.state });
  }

  private broadcastDevices(): void {
    this.broadcast({ t: 'devices', devices: this.getDevices() });
  }

  /** Tells every client its cached library is stale (new upload, disk rescan, playlist edit). */
  notifyLibraryChanged(reason: string): void {
    this.broadcast({ t: 'library', reason });
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const conn of this.connections.values()) {
      if (conn.ws.readyState === 1) {
        try { conn.ws.send(payload); } catch { /* socket died mid-send; cleanup runs on close */ }
      }
    }
  }

  private sendTo(deviceId: string, msg: ServerMessage): void {
    const conn = this.connections.get(deviceId);
    if (conn) this.send(conn.ws, msg);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }

  /** Drops a track that no longer exists from the queue (e.g. its file was deleted). */
  purgeTrack(trackId: string): void {
    const s = this.state;
    if (!s.queue.includes(trackId) && s.trackId !== trackId) return;
    const idx = s.queue.indexOf(trackId);
    s.queue = s.queue.filter((id) => id !== trackId);
    this.unshuffledQueue = this.unshuffledQueue.filter((id) => id !== trackId);
    if (s.trackId === trackId) {
      this.loadTrackAt(Math.min(idx, s.queue.length - 1));
      s.isPlaying = false;
    } else if (idx >= 0 && idx < s.queueIndex) {
      s.queueIndex--;
    }
    this.bump();
  }
}

export const hub = new Hub();
