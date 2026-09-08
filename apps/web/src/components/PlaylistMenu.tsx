import { useState } from 'react';
import { IconPlay, IconShuffle, IconEdit, IconImage, IconTrash, IconX } from '../icons.tsx';

export interface PlaylistMenuTarget {
  id: string;
  name: string;
  x: number;
  y: number;
  scope: 'catalog' | 'offline';
  /** False when the playlist has no cover image, so "remove image" is pointless. */
  hasCover: boolean;
}

interface Props {
  target: PlaylistMenuTarget;
  onClose: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onRename: () => void;
  onPickCover: () => void;
  onClearCover: () => void;
  onDelete: () => void;
}

const WIDTH = 232;

export function PlaylistMenu({
  target, onClose, onPlay, onShuffle, onRename, onPickCover, onClearCover, onDelete,
}: Props) {
  // Two-step delete: a playlist is easy to rebuild but annoying to lose by a stray click.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const left = Math.max(8, Math.min(target.x, window.innerWidth - WIDTH - 8));
  const top = Math.min(target.y + 6, Math.max(8, window.innerHeight - 300));
  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <div
      className="menu"
      style={{ left, top, width: WIDTH }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      <div className="menu-title truncate" title={target.name}>{target.name}</div>

      <button className="menu-item" onClick={run(onPlay)}>
        <IconPlay size={16} /> Tocar
      </button>
      <button className="menu-item" onClick={run(onShuffle)}>
        <IconShuffle size={16} /> Tocar aleatório
      </button>

      <div className="menu-sep" />

      <button className="menu-item" onClick={run(onRename)}>
        <IconEdit size={16} /> Renomear
      </button>
      <button className="menu-item" onClick={run(onPickCover)}>
        <IconImage size={16} /> {target.hasCover ? 'Trocar imagem' : 'Escolher imagem'}
      </button>
      {target.hasCover && (
        <button className="menu-item" onClick={run(onClearCover)}>
          <IconX size={16} /> Remover imagem
        </button>
      )}

      <div className="menu-sep" />

      <button
        className={`menu-item ${confirmDelete ? 'danger' : ''}`}
        onClick={confirmDelete ? run(onDelete) : () => setConfirmDelete(true)}
      >
        <IconTrash size={16} />
        {confirmDelete ? 'Confirmar: excluir playlist' : 'Excluir playlist'}
      </button>
    </div>
  );
}
