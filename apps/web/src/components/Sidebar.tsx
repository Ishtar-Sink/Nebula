import type { Playlist } from '@nebula/protocol';
import { IconHome, IconSearch, IconFolder, IconQueue, IconPlus, IconDisc } from '../icons.tsx';
import { Cover } from './Cover.tsx';

export type View =
  | { kind: 'home' }
  | { kind: 'search' }
  | { kind: 'offline' }
  | { kind: 'queue' }
  | { kind: 'album'; name: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'offline-playlist'; id: string };

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  playlists: Playlist[];
  onCreatePlaylist: () => void;
  /** Playlists of files that live only on this device. Kept visually apart on purpose. */
  offlinePlaylists: Playlist[];
  onCreateOfflinePlaylist: () => void;
  onPlaylistMenu: (
    playlist: Playlist,
    scope: 'catalog' | 'offline',
    anchor: { x: number; y: number },
  ) => void;
}

export function Sidebar({
  view, onNavigate, playlists, onCreatePlaylist, offlinePlaylists, onCreateOfflinePlaylist,
  onPlaylistMenu,
}: Props) {
  const nav = [
    { kind: 'home' as const, label: 'Início', Icon: IconHome },
    { kind: 'search' as const, label: 'Buscar', Icon: IconSearch },
    { kind: 'offline' as const, label: 'Modo offline', Icon: IconFolder },
    { kind: 'queue' as const, label: 'Fila', Icon: IconQueue },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><IconDisc size={19} /></div>
        <span className="brand-name">Nebula</span>
      </div>

      <nav className="nav">
        {nav.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            className={`nav-item ${view.kind === kind ? 'active' : ''}`}
            onClick={() => onNavigate({ kind })}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-head">
          <span>Suas playlists</span>
          <button className="icon-btn" onClick={onCreatePlaylist} title="Criar playlist" aria-label="Criar playlist">
            <IconPlus size={16} />
          </button>
        </div>

        {playlists.length === 0 ? (
          <div className="sidebar-empty">
            Nenhuma playlist ainda. Crie a primeira no botão <strong>+</strong> acima.
          </div>
        ) : (
          <PlaylistList
            playlists={playlists}
            activeId={view.kind === 'playlist' ? view.id : null}
            onOpen={(id) => onNavigate({ kind: 'playlist', id })}
            onMenu={(pl, at) => onPlaylistMenu(pl, 'catalog', at)}
          />
        )}

        {/* Always visible, including when the server is unreachable — that is precisely when
            an offline playlist is the only one that can be created. */}
        <div className="sidebar-head" style={{ marginTop: 18 }}>
          <span>Playlists offline</span>
          <button
            className="icon-btn"
            onClick={onCreateOfflinePlaylist}
            title="Criar playlist offline"
            aria-label="Criar playlist offline"
          >
            <IconPlus size={16} />
          </button>
        </div>

        {offlinePlaylists.length === 0 ? (
          <div className="sidebar-empty">
            Só com arquivos deste aparelho. Nunca vão para o servidor.
          </div>
        ) : (
          <PlaylistList
            playlists={offlinePlaylists}
            activeId={view.kind === 'offline-playlist' ? view.id : null}
            onOpen={(id) => onNavigate({ kind: 'offline-playlist', id })}
            onMenu={(pl, at) => onPlaylistMenu(pl, 'offline', at)}
            badge
          />
        )}
      </div>
    </aside>
  );
}

function PlaylistList({
  playlists, activeId, onOpen, onMenu, badge = false,
}: {
  playlists: Playlist[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onMenu: (playlist: Playlist, anchor: { x: number; y: number }) => void;
  badge?: boolean;
}) {
  return (
    <div className="playlist-list">
      {playlists.map((pl) => (
        <button
          key={pl.id}
          className={`playlist-item ${activeId === pl.id ? 'active' : ''}`}
          onClick={() => onOpen(pl.id)}
          onContextMenu={(e) => { e.preventDefault(); onMenu(pl, { x: e.clientX, y: e.clientY }); }}
        >
          <Cover
            colorA={pl.colorA}
            colorB={pl.colorB}
            coverUrl={pl.coverUrl}
            size={40}
            radius={8}
            showNote={false}
          />
          <span className="playlist-item-text">
            <div className="playlist-item-name truncate">{pl.name}</div>
            <div className="playlist-item-meta">
              {badge && <span className="badge local">Offline</span>}
              {pl.trackCount} {pl.trackCount === 1 ? 'faixa' : 'faixas'}
            </div>
          </span>
        </button>
      ))}
    </div>
  );
}
