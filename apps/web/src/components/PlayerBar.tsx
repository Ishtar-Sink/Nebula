import { useState } from 'react';
import type { Track } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import type { NebulaClient } from '../useNebula.ts';
import { Cover } from './Cover.tsx';
import { DevicePanel } from './DevicePanel.tsx';
import { Scrubber } from './Scrubber.tsx';
import {
  IconPlay, IconPause, IconNext, IconPrev, IconShuffle, IconRepeat,
  IconVolume, IconVolumeOff, IconDevices, IconQueue,
} from '../icons.tsx';

interface Props {
  client: NebulaClient;
  track: Track | null;
  onOpenQueue: () => void;
}

export function PlayerBar({ client, track, onOpenQueue }: Props) {
  const { state, devices, send, seek, positionMs, isActive, deviceId, offline } = client;
  const [showDevices, setShowDevices] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const duration = state.durationMs || track?.durationMs || 0;
  const shown = scrubbing ?? positionMs;
  const activeDevice = devices.find((d) => d.id === state.activeDeviceId);
  const remoteName = !isActive && activeDevice ? activeDevice.name : null;

  return (
    <div className="player">
      <div className="now-playing">
        {track ? (
          <>
            <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={56} radius={10} />
            <div style={{ minWidth: 0 }}>
              <div className="np-title truncate">{track.title}</div>
              <div className="np-artist truncate">{track.artist}</div>
              {/* Lives here rather than above the transport: stacked in the centre column it
                  pushed the scrubber past the bottom of the bar. */}
              {offline ? (
                <div className="remote-banner truncate">
                  <span className="status-dot" />
                  Modo offline · só neste aparelho
                </div>
              ) : remoteName ? (
                <div className="remote-banner truncate">
                  <span className="status-dot" />
                  Tocando em {remoteName}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="np-artist">Nada tocando</div>
        )}
      </div>

      <div className="player-center">
        <div className="transport">
          <button
            className={`transport-btn ${state.shuffle ? 'on' : ''}`}
            onClick={() => send({ type: 'shuffle', shuffle: !state.shuffle })}
            title="Aleatório"
            aria-label="Aleatório"
          >
            <IconShuffle size={18} />
          </button>

          <button
            className="transport-btn"
            onClick={() => send({ type: 'previous' })}
            disabled={!track}
            title="Anterior"
            aria-label="Anterior"
          >
            <IconPrev size={21} />
          </button>

          <button
            className="play-btn"
            onClick={() => send({ type: 'toggle' })}
            disabled={!track}
            title={state.isPlaying ? 'Pausar' : 'Tocar'}
            aria-label={state.isPlaying ? 'Pausar' : 'Tocar'}
          >
            {state.isPlaying ? <IconPause size={19} /> : <IconPlay size={19} />}
          </button>

          <button
            className="transport-btn"
            onClick={() => send({ type: 'next' })}
            disabled={!track}
            title="Próxima"
            aria-label="Próxima"
          >
            <IconNext size={21} />
          </button>

          <button
            className={`transport-btn ${state.repeat !== 'off' ? 'on' : ''}`}
            onClick={() =>
              send({
                type: 'repeat',
                repeat: state.repeat === 'off' ? 'context' : state.repeat === 'context' ? 'track' : 'off',
              })
            }
            title={
              state.repeat === 'track' ? 'Repetir faixa'
                : state.repeat === 'context' ? 'Repetir fila' : 'Repetir desligado'
            }
            aria-label="Repetir"
          >
            <IconRepeat size={18} />
            {state.repeat === 'track' && (
              <span style={{ position: 'absolute', fontSize: 8, fontWeight: 800, marginTop: 1 }}>1</span>
            )}
          </button>
        </div>

        <div className="scrub">
          <span className="time">{formatDuration(shown)}</span>
          <Scrubber
            value={Math.min(shown, duration)}
            max={duration}
            disabled={!track || duration <= 0}
            onScrub={setScrubbing}
            onSeek={seek}
            step={5000}
            ariaLabel="Posição da faixa"
          />
          <span className="time right">{formatDuration(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        <button className="transport-btn" onClick={onOpenQueue} title="Fila" aria-label="Fila">
          <IconQueue size={18} />
        </button>

        {/* Offline playback exists on this device only — there is nothing to transfer to. */}
        {!offline && (
          <button
            className={`transport-btn ${state.activeDeviceId && !isActive ? 'on' : ''}`}
            onClick={() => setShowDevices((v) => !v)}
            title="Conectar a um dispositivo"
            aria-label="Conectar a um dispositivo"
          >
            <IconDevices size={19} />
          </button>
        )}

        <div className="volume-wrap">
          <button
            className="transport-btn"
            onClick={() => send({ type: 'mute', muted: !state.muted })}
            aria-label={state.muted ? 'Reativar som' : 'Silenciar'}
          >
            {state.muted || state.volume === 0 ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
          </button>
          <Scrubber
            className="volume"
            value={state.muted ? 0 : state.volume * 100}
            max={100}
            onScrub={(v) => { if (v !== null) send({ type: 'volume', volume: v / 100 }); }}
            onSeek={(v) => send({ type: 'volume', volume: v / 100 })}
            step={5}
            ariaLabel="Volume"
          />
        </div>
      </div>

      {showDevices && (
        <DevicePanel
          devices={devices}
          activeDeviceId={state.activeDeviceId}
          myDeviceId={deviceId}
          onTransfer={(id) => send({ type: 'transfer', deviceId: id, play: true })}
          onClose={() => setShowDevices(false)}
        />
      )}
    </div>
  );
}
