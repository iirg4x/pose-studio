import { useEffect, useState } from 'react';
import { Hand } from 'lucide-react';
import type { StudioScene } from '../scene/StudioScene';

const gripThumbnailCache = new WeakMap<StudioScene, string[]>();

/**
 * Grip thumbnails are an expensive off-screen render. Keep them out of the
 * scene's ready path and render them only after the Grip section is mounted.
 * The WeakMap means reopening the section reuses the images for this runtime,
 * while a retry/new scene naturally gets a fresh set.
 */
export function GripPresets({
  runtime,
  ready,
  apply,
}: {
  runtime: StudioScene | null;
  ready: boolean;
  apply: (kind: number) => void;
}) {
  const [thumbs, setThumbs] = useState<string[]>(() =>
    runtime ? (gripThumbnailCache.get(runtime) ?? []) : [],
  );

  useEffect(() => {
    let cancelled = false;
    if (!runtime || !ready) {
      setThumbs([]);
      return;
    }
    const cached = gripThumbnailCache.get(runtime);
    if (cached) {
      setThumbs(cached);
      return;
    }

    setThumbs([]);
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const generated = runtime.gripThumbnails();
      if (cancelled) return;
      if (generated.length) gripThumbnailCache.set(runtime, generated);
      setThumbs(generated);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [runtime, ready]);

  return (
    <div className="pose-presets">
      {['Relaxed', 'Rifle', 'Pinch'].map((label, i) => (
        <button
          key={label}
          className="pose-preset"
          onClick={() => apply(i)}
          title={'Apply ' + label.toLowerCase() + ' grip'}
        >
          {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <Hand size={30} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
