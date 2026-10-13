import { portablePlatform as isAndroid } from '../platform/storage';
import { useEffect, useRef, useState } from 'react';
import { X, Video, Repeat2, Check, FolderOpen, AlertCircle } from 'lucide-react';
import { recordingPlan } from '../core/recording';
import type { RecordingOptions } from '../core/recording';
import { useStudio } from '../hooks';
import type { StudioScene } from '../scene/StudioScene';
import { ScrubNumber } from './ScrubNumber';
import '../recording.css';

export function RecordingDialog({
  runtime,
  close,
}: {
  runtime: StudioScene | null;
  close: () => void;
}) {
  const s = useStudio(),
    [loops, setLoops] = useState(3),
    [view, setView] = useState<RecordingOptions['view']>(
      !s.retargetMode && (s.playerView || s.project?.editing === 'firstPerson')
        ? 'player'
        : 'scene',
    ),
    [range, setRange] = useState<RecordingOptions['range']>('animation'),
    [format, setFormat] = useState<RecordingOptions['format']>(isAndroid ? 'webm' : 'mp4'),
    [size, setSize] = useState('1080');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<string | null>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const canvas = runtime?.renderer.domElement,
    even = (v: number) => Math.max(2, Math.min(3840, Math.round(v / 2) * 2));
  const width =
      size === 'viewport' ? even(canvas?.clientWidth ?? 1280) : size === '1080' ? 1920 : 1280,
    height = size === 'viewport' ? even(canvas?.clientHeight ?? 720) : size === '1080' ? 1080 : 720;
  let plan: ReturnType<typeof recordingPlan> | null = null,
    invalid = '';
  try {
    if (s.project) plan = recordingPlan(s.project, { loops, view, range, format, width, height });
  } catch (e) {
    invalid = (e as Error).message;
  }
  async function run() {
    if (!runtime || !plan || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setProgress(0);
    setError('');
    try {
      const { exportRecording } = await import('../scene/exportRecording');
      const filename = await exportRecording(runtime, plan, setProgress, abort.signal);
      if (filename) setResult(filename);
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal recording-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) close();
        }}
      >
        <header>
          <div>
            <h2 id="recording-title">
              <Video size={18} />
              Export recording
            </h2>
            <p>{s.project?.name}</p>
          </div>
          <button aria-label="Close recording export" disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        {result ? (
          <div className="recording-success">
            <Check size={26} />
            <h3>Recording saved</h3>
            <p>
              {loops} {loops === 1 ? 'loop' : 'loops'} · {plan?.duration.toFixed(2)} s · 60 fps ·{' '}
              {width} × {height}
            </p>
            <code>{result}</code>
            {!isAndroid && (
              <button
                className="primary"
                onClick={() => window.studioDesktop?.revealRecording(result)}
              >
                <FolderOpen size={16} />
                Show in folder
              </button>
            )}
            <footer>
              <button
                onClick={() => {
                  setResult(null);
                  setProgress(0);
                }}
              >
                Export another
              </button>
              <button onClick={close}>Done</button>
            </footer>
          </div>
        ) : (
          <>
            <div className="recording-fields">
              <label>
                View
                <select
                  disabled={busy}
                  value={view}
                  onChange={(e) => setView(e.target.value as RecordingOptions['view'])}
                >
                  <option value="player" disabled={s.retargetMode}>
                    Player camera
                  </option>
                  <option value="scene">Scene camera</option>
                </select>
              </label>
              <label>
                Size
                <select disabled={busy} value={size} onChange={(e) => setSize(e.target.value)}>
                  <option value="1080">1920 × 1080</option>
                  <option value="720">1280 × 720</option>
                  <option value="viewport">Match viewport</option>
                </select>
              </label>
              <label>
                Range
                <select
                  disabled={busy}
                  value={range}
                  onChange={(e) => setRange(e.target.value as RecordingOptions['range'])}
                >
                  <option value="animation">Whole animation</option>
                  <option value="loop">Timeline loop range</option>
                </select>
              </label>
              <label>
                Loop count
                <ScrubNumber
                  disabled={busy}
                  aria-label="Loop count"
                  min={1}
                  max={100}
                  step={1}
                  value={loops}
                  onChange={(e) => setLoops(Number(e.target.value))}
                />
              </label>
              <label>
                Format
                <select
                  disabled={busy}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as RecordingOptions['format'])}
                >
                  <option value="mp4">MP4 · H.264</option>
                  <option value="webm">WebM · VP9</option>
                </select>
              </label>
              <div className="recording-quality">
                <span>Frame rate</span>
                <strong>60 fps</strong>
              </div>
            </div>
            <div className="recording-duration">
              <Repeat2 size={16} />
              <span>
                {plan
                  ? `${loops} ${loops === 1 ? 'loop' : 'loops'} · ${plan.totalFrames} video frames`
                  : 'Set the loop count'}
              </span>
              <strong>{plan ? plan.duration.toFixed(2) + ' s' : '—'}</strong>
            </div>
            <p className="help-text">
              {s.cinematic ? 'Cinematic' : 'Standard'} shading with the floor and grid. Editor
              controls are hidden. Motion is sampled at 60 fps without changing animation speed.
            </p>
            {!!Object.keys(s.drafts).length && (
              <p className="notice">
                Unkeyed edits are preserved in the editor. Insert keys to include them in the
                recording.
              </p>
            )}
            {busy && (
              <div className="export-progress">
                <span>
                  {progress >= 0.96
                    ? 'Saving video…'
                    : `Rendering · ${Math.round((progress / 0.96) * 100)}%`}
                </span>
                <progress aria-label="Recording progress" value={progress} max={1} />
              </div>
            )}
            {(error || invalid) && (
              <p role="alert" className="error-message">
                <AlertCircle size={16} />
                {error || invalid}
              </p>
            )}
            {!window.studioDesktop && (
              <p className="notice">Open the desktop app to export video.</p>
            )}
            <footer>
              <button onClick={() => (busy ? controller.current?.abort() : close())}>
                {busy ? 'Cancel export' : 'Cancel'}
              </button>
              <button
                className="primary"
                disabled={busy || !plan || !runtime || !s.ready || !window.studioDesktop}
                onClick={run}
              >
                {busy ? 'Exporting…' : 'Choose file & export'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
