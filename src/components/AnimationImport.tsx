import { portablePlatform as isAndroid } from '../platform/storage';
import { useState } from 'react';
import { FolderOpen, X, Clapperboard, LoaderCircle } from 'lucide-react';
import { studio } from '../core/store';
import { autoMapBones, RETARGET_SLOTS } from '../core/retarget';
import { importMotion } from '../core/importAnimation';
import type { AnimationInspection } from '../core/importAnimation';
import type { RigLayer } from '../core/model';
import type { StudioScene } from '../scene/StudioScene';
import { ScrubNumber } from './ScrubNumber';
import './assets.css';

export function AnimationImport({
  runtime,
  close,
  nativeImport,
}: {
  runtime: StudioScene | null;
  close: () => void;
  nativeImport: () => void;
}) {
  const [file, setFile] = useState<AnimationInspection | null>(null),
    [rigIndex, setRig] = useState(0),
    [actionIndex, setAction] = useState(0),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [fps, setFps] = useState(30),
    [type, setType] = useState<RigLayer>('body'),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0),
    [facing, setFacing] = useState(0),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [detail, setDetail] = useState('balanced'),
    [placement, setPlacement] = useState<'scene' | 'camera'>('camera');
  const rig = file?.rigs[rigIndex],
    action = rig?.actions[actionIndex];
  function chooseRig(data: AnimationInspection, i: number) {
    setRig(i);
    setAction(0);
    const r = data.rigs[i],
      a = r?.actions[0];
    setStart(a?.start ?? 0);
    setEnd(a?.end ?? 0);
    const map = autoMapBones(r?.bones ?? []),
      root = r?.bones.find((n) => /^(root|Root|mixamorig:Root)$/.test(n));
    if (root) map.root = root;
    setMapping(map);
  }
  async function choose() {
    setBusy('Reading file…');
    setError('');
    try {
      const data = await window.studioDesktop?.inspectAnimation();
      if (data) {
        setFile(data);
        setFps(Math.max(1, Math.min(120, Math.round(data.fps))));
        chooseRig(data, 0);
        if (/(?:^|_)FP(?:_|\.)/i.test(data.filename)) setType('firstPerson');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function run() {
    if (!file || !rig || !action || !runtime?.bodyRig) return;
    setBusy('Importing and fitting editable curves…');
    setError('');
    try {
      const data = await window.studioDesktop!.sampleAnimation(file.token, {
        rig: rig.name,
        action: action.id,
        start,
        end,
        fps,
      });
      const project = importMotion(
        data,
        mapping,
        runtime.canonicalRig ?? runtime.bodyRig,
        type,
        facing,
        1,
        {
          position: 0.0002,
          rotation:
            (({ precise: 0.1, balanced: 0.25, editable: 0.5 }[detail] ?? 0.25) * Math.PI) / 180,
        },
        type === 'firstPerson' ? placement : 'scene',
      );
      if (/Unreal Take|Base Layer/i.test(data.name))
        project.name = file.filename.replace(/\.[^.]+$/, '');
      studio.addImportedAction(project);
      studio.patch({ retargetMode: false, retargetRest: false });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal animation-import"
        role="dialog"
        aria-modal="true"
        aria-label="Import animation"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <header>
          <Clapperboard size={18} />
          <h2>Import animation</h2>
          <button aria-label="Close animation import" disabled={!!busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="animation-import-content">
          <div className="import-file">
            <span>{file?.filename ?? 'Choose an animated skeleton'}</span>
            <button disabled={!!busy} onClick={() => void choose()}>
              <FolderOpen size={15} />
              {file ? 'Change file' : 'Choose file'}
            </button>
          </div>
          {!file && (
            <>
              <p className="help-text">
                {isAndroid
                  ? 'Animated GLB, or import actions from a .pose project.'
                  : 'FBX, GLB, glTF, Blender and BVH.'}{' '}
                Choose a skeleton and action, then match its bones to the animation rig.
              </p>
              <button
                className="import-project-link"
                onClick={() => {
                  close();
                  nativeImport();
                }}
              >
                Import actions from a Pose project…
              </button>
            </>
          )}
          {file && (
            <>
              <div className="import-options">
                <label>
                  Skeleton
                  <select
                    aria-label="Import skeleton"
                    disabled={!!busy}
                    value={rigIndex}
                    onChange={(e) => chooseRig(file, Number(e.target.value))}
                  >
                    {file.rigs.map((r, i) => (
                      <option key={r.name} value={i}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Action
                  <select
                    aria-label="Import action"
                    disabled={!!busy}
                    value={actionIndex}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      setAction(i);
                      setStart(rig!.actions[i].start);
                      setEnd(rig!.actions[i].end);
                    }}
                  >
                    {rig?.actions.map((a, i) => (
                      <option key={a.id} value={i}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Start
                  <ScrubNumber
                    aria-label="Import start"
                    value={start}
                    step={1}
                    onChange={(e) => setStart(Number(e.target.value))}
                  />
                </label>
                <label>
                  End
                  <ScrubNumber
                    aria-label="Import end"
                    value={end}
                    step={1}
                    onChange={(e) => setEnd(Number(e.target.value))}
                  />
                </label>
                <label>
                  Sample rate
                  <ScrubNumber
                    aria-label="Import sample rate"
                    value={fps}
                    min={1}
                    max={120}
                    step={1}
                    onChange={(e) => setFps(Number(e.target.value))}
                  />
                </label>
                <label>
                  Action type
                  <select
                    aria-label="Action type"
                    disabled={!!busy}
                    value={type}
                    onChange={(e) => setType(e.target.value as RigLayer)}
                  >
                    <option value="body">Full body</option>
                    <option value="firstPerson">First person</option>
                  </select>
                </label>
                <label>
                  Facing
                  <select
                    aria-label="Import facing"
                    disabled={!!busy}
                    value={facing}
                    onChange={(e) => setFacing(Number(e.target.value))}
                  >
                    {[0, 90, 180, 270].map((n) => (
                      <option key={n} value={n}>
                        {n}°
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Key detail
                  <select
                    aria-label="Import key detail"
                    disabled={!!busy}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                  >
                    <option value="precise">High accuracy</option>
                    <option value="balanced">Balanced</option>
                    <option value="editable">Fewer keys</option>
                  </select>
                </label>
                {type === 'firstPerson' && (
                  <label>
                    Source origin
                    <select
                      aria-label="Import source origin"
                      disabled={!!busy}
                      value={placement}
                      onChange={(e) => setPlacement(e.target.value as 'scene' | 'camera')}
                    >
                      <option value="camera">Player camera</option>
                      <option value="scene">Scene / floor</option>
                    </select>
                  </label>
                )}
              </div>
              {!rig?.actions.length && (
                <p role="alert" className="retarget-error">
                  No actions found on this skeleton.
                </p>
              )}
              <details className="import-mapping" open={!!query}>
                <summary>
                  Bone mapping <small>{Object.keys(mapping).length} matched</small>
                </summary>
                <input
                  aria-label="Search import bones"
                  placeholder="Find bone…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {[{ bone: 'root', label: 'Root motion', group: 'Body' }, ...RETARGET_SLOTS]
                  .filter((slot) =>
                    (slot.label + ' ' + (mapping[slot.bone] ?? ''))
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((slot) => (
                    <label className="mapping-row" key={slot.bone}>
                      <span>{slot.label}</span>
                      <select
                        aria-label={'Import map ' + slot.label}
                        value={mapping[slot.bone] ?? ''}
                        onChange={(e) => {
                          const next = { ...mapping };
                          for (const [k, v] of Object.entries(next))
                            if (v === e.target.value) delete next[k];
                          if (e.target.value) next[slot.bone] = e.target.value;
                          else delete next[slot.bone];
                          setMapping(next);
                        }}
                      >
                        <option value="">Unmapped</option>
                        {rig?.bones.map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  ))}
              </details>
              <p className="help-text">
                Each channel is fitted independently with linear segments or editable Bézier
                handles. Key detail sets the maximum sampled rotation error: High accuracy 0.1°,
                Balanced 0.25°, Fewer keys 0.5°. Static channels keep one key. The target retains
                its bone lengths; unmapped bones remain at rest.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="retarget-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          {busy && (
            <span role="status">
              <LoaderCircle size={14} className="spin" />
              {busy}
            </span>
          )}
          <button disabled={!!busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!!busy || !action || !Object.keys(mapping).length || end <= start}
            onClick={() => void run()}
          >
            Import action
          </button>
        </footer>
      </section>
    </div>
  );
}
