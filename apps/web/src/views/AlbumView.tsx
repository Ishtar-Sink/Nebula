import type { Track } from '@nebula/protocol';
import { Cover } from '../components/Cover.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { IconPlay, IconShuffle } from '../icons.tsx';

interface Props {
  name: string;
  artist: string;
  tracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onShuffle: () => void;
  onMenu: (track: Track, index: number, anchor: { x: number; y: number }) => void;
}

function totalLabel(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function AlbumView({
  name, artist, tracks, currentTrackId, isPlaying, onPlay, onShuffle, onMenu,
}: Props) {
  const duration = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const cover = tracks[0];

  return (
    <div className="view">
      <div className="page-head">
        {cover && <Cover colorA={cover.colorA} colorB={cover.colorB} coverUrl={cover.coverUrl} size={200} radius={16} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="page-eyebrow">Álbum</div>
          <h1 className="page-title">{name}</h1>
          <p className="page-sub">
            {artist} · {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}
            {duration > 0 && ` · ${totalLabel(duration)}`}
          </p>
        </div>
      </div>

      <div className="chips">
        <button className="btn btn-primary btn-sm" onClick={() => onPlay(0)} disabled={tracks.length === 0}>
          <IconPlay size={15} /> Tocar
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onShuffle} disabled={tracks.length === 0}>
          <IconShuffle size={15} /> Aleatório
        </button>
      </div>

      <TrackList
        tracks={tracks}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        onPlay={onPlay}
        onMenu={onMenu}
        showAlbum={false}
      />
    </div>
  );
}
