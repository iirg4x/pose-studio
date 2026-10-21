import './project-loading.css';

/** Presentational startup status; importing it does not initialize the editor store. */
export function LoadingStatus({ title, stage }: { title: string; stage: string }) {
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
