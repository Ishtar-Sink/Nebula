import { useState } from 'react';
import { formatDuration } from '@nebula/protocol';
import { paletteFor } from '@nebula/theme';
import { Modal } from './Modal.tsx';
import { CoverPicker } from './CoverPicker.tsx';
import type { OfflineDraft } from '../offline/store.ts';
import { IconTrash } from '../icons.tsx';

interface Props {
  drafts: OfflineDraft[];
  onCancel: () => void;
  onConfirm: (drafts: OfflineDraft[]) => void;
  onError: (message: string) => void;
}

/**
 * Confirmation step for files picked from disk. Nothing is stored until the listener presses
 * "Adicionar" — the title and artist guessed from the filename are usually close but rarely
 * right, and dragging in a whole album means fixing the same artist a dozen times otherwise.
 */
export function AddLocalDialog({ drafts: initial, onCancel, onConfirm, onError }: Props) {
  const [drafts, setDrafts] = useState(initial);
  const [bulkArtist, setBulkArtist] = useState('');
  const [bulkAlbum, setBulkAlbum] = useState('');

  const patch = (index: number, fields: Partial<OfflineDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...fields } : d)));

  const drop = (index: number) => setDrafts((prev) => prev.filter((_, i) => i !== index));

  const applyToAll = () => setDrafts((prev) => prev.map((d) => ({
    ...d,
    artist: bulkArtist.trim() || d.artist,
    album: bulkAlbum.trim() || d.album,
  })));

  return (
    <Modal
      wide
      title={drafts.length === 1 ? 'Adicionar faixa' : `Adicionar ${drafts.length} faixas`}
      subtitle="Título e artista foram adivinhados pelo nome do arquivo. Ajuste antes de guardar — tudo isto fica só neste aparelho."
      onClose={onCancel}
      actions={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onConfirm(drafts)}
            disabled={drafts.length === 0}
          >
            {drafts.length === 1 ? 'Adicionar' : `Adicionar ${drafts.length}`}
          </button>
        </>
      }
    >
      {drafts.length > 1 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          <input
            className="field"
            style={{ flex: 1, minWidth: 140 }}
            placeholder="Artista para todas"
            value={bulkArtist}
            onChange={(e) => setBulkArtist(e.target.value)}
          />
          <input
            className="field"
            style={{ flex: 1, minWidth: 140 }}
            placeholder="Álbum para todas"
            value={bulkAlbum}
            onChange={(e) => setBulkAlbum(e.target.value)}
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={applyToAll}
            disabled={!bulkArtist.trim() && !bulkAlbum.trim()}
          >
            Aplicar a todas
          </button>
        </div>
      )}

      <div className="draft-list">
        {drafts.map((draft, i) => {
          const [colorA, colorB] = paletteFor(draft.file.name);
          return (
            <div className="draft" key={`${draft.file.name}-${i}`}>
              <CoverPicker
                coverUrl={draft.coverUrl}
                colorA={colorA}
                colorB={colorB}
                onPick={(dataUrl) => patch(i, { coverUrl: dataUrl })}
                onError={onError}
              />

              <div className="draft-fields">
                <input
                  className="field"
                  placeholder="Título"
                  value={draft.title}
                  onChange={(e) => patch(i, { title: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Artista"
                  value={draft.artist}
                  onChange={(e) => patch(i, { artist: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Álbum"
                  value={draft.album}
                  onChange={(e) => patch(i, { album: e.target.value })}
                />
                <div className="draft-file truncate">
                  {draft.file.name} · {formatDuration(draft.durationMs)}
                </div>
              </div>

              <button
                className="icon-btn"
                onClick={() => drop(i)}
                title="Não adicionar este"
                aria-label={`Não adicionar ${draft.file.name}`}
              >
                <IconTrash size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
