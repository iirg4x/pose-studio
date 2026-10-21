import { describe, expect, it } from 'vitest';
import { createProject, pose } from '../src/core/model';
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

describe('authored content revision', () => {
  it('preserves the authored revision across view-only navigation', () => {
    const store = setup(),
      first = store.state.workspace!.activeId;
    store.addAnimation({});
    const second = store.state.workspace!.activeId;
    store.addCharacter(character('first'));
    store.addCharacter(character('second'));
    const before = store.authoredRevision;

    store.activate(first);
    store.setFrame(12);
    store.closeAnimation(first);
    store.selectCharacter('first');
    store.selectPreviewCharacter('second');

    expect(store.state.workspace!.activeId).toBe(second);
    expect(store.authoredRevision).toBe(before);
  });

  it('advances for authored patches while ignoring empty-draft frame seeks', () => {
    const store = setup();
    const advance = (change: () => void) => {
      const before = store.authoredRevision;
      change();
      expect(store.authoredRevision).toBeGreaterThan(before);
    };

    const emptyDrafts = store.authoredRevision;
    store.setFrame(12);
    expect(store.authoredRevision).toBe(emptyDrafts);

    advance(() => store.editWorld('root', pose([0.2, 0, 0])));
    advance(() => store.undo());
    advance(() => store.redo());
    advance(() => store.updateProject({ name: 'Renamed animation' }));
    advance(() => store.renameWorkspace('Renamed project'));
    advance(() => store.patch({ drafts: { root: pose([0.3, 0, 0]) } }));
    advance(() => store.patch({ frame: store.state.frame + 1 }));
    advance(() => store.patch({ drafts: {} }));
    advance(() => store.patch({ revision: store.state.revision }));
    advance(() => store.open(createProject({}, false)));
  });
});
