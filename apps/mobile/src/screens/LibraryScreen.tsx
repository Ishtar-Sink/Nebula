import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Playlist, PlaylistDetail, Track } from '@nebula/protocol';
import { Cover } from '../components/Cover';
import { TrackRow } from '../components/TrackRow';
import type { PlaylistRepo } from '../playlistRepo';
import { C, F, R } from '../theme';

interface Props {
  /** Where these playlists live. The screen itself is identical for both kinds. */
  repo: PlaylistRepo;
  playlists: Playlist[];
  allTracks: Track[];
  openId: string | null;
  currentTrackId: string | null;
  isPlaying: boolean;
  libraryRev: number;
  onOpen: (id: string | null) => void;
  onPlayPlaylist: (playlist: PlaylistDetail, index: number) => void;
  onChanged: () => void;
  onToast: (message: string) => void;
  /** The offline tab draws its own header, so the list can start straight away. */
  showHeader?: boolean;
}

export function LibraryScreen({
  repo, playlists, allTracks, openId, currentTrackId, isPlaying, libraryRev,
  onOpen, onPlayPlaylist, onChanged, onToast, showHeader = true,
}: Props) {
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState('');

  const addTrack = async (playlistId: string, trackId: string) => {
    await repo.addTrack(playlistId, trackId);
    setDetail(await repo.get(playlistId));
    onChanged();
  };

  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    let cancelled = false;
    setLoading(true);
    repo.get(openId)
      .then((d) => {
        if (cancelled) return;
        if (!d) { onToast('Playlist não encontrada'); onOpen(null); return; }
        setDetail(d);
      })
      .catch(() => { if (!cancelled) { onToast('Playlist não encontrada'); onOpen(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo, openId, libraryRev, playlists, onOpen, onToast]);

  // ---------------------------------------------------------------- playlist detail

  if (openId) {
    if (loading && !detail) {
      return (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      );
    }
    if (!detail) return <View style={styles.center}><Text style={F.muted}>Playlist indisponível.</Text></View>;

    const candidates = (() => {
      const q = addQuery.trim().toLowerCase();
      const pool = q
        ? allTracks.filter((t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q))
        : allTracks;
      return pool.slice(0, 50);
    })();

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.detailHeader}>
          <Pressable onPress={() => onOpen(null)} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={C.text} />
          </Pressable>
          <Text numberOfLines={1} style={styles.detailHeaderTitle}>{detail.name}</Text>
          <Pressable
            hitSlop={12}
            onPress={() => Alert.alert(
              'Excluir playlist',
              `“${detail.name}” será removida. Os arquivos continuam onde estão.`,
              [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Excluir', style: 'destructive',
                  onPress: async () => {
                    await repo.remove(detail.id);
                    onOpen(null);
                    onChanged();
                    onToast('Playlist excluída');
                  },
                },
              ],
            )}
          >
            <Ionicons name="trash-outline" size={21} color={C.textMuted} />
          </Pressable>
        </View>

        <FlatList
          data={detail.tracks}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={styles.detailHero}>
              <Cover colorA={detail.colorA} colorB={detail.colorB} coverUrl={detail.coverUrl} size={160} radius={16} showNote={false} />
              <Text style={styles.detailTitle}>{detail.name}</Text>
              <Text style={F.muted}>
                {detail.trackCount} {detail.trackCount === 1 ? 'faixa' : 'faixas'}
              </Text>

              <View style={styles.detailActions}>
                <Pressable
                  onPress={() => onPlayPlaylist(detail, 0)}
                  disabled={detail.tracks.length === 0}
                  style={[styles.btnPrimary, detail.tracks.length === 0 && { opacity: 0.4 }]}
                >
                  <Ionicons name="play" size={17} color="#fff" />
                  <Text style={styles.btnPrimaryText}>Tocar</Text>
                </Pressable>
                <Pressable onPress={() => setAdding((v) => !v)} style={styles.btnGhost}>
                  <Ionicons name={adding ? 'close' : 'add'} size={17} color={C.text} />
                  <Text style={styles.btnGhostText}>{adding ? 'Fechar' : 'Adicionar'}</Text>
                </Pressable>
              </View>

              {adding && (
                <View style={styles.addPanel}>
                  <View style={styles.searchBox}>
                    <Ionicons name="search" size={17} color={C.textFaint} />
                    <TextInput
                      style={styles.input}
                      placeholder="Buscar faixas"
                      placeholderTextColor={C.textFaint}
                      value={addQuery}
                      onChangeText={setAddQuery}
                      autoCorrect={false}
                    />
                  </View>
                  {candidates.map((track) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      isCurrent={false}
                      isPlaying={false}
                      trailing="add"
                      onPress={() => void addTrack(detail.id, track.id)}
                      onTrailing={() => void addTrack(detail.id, track.id)}
                    />
                  ))}
                </View>
              )}
            </View>
          }
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              isCurrent={item.id === currentTrackId}
              isPlaying={isPlaying}
              trailing="remove"
              onPress={() => onPlayPlaylist(detail, index)}
              onTrailing={async () => {
                await repo.removeTrack(detail.id, item.id);
                setDetail(await repo.get(detail.id));
                onChanged();
              }}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[F.muted, { textAlign: 'center' }]}>
                Playlist vazia. Use “Adicionar” para incluir faixas.
              </Text>
            </View>
          }
        />
      </View>
    );
  }

  // ---------------------------------------------------------------- playlist list

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        {showHeader ? <Text style={F.title}>{repo.label}</Text> : <View style={{ flex: 1 }} />}
        <Pressable onPress={() => { setName(''); setCreating(true); }} hitSlop={12} style={styles.addBtn}>
          <Ionicons name="add" size={24} color={C.text} />
        </Pressable>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.id)}
            style={({ pressed }) => [styles.plRow, pressed && { backgroundColor: C.card }]}
          >
            <Cover colorA={item.colorA} colorB={item.colorB} coverUrl={item.coverUrl} size={52} radius={10} showNote={false} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.plName}>{item.name}</Text>
              <Text style={F.muted}>
                {item.trackCount} {item.trackCount === 1 ? 'faixa' : 'faixas'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={C.textFaint} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[F.section, { marginBottom: 8 }]}>Nenhuma playlist</Text>
            <Text style={[F.muted, { textAlign: 'center' }]}>{repo.hint}</Text>
          </View>
        }
      />

      <Modal visible={creating} transparent animationType="fade" onRequestClose={() => setCreating(false)}>
        {/* Not a Pressable: a typed-in name must not vanish on a stray tap outside. */}
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Nova playlist</Text>
            <Text style={[F.muted, { marginBottom: 16 }]}>{repo.hint}</Text>
            <TextInput
              style={styles.field}
              placeholder="Ex.: Foco profundo"
              placeholderTextColor={C.textFaint}
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setCreating(false)} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={!name.trim()}
                style={[styles.btnPrimary, !name.trim() && { opacity: 0.4 }]}
                onPress={async () => {
                  try {
                    const created = await repo.create(name.trim());
                    setCreating(false);
                    onChanged();
                    onOpen(created.id);
                  } catch (err) {
                    onToast((err as Error).message);
                  }
                }}
              >
                <Text style={styles.btnPrimaryText}>Criar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16,
  },
  addBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  plRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 16, paddingVertical: 8 },
  plName: { ...F.body, fontWeight: '600', fontSize: 15 },

  detailHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8,
  },
  detailHeaderTitle: { ...F.body, fontWeight: '700', flex: 1 },
  detailHero: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18 },
  detailTitle: { fontSize: 24, fontWeight: '800', color: C.text, marginTop: 16, marginBottom: 4, textAlign: 'center' },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 18 },

  addPanel: { width: '100%', marginTop: 18, backgroundColor: 'rgba(255,255,255,0.035)', borderRadius: R.lg, paddingVertical: 12 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: R.pill,
    paddingHorizontal: 15, paddingVertical: 10, marginHorizontal: 12, marginBottom: 8,
  },
  input: { flex: 1, color: C.text, fontSize: 14.5, padding: 0 },

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

  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,10,0.74)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  modal: { width: '100%', maxWidth: 420, backgroundColor: C.bgElevated, borderRadius: R.xl, padding: 24, borderWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 19, fontWeight: '700', color: C.text },
  field: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 15,
  },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 18 },
});
