import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import type { Track, DeviceInfo } from '@nebula/protocol';
import { formatDuration } from '@nebula/protocol';
import { Cover } from './Cover';
import type { NebulaClient } from '../useNebula';
import { C, F, R } from '../theme';

const platformIcon = (p: string) =>
  p === 'mobile' ? 'phone-portrait-outline' : p === 'desktop' ? 'desktop-outline' : 'laptop-outline';
const platformLabel = (p: string) =>
  p === 'mobile' ? 'Celular' : p === 'desktop' ? 'Desktop' : 'Navegador';

// ------------------------------------------------------------------ mini player

export function MiniPlayer({
  client, track, onOpen,
}: { client: NebulaClient; track: Track | null; onOpen: () => void }) {
  const { state, send, positionMs, isActive, devices } = client;
  if (!track) return null;

  const progress = state.durationMs > 0 ? positionMs / state.durationMs : 0;
  const activeDevice = devices.find((d) => d.id === state.activeDeviceId);

  return (
    <Pressable onPress={onOpen} style={styles.mini}>
      <View style={styles.miniProgress}>
        <View style={[styles.miniProgressFill, { width: `${Math.min(100, progress * 100)}%` }]} />
      </View>

      <View style={styles.miniRow}>
        <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={44} radius={9} showNote={false} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.miniTitle}>{track.title}</Text>
          <Text numberOfLines={1} style={styles.miniSub}>
            {!isActive && activeDevice ? `Tocando em ${activeDevice.name}` : track.artist}
          </Text>
        </View>

        <Pressable onPress={() => send({ type: 'toggle' })} hitSlop={12} style={styles.miniBtn}>
          <Ionicons name={state.isPlaying ? 'pause' : 'play'} size={22} color={C.text} />
        </Pressable>
        <Pressable onPress={() => send({ type: 'next' })} hitSlop={12} style={styles.miniBtn}>
          <Ionicons name="play-skip-forward" size={20} color={C.text} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ full screen

export function NowPlaying({
  client, track, visible, onClose,
}: { client: NebulaClient; track: Track | null; visible: boolean; onClose: () => void }) {
  const { state, send, positionMs, isActive, devices, deviceId } = client;
  const [showDevices, setShowDevices] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);

  const activeDevice = devices.find((d) => d.id === state.activeDeviceId);
  const shown = scrub ?? positionMs;
  const duration = state.durationMs || track?.durationMs || 1;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.full}>
        <View style={styles.fullHeader}>
          <Pressable onPress={onClose} hitSlop={14}>
            <Ionicons name="chevron-down" size={26} color={C.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={F.faint}>TOCANDO DE</Text>
            <Text numberOfLines={1} style={styles.contextName}>{state.contextName ?? 'Nebula'}</Text>
          </View>
          <Pressable onPress={() => setShowDevices(true)} hitSlop={14}>
            <Ionicons name="radio-outline" size={24} color={isActive ? C.text : C.success} />
          </Pressable>
        </View>

        {track ? (
          <>
            <View style={styles.artWrap}>
              <Cover colorA={track.colorA} colorB={track.colorB} coverUrl={track.coverUrl} size={300} radius={22} />
            </View>

            <View style={styles.metaWrap}>
              <Text numberOfLines={2} style={styles.fullTitle}>{track.title}</Text>
              <Text numberOfLines={1} style={styles.fullArtist}>{track.artist}</Text>
            </View>

            {!isActive && activeDevice && (
              <View style={styles.remoteBanner}>
                <View style={styles.dot} />
                <Text style={styles.remoteText}>Tocando em {activeDevice.name}</Text>
              </View>
            )}

            <View style={styles.sliderWrap}>
              <Slider
                style={{ width: '100%', height: 34 }}
                minimumValue={0}
                maximumValue={duration}
                value={Math.min(shown, duration)}
                minimumTrackTintColor={C.primary}
                maximumTrackTintColor="rgba(255,255,255,0.18)"
                thumbTintColor="#ffffff"
                onValueChange={setScrub}
                onSlidingComplete={(v) => { send({ type: 'seek', positionMs: v }); setScrub(null); }}
              />
              <View style={styles.timeRow}>
                <Text style={F.faint}>{formatDuration(shown)}</Text>
                <Text style={F.faint}>{formatDuration(duration)}</Text>
              </View>
            </View>

            <View style={styles.transport}>
              <Pressable onPress={() => send({ type: 'shuffle', shuffle: !state.shuffle })} hitSlop={12}>
                <Ionicons name="shuffle" size={24} color={state.shuffle ? C.primaryBright : C.textMuted} />
              </Pressable>

              <Pressable onPress={() => send({ type: 'previous' })} hitSlop={12}>
                <Ionicons name="play-skip-back" size={32} color={C.text} />
              </Pressable>

              <Pressable onPress={() => send({ type: 'toggle' })} style={styles.playBig}>
                <Ionicons
                  name={state.isPlaying ? 'pause' : 'play'}
                  size={30}
                  color="#fff"
                  style={{ marginLeft: state.isPlaying ? 0 : 3 }}
                />
              </Pressable>

              <Pressable onPress={() => send({ type: 'next' })} hitSlop={12}>
                <Ionicons name="play-skip-forward" size={32} color={C.text} />
              </Pressable>

              <Pressable
                onPress={() => send({
                  type: 'repeat',
                  repeat: state.repeat === 'off' ? 'context' : state.repeat === 'context' ? 'track' : 'off',
                })}
                hitSlop={12}
              >
                <Ionicons
                  name={state.repeat === 'track' ? 'repeat-outline' : 'repeat'}
                  size={24}
                  color={state.repeat !== 'off' ? C.primaryBright : C.textMuted}
                />
              </Pressable>
            </View>

            <View style={styles.volumeRow}>
              <Ionicons name="volume-low" size={18} color={C.textMuted} />
              <Slider
                style={{ flex: 1, height: 34 }}
                minimumValue={0}
                maximumValue={1}
                value={state.muted ? 0 : state.volume}
                minimumTrackTintColor={C.primary}
                maximumTrackTintColor="rgba(255,255,255,0.18)"
                thumbTintColor="#ffffff"
                onSlidingComplete={(v) => send({ type: 'volume', volume: v })}
              />
              <Ionicons name="volume-high" size={18} color={C.textMuted} />
            </View>
          </>
        ) : (
          <View style={styles.emptyFull}>
            <Text style={F.muted}>Nada tocando</Text>
          </View>
        )}
      </View>

      <DeviceSheet
        visible={showDevices}
        onClose={() => setShowDevices(false)}
        devices={devices}
        activeDeviceId={state.activeDeviceId}
        myDeviceId={deviceId}
        onTransfer={(id) => send({ type: 'transfer', deviceId: id, play: true })}
      />
    </Modal>
  );
}

// ------------------------------------------------------------------ device picker

export function DeviceSheet({
  visible, onClose, devices, activeDeviceId, myDeviceId, onTransfer,
}: {
  visible: boolean;
  onClose: () => void;
  devices: DeviceInfo[];
  activeDeviceId: string | null;
  myDeviceId: string;
  onTransfer: (deviceId: string) => void;
}) {
  const active = devices.find((d) => d.id === activeDeviceId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Tocando em</Text>
          <Text style={styles.sheetSub}>
            {active
              ? `O som sai por “${active.name}”. Toque em outro aparelho para mover a reprodução sem perder o ponto da música.`
              : 'Nenhum aparelho tocando. Dê play em qualquer um — os outros viram controle remoto.'}
          </Text>

          <ScrollView style={{ maxHeight: 320 }}>
            {devices.map((device) => {
              const isActive = device.id === activeDeviceId;
              return (
                <Pressable
                  key={device.id}
                  onPress={() => { if (!isActive) onTransfer(device.id); onClose(); }}
                  style={({ pressed }) => [styles.deviceRow, isActive && styles.deviceActive, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={platformIcon(device.platform) as never}
                    size={22}
                    color={isActive ? C.success : C.textMuted}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[styles.deviceName, isActive && { color: C.success }]}>
                      {device.name}{device.id === myDeviceId ? ' (este)' : ''}
                    </Text>
                    <Text style={F.faint}>
                      {platformLabel(device.platform)}{isActive ? ' · tocando agora' : ''}
                    </Text>
                  </View>
                  {isActive && <Ionicons name="checkmark" size={20} color={C.success} />}
                </Pressable>
              );
            })}
            {devices.length === 0 && (
              <Text style={[F.muted, { padding: 16 }]}>Nenhum aparelho conectado.</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mini: {
    backgroundColor: '#1B1233',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  miniProgress: { height: 2, backgroundColor: 'rgba(255,255,255,0.09)' },
  miniProgressFill: { height: 2, backgroundColor: C.primary },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 8 },
  miniTitle: { ...F.body, fontWeight: '600', fontSize: 13.5 },
  miniSub: { ...F.faint, marginTop: 1 },
  miniBtn: { paddingHorizontal: 6 },

  full: { flex: 1, backgroundColor: '#150E28', paddingTop: 54, paddingHorizontal: 24 },
  fullHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 },
  contextName: { ...F.body, fontWeight: '600', fontSize: 13 },
  artWrap: { alignItems: 'center', marginTop: 26, marginBottom: 30 },
  metaWrap: { marginBottom: 6 },
  fullTitle: { fontSize: 25, fontWeight: '800', color: C.text, letterSpacing: -0.6 },
  fullArtist: { ...F.muted, fontSize: 15, marginTop: 5 },
  remoteBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.success },
  remoteText: { color: C.success, fontSize: 12.5, fontWeight: '600' },
  sliderWrap: { marginTop: 22 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
  playBig: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary, shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  emptyFull: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(5,3,10,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1130',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center', marginBottom: 14,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  sheetSub: { ...F.muted, marginTop: 6, marginBottom: 14, lineHeight: 18 },
  deviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: R.md,
  },
  deviceActive: { backgroundColor: 'rgba(52,211,153,0.12)' },
  deviceName: { ...F.body, fontWeight: '600', fontSize: 14 },
});
