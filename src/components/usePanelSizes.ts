import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
type Sizes = { controls: number; inspector: number; timeline: number };
type Panel = keyof Sizes;
const defaults: Sizes = { controls: 196, inspector: 300, timeline: 320 };
export function usePanelSizes(curves = false) {
  const [sizes, setSizes] = useState<Sizes>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('manny-studio-panels-v1') ?? '{}');
      return {
        ...defaults,
        ...Object.fromEntries(
          Object.entries(value).filter(
            ([k, v]) => k in defaults && typeof v === 'number' && Number.isFinite(v),
          ),
        ),
      };
    } catch {
      return defaults;
    }
  });
  const clamp = (s: Sizes): Sizes => ({
    controls: Math.max(140, Math.min(380, innerWidth - 540, s.controls)),
    inspector: Math.max(
      220,
      Math.min(480, innerWidth - Math.max(140, Math.min(380, s.controls)) - 300, s.inspector),
    ),
    timeline: Math.max(curves ? 360 : 240, Math.min(innerHeight - 340, s.timeline)),
  });
  const [windowSize, setWindowSize] = useState([innerWidth, innerHeight]);
  useEffect(() => {
    const resize = () => setWindowSize([innerWidth, innerHeight]);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const value = clamp(sizes);
  void windowSize;
  const change = (panel: Panel, size: number) =>
    setSizes((previous) => {
      const next = clamp({ ...previous, [panel]: size });
      try {
        localStorage.setItem('manny-studio-panels-v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  const style = {
    '--controls-width': value.controls + 'px',
    '--inspector-width': value.inspector + 'px',
    '--timeline-size': value.timeline + 'px',
  } as CSSProperties;
  return { sizes: value, change, style };
}
