import { discardProjectRecoveryRecords } from './platform/projectDocuments';
import { useCompactViewport } from './hooks/compactViewport';
import { FailureNotice } from './components/FailureNotice';
import { PoseActions } from './components/PoseActions';
import { reportFailure } from './platform/feedback';
import { RecoveryNotice } from './components/RecoveryNotice';
import { UpdateProgress } from './components/UpdateProgress';
import { useModalFocus } from './hooks/modalFocus';
import {
  configurePwaUpdate,
  initializePwa,
  notifyPwaIdle,
  appInstallSnapshot,
} from './platform/pwa';
import { getRecoveryState, readRecovery, subscribeRecoveryState } from './platform/storage';
import { useSurfaceOcclusion } from './hooks/surfaceOcclusion';
import { DesktopWorkspace, useDesktopLayout } from './components/DesktopWorkspace';
import { MenuBar, ContextMenu } from './components/MenuBar';
import type { Menu } from './components/MenuBar';
import { PreviewModel } from './components/PreviewModel';
import { InstallStudio } from './components/InstallStudio';
import { PwaUpdateIndicator } from './components/PwaUpdateIndicator';
import { isPwaBuild } from './platform/pwa';
import { MotionPresence, MotionOverlay } from './components/Motion';
import { isAndroid as nativeAndroid, portablePlatform } from './platform/storage';
import { decodeProject } from '../shared/project-codec.mjs';
import { TabletWorkspace, TabletDrawer, TabletSettings } from './components/TabletWorkspace';
import type { TabletPanel } from './components/TabletWorkspace';
import { isTouch as isAndroid, writeRecovery } from './platform/storage';
import { Updates } from './components/Updates';
import { AndroidExportDialog } from './components/AndroidExportDialog';
import { CharacterPanel, RetargetInspector, RetargetExport } from './components/RetargetPanel';
import { RecordingDialog } from './components/RecordingDialog';
import { ProjectLoading } from './components/ProjectLoading';
import { useProjectFile } from './components/useProjectFile';
import { WindowControls } from './components/WindowControls';
import { KeyframeMenu } from './components/KeyframeMenu';
import { usePanelSizes } from './components/usePanelSizes';
import { RecentProjects } from './components/RecentProjects';
import { NewActionDialog } from './components/NewActionDialog';
import type { RigLayer } from './core/model';
import { ControlList } from './components/ControlList';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Waypoints,
  Video,
  Upload,
  Check,
  LoaderCircle,
  Save,
  FolderOpen,
  FilePlus,
  X,
} from 'lucide-react';
import { studio } from './core/store';
import { useStudioChrome, usePresence } from './hooks';
import {
  claimTransientPopover,
  consumeSceneDismiss,
  useTransientPopover,
} from './hooks/transientPopover';
import { SHORTCUTS, isTypingTarget, isInteractiveShortcutTarget } from './core/shortcuts';
import { AssetLibrary } from './components/AssetLibrary';
import { AnimationImport } from './components/AnimationImport';
import { blankProject } from './core/assets';
import { library } from './core/library';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { AnimationBar } from './components/AnimationBar';
import { ExportDialog } from './components/ExportDialog';
import { interpolationChoicesFor } from './components/interpolationOptions';
import type { StudioScene } from './scene/StudioScene';
export default function App() {
  useSurfaceOcclusion();
  const compactViewport = useCompactViewport();
  const [installOpen, setInstallOpen] = useState(false);
  const installPresence = usePresence(installOpen ? true : null);
  const panels = usePanelSizes(),
    pointer = useRef({ x: innerWidth * 0.5, y: innerHeight * 0.35 });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [tabletPanel, setTabletPanel] = useState<TabletPanel | null>(null),
    [timelineOpen, setTimelineOpen] = useState(false);
  const panelPresence = usePresence(tabletPanel),
    timelinePresence = usePresence(timelineOpen ? true : null),
    shownPanel = panelPresence.value;

  const [assets, setAssets] = useState(false),
    [importing, setImporting] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [newAction, setNewAction] = useState<RigLayer | null>(null);
  const settingsDialog = useRef<HTMLElement>(null),
    helpDialog = useRef<HTMLElement>(null);
  useModalFocus({
    rootRef: settingsDialog,
    enabled: settingsOpen,
    onEscape: () => setSettingsOpen(false),
  });
  useEffect(() => {
    const open = () => setExporting(true);
    window.addEventListener('pose-export-shared', open);
    return () => window.removeEventListener('pose-export-shared', open);
  }, []);
  const s = useStudioChrome({ frame: 'none' }),
    runtime = useRef<StudioScene | null>(null),
    [inspectorRuntime, setInspectorRuntime] = useState<StudioScene | null>(null),
    [menu, setMenu] = useState(false),
    [titleSlot, setTitleSlot] = useState<HTMLDivElement | null>(null),
    [desktopLayout, setDesktopLayout] = useDesktopLayout(),
    [trail, setTrail] = useState(false),
    [poseMenu, setPoseMenu] = useState<{ x: number; y: number } | null>(null),
    [exporting, setExporting] = useState(false),
    [recording, setRecording] = useState(false),
    [characterExport, setCharacterExport] = useState(false),
    [saved, setSaved] = useState('Recovery copy'),
    recoveryReceipt = useRef<{
      project: typeof studio.state.project;
      workspace: typeof studio.state.workspace;
      drafts: typeof studio.state.drafts;
      revision: number;
      authoredRevision: number;
    } | null>(null),
    initialRecoverySeeded = useRef(false),
    [help, setHelp] = useState(false),
    fileInput = useRef<HTMLInputElement>(null),
    projectMenu = useRef<HTMLDivElement>(null),
    projectTrigger = useRef<HTMLButtonElement>(null);
  const poseMenuPresence = usePresence(poseMenu);
  useModalFocus({ rootRef: helpDialog, enabled: help, onEscape: () => setHelp(false) });
  const projectPopover = useTransientPopover({
    owner: 'project',
    open: menu,
    onClose: () => setMenu(false),
    rootRef: projectMenu,
    triggerRef: projectTrigger,
  });
  const openBoxSelection = () => {
    claimTransientPopover('box-selection');
    setTabletPanel(null);
    runtime.current?.beginBoxSelection();
  };
  useEffect(() => {
    const box = () => openBoxSelection();
    const properties = () => {
      try {
        localStorage.setItem('pose-properties-context', 'control');
      } catch {}
      // Opening Properties from the selected-control ribbon is an explicit
      // preference change. Keep it enabled after the current selection goes
      // away so the next selection can restore the inspector.
      setDesktopLayout({ properties: true });
      if (isAndroid && studio.state.selection.length) {
        claimTransientPopover('workspace-panel');
        if (compactViewport) setTimelineOpen(false);
        setTabletPanel('properties');
      }
    };
    window.addEventListener('pose-box-select', box);
    window.addEventListener('pose-open-properties', properties);
    return () => {
      window.removeEventListener('pose-box-select', box);
      window.removeEventListener('pose-open-properties', properties);
    };
  }, [compactViewport]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.defaultPrevented) return;
      if (menu) {
        event.preventDefault();
        setMenu(false);
      } else if (tabletPanel) {
        event.preventDefault();
        setTabletPanel(null);
      } else if (timelineOpen) {
        event.preventDefault();
        setTimelineOpen(false);
      }
    };
    window.addEventListener('pose-dismiss-overlay', dismiss);
    return () => window.removeEventListener('pose-dismiss-overlay', dismiss);
  }, [menu, tabletPanel, timelineOpen]);
  useEffect(() => {
    if (!isAndroid || !tabletPanel) return;
    const dismissPanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setTabletPanel(null);
    };
    window.addEventListener('keydown', dismissPanel);
    return () => window.removeEventListener('keydown', dismissPanel);
  }, [tabletPanel]);
  useEffect(() => {
    if (!settingsOpen) return;
    const dismissSettings = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setSettingsOpen(false);
    };
    window.addEventListener('keydown', dismissSettings);
    return () => window.removeEventListener('keydown', dismissSettings);
  }, [settingsOpen]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches('.scene-canvas') && tabletPanel) {
        consumeSceneDismiss(e);
        setTabletPanel(null);
      }
      if (t.matches('.modal-backdrop') && !recording && !exporting) {
        setAssets(false);
        setImporting(false);
        setSettingsOpen(false);
        setHelp(false);
        setNewAction(null);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [recording, exporting, tabletPanel]);
  const characterPreview = !!s.workspace?.previewCharacterId,
    retarget = s.retargetMode,
    setRetarget = (value: boolean) => {
      if (isAndroid && value) setTabletPanel('rig');
      if (
        value &&
        !studio.state.workspace?.previewCharacterId &&
        studio.state.workspace?.activeCharacterId
      )
        studio.selectPreviewCharacter(studio.state.workspace.activeCharacterId);
      studio.patch({
        retargetMode: value,
        retargetRest: value && !studio.state.playing,
        playerView: false,
      });
      runtime.current?.resetView();
    };
  const previousSelectionCount = useRef<number | null>(null);
  useEffect(() => {
    const count = s.selection.length,
      previous = previousSelectionCount.current;
    previousSelectionCount.current = count;

    if (isAndroid) {
      // The contextual properties drawer follows a selection, but its
      // enabled state is the persisted desktop-layout preference. A blank
      // selection never leaves an empty inspector behind.
      if (count === 0) {
        if (!retarget && tabletPanel === 'properties') setTabletPanel(null);
        return;
      }
      // Only a new selection session (including the initial selection) may
      // restore Properties. Frame updates, timeline changes and one-control
      // to another-control changes preserve the active editor.
      if (
        (previous === null || previous === 0) &&
        desktopLayout.properties &&
        !timelineOpen &&
        !tabletPanel &&
        !retarget
      )
        setTabletPanel('properties');
    }
  }, [s.selection.length, tabletPanel, timelineOpen, desktopLayout.properties, retarget]);
  useEffect(() => {
    if (isAndroid) return;
    let press: { x: number; y: number; cancels: boolean } | null = null;
    const inViewport = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.closest?.('.area-viewport canvas');
    const down = (e: PointerEvent) => {
      if (e.button !== 2 || !inViewport(e.target)) return;
      const st = studio.state;
      press = { x: e.clientX, y: e.clientY, cancels: st.interacting || !!st.boxSelection };
    };
    const menu = (e: MouseEvent) => {
      if (!press || !inViewport(e.target)) return;
      const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4,
        open =
          !moved &&
          !press.cancels &&
          !studio.state.retargetMode &&
          studio.state.selection.length > 0;
      press = null;
      if (open) setPoseMenu({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }, []);
  const onRecoverySaved = useCallback(() => {
    const { project, workspace, drafts, revision } = studio.state;
    recoveryReceipt.current = {
      project,
      workspace,
      drafts,
      revision,
      authoredRevision: studio.authoredRevision,
    };
    setSaved('Recovery copy up to date');
  }, []);
  const setRuntime = useCallback((r: StudioScene | null) => {
    runtime.current = r;
    setInspectorRuntime(r);
    if (import.meta.env.DEV) {
      window.__studio = studio;
      window.__scene = r;
    }
  }, []);
  useEffect(() => {
    const flush = () => {
      const receipt = recoveryReceipt.current,
        state = studio.state;
      if (
        receipt &&
        receipt.project === state.project &&
        receipt.workspace === state.workspace &&
        receipt.drafts === state.drafts &&
        receipt.revision === state.revision &&
        receipt.authoredRevision === studio.authoredRevision
      )
        return;
      const data = studio.recoverySnapshot();
      if (data)
        try {
          void writeRecovery(data, undefined, {
            reuseSourceClips: receipt?.authoredRevision === studio.authoredRevision,
          }).catch(() => {});
        } catch {}
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const file = useProjectFile(
      s.ready,
      exporting || recording || characterExport || importing || assets || !!newAction,
      async (shouldCancel) => runtime.current?.settled(30000, shouldCancel),
      onRecoverySaved,
    ),
    save = file.save;
  const importMode = useRef(false);
  const receive = (p: unknown, merge: boolean) => {
    if (merge) {
      try {
        studio.importAnimations(p);
      } finally {
        void discardProjectRecoveryRecords(p).catch(() => {});
      }
    } else file.requestOpen(p);
  };
  const open = async (merge = false) => {
    importMode.current = merge;
    if (window.studioDesktop) {
      if (!merge) studio.patch({ opening: { name: 'project', stage: 'Reading file' } });
      try {
        const p = await window.studioDesktop.openProject({ recovery: !merge });
        if (p) receive(p, merge);
        else if (!merge) studio.patch({ opening: null });
      } catch (e) {
        if (!merge) studio.patch({ opening: null });
        studio.patch({ message: (e as Error).message });
        reportFailure('Could not open project: ' + (e as Error).message);
      }
    } else fileInput.current?.click();
    setMenu(false);
  };
  const newClip = (demo: boolean) => {
    if (!runtime.current || !s.ready) return;
    if (demo) studio.addAnimation(runtime.current.restControls, true);
    else setNewAction('firstPerson');
    setMenu(false);
  };
  const chooseAction = (layer: RigLayer) => {
    const p = studio.state.project,
      w = studio.documentSnapshot();
    if (!p || !w || p.editing === layer) return;
    const target =
      w.clips.find((c) => c.id === p.bodyBase?.sourceId && c.project.editing === layer) ??
      w.clips.find(
        (c) => c.project.editing === layer && c.project.bodyBase?.sourceId === w.activeId,
      );
    if (target) studio.activate(target.id);
    else setNewAction(layer);
  };
  useEffect(() => {
    // Opening commits its validated snapshot explicitly. Let it finish before
    // a background autosave serializes the same large library again.
    if (!s.project || s.opening) return;
    // Workspace init has already validated and accepted a durable recovery
    // payload before installing this state. Seed the receipt once when the
    // exact accepted workspace is still current, so startup does not rewrite
    // the full library. A failed/fallback recovery has a different identity
    // and continues through the normal autosave path.
    if (!initialRecoverySeeded.current) {
      initialRecoverySeeded.current = true;
      const durable = readRecovery();
      if (durable && !getRecoveryState().writeHeld && studio.state.workspace === durable) {
        const { project, workspace, drafts, revision } = studio.state;
        recoveryReceipt.current = {
          project,
          workspace,
          drafts,
          revision,
          authoredRevision: studio.authoredRevision,
        };
        setSaved('Recovery copy up to date');
        return;
      }
    }
    const captured = {
      project: studio.state.project,
      workspace: studio.state.workspace,
      drafts: studio.state.drafts,
      revision: studio.state.revision,
      authoredRevision: studio.authoredRevision,
    };
    const receipt = recoveryReceipt.current;
    if (
      receipt &&
      receipt.project === captured.project &&
      receipt.workspace === captured.workspace &&
      receipt.drafts === captured.drafts &&
      receipt.revision === captured.revision &&
      receipt.authoredRevision === captured.authoredRevision
    ) {
      setSaved('Recovery copy up to date');
      return;
    }
    setSaved('Saving…');
    const t = setTimeout(() => {
      void (async () => {
        try {
          const data = studio.recoverySnapshot();
          if (data)
            await writeRecovery(data, undefined, {
              reuseSourceClips:
                recoveryReceipt.current?.authoredRevision === studio.authoredRevision,
            });
          const current = studio.state;
          if (
            current.project === captured.project &&
            current.workspace === captured.workspace &&
            current.drafts === captured.drafts &&
            current.revision === captured.revision &&
            studio.authoredRevision === captured.authoredRevision
          ) {
            recoveryReceipt.current = {
              project: captured.project,
              workspace: captured.workspace,
              drafts: captured.drafts,
              revision: captured.revision,
              authoredRevision: captured.authoredRevision,
            };
            setSaved('Recovery copy up to date');
          }
        } catch (error) {
          if (getRecoveryState().writeHeld) {
            setSaved('Recovery needs attention');
            return;
          }
          setSaved('Save needed · autosave full');
          reportFailure('Could not save local recovery: ' + (error as Error).message);
        }
      })();
    }, 650);
    return () => clearTimeout(t);
  }, [s.project, s.workspace, s.drafts, s.revision, s.opening, studio.authoredRevision]);
  const updateBlocked = useRef(false);
  updateBlocked.current =
    exporting ||
    recording ||
    characterExport ||
    importing ||
    assets ||
    !!newAction ||
    !!file.pending ||
    file.busy ||
    settingsOpen ||
    help ||
    menu;
  useEffect(() => {
    if (!isPwaBuild) return;
    void initializePwa();
    return configurePwaUpdate({
      canReload: () => ({
        allowed:
          studio.state.ready &&
          !studio.state.interacting &&
          !studio.state.playing &&
          !updateBlocked.current &&
          !getRecoveryState().writeHeld &&
          !studio.state.opening &&
          !isTypingTarget(document.activeElement),
        reason: 'The update will apply when the current edit, playback or file operation finishes.',
      }),
      persistSnapshot: async () => {
        const snapshot = studio.recoverySnapshot();
        if (!snapshot) return false;
        await writeRecovery(snapshot);
      },
      reload: () => {
        window.dispatchEvent(new Event('pose-before-update-reload'));
        window.location.reload();
      },
      onError: reportFailure,
    });
  }, []);
  useEffect(() => {
    if (isPwaBuild) notifyPwaIdle();
  }, [
    s.ready,
    s.interacting,
    s.playing,
    s.opening,
    file.pending,
    file.busy,
    exporting,
    importing,
    recording,
    characterExport,
    assets,
    newAction,
    settingsOpen,
    help,
    menu,
  ]);
  useEffect(() => {
    if (!isPwaBuild) return;
    const retry = () => {
      queueMicrotask(() => {
        void notifyPwaIdle();
      });
    };
    const unsubscribe = subscribeRecoveryState(retry);
    document.addEventListener('focusout', retry);
    return () => {
      unsubscribe();
      document.removeEventListener('focusout', retry);
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (appInstallSnapshot().updateApplying) return;
      const resetKey = e.key.toLowerCase();
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (resetKey === 'g' || resetKey === 'r') &&
        !studio.state.keyframeMenu &&
        !exporting &&
        !recording &&
        !characterExport &&
        !retarget &&
        !help &&
        !newAction &&
        !file.pending &&
        !importing &&
        !assets
      ) {
        const target = e.target as HTMLElement;
        if (
          !target.closest('[role=dialog],[data-editor-overlay],.curve-editor,.timeline') &&
          (!isTypingTarget(target) || target.matches('input[type=number]'))
        ) {
          e.preventDefault();
          if (target.matches('input[type=number]')) target.blur();
          runtime.current?.handleTransformKey(new KeyboardEvent('keydown', { key: 'Escape' }));
          studio.resetSelected(resetKey === 'g' ? 'location' : 'rotation');
          return;
        }
      }
      if (
        studio.state.keyframeMenu ||
        e.defaultPrevented ||
        isTypingTarget(e.target) ||
        exporting ||
        recording ||
        characterExport ||
        help ||
        newAction ||
        file.pending ||
        importing ||
        assets ||
        settingsOpen ||
        (!e.ctrlKey && !e.metaKey && isInteractiveShortcutTarget(e.target)) ||
        !!document.querySelector('dialog[open]') ||
        (e.target as HTMLElement).closest('[role=dialog],[data-editor-overlay]')
      )
        return;
      if (retarget) {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 's') {
          e.preventDefault();
          save();
        } else if (k === ' ') {
          e.preventDefault();
          studio.patch({ playing: !studio.state.playing, retargetRest: false });
        } else if (k === 'arrowleft' || k === 'arrowright') {
          e.preventDefault();
          studio.setFrame(studio.state.frame + (k === 'arrowleft' ? -1 : 1));
        } else if (k === 'home' || k === 'end') {
          e.preventDefault();
          studio.setFrame(k === 'home' ? 0 : (studio.state.project?.end ?? 0));
        }
        return;
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        runtime.current?.toggleGameView();
        return;
      }
      if (runtime.current?.handleTransformKey(e)) return;
      if (e.code === 'Numpad0') {
        e.preventDefault();
        studio.patch({
          playerView: !studio.state.playerView,
          message: studio.state.playerView ? 'Orbit view' : 'Player camera · Numpad 0 to return',
        });
        return;
      }
      // Like Blender, timeline shortcuts follow the editor under the pointer,
      // including after switching actions using the tabs above the viewport.
      const target = e.target as HTMLElement,
        hovered = document
          .elementFromPoint(pointer.current.x, pointer.current.y)
          ?.closest('.dope-sheet');
      if (hovered && !target.closest('.dope-sheet,.curve-editor')) {
        const forwarded = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          bubbles: true,
          cancelable: true,
        });
        if (!hovered.dispatchEvent(forwarded)) {
          e.preventDefault();
          return;
        }
      }
      const k = e.key.toLowerCase(),
        graph = !!(e.target as HTMLElement).closest('.curve-editor');
      if (!graph) {
        if (e.altKey && k === 'r') {
          e.preventDefault();
          studio.resetSelected('rotation');
          return;
        }
        if (e.altKey && k === 'g') {
          e.preventDefault();
          studio.resetSelected('location');
          return;
        }
        if (e.altKey && k === 'h') {
          e.preventDefault();
          studio.showControls(true);
          return;
        }
        if (k === 'a' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.altKey ? studio.deselectAll() : studio.selectAll();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 'i') {
          e.preventDefault();
          studio.invertSelection();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (k === ',' || k === '.') {
            e.preventDefault();
            window.dispatchEvent(
              new CustomEvent('transform-options', { detail: k === ',' ? 'orientation' : 'pivot' }),
            );
            return;
          }
          if (k === 'b') {
            e.preventDefault();
            openBoxSelection();
            return;
          }
          if (k === 't' && !isAndroid) {
            e.preventDefault();
            if (!e.repeat) window.dispatchEvent(new Event('pose-toggle-properties'));
            return;
          }
          if (k === 'g' || k === 'r') {
            e.preventDefault();
            runtime.current?.beginTransform(k === 'g' ? 'translate' : 'rotate');
            return;
          }
          if (k === 'h') {
            e.preventDefault();
            studio.hideSelected(e.shiftKey);
            return;
          }
          if (k === 'i' || k === 'k') {
            e.preventDefault();
            studio.showKeyframeMenu(pointer.current.x, pointer.current.y);
            return;
          }
          if (e.code === 'NumpadDecimal' || k === 'f') {
            e.preventDefault();
            runtime.current?.frameSelected();
            return;
          }
          if (k === 'home') {
            e.preventDefault();
            runtime.current?.resetView();
            return;
          }
        }
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'c') {
          e.preventDefault();
          e.shiftKey ? studio.copyPose('rig') : studio.copySelectedPose();
          return;
        }
        if (key === 'v') {
          e.preventDefault();
          e.shiftKey ? runtime.current?.pasteMirroredPose() : studio.pastePose();
          return;
        }
        if (key === 'n') {
          e.preventDefault();
          if (runtime.current) setNewAction('firstPerson');
          return;
        }
        if (key === 'tab') {
          e.preventDefault();
          const w = studio.state.workspace;
          if (w) {
            const i = w.openIds.indexOf(w.activeId);
            studio.activate(
              w.openIds[(i + (e.shiftKey ? -1 : 1) + w.openIds.length) % w.openIds.length],
            );
          }
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? studio.redo() : studio.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        studio.redo();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        if (!e.repeat) studio.patch({ playing: !studio.state.playing });
      } else if (key === 'k') {
        e.preventDefault();
        studio.addKey();
      } else if (key === 'delete') {
        e.preventDefault();
        studio.removeKey();
      } else if (key === 'arrowleft') {
        e.preventDefault();
        studio.setFrame(e.shiftKey ? 0 : studio.state.frame - 1);
      } else if (key === 'arrowright') {
        e.preventDefault();
        studio.setFrame(e.shiftKey ? (studio.state.project?.end ?? 96) : studio.state.frame + 1);
      } else if (key === 'home') {
        e.preventDefault();
        studio.setFrame(0);
      } else if (key === 'end') {
        e.preventDefault();
        studio.setFrame(studio.state.project?.end ?? 96);
      } else if (key === 'w') studio.patch({ mode: 'translate' });
      else if (key === 'e') studio.patch({ mode: 'rotate' });
      else if (key === 'q') studio.patch({ mode: 'select' });
      else if (key === 'f') runtime.current?.frameSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    save,
    exporting,
    recording,
    characterExport,
    retarget,
    help,
    file.pending,
    newAction,
    importing,
    assets,
    settingsOpen,
  ]);
  const controls = retarget ? <CharacterPanel runtime={runtime.current} /> : <ControlList />;
  const inspector = retarget ? (
    <RetargetInspector runtime={runtime.current} />
  ) : (
    <Inspector
      onClose={() => {
        if (isAndroid) setTabletPanel(null);
        setDesktopLayout({ properties: false });
      }}
      runtime={inspectorRuntime}
      attach={(target, position, rotation) =>
        runtime.current?.setAttachment(target, position, rotation)
      }
      pick={() => runtime.current?.pickAttachment()}
      switchLimb={(limb, mode) => runtime.current?.switchLimb(limb, mode)}
    />
  );
  const newProject = () => {
    const data = library(blankProject(runtime.current?.restControls ?? {}));
    data.name = 'Untitled project';
    file.requestOpen(data);
  };
  const openExample = async () => {
    try {
      const data = await window.studioDesktop?.openExample();
      if (data) file.requestOpen(data);
    } catch (e) {
      studio.patch({ message: (e as Error).message });
    }
  };
  const busy = !s.ready || recording || exporting,
    selected = s.selection.length > 0,
    keyLocked = selected && !!s.project && s.selection.every((id) => s.project!.tracks[id].keyLock);
  const activeInterpolation = s.project?.tracks[s.selected]?.interpolation,
    interpolationChoices = interpolationChoicesFor(
      activeInterpolation === undefined || activeInterpolation === 'smooth'
        ? 'bezier'
        : activeInterpolation,
    );
  const closePoseMenu = useCallback(() => setPoseMenu(null), []);
  const desktopMenus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New project', run: newProject, disabled: !s.ready },
        {
          label: 'New animation…',
          shortcut: 'Ctrl N',
          run: () => newClip(false),
          disabled: !s.ready,
        },
        { label: 'Open project…', run: () => void open(), disabled: !s.ready },
        { label: 'Save project', shortcut: 'Ctrl S', run: save, disabled: !s.ready },
        'separator',
        { label: 'Import animation…', run: () => setImporting(true), disabled: !s.ready },
        { label: 'Models, props and animations…', run: () => setAssets(true), disabled: !s.ready },
        'separator',
        {
          // The browser build saves .pose (Unreal packaging needs the desktop app).
          label: characterPreview
            ? 'Export character animation…'
            : portablePlatform
              ? 'Export…'
              : 'Export to Unreal…',
          run: () => (characterPreview ? setCharacterExport(true) : setExporting(true)),
          disabled: busy,
        },
        { label: 'Record video…', run: () => setRecording(true), disabled: busy },
        'separator',
        isPwaBuild
          ? { label: 'Install app and offline status…', run: () => setInstallOpen(true) }
          : { label: 'Open Axe studio example…', run: () => void openExample() },
      ],
      footer: (
        <>
          <label className="menu-field">
            Project name
            <input
              aria-label="Project name"
              disabled={!s.ready}
              maxLength={100}
              value={s.workspace?.name ?? ''}
              onChange={(e) => studio.renameWorkspace(e.target.value)}
            />
          </label>
          <RecentProjects open={(p) => receive(p, false)} />
        </>
      ),
    },
    {
      label: 'Edit',
      items: [
        { label: 'Select controls', shortcut: 'Q', run: () => studio.patch({ mode: 'select' }) },
        { label: 'Undo', shortcut: 'Ctrl Z', run: () => studio.undo() },
        { label: 'Redo', shortcut: 'Ctrl Y', run: () => studio.redo() },
        'separator',
        { label: 'Select all controls', shortcut: 'A', run: () => studio.selectAll() },
        { label: 'Deselect all', shortcut: 'Alt A', run: () => studio.deselectAll() },
        { label: 'Invert selection', shortcut: 'Ctrl I', run: () => studio.invertSelection() },
        {
          label: 'Box select',
          shortcut: 'B',
          run: openBoxSelection,
          disabled: retarget,
        },
        'separator',
        {
          label: 'Hide selected',
          shortcut: 'H',
          run: () => studio.hideSelected(false),
          disabled: !selected,
        },
        {
          label: 'Hide others',
          shortcut: 'Shift H',
          run: () => studio.hideSelected(true),
          disabled: !selected,
        },
        { label: 'Show all controls', shortcut: 'Alt H', run: () => studio.showControls(true) },
      ],
    },
    {
      label: 'Pose',
      items: [
        {
          label: 'Copy pose',
          shortcut: 'Ctrl C',
          run: () => studio.copySelectedPose(),
          disabled: !selected,
        },
        {
          label: 'Copy whole-rig pose',
          shortcut: 'Ctrl Shift C',
          run: () => studio.copyPose('rig'),
        },
        {
          label: 'Paste pose',
          shortcut: 'Ctrl V',
          run: () => studio.pastePose(),
          disabled: !s.clipboard,
        },
        {
          label: 'Paste mirrored',
          shortcut: 'Ctrl Shift V',
          run: () => runtime.current?.pasteMirroredPose(),
          disabled: !s.clipboard,
        },
        {
          label: 'Mirror to other side',
          run: () => runtime.current?.mirrorSelectedPose(),
          disabled: !selected,
        },
        'separator',
        {
          label: 'Reset location',
          shortcut: 'Alt G',
          run: () => studio.resetSelected('location'),
          disabled: !selected,
        },
        {
          label: 'Reset rotation',
          shortcut: 'Alt R',
          run: () => studio.resetSelected('rotation'),
          disabled: !selected,
        },
        {
          label: 'Ground and key',
          run: () => window.dispatchEvent(new Event('pose-ground-selection')),
          disabled: !selected,
        },
      ],
    },
    {
      label: 'Key',
      items: [
        {
          label: 'Insert keyframe…',
          shortcut: 'I',
          run: () => studio.showKeyframeMenu(innerWidth * 0.5, innerHeight * 0.35),
          disabled: !selected,
        },
        {
          label: 'Delete key at frame',
          shortcut: 'Delete',
          run: () => studio.removeKey(),
          disabled: !selected,
        },
        'separator',
        { label: 'Auto key', checked: s.autoKey, run: () => studio.patch({ autoKey: !s.autoKey }) },
        {
          label: 'Lock new keys on selection',
          checked: keyLocked,
          disabled: !selected,
          run: () => studio.setControlKeyLock(s.selection, !keyLocked),
        },
        'separator',
        ...interpolationChoices.map(({ value, label }) => ({
          label: 'Interpolation: ' + label,
          run: () => studio.setInterpolation(value === 'bezier' ? 'smooth' : value),
          disabled: !s.project,
        })),
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Animate workspace', checked: !retarget, run: () => setRetarget(false) },
        { label: 'Character setup workspace', checked: retarget, run: () => setRetarget(true) },
        'separator',
        {
          label: 'Dope sheet and graph editor',
          checked: desktopLayout.editors,
          disabled: retarget,
          run: () => setDesktopLayout({ editors: !desktopLayout.editors }),
        },
        {
          label: 'Properties',
          checked: desktopLayout.properties,
          disabled: retarget,
          run: () => setDesktopLayout({ properties: !desktopLayout.properties }),
        },
        'separator',
        { label: 'Frame selected', shortcut: 'F', run: () => runtime.current?.frameSelected() },
        { label: 'Reset view', shortcut: 'Home', run: () => runtime.current?.resetView() },
        {
          label: 'Player camera',
          shortcut: 'Numpad 0',
          checked: s.playerView,
          disabled: retarget,
          run: () => studio.patch({ playerView: !s.playerView }),
        },
        {
          label: 'Game view',
          shortcut: 'Shift G',
          checked: s.gameView,
          run: () => runtime.current?.toggleGameView(),
        },
        {
          label: 'Cinematic lighting',
          checked: s.cinematic,
          run: () => studio.setCinematic(!s.cinematic),
        },
        {
          label: 'Camera preview',
          checked: s.cameraPreview,
          run: () => studio.patch({ cameraPreview: !s.cameraPreview }),
        },
        {
          label: 'Motion trail',
          checked: trail,
          disabled: retarget,
          run: () => {
            runtime.current?.toggleTrail();
            setTrail(!trail);
          },
        },
      ],
      footer: (
        <div className="menu-field">
          <span>Preview character</span>
          <PreviewModel runtime={runtime.current} configure={() => setRetarget(true)} />
        </div>
      ),
    },
    {
      label: 'Help',
      items: [{ label: 'Keyboard shortcuts', run: () => setHelp(true) }],
    },
  ];
  return (
    <div
      className={
        'app ' +
        (!isAndroid ? 'desktop-workspace ' : '') +
        (s.tab === 'curves' ? 'curves-open' : '') +
        (timelineExpanded && (!isAndroid || timelinePresence.value) ? ' timeline-expanded' : '') +
        (timelinePresence.value ? ' timeline-open' : '') +
        (timelineOpen ? ' timeline-visible' : '') +
        (shownPanel ? ' sheet-open' : '')
      }
      style={panels.style}
    >
      <header className="titlebar">
        <div className="title-menu" ref={projectMenu}>
          <button
            ref={projectTrigger}
            className="brand"
            aria-label="Application menu"
            title="Application menu"
            disabled={recording || exporting}
            aria-expanded={menu}
            onClick={() => {
              if (!menu) projectPopover.announce();
              setMenu(!menu);
            }}
          >
            <Waypoints size={18} />
          </button>
          <MotionPresence show={menu}>
            {!isAndroid ? (
              <div className="desktop-command-menu" data-editor-overlay>
                <MenuBar menus={desktopMenus} disabled={recording || exporting} />
              </div>
            ) : (
              <div className="file-menu" data-editor-overlay>
                <label className="project-menu-field">
                  Project
                  <input
                    aria-label="Library project name"
                    disabled={!s.ready}
                    maxLength={100}
                    value={s.workspace?.name ?? ''}
                    onChange={(e) => studio.renameWorkspace(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => {
                    const data = library(blankProject(runtime.current?.restControls ?? {}));
                    data.name = 'Untitled project';
                    file.requestOpen(data);
                    setMenu(false);
                  }}
                >
                  <FilePlus size={16} />
                  New project
                </button>
                <button onClick={() => newClip(false)}>
                  <FilePlus size={16} />
                  New animation
                </button>
                <button disabled={!s.ready} onClick={() => open()}>
                  <FolderOpen size={16} />
                  Open project…
                </button>
                <button
                  onClick={() => {
                    setAssets(true);
                    setMenu(false);
                  }}
                >
                  <Box size={16} />
                  Project assets…
                </button>
                <button
                  onClick={() => {
                    setImporting(true);
                    setMenu(false);
                  }}
                >
                  <FolderOpen size={16} />
                  Import animation…
                </button>
                <button
                  onClick={() => {
                    save();
                    setMenu(false);
                  }}
                >
                  <Save size={16} />
                  Save project… <kbd>Ctrl S</kbd>
                </button>
                {isAndroid && (
                  <>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setRecording(true);
                      }}
                    >
                      <Video size={16} />
                      Record video…
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setExporting(true);
                      }}
                    >
                      <Upload size={16} />
                      Export animation…
                    </button>
                  </>
                )}
                <RecentProjects
                  open={(p) => {
                    receive(p, false);
                    setMenu(false);
                  }}
                />
                <hr />
                {!isPwaBuild && (
                  <button
                    onClick={async () => {
                      setMenu(false);
                      try {
                        const data = await window.studioDesktop?.openExample();
                        if (data) file.requestOpen(data);
                      } catch (e) {
                        studio.patch({ message: (e as Error).message });
                      }
                    }}
                  >
                    Open Axe studio example…
                  </button>
                )}
                {isPwaBuild && (
                  <button
                    onClick={() => {
                      setMenu(false);
                      setInstallOpen(true);
                    }}
                  >
                    Install Studio / app status…
                  </button>
                )}
                <button
                  onClick={() => {
                    setHelp(true);
                    setMenu(false);
                  }}
                >
                  Keyboard shortcuts
                </button>
                {nativeAndroid && (
                  <button
                    onClick={() => {
                      setMenu(false);
                      window.dispatchEvent(new Event('pose-show-updates'));
                    }}
                  >
                    App and project updates…
                  </button>
                )}
              </div>
            )}
          </MotionPresence>
        </div>
        <span className="project-title" title={s.workspace?.name}>
          {s.workspace?.name}
        </span>
        <PwaUpdateIndicator
          onOpen={() => {
            claimTransientPopover('app-update');
            setInstallOpen(true);
          }}
          fallback={
            <span
              className={'save-indicator ' + (saved === 'Saving…' ? 'saving' : '')}
              title={saved}
              aria-label={saved}
            >
              {saved === 'Saving…' ? <LoaderCircle size={14} /> : <Check size={14} />}
            </span>
          }
        />
        <div className="title-spacer" ref={setTitleSlot} />
        {nativeAndroid && (
          <Updates
            file={file}
            blocked={
              recording ||
              exporting ||
              characterExport ||
              importing ||
              assets ||
              !!newAction ||
              file.pending
            }
          />
        )}
        {isAndroid && (
          <>
            <button
              className="export-button"
              aria-label="Export recording"
              title="Export recording"
              disabled={!s.ready || recording || exporting}
              onClick={() => {
                setMenu(false);
                setRecording(true);
              }}
            >
              <Video size={18} />
            </button>
            <button
              className="export-button"
              aria-label={isAndroid ? 'Export' : 'Export to Unreal'}
              title={isAndroid ? 'Export' : 'Export to Unreal'}
              disabled={!s.ready || recording || exporting}
              onClick={() => {
                setMenu(false);
                if (characterPreview) setCharacterExport(true);
                else setExporting(true);
              }}
            >
              <Upload size={18} />
            </button>
          </>
        )}
        <WindowControls />
      </header>
      {installPresence.value && (
        <InstallStudio exiting={installPresence.exiting} close={() => setInstallOpen(false)} />
      )}
      {!isAndroid ? (
        <DesktopWorkspace
          scene={<Viewport onRuntime={setRuntime} />}
          controls={controls}
          inspector={inspector}
          controllerTools={
            <PoseActions
              presentation="rail"
              mirror={() => runtime.current?.mirrorSelectedPose()}
              pasteMirrored={() => runtime.current?.pasteMirroredPose()}
            />
          }
          animations={
            <AnimationBar
              embedded
              create={() => newClip(false)}
              importClips={() => setImporting(true)}
            />
          }
          sizes={panels.sizes}
          resize={panels.change}
          retarget={retarget}
          toolbarSlot={titleSlot}
          layout={{
            ...desktopLayout,
          }}
          openSettings={() => setSettingsOpen(true)}
          toggleProperties={() => {
            setDesktopLayout({ properties: !desktopLayout.properties });
          }}
          toggleEditors={() => setDesktopLayout({ editors: !desktopLayout.editors })}
        />
      ) : (
        <div className="workspace">
          <Viewport onRuntime={setRuntime} />
        </div>
      )}
      {isAndroid && (
        <>
          <TabletWorkspace
            boxSelect={openBoxSelection}
            panel={tabletPanel}
            toggle={(p) => {
              claimTransientPopover('workspace-panel');
              if (p === 'tools') {
                setTabletPanel(null);
                setSettingsOpen(true);
                return;
              }
              if (p === 'properties') {
                const opening = tabletPanel !== 'properties';
                setDesktopLayout({ properties: opening });
                // Keep the preference enabled without mounting an empty
                // contextual inspector when no control is selected.
                if (opening && !retarget && !s.selection.length) return;
              }
              if (compactViewport) setTimelineOpen(false);
              setTabletPanel((current) => (current === p ? null : p));
            }}
            timeline={timelineOpen}
            toggleTimeline={() => {
              claimTransientPopover('timeline');
              if (compactViewport) setTabletPanel(null);
              setTimelineOpen((v) => !v);
            }}
          />
          {shownPanel && (
            <TabletDrawer
              panel={shownPanel}
              hideHeader={shownPanel === 'properties' && !retarget}
              exiting={panelPresence.exiting}
              close={() => {
                if (shownPanel === 'properties') setDesktopLayout({ properties: false });
                setTabletPanel(null);
              }}
            >
              {shownPanel === 'rig' ? (
                controls
              ) : shownPanel === 'properties' ? (
                inspector
              ) : shownPanel === 'animations' ? (
                <AnimationBar
                  embedded
                  create={() => newClip(false)}
                  importClips={() => setImporting(true)}
                />
              ) : (
                <TabletSettings
                  retarget={retarget}
                  setRetarget={setRetarget}
                  chooseAction={chooseAction}
                  openAssets={() => setAssets(true)}
                  runtime={runtime.current}
                  save={save}
                  help={() => setHelp(true)}
                />
              )}
            </TabletDrawer>
          )}
        </>
      )}
      {isAndroid && timelinePresence.value && (
        <Timeline
          exiting={isAndroid && timelinePresence.exiting}
          expanded={timelineExpanded}
          expand={() => setTimelineExpanded((v) => !v)}
          close={isAndroid ? () => setTimelineOpen(false) : undefined}
        />
      )}
      <KeyframeMenu />
      {poseMenuPresence.value && (
        <ContextMenu
          x={poseMenuPresence.value.x}
          y={poseMenuPresence.value.y}
          label="Pose"
          items={[...desktopMenus[2].items, 'separator', ...desktopMenus[3].items.slice(0, 2)]}
          close={closePoseMenu}
          exiting={poseMenuPresence.exiting}
        />
      )}

      <FailureNotice />
      <RecoveryNotice />
      <UpdateProgress />
      <footer className="statusbar">
        <span role="status">{s.message}</span>
        <span>
          {s.retargetMode
            ? 'Retarget · ' +
              (s.workspace?.characters?.find((c) => c.id === s.workspace?.activeCharacterId)
                ?.name ?? 'No character')
            : Object.keys(s.drafts).length
              ? 'Unkeyed pose'
              : s.ready
                ? (s.workspace?.characters?.find((c) => c.id === s.workspace?.previewCharacterId)
                    ?.name ?? 'Manny') + ' · shared Manny rig'
                : 'Loading'}
          <i />
          v0.8.24
        </span>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".pose,.json,.manny"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f)
            try {
              if (!importMode.current)
                studio.patch({
                  opening: {
                    name: f.name.replace(/\.(pose|json|manny)$/i, ''),
                    stage: 'Reading file',
                  },
                });
              receive(
                await decodeProject(new Uint8Array(await f.arrayBuffer())),
                importMode.current,
              );
            } catch (err) {
              studio.patch({ opening: null, message: (err as Error).message });
              reportFailure('Could not open project: ' + (err as Error).message);
            }
          e.target.value = '';
        }}
      />
      <ProjectLoading />
      <MotionOverlay show={assets}>
        <AssetLibrary
          runtime={runtime.current}
          close={() => setAssets(false)}
          characterSetup={() => setRetarget(true)}
          animationImport={() => setImporting(true)}
        />
      </MotionOverlay>
      <MotionOverlay show={importing}>
        <AnimationImport
          runtime={runtime.current}
          close={() => setImporting(false)}
          nativeImport={() => void open(true)}
        />
      </MotionOverlay>
      <MotionOverlay show={settingsOpen}>
        <div className="modal-backdrop">
          <section
            ref={settingsDialog}
            className="modal standalone-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Studio settings"
          >
            <header>
              <h2>Studio settings</h2>
              <button aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <TabletSettings
              retarget={retarget}
              setRetarget={setRetarget}
              chooseAction={chooseAction}
              openAssets={() => {
                setSettingsOpen(false);
                setAssets(true);
              }}
              runtime={runtime.current}
              save={save}
              help={() => {
                setSettingsOpen(false);
                setHelp(true);
              }}
            />
          </section>
        </div>
      </MotionOverlay>
      <MotionOverlay show={file.pending}>{file.dialog}</MotionOverlay>
      <MotionOverlay show={!!newAction}>
        <NewActionDialog
          initial={newAction ?? 'firstPerson'}
          rest={runtime.current?.restControls ?? {}}
          close={() => setNewAction(null)}
        />
      </MotionOverlay>
      <MotionOverlay show={recording}>
        <RecordingDialog runtime={runtime.current} close={() => setRecording(false)} />
      </MotionOverlay>
      <MotionOverlay show={characterExport}>
        <RetargetExport runtime={runtime.current} close={() => setCharacterExport(false)} />
      </MotionOverlay>
      <MotionOverlay show={exporting}>
        {portablePlatform ? (
          <AndroidExportDialog
            runtime={runtime.current}
            save={save}
            close={() => setExporting(false)}
          />
        ) : (
          <ExportDialog runtime={runtime.current} close={() => setExporting(false)} />
        )}
      </MotionOverlay>
      <MotionPresence show={help} kind="overlay">
        <div className="modal-backdrop">
          <section ref={helpDialog} className="modal compact-modal" role="dialog" aria-modal="true">
            <header>
              <h2>Make your first animation</h2>
              <button aria-label="Close help" onClick={() => setHelp(false)}>
                <X size={20} />
              </button>
            </header>
            <p>
              {isAndroid && (
                <>
                  Touch or S Pen: drag a control to pose it, or use its axis handles. Drag empty
                  space to orbit; use two fingers to pan and pinch. A second finger cancels a
                  tentative pose before navigating. Rig, Pose, Clips and Tools open drawers;
                  Timeline opens timing controls.{' '}
                </>
              )}
              Use + above the viewport to add animations. Switch tabs to keep working without
              closing anything. Pick a control, choose a frame, and pose it. With Auto key enabled,
              each edit becomes a keyframe. Drag the diamonds to change timing.
            </p>
            <dl className="shortcuts">
              {SHORTCUTS.map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
            <p className="help-text">
              Change “Following” to attach a hand or prop. Switching attachments preserves its
              current position. With Auto key off, press K before changing frames to keep your pose.
            </p>
          </section>
        </div>
      </MotionPresence>
    </div>
  );
}
