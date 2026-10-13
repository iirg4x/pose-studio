import { portablePlatform as isAndroid } from '../platform/storage';
import { useEffect, useState } from 'react';
import {
  Upload,
  Plus,
  Trash2,
  PersonStanding,
  Workflow,
  Shirt,
  SlidersHorizontal,
  WandSparkles,
  Check,
  AlertCircle,
  X,
  Download,
  FolderOpen,
} from 'lucide-react';
import { useStudio } from '../hooks';
import { studio } from '../core/store';
import { RETARGET_SLOTS, autoMapBones, mappingIssues } from '../core/retarget';
import type { StudioScene } from '../scene/StudioScene';
import { PropertySection } from './PropertySection';
import { ScrubNumber } from './ScrubNumber';
import '../retarget.css';

// Dense rig tools share the editor's inset fields, cyan correspondence accent,
// muted metadata, Segoe UI typography and 4 px spacing rhythm.
export function CharacterPanel({ runtime }: { runtime: StudioScene | null }) {
  const s = useStudio(),
    w = s.workspace,
    c = w?.characters?.find((c) => c.id === w.activeCharacterId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function add(example?: 'male' | 'female') {
    if (!runtime || busy) return;
    setBusy(true);
    setError('');
    try {
      if (example)
        await runtime.addRetargetCharacter('example-fantasy-' + example, 'Fantasy ' + example);
      else {
        const file = await window.studioDesktop?.importCharacter();
        if (file) await runtime.addRetargetCharacter(file.asset, file.name, file.data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="character-panel" aria-label="Retarget characters">
      <header>
        <strong>Characters</strong>
        <button
          aria-label="Import character"
          title="Import FBX / GLB character"
          disabled={busy || !s.ready || (w?.characters?.length ?? 0) >= 8 || !window.studioDesktop}
          onClick={() => add()}
        >
          <Plus size={16} />
        </button>
      </header>
      <div className="character-list">
        {w?.characters?.map((target) => (
          <button
            className={target.id === c?.id ? 'selected' : ''}
            key={target.id}
            aria-pressed={target.id === c?.id}
            onClick={() => studio.selectCharacter(target.id)}
          >
            <PersonStanding size={17} />
            <span>{target.name}</span>
            {target.id === c?.id && <Check size={13} />}
          </button>
        ))}
      </div>
      {!w?.characters?.length && (
        <div className="retarget-intro">
          <PersonStanding size={28} />
          <h3>Bring your character</h3>
          <p>Bind a humanoid mesh to the shared Manny rig, preserving its proportions.</p>
          <button disabled={busy || !s.ready || !window.studioDesktop} onClick={() => add()}>
            <Upload size={14} />
            Import FBX / GLB
          </button>
        </div>
      )}
      {busy && (
        <p className="retarget-note" role="status">
          Preparing character…
        </p>
      )}
      {error && (
        <p role="alert" className="retarget-error">
          {error}
        </p>
      )}
      <div className="retarget-source">
        <strong>{s.project?.name}</strong>
        <span>
          Shared Manny animation · {s.project?.fps} fps · {s.project?.end} frames
        </span>
        <p>
          Switch between project characters using Preview model while animating. Your keys and
          layers stay shared.
        </p>
      </div>
      <div className="retarget-view-settings">
        <label>
          <input
            type="checkbox"
            checked={s.retargetRest}
            onChange={(e) => studio.patch({ retargetRest: e.target.checked })}
          />
          Reference pose
        </label>
      </div>
      {c && (
        <footer>
          <button
            title="Remove character from this project"
            onClick={() => studio.removeCharacter()}
          >
            <Trash2 size={14} />
            Remove character
          </button>
        </footer>
      )}
    </aside>
  );
}
export function RetargetInspector({ runtime }: { runtime: StudioScene | null }) {
  const s = useStudio(),
    c = s.workspace?.characters?.find((c) => c.id === s.workspace?.activeCharacterId),
    [tab, setTab] = useState('mapping'),
    [query, setQuery] = useState(''),
    [bone, setBone] = useState('upperarm_l'),
    [exporting, setExporting] = useState(false);
  const report = mappingIssues(c?.mapping ?? {}, s.retargetBones),
    mapped = Object.values(c?.mapping ?? {}).filter(Boolean).length,
    update = studio.updateCharacter.bind(studio);
  useEffect(() => {
    const show = () => {
      if (report.ready && runtime) setExporting(true);
      else studio.patch({ message: 'Complete the required bone mapping before exporting.' });
    };
    window.addEventListener('retarget-export', show);
    return () => window.removeEventListener('retarget-export', show);
  }, [report.ready, runtime]);
  const groups = [...new Set(RETARGET_SLOTS.map((slot) => slot.group))];
  return (
    <aside className="inspector retarget-inspector" aria-label="Retarget settings">
      <header className="retarget-heading">
        <Workflow size={17} />
        <strong>{c?.name ?? 'Retarget'}</strong>
      </header>
      {!c ? (
        <p className="retarget-note">Add a character to map its bones to Manny.</p>
      ) : s.retargetLoading ? (
        <p className="retarget-note" role="status">
          Loading skeleton and materials…
        </p>
      ) : s.retargetError ? (
        <p role="alert" className="retarget-error">
          {s.retargetError}
        </p>
      ) : (
        <>
          <div className="retarget-tabs" role="tablist" aria-label="Retarget properties">
            {[
              ['mapping', 'Bones', Workflow],
              ['parts', 'Parts', Shirt],
              ['alignment', 'Alignment', SlidersHorizontal],
            ].map(([id, label, Icon]) => (
              <button
                key={id as string}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id as string)}
              >
                <Icon size={14} />
                {label as string}
              </button>
            ))}
          </div>
          <div className="retarget-properties" role="tabpanel" aria-label={tab}>
            {tab === 'mapping' && (
              <>
                <div className={'mapping-health ' + (report.ready ? 'ready' : '')}>
                  <span>{report.ready ? <Check size={14} /> : <AlertCircle size={14} />}</span>
                  <div>
                    <strong>
                      {report.ready
                        ? 'Ready to retarget'
                        : report.missing.length +
                          ' required bone' +
                          (report.missing.length === 1 ? '' : 's') +
                          ' missing'}
                    </strong>
                    <small>
                      {mapped} of {RETARGET_SLOTS.length} mapped · optional bones can stay empty
                    </small>
                  </div>
                  <button
                    aria-label="Auto-map bones"
                    title="Auto-map bone names"
                    onClick={() => update({ mapping: autoMapBones(s.retargetBones) })}
                  >
                    <WandSparkles size={16} />
                  </button>
                </div>
                <input
                  className="mapping-search"
                  aria-label="Find bone mapping"
                  placeholder="Find bone…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="mapping-columns">
                  <span>Manny</span>
                  <span>Target bone</span>
                </div>
                {groups.map((group) => {
                  const slots = RETARGET_SLOTS.filter(
                    (slot) =>
                      slot.group === group &&
                      (!query ||
                        (slot.label + ' ' + (c.mapping[slot.bone] ?? ''))
                          .toLowerCase()
                          .includes(query.toLowerCase())),
                  );
                  return (
                    slots.length > 0 && (
                      <PropertySection
                        key={group + !!query}
                        id={'retarget-' + group}
                        title={group}
                        defaultOpen={!!query || !group.includes('fingers')}
                      >
                        {slots.map((slot) => (
                          <label key={slot.bone} className="mapping-row">
                            <span title={slot.bone}>
                              {slot.label.replace(/^(Left|Right) /, '')}
                              {slot.required && <i title="Required">*</i>}
                            </span>
                            <select
                              aria-label={'Map ' + slot.label}
                              className={slot.required && !c.mapping[slot.bone] ? 'missing' : ''}
                              value={c.mapping[slot.bone] ?? ''}
                              onChange={(e) => {
                                const mapping = { ...c.mapping };
                                for (const key of Object.keys(mapping))
                                  if (mapping[key] === e.target.value && key !== slot.bone)
                                    delete mapping[key];
                                if (e.target.value) mapping[slot.bone] = e.target.value;
                                else delete mapping[slot.bone];
                                update({ mapping });
                              }}
                            >
                              <option value="">— Unmapped —</option>
                              {s.retargetBones.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </PropertySection>
                    )
                  );
                })}
              </>
            )}
            {tab === 'parts' && (
              <>
                <p className="retarget-note">
                  Choose the visible pieces. The same parts are included in the exported character.
                </p>
                {s.retargetMeshes.map((name) => (
                  <label className="mesh-visibility" key={name}>
                    <input
                      type="checkbox"
                      checked={!c.hiddenMeshes.includes(name)}
                      onChange={(e) =>
                        update({
                          hiddenMeshes: e.target.checked
                            ? c.hiddenMeshes.filter((n) => n !== name)
                            : [...c.hiddenMeshes, name],
                        })
                      }
                    />
                    <span>{name.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </>
            )}
            {tab === 'alignment' && (
              <>
                <PropertySection id="retarget-size" title="Character alignment">
                  <label className="property-row">
                    <span>Scale</span>
                    <ScrubNumber
                      aria-label="Character scale"
                      value={c.scale}
                      min={0.01}
                      max={100}
                      step={0.01}
                      onChange={(e) =>
                        update({ scale: Math.max(0.01, Math.min(100, Number(e.target.value))) })
                      }
                    />
                  </label>
                  <label className="property-row">
                    <span>Facing</span>
                    <select
                      aria-label="Character facing"
                      value={c.facing}
                      onChange={(e) => update({ facing: Number(e.target.value) })}
                    >
                      {[0, 90, 180, 270].map((n) => (
                        <option key={n} value={n}>
                          {n}°
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="property-note">
                    A/T pose differences are aligned automatically. Facing aligns the character
                    before motion is transferred.
                  </p>
                </PropertySection>
                <PropertySection id="retarget-contacts" title="Proportions & contacts">
                  <label className="mesh-visibility">
                    <input
                      type="checkbox"
                      checked={c.handIK}
                      onChange={(e) => update({ handIK: e.target.checked })}
                    />
                    Adapt arm reach
                  </label>
                  <label className="mesh-visibility">
                    <input
                      type="checkbox"
                      checked={c.footIK}
                      onChange={(e) => update({ footIK: e.target.checked })}
                    />
                    Preserve foot placement
                  </label>
                  <label className="mesh-visibility">
                    <input
                      type="checkbox"
                      checked={c.preserveSkinning ?? false}
                      onChange={(e) => update({ preserveSkinning: e.target.checked })}
                    />
                    Preserve imported skin weights
                  </label>
                  {runtime?.shoulderAdaptation?.characterId === c.id && (
                    <div className="property-row">
                      <span>Shoulder offset</span>
                      <output>
                        {runtime.shoulderAdaptation.left.toFixed(1)} /{' '}
                        {runtime.shoulderAdaptation.right.toFixed(1)} cm
                      </output>
                    </div>
                  )}
                  <p className="property-note">
                    Shoulders and limb lengths come from this mesh. Arm motion adapts from its
                    shoulders; foot motion starts from its own stance. Prop size stays unchanged.
                  </p>
                </PropertySection>
                <PropertySection id="retarget-correction" title="Pose correction">
                  <select
                    className="correction-bone"
                    aria-label="Correction bone"
                    value={bone}
                    onChange={(e) => setBone(e.target.value)}
                  >
                    {RETARGET_SLOTS.map((slot) => (
                      <option key={slot.bone} value={slot.bone}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                  <div className="retarget-axes">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <label key={axis}>
                        <span>{axis}</span>
                        <ScrubNumber
                          aria-label={'Correction ' + axis}
                          value={c.offsets[bone]?.[i] ?? 0}
                          min={-180}
                          max={180}
                          step={1}
                          disabled={!c.mapping[bone]}
                          onChange={(e) => {
                            const value = [...(c.offsets[bone] ?? [0, 0, 0])] as [
                              number,
                              number,
                              number,
                            ];
                            value[i] = Math.max(-180, Math.min(180, Number(e.target.value)));
                            update({ offsets: { ...c.offsets, [bone]: value } });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const offsets = { ...c.offsets };
                      delete offsets[bone];
                      update({ offsets });
                    }}
                  >
                    Reset correction
                  </button>
                  <p className="property-note">
                    Local rotation in degrees. Applies to every action on this character.
                  </p>
                </PropertySection>
              </>
            )}
          </div>
          <footer className="retarget-export">
            <button
              className="primary"
              disabled={!report.ready || !runtime}
              onClick={() => setExporting(true)}
            >
              <Download size={15} />
              Export target animation
            </button>
          </footer>
        </>
      )}
      {exporting && c && <RetargetExport runtime={runtime} close={() => setExporting(false)} />}
    </aside>
  );
}
export function RetargetExport({
  runtime,
  close,
}: {
  runtime: StudioScene | null;
  close: () => void;
}) {
  const s = useStudio(),
    c = s.workspace?.characters?.find((c) => c.id === s.workspace?.activeCharacterId),
    [format, setFormat] = useState<'fbx' | 'glb'>(isAndroid ? 'glb' : 'fbx'),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [path, setPath] = useState('');
  async function run() {
    if (!runtime || !s.project) return;
    setBusy(true);
    setError('');
    try {
      const data = await runtime.bakeRetarget((v) => setProgress(v * 0.8));
      const result = await window.studioDesktop!.exportCharacter(data, {
        name: c?.name + '_' + s.project.name,
        format,
        fps: s.project.fps,
        end: s.project.end,
      });
      if (result) setPath(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="retarget-export-title"
        className="modal compact-modal"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <header>
          <h2 id="retarget-export-title">Export target animation</h2>
          <button aria-label="Close target export" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {path ? (
          <>
            <p>
              <Check size={16} />
              Animation saved on {c?.name}'s Manny-compatible skeleton.
            </p>
            <code className="retarget-export-path">{path}</code>
            <footer>
              {!isAndroid && (
                <button onClick={() => window.studioDesktop?.revealRecording(path)}>
                  <FolderOpen size={15} />
                  Show in folder
                </button>
              )}
              <button onClick={close}>Done</button>
            </footer>
          </>
        ) : (
          <>
            <p>
              {s.project?.name} → {c?.name}
            </p>
            <p className="help-text">
              Manny-compatible skeleton, visible meshes and baked motion at {s.project?.fps} fps.
              Manny's source animation stays editable. Props can be exported separately with the
              source action.
            </p>
            {!isAndroid && (
              <button
                className="check-row"
                disabled={busy}
                onClick={() => {
                  close();
                  window.dispatchEvent(new Event('pose-export-shared'));
                }}
              >
                Export all characters on one shared skeleton…
              </button>
            )}
            <label className="property-row">
              <span>Format</span>
              <select
                aria-label="Target export format"
                disabled={busy}
                value={format}
                onChange={(e) => setFormat(e.target.value as 'fbx' | 'glb')}
              >
                {!isAndroid && <option value="fbx">FBX</option>}
                <option value="glb">GLB</option>
              </select>
            </label>
            {busy && (
              <div className="export-progress">
                <span>
                  {progress < 0.8 ? 'Baking target motion…' : 'Writing target animation…'}
                </span>
                <progress value={progress} max={1} />
              </div>
            )}
            {error && (
              <p role="alert" className="retarget-error">
                {error}
              </p>
            )}
            <footer>
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={run}>
                {busy ? 'Exporting…' : 'Choose file & export'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
