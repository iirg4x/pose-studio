import { useStudioSelector } from '../hooks';
import { LoadingStatus } from './LoadingStatus';

/** Covers the editor while a project opens, so a long open reads as progress rather
 * than a freeze. The stage text comes from the steps the open actually runs. */
export function ProjectLoading() {
  const opening = useStudioSelector(
    (s) => s.opening,
    (a, b) => a?.name === b?.name && a?.stage === b?.stage,
  );
  if (!opening) return null;
  return <LoadingStatus title={`Opening ${opening.name}`} stage={opening.stage} />;
}
