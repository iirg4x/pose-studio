import { afterEach, describe, expect, it, vi } from 'vitest';
import { entry, library } from '../src/core/library';
import { clone, createProject } from '../src/core/model';
import { sameEditableWorkspace } from '../src/core/store/workspaceHistory';

const workspace = () => {
  const result = library(createProject({}, false));
  result.clips.push(entry(createProject({}, false)));
  return result;
};

afterEach(() => vi.restoreAllMocks());

describe('workspace history comparison', () => {
  it('ignores navigation state while detecting editable content changes', () => {
    const before = workspace();
    const navigated = clone(before);
    navigated.activeId = navigated.clips[1]!.id;
    navigated.openIds = [navigated.clips[1]!.id];
    navigated.previewCharacterId = 'preview-character';
    navigated.clips[0]!.frame = 12;
    navigated.clips[0]!.selected = 'root';

    expect(sameEditableWorkspace(before, navigated)).toBe(true);

    const keyChanged = clone(before);
    keyChanged.clips[0]!.project.tracks.root.keys[0]!.p[0] += 0.25;
    expect(sameEditableWorkspace(before, keyChanged)).toBe(false);

    const folderChanged = clone(before);
    folderChanged.clips[0]!.folder = ['Weapons'];
    expect(sameEditableWorkspace(before, folderChanged)).toBe(false);

    const sourceChanged = clone(before);
    sourceChanged.clips[0]!.previewId = sourceChanged.clips[1]!.id;
    expect(sameEditableWorkspace(before, sourceChanged)).toBe(false);

    const characterChanged = clone(before);
    characterChanged.characters = [
      {
        id: 'character',
        name: 'Character',
        asset: 'example-fantasy-male',
        mapping: {},
        hiddenMeshes: [],
        scale: 1,
        facing: 0,
        handIK: true,
        footIK: true,
        offsets: {},
      },
    ];
    expect(sameEditableWorkspace(before, characterChanged)).toBe(false);
  });

  it('compares bounded projections without mutating either library', () => {
    const before = workspace();
    const after = clone(before);
    const beforeSnapshot = JSON.stringify(before);
    const afterSnapshot = JSON.stringify(after);
    const stringify = vi.spyOn(JSON, 'stringify');

    expect(sameEditableWorkspace(before, after)).toBe(true);

    expect(
      stringify.mock.calls.every(([value]) => {
        if (!value || typeof value !== 'object') return true;
        return value !== before && value !== after && !('clips' in value);
      }),
    ).toBe(true);
    expect(JSON.stringify(before)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
  });
});
