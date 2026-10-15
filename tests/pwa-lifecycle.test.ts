import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const environments = new Set<{ cleanup: () => void }>();

function makeWaitingWorker() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    state: 'installed' as ServiceWorkerState,
    postMessage: vi.fn(),
    addEventListener: vi.fn((type: string, listener: Listener) => {
      let entries = listeners.get(type);
      if (!entries) listeners.set(type, (entries = new Set()));
      entries.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
  } as unknown as ServiceWorker;
}

function makeRegistration(
  update: ReturnType<typeof vi.fn>,
  active: object | null = {},
  waiting: ServiceWorker | undefined = undefined,
) {
  const listeners = new Map<string, Set<Listener>>();
  const addEventListener = vi.fn((type: string, listener: Listener) => {
    let entries = listeners.get(type);
    if (!entries) listeners.set(type, (entries = new Set()));
    entries.add(listener);
  });
  const removeEventListener = vi.fn((type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  });
  return {
    active,
    waiting,
    installing: undefined,
    update,
    addEventListener,
    removeEventListener,
    listeners,
    dispatch(type: string) {
      listeners.get(type)?.forEach((listener) => listener({}));
    },
  };
}

function makeEnvironment(
  register: () => Promise<Record<string, unknown>>,
  options: { controller?: object | null } = {},
) {
  const windowListeners = new Map<string, Set<Listener>>();
  const documentListeners = new Map<string, Set<Listener>>();
  const serviceWorkerListeners = new Map<string, Set<Listener>>();
  const activeIntervals = new Set<ReturnType<typeof setInterval>>();
  const standaloneChange = vi.fn();
  const add = (map: Map<string, Set<Listener>>, type: string, listener: Listener) => {
    let listeners = map.get(type);
    if (!listeners) map.set(type, (listeners = new Set()));
    listeners.add(listener);
  };
  const remove = (map: Map<string, Set<Listener>>, type: string, listener: Listener) =>
    map.get(type)?.delete(listener);
  const dispatch = (map: Map<string, Set<Listener>>, type: string) =>
    map.get(type)?.forEach((listener) => listener({}));
  const serviceWorker = {
    register: vi.fn(register),
    controller: options.controller === undefined ? {} : options.controller,
    addEventListener: vi.fn((type: string, listener: Listener) =>
      add(serviceWorkerListeners, type, listener),
    ),
    removeEventListener: vi.fn((type: string, listener: Listener) =>
      remove(serviceWorkerListeners, type, listener),
    ),
  };
  const setWindowInterval = (
    handler: Parameters<typeof setInterval>[0],
    timeout?: number,
  ): ReturnType<typeof setInterval> => {
    const handle = setInterval(handler, timeout);
    activeIntervals.add(handle);
    return handle;
  };
  const clearWindowInterval = (handle: ReturnType<typeof setInterval>) => {
    clearInterval(handle);
    activeIntervals.delete(handle);
  };
  const documentMock = {
    baseURI: 'https://example.test/pose-studio/',
    visibilityState: 'visible',
    addEventListener: (type: string, listener: Listener) => add(documentListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) =>
      remove(documentListeners, type, listener),
  };
  const windowMock = {
    innerWidth: 390,
    innerHeight: 760,
    devicePixelRatio: 2,
    screen: { width: 390, height: 844 },
    visualViewport: undefined,
    setInterval: setWindowInterval,
    clearInterval: clearWindowInterval,
    addEventListener: (type: string, listener: Listener) => add(windowListeners, type, listener),
    removeEventListener: (type: string, listener: Listener) =>
      remove(windowListeners, type, listener),
  };
  const navigatorMock = {
    onLine: true,
    userAgent: 'test',
    maxTouchPoints: 0,
    serviceWorker,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorMock });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: standaloneChange }),
  });
  const environment = {
    windowListeners,
    documentListeners,
    serviceWorkerListeners,
    standaloneChange,
    serviceWorker,
    dispatchWindow: (type: string) => dispatch(windowListeners, type),
    dispatchDocument: (type: string) => dispatch(documentListeners, type),
    dispatchServiceWorker: (type: string) => dispatch(serviceWorkerListeners, type),
    setVisible(value: 'hidden' | 'visible') {
      documentMock.visibilityState = value;
    },
    setOnline(value: boolean) {
      navigatorMock.onLine = value;
    },
    cleanup() {
      for (const handle of activeIntervals) clearWindowInterval(handle);
      activeIntervals.clear();
    },
  };
  environments.add(environment);
  return environment;
}

async function loadPwa() {
  vi.resetModules();
  vi.stubEnv('MODE', 'pwa');
  return import('../src/platform/pwa');
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const environment of environments) environment.cleanup();
  environments.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('PWA update lifecycle', () => {
  it('rate-limits foreground checks and skips hidden/offline checks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn(async () => undefined);
    const registration = makeRegistration(update);
    const environment = makeEnvironment(async () => registration);
    const pwa = await loadPwa();
    await pwa.initializePwa();
    await flush();
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(1);

    environment.dispatchWindow('pageshow');
    await flush();
    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(59_999);
    environment.dispatchWindow('pageshow');
    await flush();
    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    environment.dispatchWindow('pageshow');
    await flush();
    expect(update).toHaveBeenCalledTimes(2);

    environment.setOnline(false);
    environment.dispatchWindow('offline');
    environment.dispatchWindow('pageshow');
    await flush();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('retries a failed registration without duplicating lifecycle listeners', async () => {
    const update = vi.fn(async () => undefined);
    const registration = makeRegistration(update);
    let attempt = 0;
    const environment = makeEnvironment(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('temporary registration failure');
      return registration;
    });
    const pwa = await loadPwa();

    await pwa.initializePwa();
    expect(pwa.appInstallSnapshot().status).toBe('error');
    expect(environment.documentListeners.get('visibilitychange')?.size).toBe(1);

    await pwa.checkAppUpdate({ force: true });
    await flush();
    expect(attempt).toBe(2);
    expect(update.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(environment.documentListeners.get('visibilitychange')?.size).toBe(1);
    expect(environment.serviceWorkerListeners.get('controllerchange')?.size).toBe(1);
    expect(environment.standaloneChange).toHaveBeenCalledTimes(1);
  });

  it('detaches a stale registration after update failure and safely retries', async () => {
    const staleUpdate = vi.fn(async () => {
      throw new Error('worker has no active controller');
    });
    const freshUpdate = vi.fn(async () => undefined);
    const stale = makeRegistration(staleUpdate, null);
    const fresh = makeRegistration(freshUpdate);
    let attempt = 0;
    const environment = makeEnvironment(async () => {
      attempt += 1;
      return attempt === 1 ? stale : fresh;
    });
    environment.setVisible('hidden');
    const pwa = await loadPwa();

    await pwa.initializePwa();
    expect(environment.serviceWorkerListeners.get('controllerchange')?.size).toBe(1);
    expect(stale.listeners.get('updatefound')?.size).toBe(1);

    environment.setVisible('visible');
    environment.dispatchWindow('pageshow');
    await flush();
    expect(pwa.appInstallSnapshot().status).toBe('error');
    expect(environment.serviceWorkerListeners.get('controllerchange')?.size).toBe(0);
    expect(stale.listeners.get('updatefound')?.size).toBe(0);

    // Events from the detached worker must be harmless.
    stale.dispatch('updatefound');
    environment.dispatchServiceWorker('controllerchange');
    await pwa.checkAppUpdate({ force: true });
    await flush();
    expect(attempt).toBe(2);
    expect(environment.serviceWorkerListeners.get('controllerchange')?.size).toBe(1);
    expect(fresh.listeners.get('updatefound')?.size).toBe(1);
  });

  it('persists before explicitly activating a waiting worker and reloads after control changes', async () => {
    const update = vi.fn(async () => undefined);
    const waiting = makeWaitingWorker();
    const registration = makeRegistration(update, {}, waiting);
    const environment = makeEnvironment(async () => registration);
    const persisted = vi.fn(async () => undefined);
    const reloaded = vi.fn();
    const pwa = await loadPwa();
    pwa.configurePwaUpdate({
      persistSnapshot: persisted,
      canReload: () => true,
      reload: reloaded,
    });

    await pwa.initializePwa();
    await flush();
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reloaded).not.toHaveBeenCalled();

    environment.dispatchServiceWorker('controllerchange');
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the first install takes control of an open page', async () => {
    const update = vi.fn(async () => undefined);
    const waiting = makeWaitingWorker();
    const registration = makeRegistration(update, {}, waiting);
    const environment = makeEnvironment(async () => registration, { controller: null });
    const persisted = vi.fn(async () => undefined);
    const reloaded = vi.fn();
    const pwa = await loadPwa();
    pwa.configurePwaUpdate({
      persistSnapshot: persisted,
      canReload: () => true,
      reload: reloaded,
    });

    await pwa.initializePwa();
    await flush();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    registration.waiting = undefined;
    environment.dispatchServiceWorker('controllerchange');
    expect(reloaded).not.toHaveBeenCalled();
    expect(pwa.appInstallSnapshot().updateApplying).toBe(false);
  });

  it('keeps a waiting update visible when the recovery write fails', async () => {
    const update = vi.fn(async () => undefined);
    const waiting = makeWaitingWorker();
    const registration = makeRegistration(update, {}, waiting);
    makeEnvironment(async () => registration);
    const reported = vi.fn();
    const pwa = await loadPwa();
    pwa.configurePwaUpdate({
      persistSnapshot: async () => {
        throw Error('quota exceeded');
      },
      canReload: () => true,
      reload: vi.fn(),
      onError: reported,
    });

    await pwa.initializePwa();
    await flush();
    expect(pwa.appInstallSnapshot().status).toBe('update');
    expect(pwa.appInstallSnapshot().updateApplying).toBe(false);
    expect(pwa.appInstallSnapshot().updateMessage).toMatch(/recovery copy/i);
    expect(reported).toHaveBeenCalledWith(expect.stringMatching(/recovery copy/i));
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  it('rechecks the reload gate after persistence and retries once the editor is idle', async () => {
    const update = vi.fn(async () => undefined);
    const waiting = makeWaitingWorker();
    const registration = makeRegistration(update, {}, waiting);
    const environment = makeEnvironment(async () => registration);
    let releasePersist!: () => void;
    let persistCalls = 0;
    const persisted = vi.fn(() => {
      persistCalls += 1;
      if (persistCalls === 1) {
        return new Promise<void>((resolve) => {
          releasePersist = resolve;
        });
      }
      return Promise.resolve();
    });
    const reloaded = vi.fn();
    let allowed = true;
    const pwa = await loadPwa();
    pwa.configurePwaUpdate({
      persistSnapshot: persisted,
      canReload: () => allowed,
      reload: reloaded,
    });

    await pwa.initializePwa();
    await flush();
    expect(persisted).toHaveBeenCalledTimes(1);

    allowed = false;
    releasePersist();
    await flush();
    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(reloaded).not.toHaveBeenCalled();
    expect(pwa.appInstallSnapshot().updateMessage).toMatch(/edit|playback|state/i);

    allowed = true;
    await pwa.notifyPwaIdle();
    expect(persisted).toHaveBeenCalledTimes(2);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    environment.dispatchServiceWorker('controllerchange');
    expect(reloaded).toHaveBeenCalledTimes(1);
  });
});
