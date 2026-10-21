import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { serviceWorkerSource } from '../shared/pwa-build.mjs';

const ROOT = 'https://example.test/pose-studio/';
const FILES = ['index.html', 'assets/app.js', 'assets/manny.glb'] as const;

function url(file: string) {
  return new URL(file, ROOT).href;
}

function cacheName(revision: string) {
  return 'pose-studio-shell:' + ROOT + ':' + revision;
}

async function sha256(value: string) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashesFor(bodies: Record<string, string>) {
  return Object.fromEntries(
    await Promise.all(FILES.map(async (file) => [file, await sha256(bodies[file])])),
  );
}

type WorkerOptions = {
  hashes: Record<string, string>;
  fetchBodies: Record<string, string>;
  fetchStatuses?: Record<string, number>;
  oldCaches?: Record<string, Record<string, string>>;
};

function worker(options: WorkerOptions) {
  const listeners: Record<string, (event: any) => void> = {};
  const stored = new Map<string, Map<string, Response>>();
  const requests: string[] = [];
  const claimed = { value: false };

  for (const [name, entries] of Object.entries(options.oldCaches ?? {})) {
    stored.set(
      name,
      new Map(Object.entries(entries).map(([key, value]) => [key, new Response(value)])),
    );
  }

  const caches = {
    async open(name: string) {
      let data = stored.get(name);
      if (!data) stored.set(name, (data = new Map()));
      return {
        async put(key: string, value: Response) {
          data!.set(key, value.clone());
        },
        async match(key: string) {
          return data!.get(key)?.clone();
        },
      };
    },
    async keys() {
      return [...stored.keys()];
    },
    async delete(name: string) {
      return stored.delete(name);
    },
  };
  const fetch = async (request: Request) => {
    const body = options.fetchBodies[request.url];
    requests.push(request.url);
    return new Response(body, { status: options.fetchStatuses?.[request.url] ?? 200 });
  };

  vm.runInNewContext(serviceWorkerSource([...FILES], 'new', options.hashes), {
    self: {
      location: { href: ROOT + 'sw.js' },
      crypto: webcrypto,
      clients: {
        async claim() {
          claimed.value = true;
        },
      },
      addEventListener(type: string, listener: (event: any) => void) {
        listeners[type] = listener;
      },
    },
    caches,
    fetch,
    URL,
    Request,
    Response,
    Set,
    Uint8Array,
    Error,
  });

  const event = async (type: string) => {
    let task: Promise<unknown> | undefined;
    listeners[type]({
      waitUntil(promise: Promise<unknown>) {
        task = promise;
      },
    });
    if (task) await task;
  };

  return { stored, requests, event, claimed };
}

function entries(bodies: Record<string, string>) {
  return Object.fromEntries(FILES.map((file) => [url(file), bodies[file]]));
}

describe('PWA immutable asset reuse', () => {
  it('reuses unchanged responses from the previous Pose Studio cache without network requests', async () => {
    const bodies = {
      'index.html': 'editor',
      'assets/app.js': 'application',
      'assets/manny.glb': 'large-model',
    };
    const w = worker({
      hashes: await hashesFor(bodies),
      fetchBodies: Object.fromEntries(FILES.map((file) => [url(file), 'network'])),
      oldCaches: { [cacheName('old')]: entries(bodies) },
    });

    await w.event('install');

    expect(w.requests).toEqual([]);
    expect(w.stored.has(cacheName('old'))).toBe(true);
    expect(w.stored.has(cacheName('new'))).toBe(true);
    for (const file of FILES)
      expect(await w.stored.get(cacheName('new'))!.get(url(file))!.text()).toBe(bodies[file]);
  });

  it('refetches only the asset whose expected hash changed', async () => {
    const oldBodies = {
      'index.html': 'editor',
      'assets/app.js': 'application-v1',
      'assets/manny.glb': 'large-model',
    };
    const currentBodies = { ...oldBodies, 'assets/app.js': 'application-v2' };
    const w = worker({
      hashes: await hashesFor(currentBodies),
      fetchBodies: Object.fromEntries(FILES.map((file) => [url(file), currentBodies[file]])),
      oldCaches: { [cacheName('old')]: entries(oldBodies) },
    });

    await w.event('install');

    expect(w.requests).toEqual([url('assets/app.js')]);
    expect(await w.stored.get(cacheName('new'))!.get(url('assets/app.js'))!.text()).toBe(
      currentBodies['assets/app.js'],
    );
  });

  it('never reuses a matching response from an unrelated cache', async () => {
    const bodies = {
      'index.html': 'editor',
      'assets/app.js': 'application',
      'assets/manny.glb': 'large-model',
    };
    const w = worker({
      hashes: await hashesFor(bodies),
      fetchBodies: Object.fromEntries(FILES.map((file) => [url(file), 'network'])),
      oldCaches: { 'another-app-cache': entries(bodies) },
    });

    await w.event('install');

    expect(w.requests).toEqual(FILES.map(url));
  });

  it('keeps the previous cache when a changed asset fails to download', async () => {
    const oldBodies = {
      'index.html': 'editor',
      'assets/app.js': 'application-v1',
      'assets/manny.glb': 'large-model',
    };
    const currentBodies = { ...oldBodies, 'assets/app.js': 'application-v2' };
    const oldCache = cacheName('old');
    const w = worker({
      hashes: await hashesFor(currentBodies),
      fetchBodies: Object.fromEntries(FILES.map((file) => [url(file), currentBodies[file]])),
      fetchStatuses: { [url('assets/app.js')]: 503 },
      oldCaches: { [oldCache]: entries(oldBodies) },
    });

    await expect(w.event('install')).rejects.toThrow('Could not download');

    expect(w.stored.has(cacheName('new'))).toBe(false);
    expect(w.stored.has(oldCache)).toBe(true);
    for (const file of FILES)
      expect(await w.stored.get(oldCache)!.get(url(file))!.text()).toBe(oldBodies[file]);
  });
});
