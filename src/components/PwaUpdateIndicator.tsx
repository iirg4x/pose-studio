import { RefreshCw } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { appInstallSnapshot, applyPwaUpdate, subscribeAppInstall } from '../platform/pwa';

/**
 * Compact update affordance for the app chrome. The parent owns placement and
 * opens InstallStudio; this component intentionally takes no scene space when
 * there is no waiting worker.
 */
export function PwaUpdateIndicator({
  onOpen,
  fallback = null,
}: {
  onOpen: () => void;
  fallback?: ReactNode;
}) {
  const state = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot);
  if (state.status !== 'update') return fallback;
  const label = state.updateApplying
    ? 'Applying update…'
    : state.updateMessage || 'Update ready. Open to apply.';
  return (
    <button
      type="button"
      className="pwa-update-indicator"
      aria-label={label}
      aria-busy={state.updateApplying || undefined}
      title={label}
      onClick={() => {
        // A click is an explicit retry after a persistence failure or a
        // deferred edit. The coordinator still enforces the editor safety gate.
        void applyPwaUpdate({ force: true });
        onOpen();
      }}
    >
      <RefreshCw size={15} aria-hidden="true" />
    </button>
  );
}
