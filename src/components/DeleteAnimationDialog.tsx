import { useEffect, useRef } from 'react';
import { Trash2, X } from 'lucide-react';
export function DeleteAnimationDialog({
  name,
  last,
  remove,
  cancel,
  exiting = false,
}: {
  name: string;
  last: boolean;
  remove: () => void;
  cancel: () => void;
  exiting?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    const node = dialog.current;
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="delete-animation-dialog"
      aria-labelledby="delete-animation-title"
      aria-hidden={exiting || undefined}
      data-editor-overlay
      data-motion="popover"
      data-state={exiting ? 'closing' : 'open'}
      inert={exiting || undefined}
      onCancel={cancel}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        )
          cancel();
      }}
    >
      <header>
        <h2 id="delete-animation-title">Delete animation?</h2>
        <button aria-label="Cancel deletion" onClick={cancel}>
          <X size={18} />
        </button>
      </header>
      <p>
        <strong>{name}</strong> will be removed from this project.
      </p>
      <p className="help-text">
        Animations using it as a source keep a saved copy of its motion. Preview pairs are unlinked.
        {last ? ' A blank animation will replace the last clip.' : ''}
      </p>
      <footer>
        <button autoFocus onClick={cancel}>
          Cancel
        </button>
        <button className="danger" onClick={remove}>
          <Trash2 size={16} />
          Delete animation
        </button>
      </footer>
    </dialog>
  );
}
