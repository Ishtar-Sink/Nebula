import { useRef, useState } from 'react';
import type { Track } from '@nebula/protocol';
import { TrackList } from '../components/TrackList.tsx';
import { IconUpload, IconPlay, IconPause, IconTrash, IconFolder, IconPlus } from '../icons.tsx';

interface Props {
  tracks: Track[];
  bytes: number;
  currentTrackId: string | null;
  isPlaying: boolean;
  busy: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (track: Track) => void;
  onClear: () => void;
  onPlay: (index: number) => void;
  onToggle: () => void;
  onMenu: (track: Track, index: number, anchor: { x: number; y: number }) => void;
  onCreatePlaylist: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function OfflineView({
  tracks, bytes, currentTrackId, isPlaying, busy,
  onAdd, onRemove, onClear, onPlay, onToggle, onMenu, onCreatePlaylist,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const pick = () => fileInput.current?.click();

  return (
    <div className="view">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <div className="page-eyebrow">Modo offline</div>
          <h1 className="page-title">Arquivos deste aparelho</h1>
          <p className="page-sub">
            Tocam sem servidor e sem internet. Os arquivos ficam guardados só aqui, neste
            navegador — nada é enviado e nenhum outro aparelho enxerga esta lista.
          </p>
        </div>
      </div>

      <div className="chips">
        {tracks.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => (currentTrackId ? onToggle() : onPlay(0))}>
            {isPlaying ? <IconPause size={15} /> : <IconPlay size={15} />}
            {isPlaying ? 'Pausar' : 'Tocar tudo'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={pick} disabled={busy}>
          <IconUpload size={15} /> {busy ? 'Lendo...' : 'Adicionar arquivos'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCreatePlaylist}>
          <IconPlus size={15} /> Nova playlist offline
        </button>
        {tracks.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => (confirmClear ? (onClear(), setConfirmClear(false)) : setConfirmClear(true))}
            onBlur={() => setConfirmClear(false)}
          >
            <IconTrash size={15} /> {confirmClear ? 'Confirmar remoção' : 'Esvaziar'}
          </button>
        )}
        {tracks.length > 0 && (
          <span className="chip-note">
            {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'} · {formatBytes(bytes)} neste aparelho
          </span>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac"
          multiple
          hidden
          onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }}
        />
      </div>

      {tracks.length === 0 ? (
        <div className="empty">
          <IconFolder size={34} />
          <h3>Sua biblioteca offline está vazia</h3>
          <p>
            Escolha músicas do disco para tocar sem depender do servidor. Elas ficam salvas
            neste navegador e continuam aqui na próxima vez que você abrir o Nebula.
          </p>
          <button className="btn btn-primary" onClick={pick}>
            <IconUpload size={16} /> Escolher arquivos
          </button>
        </div>
      ) : (
        <TrackList
          tracks={tracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={onPlay}
          onMenu={onMenu}
          onRemove={onRemove}
          removeLabel="Remover deste aparelho"
          showAlbum={false}
        />
      )}
    </div>
  );
}
