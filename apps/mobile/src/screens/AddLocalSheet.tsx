import { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, Modal, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { formatDuration } from '@nebula/protocol';
import { saveCoverImage, type OfflineDraft } from '../offline/store';
import { Cover } from '../components/Cover';
import { C, F, R } from '../theme';

interface Props {
  drafts: OfflineDraft[];
  onCancel: () => void;
  onConfirm: (drafts: OfflineDraft[]) => void;
  onToast: (message: string) => void;
}

/**
 * Confirmation step for files picked from the phone. Nothing is copied or listed until the
 * listener accepts — the title and artist guessed from the filename are usually close but
 * rarely right, and a whole album means fixing the same artist a dozen times otherwise.
 */
export function AddLocalSheet({ drafts: initial, onCancel, onConfirm, onToast }: Props) {
  const [drafts, setDrafts] = useState(initial);
  const [bulk, setBulk] = useState({ artist: '', album: '' });

  const patch = (index: number, fields: Partial<OfflineDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...fields } : d)));

  const pickCover = async (index: number) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      patch(index, { coverUrl: await saveCoverImage(asset.uri, asset.name) });
    } catch (err) {
      onToast((err as Error).message);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      {/* Not a Pressable: a form of typed corrections must not vanish on a stray tap. */}
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>
              {drafts.length === 1 ? 'Conferir a faixa' : `Conferir ${drafts.length} faixas`}
            </Text>
            <Pressable onPress={onCancel} hitSlop={12}>
              <Ionicons name="close" size={24} color={C.textMuted} />
            </Pressable>
          </View>
          <Text style={[F.muted, { marginBottom: 14, lineHeight: 19 }]}>
            Ajuste antes de guardar. Tudo isto fica só neste aparelho.
          </Text>

          {drafts.length > 1 && (
            <View style={styles.bulk}>
              <TextInput
                style={[styles.field, { flex: 1 }]}
                placeholder="Artista para todas"
                placeholderTextColor={C.textFaint}
                value={bulk.artist}
                onChangeText={(artist) => setBulk({ ...bulk, artist })}
              />
              <TextInput
                style={[styles.field, { flex: 1 }]}
                placeholder="Álbum para todas"
                placeholderTextColor={C.textFaint}
                value={bulk.album}
                onChangeText={(album) => setBulk({ ...bulk, album })}
              />
              <Pressable
                style={styles.applyBtn}
                onPress={() => setDrafts((prev) => prev.map((d) => ({
                  ...d,
                  artist: bulk.artist.trim() || d.artist,
                  album: bulk.album.trim() || d.album,
                })))}
              >
                <Ionicons name="checkmark" size={19} color={C.text} />
              </Pressable>
            </View>
          )}

          <ScrollView style={{ maxHeight: 380 }}>
            {drafts.map((draft, i) => (
              <View key={`${draft.name}-${i}`} style={styles.draft}>
                <Pressable onPress={() => void pickCover(i)} style={styles.coverSlot}>
                  <Cover
                    colorA={C.primary}
                    colorB={C.accent}
                    coverUrl={draft.coverUrl}
                    size={64}
                    radius={10}
                    showNote={false}
                  />
                  {!draft.coverUrl && (
                    <View style={styles.coverHint}>
                      <Ionicons name="image-outline" size={20} color="rgba(255,255,255,0.85)" />
                    </View>
                  )}
                </Pressable>

                <View style={{ flex: 1, gap: 7, minWidth: 0 }}>
                  <TextInput
                    style={styles.field}
                    placeholder="Título"
                    placeholderTextColor={C.textFaint}
                    value={draft.title}
                    onChangeText={(title) => patch(i, { title })}
                  />
                  <TextInput
                    style={styles.field}
                    placeholder="Artista"
                    placeholderTextColor={C.textFaint}
                    value={draft.artist}
                    onChangeText={(artist) => patch(i, { artist })}
                  />
                  <TextInput
                    style={styles.field}
                    placeholder="Álbum"
                    placeholderTextColor={C.textFaint}
                    value={draft.album}
                    onChangeText={(album) => patch(i, { album })}
                  />
                  <Text numberOfLines={1} style={F.faint}>
                    {draft.name} · {formatDuration(draft.durationMs)}
                  </Text>
                </View>

                <Pressable
                  onPress={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                  hitSlop={10}
                >
                  <Ionicons name="close" size={19} color={C.textMuted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(drafts)}
              disabled={drafts.length === 0}
              style={[styles.btnPrimary, drafts.length === 0 && { opacity: 0.4 }]}
            >
              <Text style={styles.btnPrimaryText}>
                {drafts.length === 1 ? 'Adicionar' : `Adicionar ${drafts.length}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,10,0.78)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bgElevated, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: 20, paddingBottom: 30, borderWidth: 1, borderColor: C.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  title: { flex: 1, fontSize: 19, fontWeight: '700', color: C.text },
  bulk: { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'center' },
  applyBtn: {
    width: 44, height: 44, borderRadius: R.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  draft: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: C.border,
    borderRadius: R.lg, padding: 10, marginBottom: 10,
  },
  coverSlot: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden' },
  coverHint: {
    position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center',
  },
  field: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9, color: C.text, fontSize: 14,
  },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  btnPrimary: {
    backgroundColor: C.primary, paddingHorizontal: 22, paddingVertical: 11, borderRadius: R.pill,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    borderWidth: 1, borderColor: C.border, paddingHorizontal: 20, paddingVertical: 11,
    borderRadius: R.pill,
  },
  btnGhostText: { color: C.text, fontWeight: '600', fontSize: 14 },
});
