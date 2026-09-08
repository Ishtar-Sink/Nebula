import { View, Image, type ViewStyle, type ImageStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { apiUrl } from '../api';

interface Props {
  colorA: string;
  colorB: string;
  /** A real image when one was set: a server path for catalog art, a local URI offline. */
  coverUrl?: string | null;
  size: number;
  radius?: number;
  showNote?: boolean;
  style?: ViewStyle;
}

/** Turns a server-relative cover path into something Image can load. */
function resolve(coverUrl: string | null | undefined): string | null {
  if (!coverUrl) return null;
  return coverUrl.startsWith('/') ? `${apiUrl()}${coverUrl}` : coverUrl;
}

/** Cover art: the uploaded image when there is one, the generated palette otherwise. */
export function Cover({ colorA, colorB, coverUrl, size, radius, showNote = true, style }: Props) {
  const borderRadius = radius ?? size * 0.09;
  const src = resolve(coverUrl);

  if (src) {
    return (
      <Image
        source={{ uri: src }}
        style={[{ width: size, height: size, borderRadius }, style as ImageStyle]}
        resizeMode="cover"
      />
    );
  }

  return (
    <LinearGradient
      colors={[colorA, colorB]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[{ width: size, height: size, borderRadius }, style]}
    >
      {showNote && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="musical-notes" size={Math.max(13, size * 0.26)} color="rgba(255,255,255,0.8)" />
        </View>
      )}
    </LinearGradient>
  );
}
