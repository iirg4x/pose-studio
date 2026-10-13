import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

function makeRegistration(update: ReturnType<typeof vi.fn>, active: object | null = {}) {
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
    waiting: undefined,
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

function makeEnvironment(register: () => Promise<Record<string, unknown>>) {
  const windowListeners = new Map<string, Set<Listener>>();
  const documentListeners = new Map<string, Set<Listener>>();
  const serviceWorkerListeners = new Map<string, Set<Listener>>();
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
    addEventListener: vi.fn((type: string, listener: Listener) =>
      add(serviceWorkerListeners, type, listener),
    ),
    removeEventListener: vi.fn((type: string, listener: Listener) =>
      remove(serviceWorkerListeners, type, listener),
    ),
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
    setInterval,
    clearInterval,
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
  return {
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
  };
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
});
