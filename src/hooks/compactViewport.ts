import { useSyncExternalStore } from 'react';

const query = '(max-width: 700px), (max-height: 540px), (pointer: fine) and (max-width: 740px)';
const snapshot = () => window.matchMedia(query).matches;
const subscribe = (change: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
};
/** Phone, short landscape and narrow fine-pointer layouts use compact disclosure rules. */
export function useCompactViewport() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
