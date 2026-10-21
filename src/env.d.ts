import type { StudioStore } from './core/store';
import type { StudioScene } from './scene/StudioScene';
declare global {
  interface Window {
    studioDesktop?: {
      platform?: 'android' | 'desktop' | 'web';
      beginSharedExport: (
        plan: import('./core/sharedExport').SharedExportPlan,
      ) => Promise<{ id: string; directory: string } | null>;
      writeSharedExport: (
        id: string,
        item: import('./core/sharedExport').SharedExportItem,
        data: Uint8Array,
      ) => Promise<void>;
      finishSharedExport: (id: string) => Promise<{ directory: string; files: string[] }>;
      cancelSharedExport: (id: string) => Promise<void>;
      importProp: () => Promise<{ asset: string; name: string; data: Uint8Array } | null>;
      inspectAnimation: () => Promise<import('./core/importAnimation').AnimationInspection | null>;
      sampleAnimation: (
        token: string,
        options: Record<string, unknown>,
      ) => Promise<import('./core/importAnimation').MotionSource>;
      openExample: () => Promise<unknown>;
      importCharacter: () => Promise<{ asset: string; name: string; data: Uint8Array } | null>;
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
      status: () => Promise<{ blender: string | null; maximized: boolean }>;
      chooseBlender: () => Promise<string | null>;
      saveProject: (p: unknown) => Promise<string | null>;
      openProject: (options?: { recovery?: boolean }) => Promise<unknown | null>;
      takeProject: () => Promise<unknown | null>;
      onProjectQueued: (callback: () => void) => () => void;
      recentProjects: () => Promise<{ path: string; name: string; openedAt: string }[]>;
      openRecentProject: (path: string) => Promise<unknown>;
      clearRecentProjects: () => Promise<void>;
      exportAnimation: (
        payload: unknown,
        options: { includeMesh: boolean },
      ) => Promise<{ canceled?: boolean; directory: string; files: string[] }>;
      showFolder: (path: string) => Promise<void>;
      onWindowState: (callback: (state: { maximized: boolean }) => void) => () => void;
      windowAction: (action: 'minimize' | 'maximize' | 'close') => void;
    };
    __studio?: StudioStore;
    __scene?: StudioScene | null;
  }
}
export {};
