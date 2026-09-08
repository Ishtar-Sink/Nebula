import { useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@nebula/protocol';
import { TrackRow } from '../components/TrackRow';
import { C, F, R } from '../theme';

interface Props {
  tracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (results: Track[], index: number, query: string) => void;
  onMenu: (track: Track) => void;
}

export function SearchScreen({ tracks, currentTrackId, isPlaying, onPlay, onMenu }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q));
  }, [tracks, query]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={F.title}>Buscar</Text>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={C.textFaint} />
          <TextInput
            style={styles.input}
            placeholder="Faixas, artistas ou álbuns"
            placeholderTextColor={C.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Ionicons name="close-circle" size={18} color={C.textFaint} onPress={() => setQuery('')} />
          )}
        </View>
      </View>

      {query.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[F.muted, { textAlign: 'center' }]}>
            Digite para procurar no catálogo e nos arquivos do disco.
          </Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[F.section, { marginBottom: 6 }]}>Nada encontrado</Text>
          <Text style={F.muted}>Tente outro termo.</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item, index }) => (
            <TrackRow
              track={item}
              isCurrent={item.id === currentTrackId}
              isPlaying={isPlaying}
              onPress={() => onPlay(results, index, query)}
              onTrailing={() => onMenu(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 11, marginTop: 14,
  },
  input: { flex: 1, color: C.text, fontSize: 15, padding: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
});
