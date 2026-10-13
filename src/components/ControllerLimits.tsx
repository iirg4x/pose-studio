import { ArrowDownToLine } from 'lucide-react';
import { PropertySection } from './PropertySection';
import { ScrubNumber } from './ScrubNumber';
import { studio } from '../core/store';
import { controllerConstraints, groundingClearance } from '../core/controllerConstraints';
import { CONTROLS } from '../core/controls';
import { controlEnabled } from '../core/model';
import { editLayerAllowed } from '../core/layers';
import type { ControlId, Project } from '../core/model';
export function ControllerLimits({
  project,
  id,
  ground: applyGround,
}: {
  project: Project;
  id: ControlId;
  ground: () => void;
}) {
  const definition = CONTROLS[id],
    limb = definition.limb,
    tip = limb
      ? (((limb.startsWith('arm') ? 'hand_' : 'foot_') + limb.at(-1)) as ControlId)
      : undefined,
    settings = controllerConstraints(project),
    ground = definition.kind !== 'pivot' && id !== 'camera';
  if (!ground && !tip) return null;
  return (
    <PropertySection id="controller-limits" title="Grounding and reach">
      {ground && (
        <>
          <button
            type="button"
            className="ground-key-command"
            aria-label="Ground and key this control"
            disabled={
              !controlEnabled(project, id, studio.state.frame) || !editLayerAllowed(project, id)
            }
            onClick={applyGround}
          >
            <ArrowDownToLine size={17} />
            <span>Ground and key</span>
          </button>
          <label className="property-row">
            <span>
              Clearance <small>cm</small>
            </span>
            <ScrubNumber
              aria-label="Ground clearance"
              type="number"
              min={0}
              max={10000}
              step={1}
              value={Number((groundingClearance(project, id) * 100).toFixed(2))}
              onFocus={() => studio.beginGesture()}
              onBlur={() => studio.endGesture()}
              onChange={(e) =>
                studio.configureConstraint(id, {
                  clearance: Math.max(0, Math.min(100, Number(e.target.value) / 100)),
                })
              }
            />
          </label>
          <p className="property-note">
            Places {definition.bone ? 'the mesh' : 'this control'} on the floor and keys this frame.
            Motion between keys interpolates normally.
          </p>
        </>
      )}
      {tip && (
        <>
          <div className="property-row">
            <span>IK reach</span>
            <div className="segmented constraint-reach">
              {(
                [
                  ['Fixed', false],
                  ['Stretch', true],
                ] as const
              ).map(([label, stretch]) => (
                <button
                  key={label}
                  aria-pressed={!!settings[tip]?.stretch === stretch}
                  onClick={() => studio.configureConstraint(tip, { stretch })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="property-note">
            {settings[tip]?.stretch
              ? 'The limb can lengthen to reach its target.'
              : 'Keeps the original limb length.'}{' '}
            Applies in IK mode.
          </p>
        </>
      )}
    </PropertySection>
  );
}
