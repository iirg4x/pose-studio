import { mirrorDriver } from '../core/liveMirror';
import { MirrorDriverNotice } from './AnimationMirror';
import { FootPoseTools } from './FootPoseTools';
import { MotionPresence, Collapse } from './Motion';
import { useEffect, useRef, useState, useId, type RefObject } from 'react';
import {
  ArrowDownToLine,
  Copy,
  ClipboardPaste,
  FlipHorizontal2,
  Move,
  Move3D,
  RotateCw,
  RotateCcw,
  Layers,
  ChevronDown,
  Check,
  Plus,
  Pin,
  Diamond,
  SlidersHorizontal,
  MoreHorizontal,
} from 'lucide-react';
import { useStudioChrome, usePresence } from '../hooks';
import { CONTROLS } from '../core/controls';
import { mirrorDestination } from '../core/mirrorPose';
import { studio } from '../core/store';
import { controlLabel } from '../core/model';
import { activeAnimationLayer, editLayerAllowed } from '../core/layers';
import { consumeSceneDismiss, useTransientPopover } from '../hooks/transientPopover';
import { TransformOptions } from './TransformOptions';
import './controller-ribbon.css';

type SelectionAnchorDetail = {
  x: number;
  y: number;
  visible: boolean;
  /** Projected handle/gizmo bounds in the scene's local pixel space. */
  gizmoBounds?: { left: number; top: number; right: number; bottom: number };
  dragging?: boolean;
  playing?: boolean;
  scrubbing?: boolean;
};

/**
 * Keeps the contextual ribbon attached to the controller projected by the
 * scene. The scene publishes this as an imperative event so playback and
 * camera movement do not wake the React chrome on every frame.
 */
function useControllerRibbonAnchor(
  ref: RefObject<HTMLElement | null>,
  onCompactChange?: (compact: boolean) => void,
  enabled = true,
) {
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) {
      refreshRef.current = () => {};
      return;
    }
    let raf = 0;
    let pendingDetail: SelectionAnchorDetail | undefined;
    let latestDetail: SelectionAnchorDetail | undefined;
    let lastLayoutRead = 0;
    let layout:
      | {
          parent: HTMLElement;
          rect: DOMRect;
          width: number;
          height: number;
          ribbonWidth: number;
          ribbonHeight: number;
          blockers: { left: number; top: number; right: number; bottom: number }[];
        }
      | undefined;
    // A menu may open while the pointer is over the ribbon. Placement is
    // normally frozen in that state to prevent the menu chasing the pointer,
    // but an inspector/timeline opening must still force a collision pass.
    let layoutDirty = true;
    let pointerNearRibbon = false;
    let focusedInRibbon = false;
    let forcePlacement = false;
    const readLayout = (parent: HTMLElement, now: number) => {
      if (!layoutDirty && layout && now - lastLayoutRead < 150 && layout.parent === parent)
        return layout;
      const rect = parent.getBoundingClientRect();
      const gutter = 12;
      const blockers = [
        ...document.querySelectorAll<HTMLElement>(
          '.timeline, .tablet-sheet, .inspector, .retarget-inspector, .titlebar, .touch-pose-rail, .touch-utility-rail, .touch-panel-rail, .touch-transport, .time-slider, .desktop-context-cluster, .desktop-utilities',
        ),
      ]
        .filter((el) => el.getAttribute('aria-hidden') !== 'true')
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { r, el };
        })
        .filter(({ r, el }) => {
          const style = getComputedStyle(el);
          return (
            style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0
          );
        })
        .map(({ r }) => ({
          left: r.left - rect.left - gutter,
          top: r.top - rect.top - gutter,
          right: r.right - rect.left + gutter,
          bottom: r.bottom - rect.top + gutter,
        }));
      lastLayoutRead = now;
      layout = {
        parent,
        rect,
        width: parent.clientWidth,
        height: parent.clientHeight,
        ribbonWidth: ref.current?.offsetWidth || 320,
        ribbonHeight: ref.current?.offsetHeight || 64,
        blockers,
      };
      layoutDirty = false;
      return layout;
    };
    const place = (detail: SelectionAnchorDetail) => {
      const ribbon = ref.current;
      if (!ribbon) return;
      // Fine-pointer desktop keeps the selected-control actions in a stable
      // lower viewport dock. The dock still follows the same selection and
      // activity visibility contract, while coarse pointers retain the
      // controller-adjacent placement below.
      const desktopDocked =
        (window.matchMedia?.('(pointer: fine)').matches ?? false) &&
        ribbon.closest('.app.desktop-workspace') !== null;
      const hidden =
        (!detail.visible && !desktopDocked) ||
        !!detail.dragging ||
        !!detail.playing ||
        !!detail.scrubbing;
      if (hidden) {
        ribbon.dataset.anchorVisible = 'false';
        ribbon.dataset.anchorHidden = 'true';
        pointerNearRibbon = false;
        return;
      }
      if (desktopDocked) {
        // Remove any inline anchor coordinates left by a prior coarse-pointer
        // layout before the dock's CSS coordinates take over.
        ribbon.style.removeProperty('left');
        ribbon.style.removeProperty('top');
        ribbon.style.removeProperty('--ribbon-anchor-x');
        ribbon.style.removeProperty('--ribbon-anchor-y');
        if (ribbon.dataset.ribbonDensity !== 'full') {
          ribbon.dataset.ribbonDensity = 'full';
          onCompactChange?.(false);
        }
        ribbon.dataset.anchorVisible = 'true';
        ribbon.dataset.anchorHidden = 'false';
        ribbon.dataset.anchorSide = 'docked';
        return;
      }
      const forced = forcePlacement;
      forcePlacement = false;
      const canFreeze = ribbon.dataset.anchorHidden !== 'true';
      if ((pointerNearRibbon || focusedInRibbon) && canFreeze && !forced && !layoutDirty) return;

      const parent = ribbon.offsetParent as HTMLElement | null;
      if (!parent) return;
      const now = performance.now();
      const wasLayoutDirty = layoutDirty;
      let metrics = readLayout(parent, now);
      // The pointer/focus freeze protects a menu from jumping as it is used.
      // It must not preserve a placement that has become occluded by another
      // editor surface, such as the inspector opening from Properties.
      if ((pointerNearRibbon || focusedInRibbon) && canFreeze && !wasLayoutDirty && !forced) return;
      const gutter = 12;
      const anchorX = detail.x;
      const anchorY = detail.y;
      const gizmo = detail.gizmoBounds;
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      const anchorGap = gizmo ? (coarse ? 16 : 12) : 56;
      const gizmoCenterX = gizmo ? (gizmo.left + gizmo.right) / 2 : anchorX;
      const gizmoCenterY = gizmo ? (gizmo.top + gizmo.bottom) / 2 : anchorY;
      const placementFor = (candidateMetrics: typeof metrics) => {
        const width = candidateMetrics.ribbonWidth;
        const height = candidateMetrics.ribbonHeight;
        const maxX = Math.max(gutter, candidateMetrics.width - width - gutter);
        const maxY = Math.max(gutter, candidateMetrics.height - height - gutter);
        const candidates = [
          {
            x: (gizmo?.right ?? anchorX) + anchorGap,
            y: gizmoCenterY - height / 2,
            side: 'right',
          },
          {
            x: (gizmo?.left ?? anchorX) - width - anchorGap,
            y: gizmoCenterY - height / 2,
            side: 'left',
          },
          {
            x: gizmoCenterX - width / 2,
            y: (gizmo?.bottom ?? anchorY) + anchorGap,
            side: 'below',
          },
          {
            x: gizmoCenterX - width / 2,
            y: (gizmo?.top ?? anchorY) - height - anchorGap,
            side: 'above',
          },
        ];
        const anchorBlocker = gizmo
          ? {
              left: gizmo.left - anchorGap,
              top: gizmo.top - anchorGap,
              right: gizmo.right + anchorGap,
              bottom: gizmo.bottom + anchorGap,
            }
          : {
              left: anchorX - 52,
              top: anchorY - 52,
              right: anchorX + 52,
              bottom: anchorY + 52,
            };
        const fits = (x: number, y: number) => {
          const left = Math.max(gutter, Math.min(maxX, x));
          const top = Math.max(gutter, Math.min(maxY, y));
          return ![...candidateMetrics.blockers, anchorBlocker].some(
            (b) =>
              left < b.right && left + width > b.left && top < b.bottom && top + height > b.top,
          );
        };
        return { candidate: candidates.find((c) => fits(c.x, c.y)), candidates, maxX, maxY };
      };
      // Once a constrained ribbon has been opened, retry the full layout only
      // after a real surface/viewport change. This lets closing the timeline
      // or inspector restore the normal two-row ribbon without oscillating on
      // every render at a genuinely small viewport.
      if (
        ribbon.dataset.ribbonDensity === 'compact' &&
        ribbon.dataset.moreOpen !== 'true' &&
        (wasLayoutDirty || forced)
      ) {
        ribbon.dataset.ribbonDensity = 'full';
        layout = undefined;
        lastLayoutRead = 0;
        layoutDirty = true;
        const fullMetrics = readLayout(parent, now);
        const fullPlacement = placementFor(fullMetrics);
        if (fullPlacement.candidate) {
          metrics = fullMetrics;
          onCompactChange?.(false);
        } else {
          ribbon.dataset.ribbonDensity = 'compact';
          layout = undefined;
          lastLayoutRead = 0;
          layoutDirty = true;
          metrics = readLayout(parent, now);
        }
      }
      const { candidate, candidates, maxX, maxY } = placementFor(metrics);
      // A narrow viewport can have no free area for the full command ribbon.
      // Switch to the compact one-row affordance and measure that layout on
      // the next frame. The compact menu keeps every action reachable through
      // More instead of hiding an otherwise valid selected controller.
      if (!candidate) {
        if (ribbon.dataset.ribbonDensity !== 'compact') {
          ribbon.dataset.ribbonDensity = 'compact';
          layout = undefined;
          lastLayoutRead = 0;
          layoutDirty = true;
          onCompactChange?.(true);
          schedulePlacement(detail);
          return;
        }
        // If another editor surface occupies every preferred slot, retain a
        // visible compact affordance at the nearest clamped position. This is
        // preferable to making the selected controller appear unresponsive.
        const fallback = candidates[0];
        const left = Math.max(gutter, Math.min(maxX, fallback.x));
        const top = Math.max(gutter, Math.min(maxY, fallback.y));
        ribbon.style.left = `${left}px`;
        ribbon.style.top = `${top}px`;
        ribbon.dataset.anchorVisible = 'true';
        ribbon.dataset.anchorHidden = 'false';
        ribbon.dataset.anchorSide = fallback.side;
        ribbon.style.setProperty('--ribbon-anchor-x', `${anchorX - left}px`);
        ribbon.style.setProperty('--ribbon-anchor-y', `${anchorY - top}px`);
        return;
      }
      const left = Math.max(gutter, Math.min(maxX, candidate.x));
      const top = Math.max(gutter, Math.min(maxY, candidate.y));
      ribbon.style.left = `${left}px`;
      ribbon.style.top = `${top}px`;
      ribbon.dataset.anchorVisible = 'true';
      ribbon.dataset.anchorHidden = 'false';
      ribbon.dataset.anchorSide = candidate.side;
      ribbon.style.setProperty('--ribbon-anchor-x', `${anchorX - left}px`);
      ribbon.style.setProperty('--ribbon-anchor-y', `${anchorY - top}px`);
    };
    const schedulePlacement = (detail: SelectionAnchorDetail) => {
      pendingDetail = detail;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = pendingDetail;
        pendingDetail = undefined;
        if (next) place(next);
      });
    };
    const forceLatestPlacement = () => {
      forcePlacement = true;
      onResize();
      if (latestDetail) {
        place(latestDetail);
        return;
      }
      // The scene can be idle and therefore have no fresh anchor event. The
      // stem offsets preserve the last projected anchor so a newly opened
      // inspector can still trigger a collision pass.
      const ribbon = ref.current;
      if (!ribbon) return;
      const left = Number.parseFloat(ribbon.style.left) || 0;
      const top = Number.parseFloat(ribbon.style.top) || 0;
      const styles = getComputedStyle(ribbon);
      const anchorX = Number.parseFloat(styles.getPropertyValue('--ribbon-anchor-x'));
      const anchorY = Number.parseFloat(styles.getPropertyValue('--ribbon-anchor-y'));
      if (Number.isFinite(anchorX) && Number.isFinite(anchorY))
        place({
          x: left + anchorX,
          y: top + anchorY,
          visible: true,
          dragging: false,
          playing: false,
          scrubbing: false,
        });
    };
    const onPointerMove = (event: PointerEvent) => {
      const ribbon = ref.current;
      if (!ribbon) return;
      const r = ribbon.getBoundingClientRect();
      const margin = 20;
      pointerNearRibbon =
        event.clientX >= r.left - margin &&
        event.clientX <= r.right + margin &&
        event.clientY >= r.top - margin &&
        event.clientY <= r.bottom + margin;
    };
    const onFocus = () => {
      focusedInRibbon = !!ref.current?.contains(document.activeElement);
    };
    const onResize = () => {
      layout = undefined;
      lastLayoutRead = 0;
      layoutDirty = true;
    };
    const blockerSelector = '.timeline, .tablet-sheet, .inspector, .retarget-inspector';
    const layoutHostSelector = '.animate-layout, .area-side, .side-content';
    const isBlockerNode = (node: Node | null) => {
      if (!(node instanceof HTMLElement)) return false;
      return node.matches(blockerSelector) || !!node.querySelector(blockerSelector);
    };
    const mutationObserver = new MutationObserver((records) => {
      const ribbon = ref.current;
      const relevant = records.some((record) => {
        // Moving the ribbon itself changes its style attribute; that mutation
        // must never invalidate the cache or cause an animation-frame layout
        // read loop.
        if (ribbon && (record.target === ribbon || ribbon.contains(record.target))) return false;
        if (record.type === 'attributes') {
          return (
            (record.target instanceof HTMLElement && record.target.matches(blockerSelector)) ||
            (record.target instanceof HTMLElement && record.target.matches(layoutHostSelector))
          );
        }
        if (
          record.type === 'childList' &&
          record.target instanceof HTMLElement &&
          record.target.matches(layoutHostSelector)
        )
          return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) => isBlockerNode(node) || node === ribbon,
        );
      });
      if (relevant) {
        onResize();
        observeSurfaces();
        if (latestDetail) schedulePlacement(latestDetail);
      }
    });
    const sizeObserver = new ResizeObserver(() => {
      onResize();
      if (latestDetail) schedulePlacement(latestDetail);
    });
    const observeSurfaces = () => {
      sizeObserver.disconnect();
      if (ref.current) sizeObserver.observe(ref.current);
      document.querySelectorAll(blockerSelector).forEach((el) => sizeObserver.observe(el));
    };
    observeSurfaces();
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    let surfaceTimers: number[] = [];
    const onPropertiesRequest = () => {
      // The properties host is mounted by the parent in response to this
      // event. Recheck after that commit as well as immediately; otherwise a
      // focused ribbon can keep its pre-inspector placement for one frame.
      forcePlacement = true;
      forceLatestPlacement();
      surfaceTimers.push(
        window.setTimeout(forceLatestPlacement, 0),
        window.setTimeout(forceLatestPlacement, 120),
      );
    };
    refreshRef.current = onPropertiesRequest;
    window.addEventListener('pose-open-properties', onPropertiesRequest);
    const onAnchor = (event: Event) => {
      const detail = (event as CustomEvent<SelectionAnchorDetail>).detail;
      if (!detail) return;
      // Keep one queued frame and replace its payload. Cancelling the queued
      // frame on every scene RAF can starve this callback because the scene
      // publishes immediately before the next paint. That left playback
      // ribbons visible even though every event carried playing:true.
      latestDetail = detail;
      schedulePlacement(detail);
    };
    window.addEventListener('pose-selection-anchor', onAnchor);
    // The scene publishes anchors on demand as well as during camera updates.
    // Request one after this listener is ready so a newly mounted ribbon does
    // not wait for the next pointer/camera event before becoming usable.
    window.dispatchEvent(new Event('pose-request-selection-anchor'));
    const anchorRequestFrame = requestAnimationFrame(() =>
      window.dispatchEvent(new Event('pose-request-selection-anchor')),
    );
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('focusin', onFocus);
    window.addEventListener('focusout', onFocus);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(anchorRequestFrame);
      window.removeEventListener('pose-selection-anchor', onAnchor);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('focusout', onFocus);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pose-open-properties', onPropertiesRequest);
      surfaceTimers.forEach((timer) => window.clearTimeout(timer));
      mutationObserver.disconnect();
      sizeObserver.disconnect();
      refreshRef.current = () => {};
    };
  }, [ref, onCompactChange, enabled]);
  return () => refreshRef.current();
}

export function ActiveLayer() {
  const menuId = useId(),
    s = useStudioChrome({ frame: 'none' }),
    [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popover = useTransientPopover({
      owner: 'active-layer',
      open,
      onClose: () => setOpen(false),
      rootRef: root,
      triggerRef: trigger,
    });
  const p = s.project;
  if (!p || s.retargetMode) return null;
  const layer = activeAnimationLayer(p),
    name = layer?.name ?? (p.bodyBase ? 'Animation corrections' : 'Base animation');
  return (
    <div className="active-layer-control" ref={root} data-editor-overlay>
      <button
        ref={trigger}
        className="desktop-header-trigger active-layer-trigger"
        aria-label={'Active layer: ' + name}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open) setOpen(false);
          else {
            popover.announce();
            setOpen(true);
          }
        }}
      >
        <small className="context-flair attached-flair">Editing layer</small>
        <Layers size={18} />
        <strong>{name}</strong>
        <ChevronDown className="header-chevron" size={15} />
      </button>
      <MotionPresence show={open}>
        <section id={menuId} className="active-layer-menu" aria-label="Animation layers">
          <header className="context-flair">Layers</header>
          {[
            ...(p.layers ?? [
              { id: 'base', name, kind: 'base', static: false, enabled: true, weight: 1 },
            ]),
          ]
            .reverse()
            .map((l) => (
              <button
                key={l.id}
                aria-pressed={l.id === (layer?.id ?? 'base')}
                onClick={() => {
                  if (p.layers) studio.selectLayer(l.id);
                  setOpen(false);
                }}
              >
                {l.kind === 'pose' || l.static ? <Pin size={16} /> : <Diamond size={16} />}
                <span>
                  <strong>{l.name}</strong>
                  <small>
                    {l.kind === 'pose' || l.static
                      ? 'Pose · whole animation'
                      : l.kind === 'base'
                        ? 'Base animation'
                        : 'Adjustment · keyed'}
                    {!l.enabled ? ' · hidden' : l.weight === 0 ? ' · zero weight' : ''}
                  </small>
                </span>
                {l.id === (layer?.id ?? 'base') && <Check size={16} />}
              </button>
            ))}
          <footer>
            <button
              onClick={() => {
                studio.addLayer('pose');
                setOpen(false);
              }}
            >
              <Plus size={16} />
              Pose layer
            </button>
            <button
              onClick={() => {
                studio.addLayer('additive');
                setOpen(false);
              }}
            >
              <Plus size={16} />
              Keyed layer
            </button>
          </footer>
        </section>
      </MotionPresence>
    </div>
  );
}
export function PoseActions({
  mirror,
  pasteMirrored,
  presentation = 'ribbon',
}: {
  mirror: () => void;
  pasteMirrored: () => void;
  timeline?: boolean;
  presentation?: 'ribbon' | 'rail';
}) {
  const ribbon = useRef<HTMLElement>(null);
  const morePanelId = useId();
  const [footToolsOpen, setFootToolsOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const refreshRibbon = useControllerRibbonAnchor(ribbon, setCompactMode, presentation !== 'rail');
  const live = useStudioChrome({ frame: 'none' }),
    visible = !!live.project && !!live.selection.length && !live.gameView && !live.retargetMode;
  const presence = usePresence(visible ? live : null),
    s = presence.value,
    p = s?.project;
  useEffect(() => {
    // Foot tools can grow the full ribbon past the available edge slot. Keep
    // the expanded tools reachable when the anchor switches to compact mode.
    if (compactMode && footToolsOpen) setMoreOpen(true);
    // A fine-pointer desktop uses the full docked ribbon, so do not leave the
    // compact More sheet state behind when the layout returns to full density.
    if (!compactMode && moreOpen) setMoreOpen(false);
  }, [compactMode, footToolsOpen, moreOpen]);
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // The TransformOptions menu is portaled to body. Treat it as part of
      // More so selecting orientation/pivot never dismisses its parent menu.
      if (
        ribbon.current?.contains(target) ||
        target?.closest('.transform-popover') ||
        document.querySelector('.transform-options button[aria-expanded="true"]')
      )
        return;
      // Consume only scene-canvas presses while dismissing. Other panels keep
      // receiving their own pointer event so they can open immediately.
      consumeSceneDismiss(event);
      setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const transformOpen =
        !!ribbon.current?.querySelector('.transform-options button[aria-expanded="true"]') ||
        !!document.querySelector('.transform-popover:not([data-state="closing"])');
      // Let the nested transform menu consume Escape first. Its own capture
      // listener closes the portal and restores focus to its trigger; a second
      // Escape then closes More, even though focus is back on that trigger.
      if (transformOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [moreOpen]);
  if (!s || !p) return null;
  const count = s.selection.length,
    editable = count > 0 && s.selection.some((id) => editLayerAllowed(p, id)),
    mirrored = s.selection.some((id) => !!mirrorDestination(id)),
    mirrorNotice = s.selection.length === 1 && mirrorDriver(p, s.selected);
  if (presentation === 'rail') {
    return (
      <section
        data-motion="context"
        data-state={presence.exiting ? 'closing' : 'open'}
        inert={presence.exiting || undefined}
        aria-hidden={presence.exiting || undefined}
        ref={ribbon}
        className="controller-ribbon controller-ribbon-rail"
        aria-label="Selected pose tools"
        data-editor-overlay
      >
        {mirrorNotice ? (
          <MirrorDriverNotice project={p} id={s.selected} />
        ) : (
          <div className="controller-rail-body">
            <div className="controller-rail-group" role="group" aria-label="Transform mode">
              <button
                type="button"
                aria-label="Move controls"
                aria-pressed={s.mode === 'translate'}
                title="Move controls"
                onClick={() => studio.patch({ mode: 'translate' })}
              >
                <Move3D size={17} />
                <span>Move</span>
              </button>
              <button
                type="button"
                aria-label="Rotate controls"
                aria-pressed={s.mode === 'rotate'}
                title="Rotate controls"
                onClick={() => studio.patch({ mode: 'rotate' })}
              >
                <RotateCw size={17} />
                <span>Rotate</span>
              </button>
            </div>
            <div
              className="controller-rail-group controller-rail-transform"
              role="group"
              aria-label="Transform options"
            >
              <TransformOptions compact />
            </div>
            <div className="controller-rail-group" role="group" aria-label="Pose clipboard">
              <button
                type="button"
                aria-label="Copy pose"
                title="Copy pose"
                disabled={!count}
                onClick={() => studio.copySelectedPose()}
              >
                <Copy size={17} />
                <span>Copy</span>
              </button>
              {s.clipboard && (
                <button
                  type="button"
                  aria-label="Paste pose"
                  title="Paste pose"
                  disabled={!editable}
                  onClick={() => studio.pastePose(s.clipboard!, true)}
                >
                  <ClipboardPaste size={17} />
                  <span>Paste</span>
                </button>
              )}
              {s.clipboard &&
                Object.keys(s.clipboard.poses).some(
                  (id) => !!mirrorDestination(id as keyof typeof s.clipboard.poses),
                ) && (
                  <button
                    type="button"
                    aria-label="Paste mirrored pose"
                    title="Paste mirrored pose"
                    disabled={!editable || s.clipboard.layer !== p.editing}
                    onClick={pasteMirrored}
                  >
                    <FlipHorizontal2 size={17} />
                    <span>Paste mirrored</span>
                  </button>
                )}
              {mirrored && (
                <button
                  type="button"
                  aria-label="Mirror pose to opposite side"
                  title="Mirror selected controls to the opposite side; selecting both sides swaps them"
                  disabled={!editable}
                  onClick={mirror}
                >
                  <FlipHorizontal2 size={17} />
                  <span>Mirror</span>
                </button>
              )}
            </div>
            <div
              className="controller-rail-group"
              role="group"
              aria-label="Pose reset and grounding"
            >
              {s.selection.some((id) => CONTROLS[id].kind !== 'pivot') && (
                <button
                  type="button"
                  aria-label="Reset location"
                  title="Reset selected controllers to their rest location"
                  disabled={!editable}
                  onClick={() => studio.resetSelected('location')}
                >
                  <Move size={17} />
                  <span>Reset location</span>
                </button>
              )}
              <button
                type="button"
                aria-label="Reset rotation"
                title="Reset selected controllers to their rest rotation"
                disabled={!editable}
                onClick={() => studio.resetSelected('rotation')}
              >
                <RotateCcw size={17} />
                <span>Reset rotation</span>
              </button>
              {s.selection.some((id) => id !== 'camera') && (
                <button
                  type="button"
                  aria-label="Ground and key selected controls"
                  title="Place on the floor and key this pose"
                  disabled={!editable}
                  onClick={() => window.dispatchEvent(new Event('pose-ground-selection'))}
                >
                  <ArrowDownToLine size={17} />
                  <span>Ground</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    );
  }
  return (
    <section
      data-motion="context"
      data-state={presence.exiting ? 'closing' : 'open'}
      inert={presence.exiting || undefined}
      aria-hidden={presence.exiting || undefined}
      ref={ribbon}
      className="controller-ribbon"
      aria-label="Selected pose actions"
      data-editor-overlay
      data-ribbon-density={compactMode ? 'compact' : 'full'}
      data-more-open={moreOpen ? 'true' : undefined}
    >
      {mirrorNotice ? (
        <MirrorDriverNotice project={p} id={s.selected} />
      ) : (
        <>
          <div
            className="controller-ribbon-compact-row"
            role="group"
            aria-label="Quick pose actions"
          >
            <div
              className="pose-action-context context-flair"
              title={
                (s.selection.length === 1
                  ? controlLabel(s.selected, p)
                  : s.selection.length + ' controls') +
                ' · ' +
                (s.autoKey ? 'Auto key on' : 'Unkeyed preview')
              }
            >
              <i
                className={s.autoKey ? 'auto-key-on' : 'unkeyed-preview'}
                role="img"
                aria-label={s.autoKey ? 'Auto key on' : 'Unkeyed preview'}
              />
              <strong>
                {s.selection.length === 1
                  ? controlLabel(s.selected, p)
                  : s.selection.length + ' controls'}
              </strong>
            </div>
            <button
              className="controller-ribbon-compact-mode"
              aria-label="Move controls"
              aria-pressed={s.mode === 'translate'}
              title="Move controls"
              onClick={() => studio.patch({ mode: 'translate' })}
            >
              <Move3D size={16} />
              <span>Move</span>
            </button>
            <button
              className="controller-ribbon-compact-mode"
              aria-label="Rotate controls"
              aria-pressed={s.mode === 'rotate'}
              title="Rotate controls"
              onClick={() => studio.patch({ mode: 'rotate' })}
            >
              <RotateCw size={16} />
              <span>Rotate</span>
            </button>
            <button
              className="controller-ribbon-properties"
              aria-label="Open control properties"
              title="Control properties"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('pose-open-properties', { detail: { ids: s.selection } }),
                );
                refreshRibbon();
              }}
            >
              <SlidersHorizontal size={16} />
              <span>Properties</span>
            </button>
            <button
              className="controller-ribbon-more"
              aria-label={moreOpen ? 'Close more pose actions' : 'More pose actions'}
              aria-expanded={moreOpen}
              aria-controls={morePanelId}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal size={18} />
              <span>More</span>
            </button>
          </div>
          <header className="controller-ribbon-header">
            <div
              className="pose-action-context context-flair"
              title={
                (s.selection.length === 1
                  ? controlLabel(s.selected, p)
                  : s.selection.length + ' controls') +
                ' · ' +
                (s.autoKey ? 'Auto key on' : 'Unkeyed preview')
              }
            >
              <i
                className={s.autoKey ? 'auto-key-on' : 'unkeyed-preview'}
                role="img"
                aria-label={s.autoKey ? 'Auto key on' : 'Unkeyed preview'}
              />
              <strong>
                {s.selection.length === 1
                  ? controlLabel(s.selected, p)
                  : s.selection.length + ' controls'}
              </strong>
            </div>
            <button
              className="controller-ribbon-properties"
              aria-label="Open control properties"
              title="Control properties"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('pose-open-properties', { detail: { ids: s.selection } }),
                );
                refreshRibbon();
              }}
            >
              <SlidersHorizontal size={17} />
              <span>Properties</span>
            </button>
          </header>
          <div
            id={morePanelId}
            className="controller-ribbon-more-panel"
            role={moreOpen ? 'dialog' : undefined}
            aria-label="More pose actions"
          >
            <div className="controller-ribbon-body">
              <div className="controller-ribbon-primary">
                <div className="controller-ribbon-modes" role="group" aria-label="Transform mode">
                  <button
                    className="controller-ribbon-mode"
                    aria-label="Move controls"
                    aria-pressed={s.mode === 'translate'}
                    title="Move controls"
                    onClick={() => studio.patch({ mode: 'translate' })}
                  >
                    <Move3D size={17} />
                    <span>Move</span>
                  </button>
                  <button
                    className="controller-ribbon-mode"
                    aria-label="Rotate controls"
                    aria-pressed={s.mode === 'rotate'}
                    title="Rotate controls"
                    onClick={() => studio.patch({ mode: 'rotate' })}
                  >
                    <RotateCw size={17} />
                    <span>Rotate</span>
                  </button>
                </div>
                <div className="controller-ribbon-transform">
                  <TransformOptions compact />
                </div>
              </div>
              <div className="controller-ribbon-commands" role="group" aria-label="Pose commands">
                <div
                  className="controller-ribbon-command-group controller-ribbon-command-group-clipboard"
                  role="group"
                  aria-label="Clipboard and mirror commands"
                >
                  <button
                    aria-label="Copy pose"
                    title="Copy pose"
                    disabled={!count}
                    onClick={() => studio.copySelectedPose()}
                  >
                    <Copy size={18} />
                    <span>Copy</span>
                  </button>
                  {s.clipboard && (
                    <button
                      aria-label="Paste pose"
                      title="Paste pose"
                      disabled={!s.clipboard || !editable}
                      onClick={() => studio.pastePose(s.clipboard, true)}
                    >
                      <ClipboardPaste size={18} />
                      <span>Paste</span>
                    </button>
                  )}
                  {s.clipboard &&
                    Object.keys(s.clipboard.poses).some(
                      (id) => !!mirrorDestination(id as keyof typeof s.clipboard.poses),
                    ) && (
                      <button
                        aria-label="Paste mirrored pose"
                        title="Paste mirrored pose"
                        disabled={!editable || s.clipboard.layer !== p.editing}
                        onClick={pasteMirrored}
                      >
                        <FlipHorizontal2 size={18} />
                        <span>Paste mirrored</span>
                      </button>
                    )}
                  {mirrored && (
                    <button
                      aria-label="Mirror pose to opposite side"
                      title="Mirror selected controls to the opposite side; selecting both sides swaps them"
                      disabled={!mirrored || !editable}
                      onClick={mirror}
                    >
                      <FlipHorizontal2 size={18} />
                      <span>Mirror</span>
                    </button>
                  )}
                </div>
                <div
                  className="controller-ribbon-command-group controller-ribbon-command-group-reset"
                  role="group"
                  aria-label="Reset and grounding commands"
                >
                  {s.selection.some((id) => CONTROLS[id].kind !== 'pivot') && (
                    <button
                      type="button"
                      className="pose-reset-command"
                      title="Reset selected controllers to their rest location"
                      aria-label="Reset location"
                      disabled={!editable}
                      onClick={() => studio.resetSelected('location')}
                    >
                      <Move size={18} />
                      <span>Reset location</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="pose-reset-command"
                    title="Reset selected controllers to their rest rotation"
                    aria-label="Reset rotation"
                    disabled={!editable}
                    onClick={() => studio.resetSelected('rotation')}
                  >
                    <RotateCcw size={18} />
                    <span>Reset rotation</span>
                  </button>
                  {s.selection.some((id) => id !== 'camera') && (
                    <button
                      type="button"
                      aria-label="Ground and key selected controls"
                      title="Place on the floor and key this pose"
                      disabled={!editable}
                      onClick={() => window.dispatchEvent(new Event('pose-ground-selection'))}
                    >
                      <ArrowDownToLine size={18} />
                      <span>Ground</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
            {s.selection.length === 1 && /^(foot|ankle|toe|heel|ball)_[lr]$/.test(s.selected) && (
              <>
                <button
                  className="controller-ribbon-foot-disclosure"
                  aria-expanded={footToolsOpen}
                  onClick={() => {
                    setFootToolsOpen(!footToolsOpen);
                    requestAnimationFrame(refreshRibbon);
                  }}
                >
                  Foot contacts & pivots
                  <ChevronDown size={16} />
                </button>
                <Collapse open={footToolsOpen}>
                  <FootPoseTools id={s.selected} />
                </Collapse>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
