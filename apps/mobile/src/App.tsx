import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, StatusBar, Platform, Modal, ScrollView,
  TextInput, Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import type { Track, Playlist, PlaylistDetail } from '@nebula/protocol';
import { api, loadOverride } from './api';
import { useNebula } from './useNebula';
import * as DocumentPicker from 'expo-document-picker';
import { Cover } from './components/Cover';
import { MiniPlayer, NowPlaying, DeviceSheet } from './components/Player';
import { HomeScreen } from './screens/HomeScreen';
import { SearchScreen } from './screens/SearchScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { OfflineScreen } from './screens/OfflineScreen';
import { useOfflinePlayer } from './offline/useOfflinePlayer';
import {
  listOfflineEntries, draftFromFile, addOfflineDrafts, removeOfflineTrack, updateOfflineTrack,
  saveCoverImage, offlineLibrarySize, listOfflinePlaylists, addTrackToOfflinePlaylist,
  type OfflineEntry, type OfflineDraft,
} from './offline/store';
import { AddLocalSheet } from './screens/AddLocalSheet';
import { serverPlaylists } from './playlistRepo';
import { C, F, R } from './theme';

type Tab = 'home' | 'search' | 'library' | 'offline';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'Início', icon: 'home' },
  { key: 'search', label: 'Buscar', icon: 'search' },
  { key: 'library', label: 'Biblioteca', icon: 'library' },
  { key: 'offline', label: 'Offline', icon: 'folder' },
];

function deviceName(): string {
  const name = Constants.deviceName;
  if (name) return name;
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'Celular';
}

export default function App() {
  const [ready, setReady] = useState(false);
  const client = useNebula(deviceName());
  const { state, send, libraryRev, connected, isActive, devices, deviceId } = client;

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // The offline library lives only on this phone: separate list, separate player, and
  // nothing about it ever reaches the server.
  const [offlineEntries, setOfflineEntries] = useState<OfflineEntry[]>([]);
  const [offlinePls, setOfflinePls] = useState<Playlist[]>([]);
  const [offlineBytes, setOfflineBytes] = useState(0);
  const [openOfflinePlaylist, setOpenOfflinePlaylist] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const offlineClient = useOfflinePlayer(offlineEntries);
  // Exactly one of the two players drives the bar, so two tracks can never sound at once.
  const player = offlineMode ? offlineClient : client;

  const [tab, setTab] = useState<Tab>('home');
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState(false);
  // `scope` decides what the sheet may offer: a local file can be renamed and deleted here,
  // a catalog track cannot — that belongs to the server.
  const [menuTrack, setMenuTrack] = useState<{ track: Track; scope: 'catalog' | 'offline' } | null>(null);
  const [edit, setEdit] = useState<
    { track: Track; title: string; artist: string; album: string; coverUrl: string | null } | null
  >(null);
  /** Files picked from the phone, awaiting confirmation. Nothing is copied until then. */
  const [drafts, setDrafts] = useState<OfflineDraft[] | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 3000);
  }, []);

  // The stored server override has to be read before the first request goes out.
  useEffect(() => { void loadOverride().finally(() => setReady(true)); }, []);

  const reload = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api.tracks(), api.playlists()]);
      setTracks(t);
      setPlaylists(p);
    } catch {
      /* offline: the connection dot already tells the story, no need to nag */
    }
  }, []);

  useEffect(() => { if (ready) void reload(); }, [ready, reload, libraryRev]);

  const reloadOffline = useCallback(async () => {
    const [list, pls, bytes] = await Promise.all([
      listOfflineEntries(), listOfflinePlaylists(), offlineLibrarySize(),
    ]);
    setOfflineEntries(list);
    setOfflinePls(pls);
    setOfflineBytes(bytes);
  }, []);

  useEffect(() => { void reloadOffline(); }, [reloadOffline]);

  const offlineTracks = useMemo(() => offlineEntries.map((e) => e.track), [offlineEntries]);
  // Merged only for lookups (player bar): the two libraries stay separate lists.
  const byId = useMemo(
    () => new Map([...tracks, ...offlineTracks].map((t) => [t.id, t])),
    [tracks, offlineTracks],
  );
  const currentTrack = player.state.trackId ? byId.get(player.state.trackId) ?? null : null;

  const playContext = useCallback(
    (contextId: string, contextName: string, list: Track[], startIndex: number) => {
      if (list.length === 0) return;
      // Anything from the catalog leaves offline mode, silencing the local file first.
      if (offlineMode) {
        offlineClient.send({ type: 'pause' });
        setOfflineMode(false);
      }
      send({ type: 'playContext', contextId, contextName, trackIds: list.map((t) => t.id), startIndex });
    },
    [send, offlineMode, offlineClient],
  );

  const playOfflineContext = useCallback(
    (contextId: string, contextName: string, list: Track[], startIndex: number) => {
      if (list.length === 0) return;
      // Taking over this phone's audio: whatever the server had us playing stops here. Other
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
    (startIndex: number) => playOfflineContext('offline', 'Modo offline', offlineTracks, startIndex),
    [playOfflineContext, offlineTracks],
  );

  /** Reads the picked files just enough to show them, then waits for confirmation. */
  const stageOffline = useCallback(async (files: { uri: string; name: string }[]) => {
    try {
      setDrafts(await Promise.all(files.map((f) => draftFromFile(f.uri, f.name))));
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [showToast]);

  const confirmOffline = useCallback(async (confirmed: OfflineDraft[]) => {
    setDrafts(null);
    try {
      const added = await addOfflineDrafts(confirmed);
      await reloadOffline();
      showToast(`${added.length} ${added.length === 1 ? 'faixa guardada' : 'faixas guardadas'} neste aparelho`);
    } catch (err) {
      showToast((err as Error).message);
    }
  }, [reloadOffline, showToast]);

  const removeOffline = useCallback(async (track: Track) => {
    await removeOfflineTrack(track.id);
    await reloadOffline();
    showToast(`“${track.title}” removida deste aparelho`);
  }, [reloadOffline, showToast]);

  const activeDevice = devices.find((d) => d.id === state.activeDeviceId);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <LinearGradient colors={['#1B0F35', C.bg]} locations={[0, 0.42]} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          {/* ------------------------------------------------ status strip */}
          <View style={styles.statusStrip}>
            <View style={[styles.dot, !connected && !offlineMode && styles.dotOff]} />
            <Text style={F.faint}>
              {offlineMode ? 'Modo offline · só neste aparelho'
                : !connected ? 'Reconectando ao servidor...'
                : isActive ? 'Tocando neste aparelho'
                : activeDevice ? `Controlando ${activeDevice.name}`
                : 'Conectado'}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setShowDevices(true)} hitSlop={10}>
              <Ionicons
                name="radio-outline"
                size={19}
                color={activeDevice && !isActive ? C.success : C.textMuted}
              />
            </Pressable>
          </View>

          {/* ------------------------------------------------ screens */}
          <View style={{ flex: 1 }}>
            {tab === 'home' && (
              <HomeScreen
                tracks={tracks}
                playlists={playlists}
                onPlayAlbum={(album) => playContext(`album:${album.name}`, album.name, album.tracks, 0)}
                onOpenPlaylist={(id) => { setOpenPlaylist(id); setTab('library'); }}
              />
            )}

            {tab === 'search' && (
              <SearchScreen
                tracks={tracks}
                currentTrackId={state.trackId}
                isPlaying={state.isPlaying}
                onPlay={(results, index, query) => playContext('search', `Busca: ${query}`, results, index)}
                onMenu={(track) => setMenuTrack({ track, scope: 'catalog' })}
              />
            )}

            {tab === 'library' && (
              <LibraryScreen
                repo={serverPlaylists}
                playlists={playlists}
                allTracks={tracks}
                openId={openPlaylist}
                currentTrackId={state.trackId}
                isPlaying={state.isPlaying}
                libraryRev={libraryRev}
                onOpen={setOpenPlaylist}
                onPlayPlaylist={(pl: PlaylistDetail, index) =>
                  playContext(`playlist:${pl.id}`, pl.name, pl.tracks, index)}
                onChanged={reload}
                onToast={showToast}
              />
            )}

            {tab === 'offline' && (
              <OfflineScreen
                tracks={offlineTracks}
                bytes={offlineBytes}
                currentTrackId={offlineMode ? offlineClient.state.trackId : null}
                isPlaying={offlineMode && offlineClient.state.isPlaying}
                onAdd={stageOffline}
                onMenu={(track) => setMenuTrack({ track, scope: 'offline' })}
                onPlay={playOffline}
                onChanged={reload}
                onToast={showToast}
                playlists={offlinePls}
                openPlaylistId={openOfflinePlaylist}
                onOpenPlaylist={setOpenOfflinePlaylist}
                onPlayPlaylist={(pl, index) =>
                  playOfflineContext(`offline-playlist:${pl.id}`, pl.name, pl.tracks, index)}
                onLibraryChanged={reloadOffline}
              />
            )}
          </View>

          {/* ------------------------------------------------ player + tabs */}
          <MiniPlayer client={player} track={currentTrack} onOpen={() => setNowPlaying(true)} />

          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setTab(t.key);
                    if (t.key === 'library') setOpenPlaylist(null);
                    if (t.key === 'offline') setOpenOfflinePlaylist(null);
                  }}
                  style={styles.tab}
                >
                  <Ionicons
                    name={(on ? t.icon : `${t.icon}-outline`) as never}
                    size={22}
                    color={on ? C.primaryBright : C.textFaint}
                  />
                  <Text style={[styles.tabLabel, on && { color: C.primaryBright }]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* ------------------------------------------------ overlays */}

      <NowPlaying
        client={player}
        track={currentTrack}
        visible={nowPlaying}
        onClose={() => setNowPlaying(false)}
      />

      <DeviceSheet
        visible={showDevices}
        onClose={() => setShowDevices(false)}
        devices={devices}
        activeDeviceId={state.activeDeviceId}
        myDeviceId={deviceId}
        onTransfer={(id) => send({ type: 'transfer', deviceId: id, play: true })}
      />

      <Modal visible={Boolean(menuTrack)} transparent animationType="fade" onRequestClose={() => setMenuTrack(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuTrack(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            {menuTrack && (
              <>
                <Text numberOfLines={1} style={styles.sheetTitle}>{menuTrack.track.title}</Text>
                <Text numberOfLines={1} style={[F.muted, { marginBottom: 12 }]}>
                  {menuTrack.track.artist}
                </Text>

                <Pressable
                  style={styles.menuItem}
                  onPress={() => {
                    (menuTrack.scope === 'offline' ? offlineClient : client)
                      .send({ type: 'queueAdd', trackId: menuTrack.track.id });
                    setMenuTrack(null);
                    showToast('Adicionado à fila');
                  }}
                >
                  <Ionicons name="list" size={19} color={C.text} />
                  <Text style={styles.menuText}>Adicionar à fila</Text>
                </Pressable>

                {/* A local file can be corrected and deleted from here; a catalog track
                    belongs to the server, so neither is offered for it. */}
                {menuTrack.scope === 'offline' && (
                  <>
                    <Pressable
                      style={styles.menuItem}
                      onPress={() => {
                        setEdit({
                          track: menuTrack.track,
                          title: menuTrack.track.title,
                          artist: menuTrack.track.artist,
                          album: menuTrack.track.album,
                          coverUrl: menuTrack.track.coverUrl ?? null,
                        });
                        setMenuTrack(null);
                      }}
                    >
                      <Ionicons name="create-outline" size={19} color={C.text} />
                      <Text style={styles.menuText}>Editar informações</Text>
                    </Pressable>

                    <Pressable
                      style={styles.menuItem}
                      onPress={() => {
                        const track = menuTrack.track;
                        setMenuTrack(null);
                        Alert.alert(
                          'Remover deste aparelho',
                          `O arquivo de “${track.title}” será apagado. Não dá para desfazer.`,
                          [
                            { text: 'Cancelar', style: 'cancel' },
                            {
                              text: 'Remover',
                              style: 'destructive',
                              onPress: () => void removeOffline(track),
                            },
                          ],
                        );
                      }}
                    >
                      <Ionicons name="trash-outline" size={19} color={C.danger} />
                      <Text style={[styles.menuText, { color: C.danger }]}>Remover deste aparelho</Text>
                    </Pressable>
                  </>
                )}

                <Text style={styles.menuLabel}>
                  {menuTrack.scope === 'offline' ? 'ADICIONAR À PLAYLIST OFFLINE' : 'ADICIONAR À PLAYLIST'}
                </Text>
                <ScrollView style={{ maxHeight: 240 }}>
                  {(menuTrack.scope === 'offline' ? offlinePls : playlists).length === 0 ? (
                    <Text style={[F.muted, { paddingHorizontal: 12, paddingVertical: 10 }]}>
                      {menuTrack.scope === 'offline'
                        ? 'Crie uma playlist offline na aba Offline.'
                        : 'Crie uma playlist na aba Biblioteca.'}
                    </Text>
                  ) : (
                    (menuTrack.scope === 'offline' ? offlinePls : playlists).map((pl) => (
                      <Pressable
                        key={pl.id}
                        style={styles.menuItem}
                        onPress={async () => {
                          const { track, scope } = menuTrack;
                          setMenuTrack(null);
                          try {
                            if (scope === 'offline') {
                              await addTrackToOfflinePlaylist(pl.id, track.id);
                              await reloadOffline();
                            } else {
                              await api.addToPlaylist(pl.id, track.id);
                              await reload();
                            }
                            showToast(`Adicionado a “${pl.name}”`);
                          } catch (err) {
                            showToast((err as Error).message);
                          }
                        }}
                      >
                        <Ionicons name="disc-outline" size={19} color={C.text} />
                        <Text numberOfLines={1} style={styles.menuText}>{pl.name}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(edit)} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        {/* Not a Pressable: a form of typed corrections must not vanish on a stray tap. */}
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Editar informações</Text>
            <Text style={[F.muted, { marginBottom: 16, lineHeight: 19 }]}>
              Título e artista foram adivinhados pelo nome do arquivo. A correção fica só neste
              aparelho, como o próprio arquivo.
            </Text>
            {edit && (
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'center' }}>
                <Pressable
                  onPress={async () => {
                    try {
                      const picked = await DocumentPicker.getDocumentAsync({
                        type: 'image/*', copyToCacheDirectory: true,
                      });
                      if (picked.canceled) return;
                      const asset = picked.assets[0];
                      setEdit({ ...edit, coverUrl: await saveCoverImage(asset.uri, asset.name) });
                    } catch (err) {
                      showToast((err as Error).message);
                    }
                  }}
                >
                  <Cover
                    colorA={edit.track.colorA}
                    colorB={edit.track.colorB}
                    coverUrl={edit.coverUrl}
                    size={72}
                    radius={12}
                    showNote={!edit.coverUrl}
                  />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={F.muted}>Toque na capa para escolher uma imagem.</Text>
                  {edit.coverUrl && (
                    <Pressable onPress={() => setEdit({ ...edit, coverUrl: null })} hitSlop={8}>
                      <Text style={{ color: C.primaryBright, fontSize: 13, marginTop: 6 }}>
                        Remover imagem
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}

            {edit && (['title', 'artist', 'album'] as const).map((field) => (
              <TextInput
                key={field}
                style={[styles.field, field !== 'title' && { marginTop: 10 }]}
                placeholder={field === 'title' ? 'Título' : field === 'artist' ? 'Artista' : 'Álbum'}
                placeholderTextColor={C.textFaint}
                value={edit[field]}
                onChangeText={(value) => setEdit({ ...edit, [field]: value })}
                autoFocus={field === 'title'}
              />
            ))}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEdit(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={!edit?.title.trim()}
                style={[styles.btnPrimary, !edit?.title.trim() && { opacity: 0.4 }]}
                onPress={async () => {
                  if (!edit) return;
                  try {
                    await updateOfflineTrack(edit.track.id, {
                      title: edit.title, artist: edit.artist, album: edit.album,
                      coverUrl: edit.coverUrl,
                    });
                    await reloadOffline();
                    setEdit(null);
                    showToast('Informações atualizadas');
                  } catch (err) {
                    showToast((err as Error).message);
                  }
                }}
              >
                <Text style={styles.btnPrimaryText}>Salvar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {drafts && (
        <AddLocalSheet
          drafts={drafts}
          onCancel={() => setDrafts(null)}
          onConfirm={(confirmed) => void confirmOffline(confirmed)}
          onToast={showToast}
        />
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  statusStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  dotOff: { backgroundColor: C.danger },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#150E28',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    paddingTop: 8, paddingBottom: 22,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: 10.5, color: C.textFaint, fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,10,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1130',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: R.md },
  menuText: { ...F.body, fontSize: 14.5, flex: 1 },
  menuLabel: { ...F.faint, letterSpacing: 1, marginTop: 10, marginBottom: 2, paddingHorizontal: 12 },

  modal: {
    width: '100%', maxWidth: 440, backgroundColor: C.bgElevated, borderRadius: R.xl,
    padding: 24, borderWidth: 1, borderColor: C.border,
  },
  modalTitle: { fontSize: 19, fontWeight: '700', color: C.text, marginBottom: 6 },
  field: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15,
  },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 18 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primary, paddingHorizontal: 22, paddingVertical: 11, borderRadius: R.pill,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 20, paddingVertical: 11, borderRadius: R.pill,
  },
  btnGhostText: { color: C.text, fontWeight: '600', fontSize: 14 },

  toast: {
    position: 'absolute', bottom: 130, left: 24, right: 24,
    backgroundColor: 'rgba(30,20,55,0.97)',
    borderColor: C.primary, borderWidth: 1,
    borderRadius: R.pill, paddingVertical: 12, paddingHorizontal: 20,
    alignItems: 'center',
  },
  toastText: { color: C.text, fontSize: 13, fontWeight: '500' },
});
