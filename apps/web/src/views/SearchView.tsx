import type { Track } from '@nebula/protocol';
import { TrackList } from '../components/TrackList.tsx';

interface Props {
  query: string;
  results: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onMenu: (track: Track, index: number, anchor: { x: number; y: number }) => void;
}

export function SearchView({ query, results, currentTrackId, isPlaying, onPlay, onMenu }: Props) {
  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Busca</div>
          <h1 className="page-title">{query ? `“${query}”` : 'O que você quer ouvir?'}</h1>
          {query && (
            <p className="page-sub">
              {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
            </p>
          )}
        </div>
      </div>

      {query && results.length === 0 ? (
        <div className="empty">
          <h3>Nada encontrado</h3>
          <p>Tente outro termo — a busca cobre título, artista e álbum, no catálogo e nos arquivos do disco.</p>
        </div>
      ) : query ? (
        <TrackList
          tracks={results}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          onPlay={onPlay}
          onMenu={onMenu}
        />
      ) : (
        <div className="empty">
          <h3>Comece a digitar</h3>
          <p>Use a barra no topo para procurar faixas por nome, artista ou álbum.</p>
        </div>
      )}
    </div>
  );
}
