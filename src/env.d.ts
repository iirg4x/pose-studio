import type { StudioStore } from './core/store';
import type { StudioScene } from './scene/StudioScene';
declare global {
  /** The package version, injected at build time. */
  const __APP_VERSION__: string;
  interface Window {
    studioDesktop?: {
      platform?: 'android' | 'desktop' | 'web';
      /** Choose a folder for an Unreal export. Null when the user cancels. */
      beginExport: (
        name: string,
        shared?: boolean,
      ) => Promise<{ id: string; directory: string } | null>;
      /** Add one file, by its path inside the export folder. */
      writeExport: (id: string, path: string, data: Uint8Array) => Promise<void>;
      finishExport: (id: string) => Promise<{ directory: string; files: string[] }>;
      cancelExport: (id: string) => Promise<void>;
      /** Let the user choose an animation file; the app reads it itself. */
      pickAnimation: () => Promise<import('./platform/imports').PickedFile | null>;
      /** Let the user choose a character or prop file. */
      pickModel: (
        kind: 'character' | 'prop',
      ) => Promise<import('./platform/imports').PickedFile | null>;
      /** A texture or buffer stored beside a chosen model. Desktop only; null elsewhere. */
      readSidecar: (token: string, name: string) => Promise<Uint8Array | null>;
      /** Keep a converted GLB and return its asset id. */
      storeModel: (data: Uint8Array) => Promise<string>;
      openExample: () => Promise<unknown>;
      readCharacter: (id: string) => Promise<Uint8Array>;
      exportCharacter: (
        data: Uint8Array,
        options: { name: string; format: 'glb' | 'fbx'; fps: number; end: number },
      ) => Promise<string | null>;
      beginRecording: (options: {
        name: string;
        format: 'mp4' | 'webm';
      }) => Promise<{ id: string; path: string } | null>;
      writeRecording: (id: string, data: Uint8Array, position: number) => Promise<void>;
      finishRecording: (id: string) => Promise<string>;
      cancelRecording: (id: string) => Promise<void>;
      revealRecording: (filename: string) => Promise<void>;
      confirmClose: () => Promise<void>;
      onCloseRequest: (callback: () => void) => () => void;
      status: () => Promise<{ maximized: boolean }>;
      saveProject: (p: unknown) => Promise<string | null>;
      openProject: (options?: { recovery?: boolean }) => Promise<unknown | null>;
      takeProject: () => Promise<unknown | null>;
      onProjectQueued: (callback: () => void) => () => void;
      recentProjects: () => Promise<{ path: string; name: string; openedAt: string }[]>;
      openRecentProject: (path: string) => Promise<unknown>;
      clearRecentProjects: () => Promise<void>;
      showFolder: (path: string) => Promise<void>;
      onWindowState: (callback: (state: { maximized: boolean }) => void) => () => void;
      windowAction: (action: 'minimize' | 'maximize' | 'close') => void;
    };
    __studio?: StudioStore;
    __scene?: StudioScene | null;
  }
}
export {};
