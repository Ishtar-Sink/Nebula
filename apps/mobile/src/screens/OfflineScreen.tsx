import { useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import type { Playlist, PlaylistDetail, Track } from '@nebula/protocol';
import { TrackRow } from '../components/TrackRow';
import { LibraryScreen } from './LibraryScreen';
import { offlinePlaylists as offlineRepo } from '../playlistRepo';
import { apiUrl, setOverride } from '../api';
import { C, F, R } from '../theme';

interface Props {
  tracks: Track[];
  bytes: number;
  currentTrackId: string | null;
  isPlaying: boolean;
  onAdd: (files: { uri: string; name: string }[]) => Promise<void>;
  onMenu: (track: Track) => void;
  onPlay: (index: number) => void;
  onChanged: () => void;
  onToast: (message: string) => void;
  /** Playlists made of these same files. Same screen as the server ones, other storage. */
  playlists: Playlist[];
  openPlaylistId: string | null;
  onOpenPlaylist: (id: string | null) => void;
  onPlayPlaylist: (playlist: PlaylistDetail, index: number) => void;
  onLibraryChanged: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function OfflineScreen({
  tracks, bytes, currentTrackId, isPlaying, onAdd, onMenu, onPlay, onChanged, onToast,
  playlists, openPlaylistId, onOpenPlaylist, onPlayPlaylist, onLibraryChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<'tracks' | 'playlists'>('tracks');
  const [settings, setSettings] = useState(false);
  const [serverInput, setServerInput] = useState(apiUrl());

  // The open playlist draws its own back header, so the tab chrome steps out of the way.
  const inPlaylistDetail = section === 'playlists' && openPlaylistId !== null;

  const pick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      setBusy(true);
      await onAdd(result.assets.map((a) => ({ uri: a.uri, name: a.name })));
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const playlistTab = (
    <LibraryScreen
      repo={offlineRepo}
      playlists={playlists}
      allTracks={tracks}
      openId={openPlaylistId}
      currentTrackId={currentTrackId}
      isPlaying={isPlaying}
      libraryRev={0}
      onOpen={onOpenPlaylist}
      onPlayPlaylist={onPlayPlaylist}
      onChanged={onLibraryChanged}
      onToast={onToast}
      showHeader={false}
    />
  );

  if (inPlaylistDetail) return <View style={{ flex: 1 }}>{playlistTab}</View>;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={F.title}>Modo offline</Text>
          <Text style={[F.muted, { marginTop: 4, lineHeight: 19 }]}>
            Músicas guardadas neste celular. Tocam sem servidor e nenhum outro aparelho as vê.
          </Text>
        </View>
        <Pressable onPress={() => { setServerInput(apiUrl()); setSettings(true); }} hitSlop={12}>
          <Ionicons name="settings-outline" size={22} color={C.textMuted} />
        </Pressable>
      </View>

      <View style={styles.segmented}>
        {(['tracks', 'playlists'] as const).map((key) => {
          const on = section === key;
          const count = key === 'tracks' ? tracks.length : playlists.length;
          return (
            <Pressable
              key={key}
              onPress={() => setSection(key)}
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                {key === 'tracks' ? 'Faixas' : 'Playlists'}{count > 0 ? ` · ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {section === 'playlists' ? playlistTab : (
        <>
      <View style={styles.actions}>
        <Pressable onPress={pick} disabled={busy} style={[styles.btnPrimary, busy && { opacity: 0.5 }]}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.btnPrimaryText}>Adicionar arquivos</Text>
        </Pressable>
        {tracks.length > 0 && (
          <Text style={[F.faint, { alignSelf: 'center' }]}>
            {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'} · {formatBytes(bytes)}
          </Text>
        )}
      </View>

      {busy && <ActivityIndicator color={C.primary} style={{ marginTop: 12 }} />}

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            isCurrent={item.id === currentTrackId}
            isPlaying={isPlaying}
            onPress={() => onPlay(index)}
            onLongPress={() => onMenu(item)}
            onTrailing={() => onMenu(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={34} color={C.textFaint} />
            <Text style={[F.section, { marginTop: 12, marginBottom: 8 }]}>Nada guardado ainda</Text>
            <Text style={[F.muted, { textAlign: 'center', lineHeight: 20 }]}>
              Escolha músicas do celular para tocar sem depender do servidor.
              Elas ficam salvas só aqui.
            </Text>
          </View>
        }
      />
        </>
      )}

      <Modal visible={settings} transparent animationType="fade" onRequestClose={() => setSettings(false)}>
        {/* Not a Pressable: a typed-in address must not vanish on a stray tap outside. */}
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Servidor Nebula</Text>
            <Text style={[F.muted, { marginBottom: 16, lineHeight: 19 }]}>
              Normalmente descoberto sozinho pelo endereço do Expo. Ajuste apenas se o servidor
              estiver em outra máquina. Não afeta o modo offline.
            </Text>
            <TextInput
              style={styles.field}
              placeholder="http://192.168.0.10:4000"
              placeholderTextColor={C.textFaint}
              value={serverInput}
              onChangeText={setServerInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={async () => { await setOverride(null); setSettings(false); onToast('Voltou ao padrão'); onChanged(); }}
                style={styles.btnGhost}
              >
                <Text style={styles.btnGhostText}>Padrão</Text>
              </Pressable>
              <Pressable
                onPress={async () => { await setOverride(serverInput); setSettings(false); onToast('Servidor atualizado'); onChanged(); }}
                style={styles.btnPrimary}
              >
                <Text style={styles.btnPrimaryText}>Salvar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16, flexWrap: 'wrap' },
  segmented: {
    flexDirection: 'row', gap: 6, marginHorizontal: 16, marginTop: 16, padding: 4,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: R.pill,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: R.pill },
  segmentOn: { backgroundColor: C.primary },
  segmentText: { ...F.muted, fontWeight: '600', fontSize: 13.5 },
  segmentTextOn: { color: '#fff' },
  empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.primary, paddingHorizontal: 20, paddingVertical: 11, borderRadius: R.pill,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 18, paddingVertical: 11, borderRadius: R.pill,
  },
  btnGhostText: { color: C.text, fontWeight: '600', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,10,0.74)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modal: { width: '100%', maxWidth: 440, backgroundColor: C.bgElevated, borderRadius: R.xl, padding: 24, borderWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 19, fontWeight: '700', color: C.text, marginBottom: 6 },
  field: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15,
  },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 18 },
});
