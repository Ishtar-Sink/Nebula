import type { Track } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import { Cover } from './Cover.tsx';
import { IconPlay, IconMore, IconTrash } from '../icons.tsx';

interface Props {
  tracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  /** The index matters: "Tocar" from the menu must play inside this list, not on its own. */
  onMenu?: (track: Track, index: number, anchor: { x: number; y: number }) => void;
  onRemove?: (track: Track) => void;
  removeLabel?: string;
  showAlbum?: boolean;
}

export function TrackList({
  tracks, currentTrackId, isPlaying, onPlay, onMenu, onRemove,
  removeLabel = 'Remover da playlist', showAlbum = true,
}: Props) {
  return (
    <div>
      <div className="list-head">
        <span style={{ textAlign: 'right' }}>#</span>
        <span />
        <span>Título</span>
        <span className="col-album">{showAlbum ? 'Álbum' : ''}</span>
        <span className="track-meta">Origem</span>
        <span style={{ textAlign: 'right' }}>Duração</span>
      </div>

      {tracks.map((track, index) => {
        const isCurrent = track.id === currentTrackId;
        return (
          <div
            key={`${track.id}-${index}`}
            className={`track-row clickable ${isCurrent ? 'current' : ''}`}
            onClick={() => onPlay(index)}
            onContextMenu={(e) => {
              if (!onMenu) return;
              e.preventDefault();
              onMenu(track, index, { x: e.clientX, y: e.clientY });
            }}
          >
            <div className="track-index">
              {isCurrent ? (
                <div className={`eq ${isPlaying ? '' : 'paused'}`}><span /><span /><span /></div>
              ) : (
                <>
                  <span className="num">{index + 1}</span>
                  <button
                    className="play-hint"
                    onClick={(e) => { e.stopPropagation(); onPlay(index); }}
                    aria-label={`Tocar ${track.title}`}
                  >
                    <IconPlay size={13} />
                  </button>
                </>
              )}
            </div>

            <Cover
              colorA={track.colorA}
              colorB={track.colorB}
              coverUrl={track.coverUrl}
              size={42}
              radius={7}
              showNote={false}
            />

            <div style={{ minWidth: 0 }}>
              <div className="track-title truncate">{track.title}</div>
              <div className="track-artist truncate">{track.artist}</div>
            </div>

            <div className="track-meta truncate col-album">{showAlbum ? track.album : ''}</div>

            <div className="track-meta">
              <span className={`badge ${track.source === 'local' ? 'local' : ''}`}>
                {track.source === 'local' ? 'Disco' : 'Catálogo'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
              <span className="track-dur">{formatDuration(track.durationMs)}</span>
              <div className="track-actions">
                {onRemove && (
                  <button
                    className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); onRemove(track); }}
                    title={removeLabel}
                    aria-label={removeLabel}
                  >
                    <IconTrash size={15} />
                  </button>
                )}
                {onMenu && (
                  <button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      onMenu(track, index, { x: r.left, y: r.bottom });
                    }}
                    title="Mais opções"
                    aria-label="Mais opções"
                  >
                    <IconMore size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
