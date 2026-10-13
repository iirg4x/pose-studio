import { IDS } from './model';
import type { ControlId, Project } from './model';
import { layerTracks } from './layers';
import { trackFrames } from './timelineKeys';

// Reference markers show authored source times, never baked motion samples.
export function firstPersonKeyReferences(project: Project): Record<ControlId, number[]> {
  const result = Object.fromEntries<number[]>(IDS.map((id) => [id, []])) as Record<
    ControlId,
    number[]
  >;
  const base = project.bodyBase;
  if (!base?.enabled) return result;
  const source = base.source,
    ratio = project.fps / source.fps,
    solo = source.layers?.some((l) => l.kind !== 'base' && l.enabled && l.solo);
  for (const id of IDS) {
    if (id === 'camera' || base.excluded.includes(id)) continue;
    const times = source.layers
      ? source.layers.flatMap((layer) => {
          if (
            layer.kind !== 'base' &&
            (!layer.enabled ||
              !layer.weight ||
              layer.excluded.includes(id) ||
              (solo && !layer.solo))
          )
            return [];
          return layer.kind === 'pose' || layer.static
            ? [0]
            : trackFrames(layerTracks(source, layer)[id]);
        })
      : trackFrames(source.tracks[id]);
    result[id] = [
      ...new Set(
        times
          .filter((frame) => frame <= source.end)
          .map((frame) => frame * ratio)
          .filter((frame) => frame >= 0 && frame <= project.end),
      ),
    ].sort((a, b) => a - b);
  }
  return result;
}
