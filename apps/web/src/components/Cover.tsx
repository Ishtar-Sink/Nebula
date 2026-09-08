import { IconMusic } from '../icons.tsx';
import { coverSrc } from '../api.ts';

interface Props {
  colorA: string;
  colorB: string;
  /** A real image, when the listener set one. Falls back to the generated gradient. */
  coverUrl?: string | null;
  size?: number | string;
  radius?: number;
  className?: string;
  showNote?: boolean;
  alt?: string;
}

/**
 * Cover art. When no image was uploaded, every client derives the same two colors from the
 * track/playlist id (see paletteFor in @nebula/theme), so the same item looks identical on
 * web, mobile and desktop.
 */
export function Cover({
  colorA, colorB, coverUrl, size, radius, className = '', showNote = true, alt = '',
}: Props) {
  const dim = size === undefined ? undefined : typeof size === 'number' ? `${size}px` : size;
  const src = coverSrc(coverUrl);

  return (
    <div
      className={`cover ${className}`}
      style={{
        width: dim,
        height: dim,
        borderRadius: radius,
        background: `linear-gradient(140deg, ${colorA} 0%, ${colorB} 100%)`,
      }}
    >
      {src ? (
        <img className="cover-img" src={src} alt={alt} style={{ borderRadius: radius }} />
      ) : showNote ? (
        <div className="cover-note">
          <IconMusic size={typeof size === 'number' ? Math.max(14, size * 0.3) : 22} />
        </div>
      ) : null}
    </div>
  );
}
