import { useStudioSelector } from '../hooks';
import './project-loading.css';

export interface LoadingStatusProps {
  title: string;
  stage: string;
}

/** Shared startup/project loading surface so every slow recovery has one visual treatment. */
export function LoadingStatus({ title, stage }: LoadingStatusProps) {
  return (
    <div className="project-loading" role="status" aria-live="polite">
      <div className="project-loading-panel">
        <strong>{title}</strong>
        <span>{stage}…</span>
        <div className="project-loading-bar" aria-hidden="true">
          <i />
        </div>
      </div>
    </div>
  );
}

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
