import { useEffect, useRef } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { downloadSafetyCopy } from '../platform/safetyCopy';
import './reliability.css';

export function GraphicsFallback({ message, retry }: { message: string; retry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="graphics-fallback" aria-labelledby="graphics-failure-title">
      <h2 ref={heading} id="graphics-failure-title" tabIndex={-1}>
        The 3D view is unavailable
      </h2>
      <p role="alert">{message}</p>
      <p>
        Pose needs WebGL 2. Check that hardware acceleration is enabled, or close other
        graphics-heavy tabs and retry. Your project data is kept separately from the 3D view.
      </p>
      <div className="reliability-actions">
        <button onClick={retry}>
          <RefreshCw size={16} />
          Retry 3D view
        </button>
        <button onClick={() => void downloadSafetyCopy()}>
          <Download size={16} />
          Download recovery
        </button>
      </div>
    </section>
  );
}
