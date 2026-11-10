import { useState } from 'react';
import { X, Check, FolderOpen, AlertCircle, Layers } from 'lucide-react';
import { useStudio } from '../hooks';
import { studio } from '../core/store';
import { sharedExportPlan } from '../core/sharedExport';
import { portablePlatform } from '../platform/storage';
import { SharedPackage } from '../core/fbx/sharedPackage';
import script from '../unreal/import_shared_unreal.py?raw';
import type { StudioScene } from '../scene/StudioScene';
export function SharedExportDialog({
  runtime,
  close,
  single,
}: {
  runtime: StudioScene | null;
  close: () => void;
  single: () => void;
}) {
  const s = useStudio(),
    [all, setAll] = useState(true),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [label, setLabel] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<{ directory: string; files: string[] } | null>(null);
  const workspace = studio.documentSnapshot(),
    plan = workspace ? sharedExportPlan(workspace, all) : null;
  async function run() {
    const desktop = window.studioDesktop;
    if (!runtime || !plan || !desktop) return;
    setBusy(true);
    setError('');
    let id: string | undefined;
    try {
      const session = await desktop.beginExport(plan.name, true);
      if (!session) return;
      id = session.id;
      const folder = id,
        pack = new SharedPackage(plan, (path, data) => desktop.writeExport(folder, path, data));
      await runtime.bakeShared(
        plan,
        (item, bytes) => pack.add(item, bytes),
        (v, text) => {
          setProgress(v * 0.9);
          setLabel(text);
        },
      );
      setProgress(0.9);
      setLabel('Writing props, sockets and the import script…');
      await pack.finish(desktop.readCharacter, script);
      const finished = await desktop.finishExport(id);
      id = undefined;
      setResult(finished);
      setProgress(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id) await desktop.cancelExport(id).catch(() => {});
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal export-modal shared-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-export-title"
      >
        <header>
          <div>
            <h2 id="shared-export-title">Export to Unreal</h2>
            <p>{s.workspace?.name}</p>
          </div>
          <button disabled={busy} aria-label="Close export" onClick={close}>
            <X size={18} />
          </button>
        </header>
        {!result && (
          <div className="segmented export-modes">
            <button disabled={busy} onClick={single}>
              Current animation
            </button>
            <button aria-pressed="true" disabled={busy}>
              <Layers size={15} />
              Shared skeleton
            </button>
          </div>
        )}
        {result ? (
          <div className="export-success">
            <Check size={28} />
            <h3>Shared skeleton package exported</h3>
            <p>
              {plan?.characters.length} characters · body, arms and legs · one shared animation set
            </p>
            <code>{result.directory}</code>
            {!portablePlatform && (
              <button
                className="primary"
                onClick={() => window.studioDesktop?.showFolder(result.directory)}
              >
                <FolderOpen size={16} />
                Open folder
              </button>
            )}
            <p className="help-text">
              In Unreal, enable the Python Editor Script Plugin, then use Tools → Execute Python
              Script to run <strong>import_shared_unreal.py</strong>. It assigns one Skeleton,
              configures bone translations to preserve proportions, and creates the prop sockets.
              Use the shared clips in your normal Animation Blueprint.
            </p>
            <footer>
              <button onClick={close}>Done</button>
            </footer>
          </div>
        ) : (
          <>
            <div className="shared-export-characters">
              <strong>All project characters</strong>
              <div>
                {plan?.characters.map((c) => (
                  <span key={c.id}>{c.name}</span>
                ))}
              </div>
              <p>Body, first-person arms and legs for each character.</p>
            </div>
            <div className="property-row shared-export-range">
              <span>Animations</span>
              <div className="segmented">
                <button disabled={busy} aria-pressed={all} onClick={() => setAll(true)}>
                  All ({s.workspace?.clips.length})
                </button>
                <button disabled={busy} aria-pressed={!all} onClick={() => setAll(false)}>
                  Current
                </button>
              </div>
            </div>
            <div className="export-summary">
              <span>Skeleton</span>
              <strong>One shared bone hierarchy</strong>
              <span>Proportions</span>
              <strong>Each character’s own bind pose</strong>
              <span>Motion</span>
              <strong>{plan ? plan.clips.length : 0} shared animation files</strong>
              <span>Props</span>
              <strong>
                {plan?.props.length} static {plan?.props.length === 1 ? 'mesh' : 'meshes'} +{' '}
                {plan?.sockets.length} {plan?.sockets.length === 1 ? 'socket' : 'sockets'}
              </strong>
            </div>
            <p className="help-text">
              Each clip exports once. All characters use the same Skeleton and animation assets;
              each mesh keeps its own proportions. Exact two-hand grips across different proportions
              may need hand IK in Unreal.
            </p>
            {busy && (
              <div className="export-progress" aria-live="polite">
                <span>{label || 'Choose an export folder…'}</span>
                <progress value={progress} max={1} />
              </div>
            )}
            {error && (
              <p role="alert" className="error-message">
                <AlertCircle size={16} />
                {error}
              </p>
            )}
            <footer>
              <button disabled={busy} onClick={close}>
                Cancel
              </button>
              <button className="primary" disabled={busy || !s.ready} onClick={run}>
                {busy ? 'Exporting…' : portablePlatform ? 'Export zip' : 'Choose folder & export'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
