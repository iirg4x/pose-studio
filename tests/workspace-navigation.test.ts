import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/model';
import type { AnimationLibrary } from '../src/core/library';
import type { RetargetCharacter } from '../src/core/retarget';
import { StudioStore } from '../src/core/store';
import type { WorkspaceHistoryState } from '../src/core/store/workspaceHistory';

class InstrumentedStore extends StudioStore {
  captureCount = 0;

  protected override captureWorkspaceHistoryState(
    workspace?: AnimationLibrary | null,
  ): WorkspaceHistoryState | null {
    this.captureCount++;
    return super.captureWorkspaceHistoryState(workspace);
  }

  get workspaceHistoryLengths() {
    return { past: this.workspacePast.length, future: this.workspaceFuture.length };
  }
}

const character = (id: string): RetargetCharacter => ({
  id,
  name: id,
  asset: 'example-fantasy-male',
  mapping: {},
  hiddenMeshes: [],
  scale: 1,
  facing: 0,
  handIK: true,
  footIK: true,
  offsets: {},
});

const setup = () => {
  const store = new InstrumentedStore();
  store.open(createProject({}, false));
  return store;
};

describe('workspace navigation history', () => {
  it('skips workspace history capture for tab and character navigation', () => {
    const store = setup(),
      first = store.state.workspace!.activeId;
    store.addAnimation({});
    const second = store.state.workspace!.activeId;
    store.addCharacter(character('first'));
    store.addCharacter(character('second'));
    store.renameWorkspace('Renamed');
    store.undo();
    const historyBeforeNavigation = store.workspaceHistoryLengths;
    store.captureCount = 0;

    store.activate(first);
    store.closeAnimation(first);
    store.selectCharacter('first');
    store.selectPreviewCharacter('second');

    expect(store.captureCount).toBe(0);
    expect(store.workspaceHistoryLengths).toEqual(historyBeforeNavigation);
    expect(store.state.workspace!.activeId).toBe(second);
    expect(store.state.workspace!.openIds).toEqual([second]);
    expect(store.state.workspace!.activeCharacterId).toBe('second');
    expect(store.state.workspace!.previewCharacterId).toBe('second');

    store.redo();
    expect(store.state.workspace!.name).toBe('Renamed');
    expect(store.state.workspace!.activeCharacterId).toBe('second');
    expect(store.state.workspace!.previewCharacterId).toBe('second');
  });

  it('returns before snapshotting when activating the current animation', () => {
    const store = setup(),
      state = store.state,
      active = state.workspace!.activeId;
    store.captureCount = 0;

    store.activate(active);

    expect(store.state).toBe(state);
    expect(store.captureCount).toBe(0);
  });

  it('continues to capture genuine workspace edits', () => {
    const store = setup(),
      original = store.state.workspace!.name;
    store.captureCount = 0;
    const historyBeforeEdit = store.workspaceHistoryLengths;

    store.renameWorkspace('Edited project');

    expect(store.captureCount).toBeGreaterThan(0);
    expect(store.workspaceHistoryLengths.past).toBe(historyBeforeEdit.past + 1);
    store.undo();
    expect(store.state.workspace!.name).toBe(original);
  });
});
