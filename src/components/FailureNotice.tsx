import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, X } from 'lucide-react';
import { dismissFailure, failureSnapshot, subscribeFailures } from '../platform/feedback';
import './reliability.css';

export function FailureNotice() {
  const notice = useSyncExternalStore(subscribeFailures, failureSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!notice || !node) return;
    // A non-modal top-layer notice remains readable above native dialogs too.
    node.showPopover?.();
    return () => node.hidePopover?.();
  }, [notice]);
  if (!notice) return null;
  return createPortal(
    <div ref={ref} popover="manual" className="studio-failure-notice" data-editor-overlay>
      <AlertCircle size={20} aria-hidden="true" />
      <p role="alert" aria-atomic="true">
        {notice.message}
      </p>
      <button aria-label="Dismiss error" onClick={() => dismissFailure(notice.id)}>
        <X size={18} />
      </button>
    </div>,
    document.body,
  );
}
