import { useMemo } from 'react';
import type { Track, Playlist } from '@nebula/protocol';
import { Cover } from '../components/Cover.tsx';
import { IconPlay } from '../icons.tsx';
import type { View } from '../components/Sidebar.tsx';

interface Album { name: string; artist: string; tracks: Track[]; colorA: string; colorB: string }

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onPlayAlbum: (album: Album) => void;
  onPlayPlaylist: (playlist: Playlist) => void;
  onNavigate: (view: View) => void;
}

export function Home({ tracks, playlists, onPlayAlbum, onPlayPlaylist, onNavigate }: Props) {
  const albums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const track of tracks) {
      if (track.source !== 'catalog') continue;
      const existing = map.get(track.album);
      if (existing) existing.tracks.push(track);
      else map.set(track.album, {
        name: track.album, artist: track.artist, tracks: [track],
        colorA: track.colorA, colorB: track.colorB,
      });
    }
    return [...map.values()];
  }, [tracks]);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Nebula</div>
          <h1 className="page-title">{greeting}</h1>
          <p className="page-sub">
            {tracks.length} faixas disponíveis · {playlists.length}{' '}
            {playlists.length === 1 ? 'playlist' : 'playlists'}
          </p>
        </div>
      </div>

      {albums.length > 0 && (
        <>
          <h2 className="section-title">Catálogo</h2>
          <div className="card-grid">
            {albums.map((album) => (
              <div key={album.name} className="card">
                {/* The card body opens the album; the round button plays it straight away. */}
                <button
                  className="card-open"
                  onClick={() => onNavigate({ kind: 'album', name: album.name })}
                  aria-label={`Abrir ${album.name}`}
                >
                  <Cover colorA={album.colorA} colorB={album.colorB} coverUrl={album.tracks[0]?.coverUrl} size="100%" radius={14} />
                  <div className="card-title truncate">{album.name}</div>
                  <div className="card-sub truncate">
                    {album.artist} · {album.tracks.length} faixas
                  </div>
                </button>
                <button
                  className="card-play"
                  onClick={() => onPlayAlbum(album)}
                  aria-label={`Tocar ${album.name}`}
                >
                  <IconPlay size={17} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {playlists.length > 0 && (
        <>
          <h2 className="section-title">Suas playlists</h2>
          <div className="card-grid">
            {playlists.map((pl) => (
              <div key={pl.id} className="card">
                <button
                  className="card-open"
                  onClick={() => onNavigate({ kind: 'playlist', id: pl.id })}
                  aria-label={`Abrir ${pl.name}`}
                >
                  <Cover colorA={pl.colorA} colorB={pl.colorB} coverUrl={pl.coverUrl} size="100%" radius={14} showNote={false} />
                  <div className="card-title truncate">{pl.name}</div>
                  <div className="card-sub truncate">
                    {pl.trackCount} {pl.trackCount === 1 ? 'faixa' : 'faixas'}
                  </div>
                </button>
                {pl.trackCount > 0 && (
                  <button
                    className="card-play"
                    onClick={() => onPlayPlaylist(pl)}
                    aria-label={`Tocar ${pl.name}`}
                  >
                    <IconPlay size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {tracks.length === 0 && (
        <div className="empty">
          <h3>Nenhuma faixa ainda</h3>
          <p>
            Rode <code>pnpm seed</code> para gerar o catálogo de demonstração, ou coloque seus
            próprios arquivos na pasta monitorada e use “Arquivos do disco”.
          </p>
        </div>
      )}
    </div>
  );
}
