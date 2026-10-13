import { ArrowDownToLine } from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import type { ControlId } from '../core/model';
import type { FootPivot } from '../scene/footControls';
export function FootPoseTools({ id }: { id: ControlId }) {
  const s = useStudioChrome({ frame: 'none' });
  return (
    <div className="foot-pose-tools" aria-label="Foot contact tools">
      <div className="foot-pivot-options">
        <span>Rotate about</span>
        <div role="group" aria-label="Foot rotation pivot">
          {(['ankle', 'sole', 'heel', 'ball', 'toe'] as FootPivot[]).map((pivot) => (
            <button
              key={pivot}
              type="button"
              aria-label={'Rotate foot about ' + pivot}
              aria-pressed={
                s.footPivot === pivot && s.mode === 'rotate' && s.selected.startsWith('foot_')
              }
              title={
                pivot === 'ankle'
                  ? 'Free ankle rotation'
                  : 'Rotate around the mesh ' +
                    pivot +
                    '; keep the sole above the floor while editing this pose'
              }
              onClick={() => {
                studio.selectControl(('foot_' + id.at(-1)) as ControlId);
                studio.patch({ mode: 'rotate', footPivot: pivot });
              }}
            >
              {pivot[0].toUpperCase() + pivot.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="ground-toes-command"
        disabled={!studio.canEditLayer(id)}
        aria-label="Ground and key toes"
        title="Plant the toes while preserving the toe joint and a raised heel; key this pose"
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent('pose-ground-selection', {
              detail: [('toe_' + id.at(-1)) as ControlId],
            }),
          )
        }
      >
        <ArrowDownToLine size={15} />
        Ground toes
      </button>
    </div>
  );
}
