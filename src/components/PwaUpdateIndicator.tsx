import { RefreshCw } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { appInstallSnapshot, subscribeAppInstall } from '../platform/pwa';

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
  return (
    <button
      type="button"
      className="pwa-update-indicator"
      aria-label="Update ready"
      title="Update ready"
      onClick={onOpen}
    >
      <RefreshCw size={15} aria-hidden="true" />
    </button>
  );
}
