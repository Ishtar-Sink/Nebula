import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import { Cover } from './Cover';
import { C, F, R } from '../theme';

interface Props {
  track: Track;
  isCurrent: boolean;
  isPlaying: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  trailing?: 'menu' | 'remove' | 'add' | 'none';
  onTrailing?: () => void;
}

export function TrackRow({
  track, isCurrent, isPlaying, onPress, onLongPress, trailing = 'menu', onTrailing,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={48} radius={9} showNote={false} />

      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.title, isCurrent && { color: C.primaryBright }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.sub}>
          {track.source === 'local' ? '• ' : ''}{track.artist}
        </Text>
      </View>

      {isCurrent ? (
        <Ionicons
          name={isPlaying ? 'volume-high' : 'pause'}
          size={17}
          color={C.primaryBright}
          style={{ marginRight: 4 }}
        />
      ) : (
        <Text style={styles.dur}>{formatDuration(track.durationMs)}</Text>
      )}

      {trailing !== 'none' && (
        <Pressable onPress={onTrailing} hitSlop={10} style={styles.trailing}>
          <Ionicons
            name={trailing === 'remove' ? 'remove-circle-outline' : trailing === 'add' ? 'add' : 'ellipsis-horizontal'}
            size={19}
            color={C.textMuted}
          />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 16, gap: 12 },
  pressed: { backgroundColor: C.card },
  text: { flex: 1, minWidth: 0 },
  title: { ...F.body, fontWeight: '600' },
  sub: { ...F.muted, marginTop: 2 },
  dur: { ...F.faint, fontVariant: ['tabular-nums'] },
  trailing: { width: 30, alignItems: 'flex-end' },
});
