import { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import type { Track, Playlist } from '@nebula/protocol';
import { Cover } from '../components/Cover';
import { C, F, R } from '../theme';

interface Album { name: string; artist: string; tracks: Track[]; colorA: string; colorB: string }

interface Props {
  tracks: Track[];
  playlists: Playlist[];
  onPlayAlbum: (album: Album) => void;
  onOpenPlaylist: (id: string) => void;
}

export function HomeScreen({ tracks, playlists, onPlayAlbum, onOpenPlaylist }: Props) {
  const albums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const t of tracks) {
      if (t.source !== 'catalog') continue;
      const found = map.get(t.album);
      if (found) found.tracks.push(t);
      else map.set(t.album, { name: t.album, artist: t.artist, tracks: [t], colorA: t.colorA, colorB: t.colorB });
    }
    return [...map.values()];
  }, [tracks]);

  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite';

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={F.faint}>NEBULA</Text>
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={[F.muted, { marginBottom: 22 }]}>
        {tracks.length} faixas · {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
      </Text>

      {albums.length > 0 && (
        <>
          <Text style={styles.section}>Catálogo</Text>
          <View style={styles.grid}>
            {albums.map((album) => (
              <Pressable
                key={album.name}
                onPress={() => onPlayAlbum(album)}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
              >
                <Cover colorA={album.colorA} colorB={album.colorB} coverUrl={album.tracks[0]?.coverUrl} size={148} radius={14} />
                <Text numberOfLines={1} style={styles.cardTitle}>{album.name}</Text>
                <Text numberOfLines={1} style={F.muted}>{album.artist}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {playlists.length > 0 && (
        <>
          <Text style={styles.section}>Suas playlists</Text>
          <View style={styles.grid}>
            {playlists.map((pl) => (
              <Pressable
                key={pl.id}
                onPress={() => onOpenPlaylist(pl.id)}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
              >
                <Cover colorA={pl.colorA} colorB={pl.colorB} coverUrl={pl.coverUrl} size={148} radius={14} showNote={false} />
                <Text numberOfLines={1} style={styles.cardTitle}>{pl.name}</Text>
                <Text numberOfLines={1} style={F.muted}>
                  {pl.trackCount} {pl.trackCount === 1 ? 'faixa' : 'faixas'}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {tracks.length === 0 && (
        <View style={styles.empty}>
          <Text style={[F.section, { marginBottom: 8 }]}>Nenhuma faixa</Text>
          <Text style={[F.muted, { textAlign: 'center', lineHeight: 20 }]}>
            Gere o catálogo no servidor com “pnpm seed”, ou envie arquivos pela aba Arquivos.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 30 },
  greeting: { ...F.title, marginTop: 4, marginBottom: 4 },
  section: { ...F.section, marginTop: 12, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: 148 },
  cardTitle: { ...F.body, fontWeight: '600', marginTop: 9, fontSize: 13.5 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});
