import { useMemo, useState } from 'react';
import type { PlaylistDetail, Track } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import { Cover } from '../components/Cover.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { IconPlay, IconPlus, IconTrash, IconSearch, IconX, IconShuffle, IconImage } from '../icons.tsx';

interface Props {
  playlist: PlaylistDetail;
  allTracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onShuffle: () => void;
  onMenu?: (track: Track, index: number, anchor: { x: number; y: number }) => void;
  onAddTrack: (trackId: string) => void;
  onRemoveTrack: (track: Track) => void;
  onRename: () => void;
  onDelete: () => void;
  onPickCover: () => void;
  /** Label above the title. Offline playlists say so, since they behave differently. */
  eyebrow?: string;
  /** Where the listener should look for tracks to add, when the playlist is empty. */
  emptyHint?: string;
}

function totalLabel(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function PlaylistView({
  playlist, allTracks, currentTrackId, isPlaying,
  onPlay, onShuffle, onMenu, onAddTrack, onRemoveTrack, onRename, onDelete, onPickCover,
  eyebrow = 'Playlist',
  emptyHint = 'Use “Adicionar faixas” acima para montar sua seleção a partir do catálogo.',
}: Props) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? allTracks.filter((t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q))
      : allTracks;
    return pool.slice(0, 60);
  }, [allTracks, query]);

  return (
    <div className="view">
      <div className="page-head">
        <div className="cover-editable">
          <Cover
            colorA={playlist.colorA}
            colorB={playlist.colorB}
            coverUrl={playlist.coverUrl}
            size={200}
            radius={16}
            showNote={false}
          />
          <div className="cover-actions">
            <button className="btn btn-ghost btn-sm" onClick={onPickCover}>
              <IconImage size={14} /> {playlist.coverUrl ? 'Trocar' : 'Imagem'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-eyebrow">{eyebrow}</div>
          <h1 className="page-title" style={{ cursor: 'pointer' }} onClick={onRename} title="Renomear">
            {playlist.name}
          </h1>
          {playlist.description && <p className="page-sub">{playlist.description}</p>}
          <p className="page-sub">
            {playlist.trackCount} {playlist.trackCount === 1 ? 'faixa' : 'faixas'}
            {playlist.durationMs > 0 && ` · ${totalLabel(playlist.durationMs)}`}
          </p>
        </div>
      </div>

      <div className="chips">
        <button className="btn btn-primary btn-sm" onClick={() => onPlay(0)} disabled={playlist.tracks.length === 0}>
          <IconPlay size={15} /> Tocar
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onShuffle} disabled={playlist.tracks.length === 0}>
          <IconShuffle size={15} /> Aleatório
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setAdding((v) => !v)}>
          {adding ? <IconX size={15} /> : <IconPlus size={15} />} {adding ? 'Fechar' : 'Adicionar faixas'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDelete}>
          <IconTrash size={15} /> Excluir playlist
        </button>
      </div>

      {adding && (
        <div
          style={{
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 18,
            marginBottom: 26,
          }}
        >
          <div className="search-box" style={{ maxWidth: '100%', marginBottom: 14 }}>
            <IconSearch size={17} />
            <input
              autoFocus
              placeholder="Buscar faixas para adicionar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {candidates.length === 0 ? (
            <p className="page-sub" style={{ margin: 0 }}>Nenhuma faixa encontrada.</p>
          ) : (
            <div style={{ maxHeight: 330, overflowY: 'auto' }}>
              {candidates.map((track) => (
                <div key={track.id} className="track-row" style={{ gridTemplateColumns: '42px 1fr 110px 66px 40px' }}>
                  <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={42} radius={7} showNote={false} />
                  <div style={{ minWidth: 0 }}>
                    <div className="track-title truncate">{track.title}</div>
                    <div className="track-artist truncate">{track.artist} · {track.album}</div>
                  </div>
                  <div className="track-meta">
                    <span className={`badge ${track.source === 'local' ? 'local' : ''}`}>
                      {track.source === 'local' ? 'Disco' : 'Catálogo'}
                    </span>
                  </div>
                  <span className="track-dur">{formatDuration(track.durationMs)}</span>
                  <button className="icon-btn" onClick={() => onAddTrack(track.id)} title="Adicionar" aria-label={`Adicionar ${track.title}`}>
                    <IconPlus size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {playlist.tracks.length === 0 ? (
        <div className="empty">
          <h3>Playlist vazia</h3>
          <p>{emptyHint}</p>
        </div>
      ) : (
        <TrackList
          tracks={playlist.tracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={onPlay}
          onMenu={onMenu}
          onRemove={onRemoveTrack}
        />
      )}
    </div>
  );
}
