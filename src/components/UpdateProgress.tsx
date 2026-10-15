import { useRef, useSyncExternalStore } from 'react';
import { appInstallSnapshot, subscribeAppInstall } from '../platform/pwa';
import { useModalFocus } from '../hooks/modalFocus';

/** Hold input only for the final snapshot/activation, never while downloading. */
export function UpdateProgress() {
  const state = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot);
  const root = useRef<HTMLElement>(null);
  useModalFocus({ rootRef: root, enabled: !!state.updateApplying });
  if (!state.updateApplying) return null;
  return (
    <div className="modal-backdrop" data-editor-overlay>
      <section
        ref={root}
        tabIndex={-1}
        className="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Updating Pose Studio"
        aria-busy="true"
      >
        <h2>Updating Pose Studio</h2>
        <p role="status">{state.updateMessage}</p>
        <p>Your project will reopen automatically.</p>
      </section>
    </div>
  );
}
