import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Playlist, PlaylistDetail, Track } from '@nebula/protocol';
import { api, apiUrl, defaultUrl, isOverridden, setServerUrl, settingsLocation } from './api.ts';
import { useNebula } from './useNebula.ts';
import { useMediaSession } from './useMediaSession.ts';
import { Sidebar, type View } from './components/Sidebar.tsx';
import { TrackMenu, type TrackMenuTarget } from './components/TrackMenu.tsx';
import { PlaylistMenu, type PlaylistMenuTarget } from './components/PlaylistMenu.tsx';
import { AddLocalDialog } from './components/AddLocalDialog.tsx';
import { Modal } from './components/Modal.tsx';
import { CoverPicker } from './components/CoverPicker.tsx';
import { imageToBlob, imageToDataUrl } from '@nebula/browser';
import { PlayerBar } from './components/PlayerBar.tsx';
import { Home } from './views/Home.tsx';
import { SearchView } from './views/SearchView.tsx';
import { OfflineView } from './views/OfflineView.tsx';
import { QueueView } from './views/QueueView.tsx';
import { PlaylistView } from './views/PlaylistView.tsx';
import { AlbumView } from './views/AlbumView.tsx';
import { useOfflinePlayer } from './offline/useOfflinePlayer.ts';
import {
  listOfflineTracks, draftFromFile, addOfflineDrafts, removeOfflineTrack, updateOfflineTrack,
  clearOfflineLibrary, offlineLibrarySize,
  listOfflinePlaylists, getOfflinePlaylist, createOfflinePlaylist, deleteOfflinePlaylist,
  renameOfflinePlaylist, addTrackToOfflinePlaylist, removeTrackFromOfflinePlaylist,
  setOfflinePlaylistCover, type OfflineDraft,
} from './offline/store.ts';
import { IconSearch, IconX, IconSettings } from './icons.tsx';

interface ModalState {
  mode: 'create' | 'rename';
  scope: 'catalog' | 'offline';
  value: string;
  playlistId?: string;
}

/** Editing the guessed metadata of a local file. Only ever touches this device. */
interface EditState {
  track: Track;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
}

export default function App() {
  const client = useNebula();
  const { state, send, libraryRev, connected, isActive } = client;

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);

  // The offline library lives only in this browser: separate list, separate player, and no
  // request ever leaves the device for it.
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [offlinePlaylists, setOfflinePlaylists] = useState<Playlist[]>([]);
  const [offlineDetail, setOfflineDetail] = useState<PlaylistDetail | null>(null);
  const [offlineBytes, setOfflineBytes] = useState(0);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const offlineClient = useOfflinePlayer(offlineTracks);
  // Exactly one of the two players drives the bar, so two tracks can never sound at once.
  const player = offlineMode ? offlineClient : client;
  const [view, setView] = useState<View>({ kind: 'home' });
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [playlistMenu, setPlaylistMenu] = useState<PlaylistMenuTarget | null>(null);
  /** Files picked from disk, awaiting confirmation. Nothing is stored until then. */
  const [drafts, setDrafts] = useState<OfflineDraft[] | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [settings, setSettings] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 3200);
  }, []);

  // ---------------------------------------------------------------- data

  const reload = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.tracks(), api.playlists()]);
      setTracks(t);
      setPlaylists(p);
    } catch {
      // Silence is deliberate: the offline mode is meant to work with no server at all, and
      // the connection dot in the topbar already says what is going on.
    }
  }, []);

  useEffect(() => { void reload(); }, [reload, libraryRev]);

  const reloadOffline = useCallback(async () => {
    try {
      const [list, pls, bytes] = await Promise.all([
        listOfflineTracks(), listOfflinePlaylists(), offlineLibrarySize(),
      ]);
      setOfflineTracks(list);
      setOfflinePlaylists(pls);
      setOfflineBytes(bytes);
    } catch (err) {
      showToast(`Biblioteca offline indisponível: ${(err as Error).message}`);
    }
  }, [showToast]);

  useEffect(() => { void reloadOffline(); }, [reloadOffline]);

  // The open offline playlist is re-read whenever the local library changes.
  useEffect(() => {
    if (view.kind !== 'offline-playlist') { setOfflineDetail(null); return; }
    let cancelled = false;
    void getOfflinePlaylist(view.id).then((d) => {
      if (cancelled) return;
      if (!d) { showToast('Playlist offline não encontrada'); setView({ kind: 'offline' }); return; }
      setOfflineDetail(d);
    });
    return () => { cancelled = true; };
  }, [view, offlineTracks, offlinePlaylists, showToast]);

  // Keep the open playlist in sync with library changes made from any device.
  useEffect(() => {
    if (view.kind !== 'playlist') { setDetail(null); return; }
    let cancelled = false;
    api.playlist(view.id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) { showToast('Playlist não encontrada'); setView({ kind: 'home' }); } });
    return () => { cancelled = true; };
  }, [view, libraryRev, showToast]);

  // Merged only for lookups (player bar, queue): the two libraries stay separate lists.
  const byId = useMemo(
    () => new Map([...tracks, ...offlineTracks].map((t) => [t.id, t])),
    [tracks, offlineTracks],
  );
  const currentTrack = player.state.trackId ? byId.get(player.state.trackId) ?? null : null;

  // Whichever player owns the audio also owns the hardware buttons.
  useMediaSession({
    state: player.state,
    track: currentTrack,
    positionMs: player.positionMs,
    active: player.isActive,
    send: player.send,
    seek: player.seek,
  });

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q));
  }, [tracks, query]);

  const albumTracks = useMemo(
    () => (view.kind === 'album' ? tracks.filter((t) => t.album === view.name) : []),
    [tracks, view],
  );

  const queueTracks = useMemo(
    () => player.state.queue.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t)),
    [player.state.queue, byId],
  );

  // ---------------------------------------------------------------- playback

  const playContext = useCallback(
    (contextId: string, contextName: string, list: Track[], startIndex: number) => {
      if (list.length === 0) return;
      // Anything from the catalog leaves offline mode, silencing the local file first.
      if (offlineMode) {
        offlineClient.send({ type: 'pause' });
        setOfflineMode(false);
      }
      send({
        type: 'playContext',
        contextId,
        contextName,
        trackIds: list.map((t) => t.id),
        startIndex,
      });
    },
    [send, offlineMode, offlineClient],
  );

  const playOfflineContext = useCallback(
    (contextId: string, contextName: string, list: Track[], startIndex: number) => {
      if (list.length === 0) return;
      // Taking over this device's audio: whatever the server had us playing stops here. Other
      // devices keep going — the offline library simply never was part of that session.
      if (!offlineMode) {
        if (isActive) send({ type: 'pause' });
        setOfflineMode(true);
      }
      offlineClient.send({
        type: 'playContext',
        contextId,
        contextName,
        trackIds: list.map((t) => t.id),
        startIndex,
      });
    },
    [offlineMode, offlineClient, isActive, send],
  );

  const playOffline = useCallback(
    (startIndex: number) =>
      playOfflineContext('offline', 'Modo offline', offlineTracks, startIndex),
    [playOfflineContext, offlineTracks],
  );

  // ---------------------------------------------------------------- offline library

  /** Reads the picked files just enough to show them, then waits for confirmation. */
  const stageOffline = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setOfflineBusy(true);
    try {
      setDrafts(await Promise.all(Array.from(files).map(draftFromFile)));
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setOfflineBusy(false);
    }
  }, [showToast]);

  const confirmOffline = useCallback(async (confirmed: OfflineDraft[]) => {
    setDrafts(null);
    setOfflineBusy(true);
    try {
      const added = await addOfflineDrafts(confirmed);
      await reloadOffline();
      showToast(`${added.length} ${added.length === 1 ? 'faixa adicionada' : 'faixas adicionadas'} a este aparelho`);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setOfflineBusy(false);
    }
  }, [reloadOffline, showToast]);

  const removeOffline = useCallback(async (track: Track) => {
    await removeOfflineTrack(track.id);
    await reloadOffline();
    showToast(`“${track.title}” removida deste aparelho`);
  }, [reloadOffline, showToast]);

  const saveEdit = useCallback(async () => {
    if (!edit) return;
    try {
      await updateOfflineTrack(edit.track.id, {
        title: edit.title, artist: edit.artist, album: edit.album, coverUrl: edit.coverUrl,
      });
      await reloadOffline();
      setEdit(null);
      showToast('Informações atualizadas');
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [edit, reloadOffline, showToast]);

  /**
   * One entry point for both kinds of playlist cover: the server stores bytes, the offline
   * library stores a data URL, and the picker downscales either way.
   */
  const pickPlaylistCover = useCallback((playlistId: string, scope: 'catalog' | 'offline') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (scope === 'offline') {
          await setOfflinePlaylistCover(playlistId, await imageToDataUrl(file));
          await reloadOffline();
        } else {
          await api.setPlaylistCover(playlistId, await imageToBlob(file));
          await reload();
        }
        showToast('Imagem atualizada');
      } catch (err) {
        showToast((err as Error).message);
      }
    };
    input.click();
  }, [reload, reloadOffline, showToast]);

  const clearPlaylistCover = useCallback(async (playlistId: string, scope: 'catalog' | 'offline') => {
    try {
      if (scope === 'offline') {
        await setOfflinePlaylistCover(playlistId, null);
        await reloadOffline();
      } else {
        await api.clearPlaylistCover(playlistId);
        await reload();
      }
      showToast('Imagem removida');
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [reload, reloadOffline, showToast]);

  const deletePlaylistById = useCallback(async (playlistId: string, scope: 'catalog' | 'offline') => {
    try {
      if (scope === 'offline') {
        await deleteOfflinePlaylist(playlistId);
        await reloadOffline();
      } else {
        await api.deletePlaylist(playlistId);
        await reload();
      }
      setView((current) =>
        (current.kind === 'playlist' || current.kind === 'offline-playlist') && current.id === playlistId
          ? { kind: 'home' }
          : current);
      showToast('Playlist excluída');
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [reload, reloadOffline, showToast]);

  /** Plays a playlist without opening it — used by the sidebar's context menu. */
  const playPlaylistById = useCallback(async (
    playlistId: string, scope: 'catalog' | 'offline', shuffle: boolean,
  ) => {
    try {
      if (scope === 'offline') {
        const full = await getOfflinePlaylist(playlistId);
        if (!full || full.tracks.length === 0) { showToast('Playlist vazia'); return; }
        if (shuffle) offlineClient.send({ type: 'shuffle', shuffle: true });
        playOfflineContext(`offline-playlist:${full.id}`, full.name, full.tracks, 0);
      } else {
        const full = await api.playlist(playlistId);
        if (full.tracks.length === 0) { showToast('Playlist vazia'); return; }
        if (shuffle) send({ type: 'shuffle', shuffle: true });
        playContext(`playlist:${full.id}`, full.name, full.tracks, 0);
      }
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [offlineClient, playOfflineContext, playContext, send, showToast]);

  const addToOfflinePlaylist = useCallback(async (playlistId: string, trackId: string) => {
    try {
      await addTrackToOfflinePlaylist(playlistId, trackId);
      await reloadOffline();
      showToast('Adicionado à playlist offline');
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [reloadOffline, showToast]);

  const clearOffline = useCallback(async () => {
    await clearOfflineLibrary();
    await reloadOffline();
    showToast('Biblioteca offline esvaziada');
  }, [reloadOffline, showToast]);

  // ---------------------------------------------------------------- playlist actions

  const submitModal = useCallback(async () => {
    if (!modal) return;
    const name = modal.value.trim();
    if (!name) return;
    try {
      if (modal.scope === 'offline') {
        if (modal.mode === 'create') {
          const created = await createOfflinePlaylist(name);
          setView({ kind: 'offline-playlist', id: created.id });
          showToast(`Playlist offline “${name}” criada`);
        } else if (modal.playlistId) {
          await renameOfflinePlaylist(modal.playlistId, name);
          showToast('Playlist renomeada');
        }
        await reloadOffline();
      } else if (modal.mode === 'create') {
        const created = await api.createPlaylist(name);
        setPlaylists((prev) => [created, ...prev]);
        setView({ kind: 'playlist', id: created.id });
        showToast(`Playlist “${name}” criada`);
      } else if (modal.playlistId) {
        await api.updatePlaylist(modal.playlistId, { name });
        showToast('Playlist renomeada');
        await reload();
      }
      setModal(null);
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [modal, reload, reloadOffline, showToast]);

  const addToPlaylist = useCallback(async (playlistId: string, trackId: string) => {
    try {
      const updated = await api.addToPlaylist(playlistId, trackId);
      if (view.kind === 'playlist' && view.id === playlistId) setDetail(updated);
      showToast('Adicionado à playlist');
      await reload();
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [reload, showToast, view]);

  // ---------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); player.send({ type: 'toggle' }); }
      if (e.code === 'ArrowRight' && e.shiftKey) player.send({ type: 'next' });
      if (e.code === 'ArrowLeft' && e.shiftKey) player.send({ type: 'previous' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player]);

  useEffect(() => {
    if (!menu && !playlistMenu) return;
    const close = () => { setMenu(null); setPlaylistMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); };
  }, [menu, playlistMenu]);

  // ---------------------------------------------------------------- render

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        playlists={playlists}
        onCreatePlaylist={() => setModal({ mode: 'create', scope: 'catalog', value: '' })}
        offlinePlaylists={offlinePlaylists}
        onCreateOfflinePlaylist={() => setModal({ mode: 'create', scope: 'offline', value: '' })}
        onPlaylistMenu={(pl, scope, at) => setPlaylistMenu({
          ...at, id: pl.id, name: pl.name, scope, hasCover: Boolean(pl.coverUrl),
        })}
      />

      <main className="main">
        <div className="topbar">
          <div className="search-box">
            <IconSearch size={17} />
            <input
              placeholder="Buscar faixas, artistas ou álbuns"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value && view.kind !== 'search') setView({ kind: 'search' });
              }}
            />
            {query && (
              <button className="icon-btn" onClick={() => setQuery('')} aria-label="Limpar busca">
                <IconX size={15} />
              </button>
            )}
          </div>

          <div className="spacer" />

          <span
            className="device-tag"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            title={connected ? `Conectado a ${apiUrl()}` : `Reconectando a ${apiUrl()}...`}
          >
            <span className={`status-dot ${connected ? '' : 'off'}`} />
            {connected ? (isActive ? 'Tocando aqui' : 'Conectado') : 'Reconectando'}
          </span>

          <button
            className="icon-btn"
            onClick={() => setSettings(isOverridden() ? apiUrl() : '')}
            title="Endereço do servidor"
            aria-label="Endereço do servidor"
          >
            <IconSettings size={18} />
          </button>
        </div>

        {view.kind === 'home' && (
          <Home
            tracks={tracks}
            playlists={playlists}
            onNavigate={setView}
            onPlayAlbum={(album) => playContext(`album:${album.name}`, album.name, album.tracks, 0)}
            onPlayPlaylist={async (pl) => {
              const full = await api.playlist(pl.id);
              playContext(`playlist:${pl.id}`, pl.name, full.tracks, 0);
            }}
          />
        )}

        {view.kind === 'search' && (
          <SearchView
            query={query}
            results={searchResults}
            currentTrackId={state.trackId}
            isPlaying={state.isPlaying}
            onPlay={(i) => playContext('search', `Busca: ${query}`, searchResults, i)}
            onMenu={(track, index, at) => setMenu({
              ...at, track, scope: 'catalog',
              context: { id: 'search', name: `Busca: ${query}`, tracks: searchResults, index },
            })}
          />
        )}

        {view.kind === 'offline' && (
          <OfflineView
            tracks={offlineTracks}
            bytes={offlineBytes}
            busy={offlineBusy}
            currentTrackId={offlineMode ? offlineClient.state.trackId : null}
            isPlaying={offlineMode && offlineClient.state.isPlaying}
            onAdd={stageOffline}
            onRemove={removeOffline}
            onClear={clearOffline}
            onPlay={playOffline}
            onToggle={() => offlineClient.send({ type: 'toggle' })}
            onMenu={(track, index, at) => setMenu({
              ...at, track, scope: 'offline',
              context: { id: 'offline', name: 'Modo offline', tracks: offlineTracks, index },
            })}
            onCreatePlaylist={() => setModal({ mode: 'create', scope: 'offline', value: '' })}
          />
        )}

        {view.kind === 'queue' && (
          <QueueView
            queue={queueTracks}
            queueIndex={player.state.queueIndex}
            contextName={player.state.contextName}
            isPlaying={player.state.isPlaying}
            onJump={(i) => (offlineMode
              ? playOffline(i)
              : playContext(state.contextId ?? 'queue', state.contextName ?? 'Fila', queueTracks, i))}
            onRemove={(i) => player.send({ type: 'queueRemove', index: i })}
            onMenu={(track, index, at) => setMenu({
              ...at, track, queueIndex: index,
              scope: offlineMode ? 'offline' : 'catalog',
              context: {
                id: player.state.contextId ?? 'queue',
                name: player.state.contextName ?? 'Fila',
                tracks: queueTracks,
                index,
              },
            })}
          />
        )}

        {view.kind === 'album' && (
          <AlbumView
            name={view.name}
            artist={albumTracks[0]?.artist ?? ''}
            tracks={albumTracks}
            currentTrackId={state.trackId}
            isPlaying={state.isPlaying}
            onPlay={(i) => playContext(`album:${view.name}`, view.name, albumTracks, i)}
            onShuffle={() => {
              send({ type: 'shuffle', shuffle: true });
              playContext(`album:${view.name}`, view.name, albumTracks, 0);
            }}
            onMenu={(track, index, at) => setMenu({
              ...at, track, scope: 'catalog',
              context: { id: `album:${view.name}`, name: view.name, tracks: albumTracks, index },
            })}
          />
        )}

        {view.kind === 'offline-playlist' && offlineDetail && (
          <PlaylistView
            playlist={offlineDetail}
            allTracks={offlineTracks}
            currentTrackId={offlineMode ? offlineClient.state.trackId : null}
            isPlaying={offlineMode && offlineClient.state.isPlaying}
            eyebrow="Playlist offline · só neste aparelho"
            emptyHint="Use “Adicionar faixas” acima para escolher entre os arquivos guardados neste aparelho."
            onPlay={(i) => playOfflineContext(
              `offline-playlist:${offlineDetail.id}`, offlineDetail.name, offlineDetail.tracks, i)}
            onShuffle={() => {
              offlineClient.send({ type: 'shuffle', shuffle: true });
              playOfflineContext(
                `offline-playlist:${offlineDetail.id}`, offlineDetail.name, offlineDetail.tracks, 0);
            }}
            onMenu={(track, index, at) => setMenu({
              ...at, track, scope: 'offline', playlistId: offlineDetail.id,
              context: {
                id: `offline-playlist:${offlineDetail.id}`,
                name: offlineDetail.name,
                tracks: offlineDetail.tracks,
                index,
              },
            })}
            onAddTrack={(trackId) => addToOfflinePlaylist(offlineDetail.id, trackId)}
            onRemoveTrack={async (track) => {
              await removeTrackFromOfflinePlaylist(offlineDetail.id, track.id);
              await reloadOffline();
            }}
            onRename={() => setModal({
              mode: 'rename', scope: 'offline', value: offlineDetail.name, playlistId: offlineDetail.id,
            })}
            onPickCover={() => pickPlaylistCover(offlineDetail.id, 'offline')}
            onDelete={async () => {
              await deleteOfflinePlaylist(offlineDetail.id);
              showToast('Playlist offline excluída');
              setView({ kind: 'offline' });
              await reloadOffline();
            }}
          />
        )}

        {view.kind === 'playlist' && detail && (
          <PlaylistView
            playlist={detail}
            allTracks={tracks}
            currentTrackId={state.trackId}
            isPlaying={state.isPlaying}
            onPlay={(i) => playContext(`playlist:${detail.id}`, detail.name, detail.tracks, i)}
            onShuffle={() => {
              send({ type: 'shuffle', shuffle: true });
              playContext(`playlist:${detail.id}`, detail.name, detail.tracks, 0);
            }}
            onMenu={(track, index, at) => setMenu({
              ...at, track, scope: 'catalog', playlistId: detail.id,
              context: { id: `playlist:${detail.id}`, name: detail.name, tracks: detail.tracks, index },
            })}
            onAddTrack={(trackId) => addToPlaylist(detail.id, trackId)}
            onRemoveTrack={async (track) => {
              try {
                setDetail(await api.removeFromPlaylist(detail.id, track.id));
                await reload();
              } catch (err) { showToast((err as Error).message); }
            }}
            onRename={() => setModal({ mode: 'rename', scope: 'catalog', value: detail.name, playlistId: detail.id })}
            onPickCover={() => pickPlaylistCover(detail.id, 'catalog')}
            onDelete={async () => {
              await api.deletePlaylist(detail.id);
              showToast('Playlist excluída');
              setView({ kind: 'home' });
              await reload();
            }}
          />
        )}
      </main>

      <PlayerBar client={player} track={currentTrack} onOpenQueue={() => setView({ kind: 'queue' })} />

      {/* ---------------------------------------------------------- overlays */}

      {menu && (
        <TrackMenu
          target={menu}
          playlists={menu.scope === 'offline' ? offlinePlaylists : playlists}
          onClose={() => setMenu(null)}
          onPlay={() => {
            const { id, name, tracks, index } = menu.context;
            return menu.scope === 'offline'
              ? playOfflineContext(id, name, tracks, index)
              : playContext(id, name, tracks, index);
          }}
          onQueueAdd={() => {
            (menu.scope === 'offline' ? offlineClient : client).send(
              { type: 'queueAdd', trackId: menu.track.id });
            showToast('Adicionado à fila');
          }}
          onQueueRemove={menu.queueIndex === undefined ? undefined : () =>
            player.send({ type: 'queueRemove', index: menu.queueIndex! })}
          onOpenAlbum={menu.scope === 'catalog' && menu.track.album
            ? () => setView({ kind: 'album', name: menu.track.album })
            : undefined}
          onAddToPlaylist={(id) => void (menu.scope === 'offline'
            ? addToOfflinePlaylist(id, menu.track.id)
            : addToPlaylist(id, menu.track.id))}
          onCreatePlaylist={() => setModal({ mode: 'create', scope: menu.scope, value: '' })}
          onRemoveFromPlaylist={menu.playlistId === undefined ? undefined : async () => {
            const playlistId = menu.playlistId!;
            try {
              if (menu.scope === 'offline') {
                await removeTrackFromOfflinePlaylist(playlistId, menu.track.id);
                await reloadOffline();
              } else {
                setDetail(await api.removeFromPlaylist(playlistId, menu.track.id));
                await reload();
              }
              showToast('Removida da playlist');
            } catch (err) {
              showToast((err as Error).message);
            }
          }}
          // Deleting audio is offered only for local files: catalog tracks belong to the
          // server, and removing those is the backoffice's job.
          onDeleteTrack={menu.scope === 'offline' ? () => void removeOffline(menu.track) : undefined}
          onEditTrack={menu.scope === 'offline' ? () => setEdit({
            track: menu.track,
            title: menu.track.title,
            artist: menu.track.artist,
            album: menu.track.album,
            coverUrl: menu.track.coverUrl ?? null,
          }) : undefined}
        />
      )}

      {playlistMenu && (
        <PlaylistMenu
          target={playlistMenu}
          onClose={() => setPlaylistMenu(null)}
          onPlay={() => void playPlaylistById(playlistMenu.id, playlistMenu.scope, false)}
          onShuffle={() => void playPlaylistById(playlistMenu.id, playlistMenu.scope, true)}
          onRename={() => setModal({
            mode: 'rename', scope: playlistMenu.scope,
            value: playlistMenu.name, playlistId: playlistMenu.id,
          })}
          onPickCover={() => pickPlaylistCover(playlistMenu.id, playlistMenu.scope)}
          onClearCover={() => void clearPlaylistCover(playlistMenu.id, playlistMenu.scope)}
          onDelete={() => void deletePlaylistById(playlistMenu.id, playlistMenu.scope)}
        />
      )}

      {drafts && (
        <AddLocalDialog
          drafts={drafts}
          onCancel={() => setDrafts(null)}
          onConfirm={(confirmed) => void confirmOffline(confirmed)}
          onError={showToast}
        />
      )}

      {modal && (
        <Modal
          title={modal.mode === 'create'
            ? (modal.scope === 'offline' ? 'Nova playlist offline' : 'Nova playlist')
            : 'Renomear playlist'}
          subtitle={modal.mode !== 'create' ? 'Escolha um novo nome.'
            : modal.scope === 'offline'
              ? 'Só com arquivos deste aparelho. Não vai para o servidor nem para os outros aparelhos.'
              : 'Vale em todos os aparelhos. Dê um nome para sua nova seleção.'}
          onClose={() => setModal(null)}
          actions={
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={submitModal} disabled={!modal.value.trim()}>
                {modal.mode === 'create' ? 'Criar' : 'Salvar'}
              </button>
            </>
          }
        >
          {/* Without the server there is nothing to create a catalog playlist in — say so
              before the attempt fails, and offer the one that does work. */}
          {modal.scope === 'catalog' && !connected && (
            <p style={{ color: 'var(--danger)' }}>
              Sem conexão com o servidor. Você ainda pode criar uma{' '}
              <button className="link-btn" onClick={() => setModal({ ...modal, scope: 'offline' })}>
                playlist offline
              </button>
              , que fica só neste aparelho.
            </p>
          )}
          <input
            className="field"
            autoFocus
            value={modal.value}
            placeholder="Ex.: Foco profundo"
            onChange={(e) => setModal({ ...modal, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitModal(); }}
          />
        </Modal>
      )}

      {edit && (
        <Modal
          title="Editar informações"
          subtitle="Título e artista foram adivinhados pelo nome do arquivo. A correção fica só neste aparelho, como o próprio arquivo."
          onClose={() => setEdit(null)}
          actions={
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={!edit.title.trim()}>
                Salvar
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <CoverPicker
              coverUrl={edit.coverUrl}
              colorA={edit.track.colorA}
              colorB={edit.track.colorB}
              onPick={(dataUrl) => setEdit({ ...edit, coverUrl: dataUrl })}
              onError={showToast}
            />
            <div style={{ flex: 1, display: 'grid', gap: 10, minWidth: 0 }}>
              <input
                className="field"
                autoFocus
                placeholder="Título"
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
              <input
                className="field"
                placeholder="Artista"
                value={edit.artist}
                onChange={(e) => setEdit({ ...edit, artist: e.target.value })}
              />
              <input
                className="field"
                placeholder="Álbum"
                value={edit.album}
                onChange={(e) => setEdit({ ...edit, album: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); }}
              />
              {edit.coverUrl && (
                <button className="link-btn" onClick={() => setEdit({ ...edit, coverUrl: null })}>
                  Remover imagem
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {settings !== null && (
        <Modal
          title="Servidor Nebula"
          subtitle={
            <>
              Por padrão o endereço vem do host desta página (<code>{defaultUrl()}</code>).
              Preencha abaixo apenas se o servidor estiver em outra máquina ou porta.
            </>
          }
          onClose={() => setSettings(null)}
          actions={
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void setServerUrl(null).then(() => location.reload())}
              >
                Usar o padrão
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSettings(null)}>Cancelar</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void setServerUrl(settings).then(() => location.reload())}
              >
                Salvar
              </button>
            </>
          }
        >
          <input
            className="field"
            autoFocus
            value={settings}
            placeholder={defaultUrl()}
            onChange={(e) => setSettings(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void setServerUrl(settings).then(() => location.reload()); }}
          />
          <p style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            Salvo em <code>{settingsLocation()}</code>. A janela recarrega ao salvar, para
            reabrir a conexão no novo endereço.
          </p>
        </Modal>
      )}

      {player.needsGesture && (
        <div className="toast" onClick={() => { player.send({ type: 'play' }); player.dismissError(); }}>
          O navegador bloqueou o áudio automático — clique aqui para liberar.
        </div>
      )}

      {toast && !player.needsGesture && <div className="toast">{toast}</div>}

      {player.error && !toast && (
        <div className="toast" onClick={player.dismissError}>
          {player.error} <IconX size={14} />
        </div>
      )}
    </div>
  );
}
