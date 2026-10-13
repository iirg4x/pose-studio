export const isPwaBuild = import.meta.env.MODE === 'pwa';
export type AppInstallState = {
  status: 'preparing' | 'ready' | 'update' | 'unavailable' | 'error';
  installed: boolean;
  online: boolean;
};
let state: AppInstallState = { status: 'preparing', installed: false, online: true };
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | undefined;
let started = false;
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
export async function initializePwa() {
  if (!isPwaBuild || started) return;
  started = true;
  const standalone = matchMedia('(display-mode: standalone)');
  const updateInstalled = () =>
    patch({
      installed:
        standalone.matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
  updateInstalled();
  standalone.addEventListener('change', updateInstalled);
  patch({ online: navigator.onLine });
  window.addEventListener('offline', () => patch({ online: false }));
  window.addEventListener('online', () => {
    patch({ online: true });
    void checkAppUpdate();
  });
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    patch({ status: 'unavailable' });
    return;
  }
  try {
    registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI), {
      scope: new URL('./', document.baseURI).pathname,
      updateViaCache: 'none',
    });
    const refresh = () =>
      patch({
        status: registration!.waiting ? 'update' : registration!.active ? 'ready' : 'preparing',
      });
    const watch = () => {
      const worker = registration!.installing;
      if (worker)
        worker.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && !registration!.active) patch({ status: 'error' });
          else refresh();
        });
      refresh();
    };
    registration.addEventListener('updatefound', watch);
    watch();
    navigator.serviceWorker.addEventListener('controllerchange', refresh);
    // Installation downloads the app in the background without delaying the editor.
  } catch {
    patch({ status: 'error' });
  }
}
export async function checkAppUpdate() {
  if (!registration) {
    started = false;
    return initializePwa();
  }
  try {
    await registration.update();
  } catch {
    if (!registration.active) patch({ status: 'error' });
  }
}
