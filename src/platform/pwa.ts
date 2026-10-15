export const isPwaBuild = import.meta.env.MODE === 'pwa';

export type AppInstallState = {
  status: 'preparing' | 'ready' | 'update' | 'unavailable' | 'error';
  installed: boolean;
  online: boolean;
  /** True while the current editor is writing a recovery copy and activating an update. */
  updateApplying?: boolean;
  /** A local, actionable explanation for a deferred or failed update. */
  updateMessage?: string;
};

export type PwaUpdateGate = {
  allowed: boolean;
  reason?: string;
};

/**
 * The editor owns the document and therefore owns the last safe persistence
 * point before a page reload. PWA code only coordinates the worker lifecycle.
 * Returning false from persistSnapshot is treated as a failed write.
 */
export type PwaUpdateCoordinator = {
  persistSnapshot: () => void | boolean | Promise<void | boolean>;
  canReload?: () => boolean | PwaUpdateGate;
  reload?: () => void;
  onError?: (message: string) => void;
};

export type PwaUpdateResult =
  | { status: 'applied' }
  | { status: 'deferred'; message: string }
  | { status: 'failed'; message: string }
  | { status: 'unavailable'; message: string };

const UPDATE_CHECK_MIN_INTERVAL = 60_000;
// A foreground minute is short enough to make GitHub Pages releases feel live,
// while avoiding a request on every render/focus pulse.
const UPDATE_CHECK_PERIOD = 60_000;
const UPDATE_READY_MESSAGE = 'A new Pose Studio version is ready.';
const UPDATE_SAFETY_MESSAGE = 'Finish the current edit or stop playback to apply the update.';
const UPDATE_CONTROLLER_MESSAGE =
  'A new Pose Studio worker is active. Finish the current edit to reload safely.';
const UPDATE_PERSISTENCE_MESSAGE =
  'Pose could not save a recovery copy. The update is paused; retry after saving succeeds.';

let state: AppInstallState = { status: 'preparing', installed: false, online: true };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let initialization: Promise<void> | undefined;
let lastUpdateCheck = -Infinity;
let updateCheck: Promise<void> | undefined;
let visibleTimer: number | undefined;
let lifecycleInstalled = false;
let retryableFailure = false;
let registrationCleanup: (() => void) | undefined;
let standaloneMedia: MediaQueryList | undefined;
let standaloneChange: (() => void) | undefined;
let updateCoordinator: PwaUpdateCoordinator | undefined;
let applyUpdatePromise: Promise<PwaUpdateResult> | undefined;
let observedWaiting: ServiceWorker | undefined;
let autoApplyBlocked = false;
let activationRequested = false;
let activationAwaitingReload = false;
let activationSnapshotPersisted = false;
let activationRegistration: ServiceWorkerRegistration | undefined;
let activationReload: (() => void) | undefined;

function patch(value: Partial<AppInstallState>) {
  state = { ...state, ...value };
  listeners.forEach((fn) => fn());
}

export const subscribeAppInstall = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const appInstallSnapshot = () => state;

function isVisible() {
  return document.visibilityState === 'visible';
}

function stopVisibleChecks() {
  if (visibleTimer !== undefined) {
    window.clearInterval(visibleTimer);
    visibleTimer = undefined;
  }
}

function startVisibleChecks() {
  stopVisibleChecks();
  if (!isVisible() || !navigator.onLine || (!registration && !retryableFailure)) return;
  visibleTimer = window.setInterval(() => {
    if (isVisible() && navigator.onLine) void checkAppUpdate();
  }, UPDATE_CHECK_PERIOD);
}

function scheduleVisibleCheck() {
  if (!isVisible() || !navigator.onLine || (!registration && !retryableFailure)) {
    stopVisibleChecks();
    return;
  }
  startVisibleChecks();
  void checkAppUpdate();
}

function installLifecycleChecks() {
  const onVisibilityChange = () => {
    if (isVisible()) scheduleVisibleCheck();
    else stopVisibleChecks();
  };
  const onPageShow = () => scheduleVisibleCheck();
  const onFocus = () => scheduleVisibleCheck();
  const onOffline = () => {
    patch({ online: false });
    stopVisibleChecks();
  };
  const onOnline = () => {
    patch({ online: true });
    scheduleVisibleCheck();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow, { passive: true });
  window.addEventListener('focus', onFocus, { passive: true });
  window.addEventListener('offline', onOffline, { passive: true });
  window.addEventListener('online', onOnline, { passive: true });
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    stopVisibleChecks();
  };
}

function clearActivation() {
  activationRequested = false;
  activationAwaitingReload = false;
  activationSnapshotPersisted = false;
  activationRegistration = undefined;
  activationReload = undefined;
}

function clearActivationRequest() {
  activationRequested = false;
}

function clearRegistration(expected?: ServiceWorkerRegistration) {
  if (expected && registration !== expected) return;
  registrationCleanup?.();
  registrationCleanup = undefined;
  registration = undefined;
  observedWaiting = undefined;
  clearActivation();
}

function currentReload() {
  return () => window.location.reload();
}

function updateWaitingState(current: ServiceWorkerRegistration) {
  const waiting = current.waiting;
  if (waiting && waiting !== observedWaiting) {
    observedWaiting = waiting;
    autoApplyBlocked = false;
    patch({ updateMessage: UPDATE_READY_MESSAGE, updateApplying: false });
  } else if (!waiting && !activationRequested && !activationAwaitingReload) {
    observedWaiting = undefined;
  }
  if (waiting) {
    patch({
      status: 'update',
      updateApplying: activationRequested,
      updateMessage: state.updateMessage || UPDATE_READY_MESSAGE,
    });
  } else if (!activationRequested && !activationAwaitingReload) {
    patch({
      status: current.active ? 'ready' : 'preparing',
      updateApplying: false,
      updateMessage: undefined,
    });
  }
  if (waiting) void maybeApplyWaitingUpdate();
}

function bindRegistration(next: ServiceWorkerRegistration) {
  clearRegistration();
  registration = next;
  const current = next;
  // A controllerchange for the first installation only attaches this page to
  // the worker. Pages already controlled by an older worker must treat the
  // same event as an update, including when another open tab initiated it.
  let hadController = !!navigator.serviceWorker.controller;
  let workerCleanup: (() => void) | undefined;
  const refresh = () => {
    if (registration !== current) return;
    updateWaitingState(current);
  };
  const watch = () => {
    if (registration !== current) return;
    workerCleanup?.();
    workerCleanup = undefined;
    const worker = current.installing;
    if (worker) {
      const onStateChange = () => {
        if (registration !== current) return;
        if (worker.state === 'redundant' && !current.active) {
          retryableFailure = true;
          clearRegistration(current);
          patch({ status: 'error', updateApplying: false, updateMessage: undefined });
        } else refresh();
      };
      worker.addEventListener('statechange', onStateChange);
      workerCleanup = () => worker.removeEventListener('statechange', onStateChange);
    }
    refresh();
  };
  const onControllerChange = () => {
    if (registration !== current) return;
    if (activationRequested && activationRegistration === current) {
      clearActivationRequest();
      if (!hadController) {
        // The first service worker takeover only attaches this page to the
        // worker. There is no older app version to preserve or reload.
        hadController = true;
        activationAwaitingReload = false;
        activationSnapshotPersisted = false;
        activationRegistration = undefined;
        activationReload = undefined;
        refresh();
        return;
      }
      activationAwaitingReload = true;
      activationRegistration = current;
      patch({
        status: 'update',
        updateApplying: false,
        updateMessage: UPDATE_CONTROLLER_MESSAGE,
      });
      void maybeApplyActivatedUpdate();
      hadController = true;
      return;
    }
    if (!hadController) {
      hadController = true;
      refresh();
      return;
    }
    activationAwaitingReload = true;
    activationSnapshotPersisted = false;
    activationRegistration = current;
    patch({
      status: 'update',
      updateApplying: false,
      updateMessage: UPDATE_CONTROLLER_MESSAGE,
    });
    void maybeApplyActivatedUpdate();
    refresh();
  };
  current.addEventListener('updatefound', watch);
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  registrationCleanup = () => {
    workerCleanup?.();
    workerCleanup = undefined;
    current.removeEventListener('updatefound', watch);
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    if (registration === current) registration = undefined;
  };
  watch();
}

function installStandaloneTracking() {
  const standalone = (standaloneMedia ??= matchMedia('(display-mode: standalone)'));
  const updateInstalled = () =>
    patch({
      installed:
        standalone.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
  updateInstalled();
  if (!standaloneChange) {
    standaloneChange = updateInstalled;
    standalone.addEventListener('change', standaloneChange);
  }
}

export function initializePwa(): Promise<void> {
  if (!isPwaBuild) return Promise.resolve();
  if (initialization && !(retryableFailure && !registration)) return initialization;
  if (retryableFailure && !registration) {
    initialization = undefined;
    started = false;
  }
  started = true;
  retryableFailure = false;
  initialization = (async () => {
    installStandaloneTracking();
    patch({ online: navigator.onLine });
    if (!lifecycleInstalled) {
      installLifecycleChecks();
      lifecycleInstalled = true;
    }
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      patch({ status: 'unavailable', updateMessage: undefined });
      return;
    }
    try {
      const next = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), {
        scope: new URL('./', document.baseURI).pathname,
        updateViaCache: 'none',
      });
      bindRegistration(next);
      // Installation downloads the app in the background without delaying the editor.
      scheduleVisibleCheck();
    } catch {
      retryableFailure = true;
      patch({ status: 'error', updateMessage: undefined });
    }
  })();
  return initialization;
}

function readReloadGate(coordinator: PwaUpdateCoordinator): PwaUpdateGate {
  if (!coordinator.canReload) return { allowed: true };
  try {
    const result = coordinator.canReload();
    return typeof result === 'boolean' ? { allowed: result } : result;
  } catch (error) {
    return {
      allowed: false,
      reason:
        error instanceof Error
          ? `Update waiting for editor state: ${error.message}`
          : UPDATE_SAFETY_MESSAGE,
    };
  }
}

function reportCoordinatorError(coordinator: PwaUpdateCoordinator | undefined, message: string) {
  try {
    coordinator?.onError?.(message);
  } catch {
    // Error reporting must never prevent the update from remaining blocked.
  }
}

function deferredUpdate(message: string): PwaUpdateResult {
  patch({ status: 'update', updateApplying: false, updateMessage: message });
  return { status: 'deferred', message };
}

/**
 * Finish an activation that already changed this page's controller. This path
 * is used both after our own SKIP_WAITING request and when another tab caused
 * controllerchange. The page must still persist and recheck its own editor
 * state before reloading.
 */
function applyActivatedUpdate(force = false): Promise<PwaUpdateResult> {
  if (applyUpdatePromise) return applyUpdatePromise;
  if (!activationAwaitingReload)
    return Promise.resolve({ status: 'unavailable', message: 'No activated update is waiting.' });
  const coordinator = updateCoordinator;
  if (!coordinator)
    return Promise.resolve(deferredUpdate('Save a recovery copy before applying the update.'));
  if (!force && autoApplyBlocked) {
    const message = state.updateMessage || UPDATE_PERSISTENCE_MESSAGE;
    return Promise.resolve({ status: 'failed', message });
  }
  const gate = readReloadGate(coordinator);
  if (!gate.allowed) {
    activationSnapshotPersisted = false;
    return Promise.resolve(deferredUpdate(gate.reason || UPDATE_SAFETY_MESSAGE));
  }
  const run = (async (): Promise<PwaUpdateResult> => {
    patch({
      status: 'update',
      updateApplying: true,
      updateMessage: activationSnapshotPersisted
        ? 'Checking editor state before reload…'
        : 'Saving a recovery copy…',
    });
    try {
      if (!activationSnapshotPersisted) {
        const persisted = await coordinator.persistSnapshot();
        if (persisted === false) throw Error(UPDATE_PERSISTENCE_MESSAGE);
        activationSnapshotPersisted = true;
      }
      // Editing/playback can become active while IndexedDB is writing. Do not
      // reload until the editor is safe again.
      const afterPersist = readReloadGate(coordinator);
      if (!afterPersist.allowed) {
        activationSnapshotPersisted = false;
        return deferredUpdate(afterPersist.reason || UPDATE_SAFETY_MESSAGE);
      }
      if (!activationAwaitingReload)
        return deferredUpdate('The update is no longer waiting for a safe reload. Check again.');
      const reload = activationReload ?? coordinator.reload ?? currentReload();
      activationAwaitingReload = false;
      activationRegistration = undefined;
      activationReload = undefined;
      patch({ status: 'ready', updateApplying: false, updateMessage: undefined });
      try {
        reload();
        return { status: 'applied' };
      } catch (error) {
        activationAwaitingReload = true;
        const message =
          error instanceof Error
            ? `Update activated, but this page could not reload: ${error.message}`
            : 'Update activated, but this page could not reload. Refresh when convenient.';
        reportCoordinatorError(coordinator, message);
        patch({ status: 'update', updateApplying: false, updateMessage: message });
        return { status: 'failed', message };
      }
    } catch (error) {
      if (activationRequested) {
        activationRequested = false;
        activationRegistration = undefined;
        activationReload = undefined;
        activationSnapshotPersisted = false;
      }
      autoApplyBlocked = true;
      const message =
        error instanceof Error && error.message !== UPDATE_PERSISTENCE_MESSAGE
          ? `${UPDATE_PERSISTENCE_MESSAGE} (${error.message})`
          : UPDATE_PERSISTENCE_MESSAGE;
      reportCoordinatorError(coordinator, message);
      patch({ status: 'update', updateApplying: false, updateMessage: message });
      return { status: 'failed', message };
    } finally {
      applyUpdatePromise = undefined;
    }
  })();
  applyUpdatePromise = run;
  return run;
}

function applyWaitingUpdate(force = false): Promise<PwaUpdateResult> {
  if (applyUpdatePromise) return applyUpdatePromise;
  if (activationAwaitingReload) return applyActivatedUpdate(force);
  if (activationRequested) return Promise.resolve({ status: 'applied' });
  const current = registration;
  const waiting = current?.waiting;
  if (!current || !waiting)
    return Promise.resolve({ status: 'unavailable', message: 'No update is ready.' });
  const coordinator = updateCoordinator;
  if (!coordinator) {
    const message = 'Save a recovery copy before applying the update.';
    patch({ status: 'update', updateApplying: false, updateMessage: message });
    return Promise.resolve({ status: 'deferred', message });
  }
  if (!force && autoApplyBlocked) {
    const message = state.updateMessage || UPDATE_PERSISTENCE_MESSAGE;
    return Promise.resolve({ status: 'failed', message });
  }
  const gate = readReloadGate(coordinator);
  if (!gate.allowed) {
    const message = gate.reason || UPDATE_SAFETY_MESSAGE;
    patch({ status: 'update', updateApplying: false, updateMessage: message });
    return Promise.resolve({ status: 'deferred', message });
  }
  const run = (async (): Promise<PwaUpdateResult> => {
    activationSnapshotPersisted = false;
    patch({ status: 'update', updateApplying: true, updateMessage: 'Saving a recovery copy…' });
    try {
      const persisted = await coordinator.persistSnapshot();
      if (persisted === false) throw Error(UPDATE_PERSISTENCE_MESSAGE);
      const afterPersist = readReloadGate(coordinator);
      if (!afterPersist.allowed) {
        activationSnapshotPersisted = false;
        return deferredUpdate(afterPersist.reason || UPDATE_SAFETY_MESSAGE);
      }
      activationSnapshotPersisted = true;
      // A second update may have superseded this worker while the snapshot was
      // being written. Always activate the currently waiting worker.
      const latestRegistration = registration;
      const latest = latestRegistration?.waiting;
      if (!latest || latestRegistration !== current) {
        if (activationAwaitingReload) return deferredUpdate(UPDATE_CONTROLLER_MESSAGE);
        const message = 'The update changed while the recovery copy was being saved. Check again.';
        return deferredUpdate(message);
      }
      activationRequested = true;
      activationRegistration = latestRegistration;
      activationReload = coordinator.reload ?? currentReload();
      patch({ status: 'update', updateApplying: true, updateMessage: 'Applying update…' });
      latest.postMessage({ type: 'SKIP_WAITING' });
      return { status: 'applied' };
    } catch (error) {
      if (activationRequested) {
        activationRequested = false;
        activationRegistration = undefined;
        activationReload = undefined;
        activationSnapshotPersisted = false;
      }
      autoApplyBlocked = true;
      const message =
        error instanceof Error && error.message !== UPDATE_PERSISTENCE_MESSAGE
          ? `${UPDATE_PERSISTENCE_MESSAGE} (${error.message})`
          : UPDATE_PERSISTENCE_MESSAGE;
      reportCoordinatorError(coordinator, message);
      patch({ status: 'update', updateApplying: false, updateMessage: message });
      return { status: 'failed', message };
    } finally {
      applyUpdatePromise = undefined;
      if (activationAwaitingReload && updateCoordinator && !autoApplyBlocked)
        queueMicrotask(() => void maybeApplyActivatedUpdate());
    }
  })();
  applyUpdatePromise = run;
  return run;
}

async function maybeApplyWaitingUpdate() {
  if (
    !updateCoordinator ||
    autoApplyBlocked ||
    activationRequested ||
    activationAwaitingReload ||
    applyUpdatePromise ||
    !registration?.waiting
  )
    return;
  await applyWaitingUpdate();
}

async function maybeApplyActivatedUpdate() {
  if (!updateCoordinator || autoApplyBlocked || applyUpdatePromise || !activationAwaitingReload)
    return;
  await applyActivatedUpdate();
}

/**
 * Connect the editor's recovery and interaction state to PWA activation.
 * Configuring this is what enables automatic activation; without it a waiting
 * worker remains visible and cannot reload over an unsaved document.
 */
export function configurePwaUpdate(coordinator?: PwaUpdateCoordinator) {
  updateCoordinator = coordinator;
  autoApplyBlocked = false;
  if (coordinator && registration?.waiting) void maybeApplyWaitingUpdate();
  if (coordinator && activationAwaitingReload) void maybeApplyActivatedUpdate();
  return () => {
    if (updateCoordinator === coordinator) updateCoordinator = undefined;
  };
}

/** Apply the waiting worker after persisting the latest recoverable document. */
export function applyPwaUpdate(options?: { force?: boolean }) {
  return applyWaitingUpdate(options?.force === true);
}

/** Notify PWA update coordination that a controller edit/playback is idle. */
export function notifyPwaIdle() {
  if (!registration || (!registration.waiting && !activationAwaitingReload))
    return Promise.resolve({
      status: 'unavailable',
      message: 'No update is ready.',
    } as PwaUpdateResult);
  return applyWaitingUpdate();
}

export async function checkAppUpdate(options?: { force?: boolean }) {
  if (!isPwaBuild || !navigator.onLine || !isVisible()) return;
  if (!registration) {
    if (!started) await initializePwa();
    else if (initialization) await initialization;
    if (!registration && retryableFailure) await initializePwa();
  }
  if (!registration) return;
  const now = Date.now();
  if (!options?.force && now - lastUpdateCheck < UPDATE_CHECK_MIN_INTERVAL) return;
  if (updateCheck) return updateCheck;
  lastUpdateCheck = now;
  const current = registration;
  updateCheck = (async () => {
    try {
      await current.update();
      if (registration === current && current.waiting) void maybeApplyWaitingUpdate();
    } catch {
      if (registration === current && !current.active) {
        retryableFailure = true;
        clearRegistration(current);
        patch({ status: 'error', updateApplying: false, updateMessage: undefined });
      }
    } finally {
      updateCheck = undefined;
    }
  })();
  return updateCheck;
}

/**
 * Returns local-only diagnostics for troubleshooting viewport/update issues.
 * The app never collects or sends this data automatically.
 */
export function getPwaDiagnostics() {
  const visual = window.visualViewport;
  const standalone =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const build =
    document.querySelector('meta[name="pose-build"]')?.getAttribute('content') ||
    document.querySelector('meta[name="application-version"]')?.getAttribute('content') ||
    'unknown';
  return [
    'Pose Studio PWA diagnostics',
    `build=${build}`,
    `mode=${standalone ? 'standalone' : 'browser'}`,
    `status=${state.status}`,
    `updateApplying=${state.updateApplying === true}`,
    `updateMessage=${state.updateMessage || 'none'}`,
    `online=${navigator.onLine}`,
    `viewport=${window.innerWidth}x${window.innerHeight}`,
    `visualViewport=${visual ? `${visual.width}x${visual.height} @ ${visual.offsetLeft},${visual.offsetTop} scale=${visual.scale}` : 'unavailable'}`,
    `screen=${window.screen.width}x${window.screen.height}`,
    `devicePixelRatio=${window.devicePixelRatio}`,
  ].join('\n');
}
