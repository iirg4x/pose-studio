import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Scissors, X } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { controlLabel, visibleControls } from '../core/model';
import type { Project } from '../core/model';
import { activeAnimationLayer, editLayerAllowed } from '../core/layers';
import { CHANNEL_LABELS, channelColor, channelUnit, readCurve, sampleCurve } from '../core/curves';
import type { Channel } from '../core/curves';
import { DEFAULT_REDUCTION, reductionChannels } from '../core/curveReduction';
import type { ReductionInput, ReductionOptions, ReductionResult } from '../core/curveReduction';
import type { ReductionReply, ReductionRequest } from '../core/curveReduction.worker';

const noiseForRow = (row: ReductionResult['rows'][number]) => row.noise;
const motionForRow = (row: ReductionResult['rows'][number]) => row.motion;

export function CurveReducer({
  channel,
  selectedFrames = [],
  close,
}: {
  channel?: Channel;
  selectedFrames?: number[];
  close: () => void;
}) {
  const s = useStudioChrome({ frame: 'none' }),
    p = s.project!,
    dialog = useRef<HTMLElement>(null),
    worker = useRef<Worker | null>(null),
    source = useRef<Project | null>(null);
  const [scope, setScope] = useState<'axis' | 'selection' | 'layer'>(
      channel ? 'axis' : 'selection',
    ),
    [options, setOptions] = useState<ReductionOptions>({
      ...DEFAULT_REDUCTION,
      fit: 'baked',
      drift: 2,
      preserveExtrema: false,
      detectNoise: true,
      detectMotion: true,
    });
  const [range, setRange] = useState(selectedFrames.length > 1),
    [from, setFrom] = useState(selectedFrames.length ? Math.min(...selectedFrames) : 0),
    [to, setTo] = useState(selectedFrames.length ? Math.max(...selectedFrames) : p.end);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [label, setLabel] = useState(''),
    [error, setError] = useState(''),
    [results, setResults] = useState<ReductionResult[] | null>(null);
  const [shown, setShown] = useState(0),
    [previewChannel, setPreviewChannel] = useState<Channel>(channel ?? 'px');
  const stale = !!results && source.current !== p,
    layer = activeAnimationLayer(p),
    changed = results?.filter((r) => r.changed) ?? [];
  const total = results?.reduce(
    (n, r) => ({ before: n.before + r.before, after: n.after + r.after }),
    { before: 0, after: 0 },
  );
  const inferredNoise =
    results?.reduce(
      (count, result) => count + result.rows.filter((row) => noiseForRow(row)).length,
      0,
    ) ?? 0;
  const inferredMotion = results?.reduce(
    (count, result) => ({
      spring: count.spring + result.rows.reduce((n, row) => n + (row.motion?.spring ?? 0), 0),
      bounce: count.bounce + result.rows.reduce((n, row) => n + (row.motion?.bounce ?? 0), 0),
    }),
    { spring: 0, bounce: 0 },
  ) ?? { spring: 0, bounce: 0 };
  useEffect(() => {
    dialog.current?.focus();
    return () => worker.current?.terminate();
  }, []);
  const reset = () => {
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setResults(null);
    setError('');
  };
  const configure = (value: Partial<ReductionOptions>) => {
    reset();
    setOptions((old) => ({ ...old, ...value }));
  };
  const ids =
    scope === 'axis'
      ? [s.selected]
      : scope === 'selection'
        ? s.selection
        : visibleControls(p.editing, p);
  const eligible = ids.filter((id) => p.tracks[id] && editLayerAllowed(p, id));
  function analyze() {
    reset();
    if (!eligible.length) {
      setError(
        'Select an editable control first. Linked source poses must be edited in their source animation.',
      );
      return;
    }
    if (range && (!(from >= 0) || to <= from || to > p.end)) {
      setError('Choose a valid frame range.');
      return;
    }
    if (
      [options.position, options.rotation, options.scalar].some(
        (v) => !Number.isFinite(v) || v <= 0,
      )
    ) {
      setError('Choose positive error tolerances.');
      return;
    }
    source.current = p;
    setBusy(true);
    setProgress(0);
    setShown(0);
    const boundaries = [
      ...(p.loop ? [p.loop.start, p.loop.end] : []),
      ...Object.values(p.limbModes?.[p.editing] ?? {}).flatMap((keys) =>
        (keys ?? []).map((k) => k.frame),
      ),
    ];
    const inputs: ReductionInput[] = eligible.map((id) => ({
      id,
      label: controlLabel(id, p),
      track: p.tracks[id],
      channels: reductionChannels(id, p.tracks[id], scope === 'axis' ? channel : undefined),
      protectedFrames: boundaries,
    }));
    const job = new Worker(new URL('../core/curveReduction.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = job;
    job.onmessage = (event: MessageEvent<ReductionReply>) => {
      const data = event.data;
      if ('error' in data) {
        setError(data.error);
        setBusy(false);
        job.terminate();
      } else if ('results' in data) {
        const best =
          data.results
            .map((r, i) => ({ i, reduction: r.before - r.after }))
            .sort((a, b) => b.reduction - a.reduction)[0]?.i ?? 0;
        setResults(data.results);
        setShown(best);
        setBusy(false);
        setProgress(1);
        setPreviewChannel(
          [...data.results[best].rows].sort((a, b) => b.before - b.after - (a.before - a.after))[0]
            ?.channel ?? 'px',
        );
        job.terminate();
      } else {
        setProgress(data.progress);
        setLabel(data.label);
      }
    };
    job.onerror = () => {
      setError('Curve analysis could not finish. Your keys are unchanged.');
      setBusy(false);
      job.terminate();
    };
    job.postMessage({
      inputs,
      options: { ...options, range: range ? [from, to] : undefined },
      end: p.end,
    } satisfies ReductionRequest);
  }
  const active = results?.[shown],
    row = active?.rows.find((r) => r.channel === previewChannel) ?? active?.rows[0],
    baked = options.fit === 'baked';
  const preview = useMemo(() => {
    if (!active || !row || !source.current) return null;
    const original = readCurve(source.current.tracks[active.id], row.channel),
      reduced = readCurve(active.track, row.channel),
      start = range ? from : original.keys[0].frame,
      end = range ? to : Math.max(start + 1, original.keys.at(-1)!.frame);
    const a = Array.from({ length: 241 }, (_, i) =>
        sampleCurve(original, start + (i / 240) * (end - start)),
      ),
      b = Array.from({ length: 241 }, (_, i) =>
        sampleCurve(reduced, start + (i / 240) * (end - start)),
      ),
      lo = Math.min(...a, ...b),
      hi = Math.max(...a, ...b),
      span = Math.max(hi - lo, 0.0001),
      y = (v: number) => 148 - ((v - lo) / span) * 122;
    const path = (vs: number[]) =>
      vs
        .map((v, i) => (i ? 'L' : 'M') + (20 + (i / 240) * 600).toFixed(2) + ',' + y(v).toFixed(2))
        .join(' ');
    return {
      before: path(a),
      after: path(b),
      keys: reduced.keys
        .filter((k) => k.frame >= start && k.frame <= end)
        .map((k) => ({
          x: 20 + ((k.frame - start) / (end - start)) * 600,
          y: y(sampleCurve(reduced, k.frame)),
        })),
      start,
      end,
    };
  }, [active, row, range, from, to]);
  return createPortal(
    <div className="modal-backdrop reducer-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal curve-reducer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reducer-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
          if (e.key === 'Tab') {
            const nodes = Array.from(
              dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ),
            ).filter((n) => n.getClientRects().length);
            if (!nodes.length) return;
            if (
              e.shiftKey &&
              (document.activeElement === nodes[0] || document.activeElement === dialog.current)
            ) {
              e.preventDefault();
              nodes.at(-1)!.focus();
            } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
              e.preventDefault();
              nodes[0].focus();
            }
          }
        }}
      >
        <header>
          <div>
            <h2 id="reducer-title">
              <Scissors size={19} />
              Reduce keyframes
            </h2>
            <p>
              {layer?.name ?? 'Base animation'} · {p.name}
            </p>
          </div>
          <button aria-label="Close keyframe reducer" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <div className="reducer-scroll">
          <div className="reducer-settings">
            <label>
              Scope
              <select
                aria-label="Reduction scope"
                value={scope}
                onChange={(e) => {
                  reset();
                  setScope(e.target.value as typeof scope);
                }}
              >
                {channel && (
                  <option value="axis">
                    {controlLabel(s.selected, p)} · {CHANNEL_LABELS[channel]}
                  </option>
                )}
                <option value="selection">Selected controls ({s.selection.length})</option>
                <option value="layer">All controls in this layer</option>
              </select>
            </label>
            <label>
              Fit
              <select
                aria-label="Reduction interpolation"
                value={options.fit}
                onChange={(e) => configure({ fit: e.target.value as ReductionOptions['fit'] })}
              >
                <option value="baked">Rebuild baked easing</option>
                <option value="auto">Preserve curve · adaptive</option>
                <option value="bezier">Bézier handles</option>
                <option value="linear">Linear segments</option>
              </select>
            </label>
          </div>
          <div className="reducer-tolerances">
            {baked ? (
              <label title="Maximum variation within a hold, as a percentage of the channel range">
                Ignore drift <small>%</small>
                <input
                  aria-label="Baked drift threshold"
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={options.drift ?? 2}
                  onChange={(e) => configure({ drift: Number(e.target.value) })}
                />
              </label>
            ) : (
              <>
                <label>
                  Position <small>cm</small>
                  <input
                    aria-label="Position error tolerance"
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={options.position}
                    onChange={(e) => configure({ position: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Rotation <small>°</small>
                  <input
                    aria-label="Rotation error tolerance"
                    type="number"
                    min="0.0001"
                    step="0.05"
                    value={options.rotation}
                    onChange={(e) => configure({ rotation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Other channels <small>%, °</small>
                  <input
                    aria-label="Other channel error tolerance"
                    type="number"
                    min="0.0001"
                    step="0.1"
                    value={options.scalar}
                    onChange={(e) => configure({ scalar: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
          </div>
          <div className="reducer-options">
            <label>
              <input
                type="checkbox"
                checked={options.skimHandles}
                disabled={options.fit === 'linear'}
                onChange={(e) => configure({ skimHandles: e.target.checked })}
              />
              Fit handle lengths
            </label>
            {options.fit !== 'linear' && (
              <label
                title={
                  range
                    ? 'Noise detection analyzes the complete curve'
                    : 'Fit an editable Blender-compatible Noise modifier when baked samples pass validation'
                }
              >
                <input
                  type="checkbox"
                  checked={options.detectNoise ?? true}
                  disabled={range}
                  onChange={(e) => configure({ detectNoise: e.target.checked })}
                />
                Detect noise
              </label>
            )}
            {options.fit !== 'linear' && (
              <label
                title={
                  range
                    ? 'Spring and bounce detection analyzes the complete curve'
                    : 'Fit editable Spring or Bounce interpolation only when the sampled motion passes validation'
                }
              >
                <input
                  type="checkbox"
                  checked={options.detectMotion ?? true}
                  disabled={range}
                  onChange={(e) => configure({ detectMotion: e.target.checked })}
                />
                Detect spring / bounce
              </label>
            )}
            {!baked && (
              <label>
                <input
                  type="checkbox"
                  checked={options.preserveExtrema}
                  onChange={(e) => configure({ preserveExtrema: e.target.checked })}
                />
                Keep peaks and holds
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={range}
                onChange={(e) => {
                  reset();
                  setRange(e.target.checked);
                }}
              />
              Frame range
            </label>
          </div>
          {range && (
            <div className="reducer-range">
              <label>
                From
                <input
                  aria-label="Reduce from frame"
                  type="number"
                  min="0"
                  max={p.end}
                  value={from}
                  onChange={(e) => {
                    reset();
                    setFrom(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                To
                <input
                  aria-label="Reduce to frame"
                  type="number"
                  min="0"
                  max={p.end}
                  value={to}
                  onChange={(e) => {
                    reset();
                    setTo(Number(e.target.value));
                  }}
                />
              </label>
            </div>
          )}
          <p className="reducer-note">
            {baked
              ? 'Rebuilds flat holds and eased motion. Drift is measured as a percentage of the channel range; measured changes are shown below.'
              : 'Each axis reduces independently. Modifiers and stepped, spring and bounce segments stay intact.'}{' '}
            {options.detectNoise && options.fit !== 'linear' && !range
              ? 'Validated noise is kept as an editable Blender-compatible Noise modifier; other curves use the current key fitting.'
              : ''}{' '}
            {options.detectMotion && options.fit !== 'linear' && !range
              ? 'Validated oscillations and impacts use editable Spring or Bounce interpolation.'
              : ''}{' '}
            Attachment switches and loop boundaries are protected.
          </p>
          {!eligible.length && (
            <p className="reducer-note">
              Select an editable control or choose another layer. To reduce a linked base pose, open
              its source animation.
            </p>
          )}
          {busy && (
            <div className="reducer-progress" role="status">
              <span>Fitting {label}…</span>
              <progress value={progress} max="1" />
              <button onClick={reset}>Cancel analysis</button>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          {results && total && (
            <div className="reducer-results">
              <div className="reducer-summary">
                <div>
                  <strong>{total.before.toLocaleString()}</strong>
                  <ArrowRight size={18} />
                  <strong>{total.after.toLocaleString()}</strong>
                  <span>axis keys</span>
                </div>
                <b>
                  {Math.round((1 - total.after / Math.max(1, total.before)) * 1000) / 10}% fewer
                </b>
              </div>
              {stale && (
                <p role="alert" className="error-message">
                  The animation changed. Analyze again to update this preview.
                </p>
              )}
              {active && row && (
                <>
                  <div className="reducer-preview-select">
                    <select
                      aria-label="Preview reduced control"
                      value={shown}
                      onChange={(e) => {
                        const i = Number(e.target.value);
                        setShown(i);
                        setPreviewChannel(results[i].rows[0].channel);
                      }}
                    >
                      {results.map((r, i) => (
                        <option value={i} key={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Preview reduced axis"
                      value={row.channel}
                      onChange={(e) => setPreviewChannel(e.target.value as Channel)}
                    >
                      {active.rows.map((r) => (
                        <option value={r.channel} key={r.channel}>
                          {CHANNEL_LABELS[r.channel]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {preview && (
                    <figure className="reducer-graph">
                      <svg
                        viewBox="0 0 640 180"
                        role="img"
                        aria-label="Original and reduced curve comparison"
                      >
                        <path
                          d={preview.before}
                          fill="none"
                          stroke="#95a4b8"
                          strokeWidth="3"
                          strokeDasharray="5 4"
                        />
                        <path
                          d={preview.after}
                          fill="none"
                          stroke={channelColor(row.channel)}
                          strokeWidth="1.8"
                        />
                        {preview.keys.map((k, i) => (
                          <rect
                            key={i}
                            x={k.x - 2.5}
                            y={k.y - 2.5}
                            width="5"
                            height="5"
                            fill="#f2cb7b"
                          />
                        ))}
                        <text x="20" y="174">
                          {preview.start}
                        </text>
                        <text x="620" y="174" textAnchor="end">
                          {preview.end}
                        </text>
                      </svg>
                      <figcaption>
                        <span>Dashed · original</span>
                        <span>Color · fitted curve</span>
                        <span>Gold · retained keys</span>
                      </figcaption>
                    </figure>
                  )}
                  <table>
                    <thead>
                      <tr>
                        <th>Axis</th>
                        <th>Keys</th>
                        <th>
                          {active.rows.some((r) => !!r.noise || !!r.motion)
                            ? 'Max deviation'
                            : baked
                              ? 'Frame deviation'
                              : 'Error bound'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.rows.map((r) => (
                        <tr key={r.channel} className={r.channel === row.channel ? 'selected' : ''}>
                          <th>
                            <button
                              style={{ color: channelColor(r.channel) }}
                              onClick={() => setPreviewChannel(r.channel)}
                            >
                              {CHANNEL_LABELS[r.channel]}
                            </button>
                          </th>
                          <td>
                            {r.before} → {r.after}
                            {noiseForRow(r) && ' · Noise modifier'}
                            {motionForRow(r) &&
                              ` · ${[
                                motionForRow(r)!.spring ? 'Spring' : '',
                                motionForRow(r)!.bounce ? 'Bounce' : '',
                              ]
                                .filter(Boolean)
                                .join(' / ')}`}
                          </td>
                          <td
                            title={
                              noiseForRow(r)
                                ? `Blender Noise modifier · fit error ${noiseForRow(r)!.maxError.toPrecision(3)} · validation error ${noiseForRow(r)!.validationError.toPrecision(3)}`
                                : motionForRow(r)
                                  ? `Inferred interpolation · fit error ${motionForRow(r)!.maxError.toPrecision(3)} · validation error ${motionForRow(r)!.validationError.toPrecision(3)}`
                                  : (r.reason ??
                                    (baked
                                      ? 'Maximum deviation at source-frame samples'
                                      : 'Conservative bound over the complete scalar curve'))
                            }
                          >
                            {noiseForRow(r)
                              ? noiseForRow(r)!.validationError.toPrecision(3) +
                                ' ' +
                                channelUnit(r.channel)
                              : motionForRow(r)
                                ? motionForRow(r)!.validationError.toPrecision(3) +
                                  ' ' +
                                  channelUnit(r.channel)
                                : r.reason
                                  ? 'Kept original'
                                  : r.bound.toPrecision(3) + ' ' + channelUnit(r.channel)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {options.detectNoise && options.fit !== 'linear' && !range && (
                    <p className="reducer-note" role="status">
                      <Check size={13} />
                      {inferredNoise
                        ? `${inferredNoise} Blender Noise modifier${inferredNoise === 1 ? '' : 's'} inferred from baked samples; validation errors are shown per axis.`
                        : 'No sampled channel met the Noise modifier validation threshold.'}
                    </p>
                  )}
                  {options.detectMotion && options.fit !== 'linear' && !range && (
                    <p className="reducer-note" role="status">
                      <Check size={13} />
                      {inferredMotion.spring || inferredMotion.bounce
                        ? `${inferredMotion.spring} Spring and ${inferredMotion.bounce} Bounce spans inferred from sampled motion; validation errors are shown per axis.`
                        : 'No sampled channel met the Spring or Bounce validation threshold.'}
                    </p>
                  )}
                  <p className="reducer-note">
                    <Check size={13} />
                    {baked ? (
                      <>
                        Frame deviation: {active.positionError.toPrecision(3)} cm ·{' '}
                        {active.rotationError.toPrecision(3)}°. Sampled between-frame deviation:{' '}
                        {active.subframePositionError?.toPrecision(3) ?? '—'} cm ·{' '}
                        {active.subframeRotationError?.toPrecision(3) ?? '—'}°.{' '}
                      </>
                    ) : (
                      <>
                        Combined transform check: {active.positionError.toPrecision(3)} cm ·{' '}
                        {active.rotationError.toPrecision(3)}°. Checked at original keys and
                        subframes.{' '}
                      </>
                    )}
                    Keys, handles, interpolation settings and modifiers remain editable.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        <footer>
          <button onClick={close}>Cancel</button>
          <button disabled={busy || !eligible.length} onClick={analyze}>
            {results ? 'Analyze again' : 'Analyze curves'}
          </button>
          <button
            className="primary"
            disabled={busy || stale || !changed.length}
            onClick={() => {
              if (
                source.current &&
                studio.applyCurveReduction(
                  source.current,
                  Object.fromEntries(changed.map((r) => [r.id, r.track])) as Partial<
                    Project['tracks']
                  >,
                )
              )
                close();
              else setError(studio.state.message);
            }}
          >
            Apply reduction
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
