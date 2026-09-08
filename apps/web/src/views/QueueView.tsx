import type { Track } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import { Cover } from '../components/Cover.tsx';
import { IconTrash, IconPlay, IconMore } from '../icons.tsx';

interface Props {
  queue: Track[];
  queueIndex: number;
  contextName: string | null;
  isPlaying: boolean;
  onJump: (index: number) => void;
  onRemove: (index: number) => void;
  onMenu: (track: Track, index: number, anchor: { x: number; y: number }) => void;
}

export function QueueView({
  queue, queueIndex, contextName, isPlaying, onJump, onRemove, onMenu,
}: Props) {
  const current = queue[queueIndex];
  const upcoming = queue.slice(queueIndex + 1);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Reprodução</div>
          <h1 className="page-title">Fila</h1>
          {contextName && <p className="page-sub">Tocando de: {contextName}</p>}
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="empty">
          <h3>Fila vazia</h3>
          <p>Toque um álbum, uma playlist ou seus arquivos do disco para montar a fila.</p>
        </div>
      ) : (
        <>
          {current && (
            <>
              <h2 className="section-title" style={{ marginTop: 0 }}>Tocando agora</h2>
              <div className="track-row current">
                <div className="track-index">
                  <div className={`eq ${isPlaying ? '' : 'paused'}`}><span /><span /><span /></div>
                </div>
                <Cover colorA={current.colorA} colorB={current.colorB} coverUrl={current.coverUrl} size={42} radius={7} showNote={false} />
                <div style={{ minWidth: 0 }}>
                  <div className="track-title truncate">{current.title}</div>
                  <div className="track-artist truncate">{current.artist}</div>
                </div>
                <div className="track-meta truncate col-album">{current.album}</div>
                <div className="track-meta" />
                <span className="track-dur">{formatDuration(current.durationMs)}</span>
              </div>
            </>
          )}

          <h2 className="section-title">
            A seguir {upcoming.length > 0 && <span style={{ color: 'var(--text-faint)', fontWeight: 500, fontSize: 15 }}>({upcoming.length})</span>}
          </h2>

          {upcoming.length === 0 ? (
            <p className="page-sub">Nada depois desta faixa.</p>
          ) : (
            upcoming.map((track, i) => {
              const absoluteIndex = queueIndex + 1 + i;
              return (
                <div
                  key={`${track.id}-${absoluteIndex}`}
                  className="track-row"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onMenu(track, absoluteIndex, { x: e.clientX, y: e.clientY });
                  }}
                >
                  <div className="track-index">
                    <span className="num">{i + 1}</span>
                    <button className="play-hint" onClick={() => onJump(absoluteIndex)} aria-label={`Tocar ${track.title}`}>
                      <IconPlay size={13} />
                    </button>
                  </div>
                  <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={42} radius={7} showNote={false} />
                  <div style={{ minWidth: 0 }}>
                    <div className="track-title truncate">{track.title}</div>
                    <div className="track-artist truncate">{track.artist}</div>
                  </div>
                  <div className="track-meta truncate col-album">{track.album}</div>
                  <div className="track-meta" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    <span className="track-dur">{formatDuration(track.durationMs)}</span>
                    <div className="track-actions">
                      <button className="icon-btn" onClick={() => onRemove(absoluteIndex)} title="Tirar da fila" aria-label="Tirar da fila">
                        <IconTrash size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Mais opções"
                        aria-label="Mais opções"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          onMenu(track, absoluteIndex, { x: r.left, y: r.bottom });
                        }}
                      >
                        <IconMore size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
