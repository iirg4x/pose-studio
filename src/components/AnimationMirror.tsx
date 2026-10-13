import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Link2, Unlink, FlipHorizontal2, X, LockKeyhole } from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { controlLabel, visibleControls } from '../core/model';
import { liveMirrorLinks, mirrorDriver } from '../core/liveMirror';
import { mirrorDestination } from '../core/mirrorPose';
import { MotionPresence } from './Motion';
import type { ControlId, Project } from '../core/model';

export function MirrorDriverNotice({ project, id }: { project: Project; id: ControlId }) {
  const link = mirrorDriver(project, id);
  if (!link) return null;
  return (
    <div className="mirror-driver-notice">
      <Link2 size={16} />
      <span>
        <strong>
          {controlLabel(link.source, project)} <ArrowRight size={12} /> {controlLabel(id, project)}
        </strong>
        <small>{link.phase ? 'Half a cycle later' : 'Same frame'} · live through all layers</small>
      </span>
      <button onClick={() => studio.selectControl(link.source)}>Edit source</button>
      <button
        title="Unlink and restore original animation"
        aria-label="Unlink mirrored control"
        onClick={() => studio.unlinkMirrors([id])}
      >
        <Unlink size={16} />
      </button>
    </div>
  );
}

export function AnimationMirror() {
  const s = useStudioChrome({ frame: 'none' }),
    p = s.project!,
    links = liveMirrorLinks(p),
    [open, setOpen] = useState(false),
    [scope, setScope] = useState<'l' | 'r' | 'selected'>('l'),
    [phase, setPhase] = useState<0 | 0.5>(0.5),
    button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null),
    [placement, setPlacement] = useState({ right: 16, top: 12 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect(),
        height = panel.current?.getBoundingClientRect().height ?? 420;
      setPlacement({
        right: Math.max(
          12,
          Math.min(Math.max(12, innerWidth - 364), innerWidth - (r?.right ?? innerWidth - 12)),
        ),
        top: Math.max(
          12,
          Math.min(innerHeight - height - 12, (r?.top ?? innerHeight) - height - 8),
        ),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    const close = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node))
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => setOpen(false), [s.workspace?.activeId, p.editing]);
  const candidates =
    scope === 'selected'
      ? s.selection
      : visibleControls(p.editing, p).filter((id) => id.endsWith('_' + scope));
  const ids = candidates.filter((id) => {
    const other = mirrorDestination(id);
    return other && other !== id;
  });
  const sides = new Set(ids.map((id) => id.at(-1))),
    valid = ids.length > 0 && sides.size === 1;
  const targets = links.map((l) => l.target);
  const apply = () => {
    window.dispatchEvent(new CustomEvent('pose-link-animation-mirror', { detail: { ids, phase } }));
  };
  return (
    <>
      <button
        ref={button}
        className="animation-mirror-trigger"
        aria-label="Animation mirror"
        title="Live mirror: animate one side, drive the other"
        aria-expanded={open}
        data-linked={links.length > 0}
        onClick={() => setOpen(!open)}
      >
        <FlipHorizontal2 size={17} />
        <span>Mirror</span>
        {links.length > 0 && <i />}
      </button>
      {createPortal(
        <MotionPresence show={open}>
          <section
            ref={panel}
            className="animation-mirror-panel"
            style={placement}
            aria-label="Live animation mirror"
            role="dialog"
          >
            <header>
              <div>
                <small>Animation</small>
                <h3>Live mirror</h3>
              </div>
              <button aria-label="Close animation mirror" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="animation-mirror-body">
              <p>Animate one side. The opposite side follows your edits.</p>
              <label>
                Source
                <select
                  aria-label="Mirror source"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="l">Left side → Right side</option>
                  <option value="r">Right side → Left side</option>
                  <option value="selected">Selected controls → Opposite</option>
                </select>
              </label>
              <fieldset className="mirror-timing">
                <legend>Timing</legend>
                <button aria-pressed={phase === 0.5} onClick={() => setPhase(0.5)}>
                  <strong>½ cycle</strong>
                  <small>Alternating walk</small>
                </button>
                <button aria-pressed={phase === 0} onClick={() => setPhase(0)}>
                  <strong>Same frame</strong>
                  <small>Symmetric motion</small>
                </button>
              </fieldset>
              <div className="mirror-link-description">
                <LockKeyhole size={16} />
                <span>
                  {valid
                    ? ids.length + ' opposite controls will be linked and protected.'
                    : 'Select controls from one side.'}
                  <small>Across all layers. Unlink restores their original animation.</small>
                </span>
              </div>
              {links.length > 0 && (
                <div className="mirror-existing">
                  <span>
                    <Link2 size={15} />
                    {links.length} controls linked
                  </span>
                  <button onClick={() => studio.setMirrorPhase(targets, phase)}>
                    Apply timing
                  </button>
                  <button onClick={() => studio.unlinkMirrors(targets)}>
                    <Unlink size={14} />
                    Unlink all
                  </button>
                </div>
              )}
            </div>
            <footer>
              <button className="mirror-link-primary" disabled={!valid} onClick={apply}>
                <Link2 size={17} />
                Link opposite side
              </button>
            </footer>
          </section>
        </MotionPresence>,
        document.body,
      )}
    </>
  );
}
