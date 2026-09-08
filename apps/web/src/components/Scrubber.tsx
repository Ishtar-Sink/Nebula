import { useCallback, useRef, useState } from 'react';

interface Props {
  value: number;
  max: number;
  disabled?: boolean;
  /** Fired once, when the drag or click is committed. */
  onSeek: (value: number) => void;
  /** Live value while dragging; null when the drag ends. */
  onScrub?: (value: number | null) => void;
  ariaLabel: string;
  /** Step for keyboard control, in the same unit as `value`. */
  step?: number;
  className?: string;
}

/**
 * Seek bar built on pointer capture rather than `<input type="range">`.
 *
 * The native element commits on `mouseup`, which never arrives if the pointer leaves the
 * element mid-click — the bar then freezes at the clicked spot and no seek is ever sent.
 * `setPointerCapture` guarantees the release is delivered here, so every press produces
 * exactly one commit.
 */
export function Scrubber({
  value, max, disabled = false, onSeek, onScrub, ariaLabel, step, className = '',
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [preview, setPreview] = useState<number | null>(null);

  const valueAt = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el || max <= 0) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return 0;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return fraction * max;
  }, [max]);

  const shown = preview ?? value;
  const percent = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;
  const keyStep = step ?? max / 20;

  return (
    <div
      ref={trackRef}
      className={`scrubber ${disabled ? 'disabled' : ''} ${className}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        const next = valueAt(e.clientX);
        setPreview(next);
        onScrub?.(next);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        const next = valueAt(e.clientX);
        setPreview(next);
        onScrub?.(next);
      }}
      onPointerUp={(e) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const next = valueAt(e.clientX);
        setPreview(null);
        onScrub?.(null);
        onSeek(next);
      }}
      onPointerCancel={() => {
        // Gesture stolen (scroll, window switch): abandon it rather than seeking somewhere
        // the user never chose.
        draggingRef.current = false;
        setPreview(null);
        onScrub?.(null);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onSeek(Math.min(max, value + keyStep));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onSeek(Math.max(0, value - keyStep));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onSeek(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          onSeek(max);
        }
      }}
    >
      <div className="scrubber-track">
        <div className="scrubber-fill" style={{ width: `${percent}%` }} />
        <div className="scrubber-thumb" style={{ left: `${percent}%` }} />
      </div>
    </div>
  );
}
