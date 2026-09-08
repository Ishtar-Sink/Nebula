import { useEffect, type ReactNode } from 'react';
import { IconX } from '../icons.tsx';

interface Props {
  title: string;
  /** One line under the title explaining what the dialog does. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The confirm/cancel row. */
  actions: ReactNode;
  wide?: boolean;
}

/**
 * A dialog that closes only on purpose — the X, Cancel, or Escape.
 *
 * Clicking the backdrop deliberately does nothing: these dialogs hold typed-in metadata, and
 * losing a form of corrections to a stray click outside it is infuriating.
 */
export function Modal({ title, subtitle, onClose, children, actions, wide = false }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} title="Fechar" aria-label="Fechar">
            <IconX size={17} />
          </button>
        </div>
        {subtitle && <p>{subtitle}</p>}
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
