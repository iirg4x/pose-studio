import { useSyncExternalStore } from 'react';

const query = '(max-width: 700px), (max-height: 540px)';
const snapshot = () => window.matchMedia(query).matches;
const subscribe = (change: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
};
/** Phone and short landscape layouts disclose one inspector category at a time. */
export function useCompactViewport() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
