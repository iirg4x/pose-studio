import { useState, useSyncExternalStore } from 'react';
import { Euler, Quaternion } from 'three';
import { ScrubNumber } from './ScrubNumber';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { clone, controlEnabled } from '../core/model';
import { editLayerAllowed, keyingFrame } from '../core/layers';
import { readCurve } from '../core/curves';
import type { Channel } from '../core/curves';
import { Diamond } from 'lucide-react';
import type { Project, Q4, Track } from '../core/model';
import { CONTROLS, isOffsetControl } from '../core/controls';
import { coordinatePose } from '../scene/coordinates';
import type { CoordinateSpace } from '../scene/coordinates';
import type { StudioScene } from '../scene/StudioScene';
const subscribeEmpty = () => () => {},
  emptySnapshot = () => null;
const SPACE_NOTE: Record<CoordinateSpace, string> = {
  world: 'Scene coordinates',
  root: 'Relative to the character root',
  parent: 'Relative to the current parent',
  local: 'Stored control or layer offsets',
};
/** Blender's convention: changed but not keyed, keyed on this frame, or animated elsewhere. */
type KeyState = 'changed' | 'keyed' | 'animated' | undefined;
function keyState(
  p: Project,
  track: Track,
  frame: number,
  channels: Channel[],
  changed: boolean,
): KeyState {
  if (changed) return 'changed';
  const f = keyingFrame(p, frame),
    curves = channels.map((c) => (track.curves?.[c] ? readCurve(track, c) : null));
  if (
    track.keys.some((k) => k.frame === f) ||
    curves.some((c) => c?.keys.some((k) => k.frame === f))
  )
    return 'keyed';
  if (track.keys.length > 1 || curves.some((c) => (c?.keys.length ?? 0) > 1)) return 'animated';
}
export function TransformFields({ runtime }: { runtime: StudioScene | null }) {
  const s = useStudioChrome({ edits: 'live' }),
    [space, setSpace] = useState<CoordinateSpace>(() => {
      try {
        const v = localStorage.getItem('pose-coordinate-space');
        if (v && ['local', 'parent', 'root', 'world'].includes(v)) return v as CoordinateSpace;
      } catch {}
      return 'world';
    });
  const resolved = useSyncExternalStore(
      runtime?.subscribeCoordinates ?? subscribeEmpty,
      runtime?.getCoordinates ?? emptySnapshot,
    ),
    raw = studio.currentTransformPose();
  if (!s.project || !raw) return null;
  const snapshot = resolved?.id === s.selected ? resolved : null,
    transform = space === 'local' ? raw : snapshot ? coordinatePose(snapshot, space, raw) : null;
  const e = new Euler().setFromQuaternion(new Quaternion(...(transform?.q ?? raw.q)), 'XYZ');
  const edit = (axis: number, value: number, rotation: boolean) => {
    if (!Number.isFinite(value)) return;
    if (space !== 'local') {
      runtime?.editCoordinate(space, axis, value, rotation);
      return;
    }
    const next = clone(studio.currentTransformPose()!);
    if (rotation) {
      const a = new Euler().setFromQuaternion(new Quaternion(...next.q), 'XYZ'),
        angles = [a.x, a.y, a.z];
      angles[axis] = (value * Math.PI) / 180;
      next.q = new Quaternion()
        .setFromEuler(new Euler(...(angles as [number, number, number]), 'XYZ'))
        .toArray() as Q4;
    } else next.p[axis] = value / 100;
    s.project!.tracks[s.selected].additive
      ? studio.editLayerOffset(s.selected, next)
      : isOffsetControl(s.selected)
        ? studio.editRaw(s.selected, next)
        : studio.editWorld(s.selected, next);
  };
  const track = s.project.tracks[s.selected],
    changed = !!s.drafts[s.selected],
    states = [
      keyState(s.project, track, s.frame, ['px', 'py', 'pz'], changed),
      keyState(s.project, track, s.frame, ['rx', 'ry', 'rz'], changed),
    ];
  return (
    <>
      {(['Location', 'Rotation'] as const).map((kind, k) => (
        <div className="property-vector" key={kind} data-key-state={states[k]}>
          <div className="property-vector-label">
            <span>{kind}</span>
            {!k && (
              <select
                className="inline-space"
                aria-label="XYZ coordinate space"
                title={SPACE_NOTE[space] + '. Changing space keeps the pose.'}
                value={space}
                onChange={(e) => {
                  studio.endGesture();
                  setSpace(e.target.value as CoordinateSpace);
                  try {
                    localStorage.setItem('pose-coordinate-space', e.target.value);
                  } catch {}
                }}
              >
                <option value="world">World</option>
                <option value="root">Root</option>
                <option value="parent">Parent</option>
                <option value="local">Local offsets</option>
              </select>
            )}
            <small>{k ? 'degrees' : 'cm'}</small>
            <button
              className="key-row"
              aria-label={'Key ' + kind.toLowerCase()}
              title={
                'Key ' +
                kind.toLowerCase() +
                (states[k] === 'keyed'
                  ? ' (keyed on this frame)'
                  : states[k] === 'changed'
                    ? ' (changed, not keyed)'
                    : states[k] === 'animated'
                      ? ' (animated)'
                      : '')
              }
              disabled={!editLayerAllowed(s.project!, s.selected)}
              onClick={() => studio.insertKeyingSet(k ? 'rotation' : 'location')}
            >
              <Diamond size={12} fill={states[k] === 'keyed' ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="vector-inputs">
            {['X', 'Y', 'Z'].map((axis, i) => (
              <label key={axis}>
                <span>{axis}</span>
                <ScrubNumber
                  aria-label={(k ? 'Rotation ' : 'Position ') + axis}
                  type="number"
                  step={k ? 5 : 1}
                  disabled={
                    !transform ||
                    !controlEnabled(s.project!, s.selected, s.frame) ||
                    !editLayerAllowed(s.project!, s.selected) ||
                    (!k && CONTROLS[s.selected].kind === 'pivot')
                  }
                  value={Number(
                    (k
                      ? ([e.x, e.y, e.z][i] * 180) / Math.PI
                      : (transform?.p[i] ?? 0) * 100
                    ).toFixed(k ? 1 : 2),
                  )}
                  onFocus={() => studio.beginGesture()}
                  onBlur={() => studio.endGesture()}
                  onChange={(event) => {
                    if (event.target.value !== '') edit(i, Number(event.target.value), !!k);
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
