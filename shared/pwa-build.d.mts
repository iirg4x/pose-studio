import type { Plugin } from 'vite';
export function serviceWorkerSource(
  files: string[],
  revision: string,
  hashes?: Record<string, string>,
): string;
export function posePwa(): Plugin;
