import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { serviceWorkerSource } from '../shared/pwa-build.mjs';

function worker(revision = 'one', fail = false) {
  const listeners: Record<string, (event: any) => void> = {},
    stored = new Map<string, Map<string, Response>>(),
    requests: string[] = [],
    claimed: { value: boolean } = { value: false },
    skipped: { value: boolean } = { value: false };
  const caches = {
    async open(name: string) {
      let data = stored.get(name);
      if (!data) stored.set(name, (data = new Map()));
      return {
        async put(key: string, value: Response) {
          data!.set(key, value);
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
    requests.push(request.url);
    if (fail && request.url.endsWith('app.js')) return new Response('missing', { status: 404 });
    return new Response(request.url.endsWith('index.html') ? 'EDITOR' : 'ASSET');
  };
  vm.runInNewContext(
    serviceWorkerSource(['index.html', 'assets/app.js', 'assets/manny.glb'], revision),
    {
      self: {
        location: { href: 'https://example.test/pose-studio/sw.js' },
        registration: { scope: 'https://example.test/pose-studio/' },
        clients: {
          async claim() {
            claimed.value = true;
          },
        },
        skipWaiting() {
          skipped.value = true;
        },
        addEventListener(type: string, fn: (e: any) => void) {
          listeners[type] = fn;
        },
      },
      caches,
      fetch,
      URL,
      Request,
      Set,
      Error,
    },
  );
  const event = async (type: string) => {
    let task: Promise<unknown> | undefined;
    listeners[type]({
      waitUntil(p: Promise<unknown>) {
        task = p;
      },
    });
    await task;
  };
  const message = (data: unknown) => listeners.message({ data });
  const request = async (url: string, mode = 'cors', method = 'GET') => {
    let result: Promise<Response> | undefined;
    listeners.fetch({
      request: { url, mode, method },
      respondWith(p: Promise<Response>) {
        result = p;
      },
    });
    return result ? await (await result).text() : undefined;
  };
  return { stored, requests, event, request, message, claimed, skipped };
}
describe('installable studio cache', () => {
  it('installs the complete shell under a nested Pages path and works offline', async () => {
    const w = worker();
    await w.event('install');
    expect(w.requests).toHaveLength(3);
    expect(w.requests.every((url) => url.startsWith('https://example.test/pose-studio/'))).toBe(
      true,
    );
    expect(await w.request('https://example.test/pose-studio/?installed=1', 'navigate')).toBe(
      'EDITOR',
    );
    expect(await w.request('https://example.test/pose-studio/assets/manny.glb')).toBe('ASSET');
    expect(w.requests).toHaveLength(3);
  });
  it('does not intercept or cache private APIs, project files, mutations or other origins', async () => {
    const w = worker();
    await w.event('install');
    for (const url of [
      'https://example.test/api/catalog',
      'https://example.test/pose-studio/api/clips/private',
      'https://example.test/pose-studio/private.pose',
      'https://other.test/pose-studio/assets/app.js',
    ])
      expect(await w.request(url)).toBeUndefined();
    expect(
      await w.request('https://example.test/pose-studio/assets/app.js', 'cors', 'POST'),
    ).toBeUndefined();
  });
  it('removes a partial offline download instead of reporting installation success', async () => {
    const w = worker('broken', true);
    await expect(w.event('install')).rejects.toThrow('Could not download');
    expect(w.stored.size).toBe(0);
  });
  it('cleans old caches only after activation, preserving unrelated apps', async () => {
    const w = worker();
    w.stored.set('pose-studio-shell:https://example.test/pose-studio/:old', new Map());
    w.stored.set('another-app', new Map());
    await w.event('install');
    expect(w.stored.size).toBe(3);
    expect(w.claimed.value).toBe(false);
    await w.event('activate');
    expect(w.stored.size).toBe(2);
    expect(w.stored.has('another-app')).toBe(true);
    expect(w.claimed.value).toBe(true);
  });
  it('keeps updates waiting until the page explicitly asks to activate them', async () => {
    const w = worker();
    await w.event('install');
    expect(w.skipped.value).toBe(false);
    w.message({ type: 'SKIP_WAITING' });
    expect(w.skipped.value).toBe(true);
    w.message({ type: 'other-message' });
    expect(w.skipped.value).toBe(true);
  });
});
