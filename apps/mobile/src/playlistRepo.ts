/**
 * A playlist source, so one screen can serve both kinds.
 *
 * Server playlists and offline playlists behave identically from the UI's point of view —
 * list, open, create, delete, add and remove tracks — but live in completely different
 * places, and deliberately never mix: a server playlist cannot hold a file that only this
 * phone has, and an offline one cannot be played anywhere else.
 */

import type { Playlist, PlaylistDetail } from '@nebula/protocol';
import { api } from './api';
import {
  listOfflinePlaylists, getOfflinePlaylist, createOfflinePlaylist, deleteOfflinePlaylist,
  addTrackToOfflinePlaylist, removeTrackFromOfflinePlaylist,
} from './offline/store';

export interface PlaylistRepo {
  /** Shown in the screen header and in the confirmation copy. */
  label: string;
  /** Explains, in the empty state, what this kind of playlist is for. */
  hint: string;
  list(): Promise<Playlist[]>;
  get(id: string): Promise<PlaylistDetail | null>;
  create(name: string): Promise<Playlist>;
  remove(id: string): Promise<void>;
  addTrack(id: string, trackId: string): Promise<void>;
  removeTrack(id: string, trackId: string): Promise<void>;
}

export const serverPlaylists: PlaylistRepo = {
  label: 'Sua biblioteca',
  hint: 'Valem em todos os aparelhos. Toque no + para criar a primeira.',
  list: () => api.playlists(),
  get: (id) => api.playlist(id),
  create: (name) => api.createPlaylist(name),
  remove: (id) => api.deletePlaylist(id),
  addTrack: async (id, trackId) => { await api.addToPlaylist(id, trackId); },
  removeTrack: async (id, trackId) => { await api.removeFromPlaylist(id, trackId); },
};

export const offlinePlaylists: PlaylistRepo = {
  label: 'Playlists offline',
  hint: 'Só com arquivos deste aparelho. Nunca vão para o servidor.',
  list: listOfflinePlaylists,
  get: getOfflinePlaylist,
  create: (name) => createOfflinePlaylist(name),
  remove: deleteOfflinePlaylist,
  addTrack: addTrackToOfflinePlaylist,
  removeTrack: removeTrackFromOfflinePlaylist,
};
