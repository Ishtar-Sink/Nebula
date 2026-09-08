import { useState } from 'react';
import type { Playlist, Track } from '@nebula/protocol';
import {
  IconQueue, IconPlus, IconDisc, IconTrash, IconX, IconPlay, IconEdit,
} from '../icons.tsx';

/**
 * What the menu is allowed to offer depends entirely on where the track was clicked, so the
 * opener describes the context and the menu decides. A catalog track can never be deleted
 * from here (that is the backoffice's job) and a local file can never join a server playlist.
 */
export interface TrackMenuTarget {
  track: Track;
  x: number;
  y: number;
  scope: 'catalog' | 'offline';
  /**
   * The list the menu was opened from, so "Tocar" starts a real queue. Playing a single track
   * on its own would leave next/previous with nowhere to go.
   */
  context: { id: string; name: string; tracks: Track[]; index: number };
  /** Opened from inside a playlist: enables "remove from this playlist". */
  playlistId?: string;
  /** Opened from the queue: enables "remove from queue". */
  queueIndex?: number;
}

interface Props {
  target: TrackMenuTarget;
  /** Already narrowed to the scope: only playlists that can actually hold this track. */
  playlists: Playlist[];
  onClose: () => void;
  onPlay: () => void;
  onQueueAdd: () => void;
  onQueueRemove?: () => void;
  onOpenAlbum?: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onCreatePlaylist: () => void;
  onRemoveFromPlaylist?: () => void;
  /** Local files only — removes the file from this device for good. */
  onDeleteTrack?: () => void;
  /** Local files only — the name guessed from the filename is often wrong. */
  onEditTrack?: () => void;
}

const WIDTH = 232;

export function TrackMenu({
  target, playlists, onClose, onPlay, onQueueAdd, onQueueRemove, onOpenAlbum,
  onAddToPlaylist, onCreatePlaylist, onRemoveFromPlaylist, onDeleteTrack, onEditTrack,
}: Props) {
  // Two-step delete: a file removed by accident cannot be recovered from anywhere.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const left = Math.max(8, Math.min(target.x, window.innerWidth - WIDTH - 8));
  const top = Math.min(target.y + 6, Math.max(8, window.innerHeight - 360));

  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div
      className="menu"
      style={{ left, top, width: WIDTH }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      <div className="menu-title truncate" title={target.track.title}>{target.track.title}</div>

      <button className="menu-item" onClick={run(onPlay)}>
        <IconPlay size={16} /> Tocar
      </button>
      <button className="menu-item" onClick={run(onQueueAdd)}>
        <IconQueue size={16} /> Adicionar à fila
      </button>
      {onQueueRemove && (
        <button className="menu-item" onClick={run(onQueueRemove)}>
          <IconX size={16} /> Tirar da fila
        </button>
      )}
      {onOpenAlbum && (
        <button className="menu-item" onClick={run(onOpenAlbum)}>
          <IconDisc size={16} /> Ir para o álbum
        </button>
      )}

      <div className="menu-sep" />
      <div className="menu-label">
        {target.scope === 'offline' ? 'Playlists offline' : 'Adicionar à playlist'}
      </div>

      {playlists.length === 0 ? (
        <button className="menu-item" onClick={run(onCreatePlaylist)}>
          <IconPlus size={16} /> Criar playlist
        </button>
      ) : (
        <>
          {playlists.map((pl) => (
            <button key={pl.id} className="menu-item" onClick={run(() => onAddToPlaylist(pl.id))}>
              <IconDisc size={16} /> <span className="truncate">{pl.name}</span>
            </button>
          ))}
          <button className="menu-item" onClick={run(onCreatePlaylist)}>
            <IconPlus size={16} /> Nova playlist
          </button>
        </>
      )}

      {(onRemoveFromPlaylist || onEditTrack || onDeleteTrack) && <div className="menu-sep" />}

      {onRemoveFromPlaylist && (
        <button className="menu-item" onClick={run(onRemoveFromPlaylist)}>
          <IconX size={16} /> Remover desta playlist
        </button>
      )}
      {onEditTrack && (
        <button className="menu-item" onClick={run(onEditTrack)}>
          <IconEdit size={16} /> Editar informações
        </button>
      )}
      {onDeleteTrack && (
        <button
          className={`menu-item ${confirmDelete ? 'danger' : ''}`}
          onClick={confirmDelete ? run(onDeleteTrack) : () => setConfirmDelete(true)}
        >
          <IconTrash size={16} />
          {confirmDelete ? 'Confirmar: apagar o arquivo' : 'Remover deste aparelho'}
        </button>
      )}
    </div>
  );
}
