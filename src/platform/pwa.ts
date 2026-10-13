export const isPwaBuild = import.meta.env.MODE === 'pwa';
export type AppInstallState = {
  status: 'preparing' | 'ready' | 'update' | 'unavailable' | 'error';
  installed: boolean;
  online: boolean;
};
const UPDATE_CHECK_MIN_INTERVAL = 60_000;
const UPDATE_CHECK_PERIOD = 15 * 60_000;
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
  window.addEventListener('offline', onOffline, { passive: true });
  window.addEventListener('online', onOnline, { passive: true });
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    stopVisibleChecks();
  };
}

function clearRegistration(expected?: ServiceWorkerRegistration) {
  if (expected && registration !== expected) return;
  registrationCleanup?.();
  registrationCleanup = undefined;
  registration = undefined;
}

function bindRegistration(next: ServiceWorkerRegistration) {
  clearRegistration();
  registration = next;
  const current = next;
  let workerCleanup: (() => void) | undefined;
  const refresh = () => {
    if (registration !== current) return;
    patch({
      status: current.waiting ? 'update' : current.active ? 'ready' : 'preparing',
    });
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
          patch({ status: 'error' });
        } else refresh();
      };
      worker.addEventListener('statechange', onStateChange);
      workerCleanup = () => worker.removeEventListener('statechange', onStateChange);
    }
    refresh();
  };
  const onControllerChange = () => refresh();
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
      patch({ status: 'unavailable' });
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
      patch({ status: 'error' });
    }
  })();
  return initialization;
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
    } catch {
      if (registration === current && !current.active) {
        retryableFailure = true;
        clearRegistration(current);
        patch({ status: 'error' });
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
    `online=${navigator.onLine}`,
    `viewport=${window.innerWidth}x${window.innerHeight}`,
    `visualViewport=${visual ? `${visual.width}x${visual.height} @ ${visual.offsetLeft},${visual.offsetTop} scale=${visual.scale}` : 'unavailable'}`,
    `screen=${window.screen.width}x${window.screen.height}`,
    `devicePixelRatio=${window.devicePixelRatio}`,
  ].join('\n');
}
