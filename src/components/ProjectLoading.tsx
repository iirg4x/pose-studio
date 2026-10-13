import { useStudioSelector } from '../hooks';
import './project-loading.css';

/** Covers the editor while a project opens, so a long open reads as progress rather
 * than a freeze. The stage text comes from the steps the open actually runs. */
export function ProjectLoading() {
  const opening = useStudioSelector(
    (s) => s.opening,
    (a, b) => a?.name === b?.name && a?.stage === b?.stage,
  );
  if (!opening) return null;
  return (
    <div className="project-loading" role="status" aria-live="polite">
      <div className="project-loading-panel">
        <strong>Opening {opening.name}</strong>
        <span>{opening.stage}…</span>
        <div className="project-loading-bar" aria-hidden="true">
          <i />
        </div>
      </div>
    </div>
  );
}
