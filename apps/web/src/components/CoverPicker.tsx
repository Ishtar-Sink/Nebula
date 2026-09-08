import { useRef, useState } from 'react';
import { Cover } from './Cover.tsx';
import { imageToDataUrl } from '@nebula/browser';
import { IconImage } from '../icons.tsx';

interface Props {
  coverUrl: string | null;
  colorA: string;
  colorB: string;
  size?: number;
  onPick: (dataUrl: string) => void;
  onError?: (message: string) => void;
}

/**
 * Square cover slot that opens the file picker. The chosen image is cropped and downscaled
 * here, so what the caller receives is already small enough to store as-is.
 */
export function CoverPicker({ coverUrl, colorA, colorB, size = 84, onPick, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onPick(await imageToDataUrl(file));
    } catch (err) {
      onError?.((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="cover-picker"
        style={{ width: size, height: size }}
        onClick={() => input.current?.click()}
        title="Escolher imagem"
        aria-label="Escolher imagem"
      >
        <Cover colorA={colorA} colorB={colorB} coverUrl={coverUrl} size={size} showNote={false} />
        {!coverUrl && !busy && (
          <span className="cover-picker-hint">
            <IconImage size={18} />
            Imagem
          </span>
        )}
        {busy && <span className="cover-picker-hint">...</span>}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }}
      />
    </>
  );
}
