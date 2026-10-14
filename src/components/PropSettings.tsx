import { Box } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { projectProps } from '../core/assets';
import type { V3 } from '../core/model';
import { PropertySection } from './PropertySection';
import { ScrubNumber } from './ScrubNumber';
export function PropSettings() {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    p = projectProps(s.project)[s.selected];
  if (!p) return null;
  return (
    <PropertySection id="prop-asset" title="Prop asset" defaultOpen={false}>
      <label className="property-row">
        <span>Name</span>
        <input
          aria-label="Prop name"
          value={p.name}
          onChange={(e) => studio.updateProp(s.selected, { name: e.target.value.slice(0, 100) })}
        />
      </label>
      <label className="property-row">
        <span>Scale</span>
        <ScrubNumber
          aria-label="Prop scale"
          value={p.scale}
          min={0.0001}
          max={1e4}
          step={0.01}
          onChange={(e) =>
            studio.updateProp(s.selected, { scale: Math.max(0.0001, Number(e.target.value)) })
          }
        />
      </label>
      {(['rotation', 'offset'] as const).map((kind) => (
        <div className="property-vector" key={kind}>
          <div className="property-vector-label">
            <span>{kind === 'rotation' ? 'Mesh rotation' : 'Mesh offset'}</span>
            <small>{kind === 'rotation' ? 'degrees' : 'cm'}</small>
          </div>
          <div className="vector-inputs">
            {['X', 'Y', 'Z'].map((axis, i) => (
              <label key={axis}>
                <span>{axis}</span>
                <ScrubNumber
                  aria-label={'Prop ' + kind + ' ' + axis}
                  value={p[kind][i] * (kind === 'offset' ? 100 : 1)}
                  step={1}
                  onChange={(e) => {
                    const v = [...p[kind]] as V3;
                    v[i] = Number(e.target.value) / (kind === 'offset' ? 100 : 1);
                    studio.updateProp(s.selected, { [kind]: v });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <p className="property-note">
        <Box size={12} /> Adjust the mesh around its control without changing animation keys.
      </p>
    </PropertySection>
  );
}
