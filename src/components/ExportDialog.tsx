import { useState } from 'react';
import { SharedExportDialog } from './SharedExportDialog';
import { X, Check, FolderOpen, AlertCircle } from 'lucide-react';
import { projectProps } from '../core/assets';
import { loopRange } from '../core/loops';
import { useStudio } from '../hooks';
import { portablePlatform } from '../platform/storage';
import { clipExportFiles } from '../core/fbx/clip';
import type { ClipBake } from '../core/fbx/clip';
import skeleton from '../unreal/manny-skeleton.json';
import type { StudioScene } from '../scene/StudioScene';
async function mannyModel() {
  const response = await fetch('assets/manny.glb');
  if (!response.ok) throw Error('The Manny model is missing from this installation.');
  return new Uint8Array(await response.arrayBuffer());
}
export function ExportDialog({
  runtime,
  close,
}: {
  runtime: StudioScene | null;
  close: () => void;
}) {
  const [shared, setShared] = useState(true);
  const s = useStudio(),
    body = s.project?.editing === 'body',
    [includeMesh, setIncludeMesh] = useState(true),
    [onlyLoop, setOnlyLoop] = useState(false),
    [extractRoot, setExtractRoot] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<{ directory: string; files: string[] } | null>(null);
  async function run() {
    const desktop = window.studioDesktop;
    if (!runtime || !s.project || !desktop) return;
    setBusy(true);
    setError('');
    let id: string | undefined;
    try {
      const session = await desktop.beginExport(s.project.name);
      if (!session) return;
      id = session.id;
      const data = await runtime.bake(
        s.project,
        (v) => setProgress(v * 0.5),
        onlyLoop ? loopRange(s.project) : undefined,
        extractRoot ? 'extract' : 'keep',
      );
      setProgress(0.55);
      const files = await clipExportFiles(data as unknown as ClipBake, {
        includeMesh,
        skeleton,
        manny: mannyModel,
        asset: desktop.readCharacter,
      });
      for (const [index, file] of files.entries()) {
        await desktop.writeExport(id, file.path, file.data);
        setProgress(0.55 + (0.45 * (index + 1)) / files.length);
      }
      const finished = await desktop.finishExport(id);
      id = undefined;
      setProgress(1);
      setResult(finished);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id) await desktop.cancelExport(id).catch(() => {});
      setBusy(false);
    }
  }
  if (shared)
    return <SharedExportDialog runtime={runtime} close={close} single={() => setShared(false)} />;
  return (
    <div className="modal-backdrop">
      <section
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <header>
          <div>
            <h2 id="export-title">Export to Unreal</h2>
            <p>
              {s.project?.name} · Manny Simple · {s.project?.fps} fps ·{' '}
              {s.project
                ? (onlyLoop
                    ? loopRange(s.project).end - loopRange(s.project).start
                    : s.project.end) + 1
                : 0}{' '}
              samples
            </p>
          </div>
          <button disabled={busy} aria-label="Close export" onClick={close}>
            <X size={18} />
          </button>
        </header>
        {!result && (
          <div className="segmented export-modes">
            <button aria-pressed="true" disabled={busy}>
              Current animation
            </button>
            <button disabled={busy} onClick={() => setShared(true)}>
              Shared skeleton
            </button>
          </div>
        )}
        {result ? (
          <div className="export-success">
            <Check size={28} />
            <h3>Animation exported</h3>
            <p>{result.files.length} files saved to:</p>
            <code>{result.directory}</code>
            {!portablePlatform && (
              <button
                className="primary"
                onClick={() => window.studioDesktop?.showFolder(result.directory)}
              >
                <FolderOpen size={16} /> Open folder
              </button>
            )}
            <p className="help-text">
              Import the body and arms as separate skeletal meshes. Legs use the body pose; floating
              arms and player props attach to the camera. The JSON sidecar records component
              settings and synchronized timing.
            </p>
          </div>
        ) : (
          <>
            <div className="export-summary">
              <span>{body ? 'Full body + legs' : 'Floating arms'}</span>
              <strong>{body ? 'Body action FBX' : 'First-person action FBX'}</strong>
              <span>{body ? 'World props' : 'Player props'}</span>
              <strong>{Object.keys(projectProps(s.project)).length} animated FBX files</strong>
              <span>Camera & attachments</span>
              <strong>JSON sidecar</strong>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={onlyLoop}
                disabled={busy}
                onChange={(e) => setOnlyLoop(e.target.checked)}
              />{' '}
              Export loop range only
              {s.project
                ? ' (' + loopRange(s.project).start + '–' + loopRange(s.project).end + ')'
                : ''}
            </label>
            <p className="help-text">
              Modifiers are baked into the motion. Loop export includes the closing pose and starts
              at frame 0. The source project stays complete.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                disabled={!body || busy}
                checked={extractRoot}
                onChange={(e) => setExtractRoot(e.target.checked)}
              />{' '}
              Prepare body root motion for Unreal
            </label>
            <p className="help-text">
              {extractRoot
                ? 'Body motion starts at the origin. World props use actor space so movement is applied once. Enable Root Motion on the body animation in Unreal; keep it off for arms and props.'
                : 'Root motion stays on the bones and world props. Use this for previewing the authored motion without Unreal root extraction.'}
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={includeMesh}
                onChange={(e) => setIncludeMesh(e.target.checked)}
                disabled={busy}
              />{' '}
              Include {body ? 'body and legs meshes' : 'floating arms mesh'}
            </label>
            <p className="help-text">
              Include meshes for a first import. Manny PBR textures are included. Export the
              companion action separately for its matching arms or body motion.
            </p>
            {busy && (
              <div className="export-progress">
                <span>{progress < 0.5 ? 'Baking animation…' : 'Writing FBX files…'}</span>
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
