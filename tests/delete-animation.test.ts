import { describe, it, expect } from 'vitest';
import { StudioStore } from '../src/core/store';
import { createProject, createBodyAction, pose, evaluate, putKey } from '../src/core/model';
import { library, entry, validateLibrary, refreshBases } from '../src/core/library';
import { ensureLayers, addAnimationLayer } from '../src/core/layers';
describe('delete animations', () => {
  it('deletes a closed clip without losing the active edit, frame, drafts or history', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const a = s.state.workspace!.activeId;
    s.addAnimation({});
    const b = s.state.workspace!.activeId;
    s.closeAnimation(a);
    s.setFrame(12);
    s.editWorld('root', pose([0.2, 0, 0]));
    s.patch({ autoKey: false });
    s.editWorld('root', pose([0.3, 0, 0]));
    s.deleteAnimation(a);
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([b]);
    expect(s.state.frame).toBe(12);
    expect(s.state.drafts.root!.p).toEqual([0.3, 0, 0]);
    expect(validateLibrary(s.snapshot()).clips).toHaveLength(1);
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([a, b]);
    expect(s.state.workspace!.activeId).toBe(b);
    expect(s.state.drafts.root!.p).toEqual([0.3, 0, 0]);
    expect(evaluate(s.state.project!, 12).root.p).toEqual([0.2, 0, 0]);
    s.undo();
    expect(evaluate(s.state.project!, 12).root.p).toEqual([0, 0, 0]);
  });
  it('switches away from a deleted active clip and keeps the other clip draft', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const a = s.state.workspace!.activeId;
    s.patch({ autoKey: false });
    s.editWorld('root', pose([0.4, 0, 0]));
    s.addAnimation({});
    const b = s.state.workspace!.activeId;
    s.deleteAnimation(b);
    expect(s.state.workspace!.activeId).toBe(a);
    expect(s.state.drafts.root!.p).toEqual([0.4, 0, 0]);
    expect(s.state.workspace!.openIds).toEqual([a]);
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([a, b]);
    expect(s.state.workspace!.activeId).toBe(b);
    expect(s.state.drafts).toEqual({});
    s.redo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([a]);
  });
  it('allows deleting the last clip while retaining project identity and saved poses', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.renameWorkspace('My library');
    s.savePose('Keep this');
    const id = s.state.workspace!.activeId;
    s.deleteAnimation(id);
    expect(s.state.workspace!.name).toBe('My library');
    expect(s.state.workspace!.poses).toHaveLength(1);
    expect(s.state.workspace!.clips).toHaveLength(1);
    expect(s.state.workspace!.activeId).not.toBe(id);
    expect(s.state.project!.name).toBe('Untitled animation');
    expect(() => validateLibrary(s.snapshot())).not.toThrow();
    s.undo();
    expect(s.state.workspace!.clips).toHaveLength(1);
    expect(s.state.workspace!.activeId).toBe(id);
    expect(s.state.project!.name).toBe('Untitled animation');
    s.redo();
    expect(s.state.workspace!.activeId).not.toBe(id);
  });
  it('freezes dependent pose/source motion and clears preview links', () => {
    const p = ensureLayers(createProject({}, false));
    p.layers![0].static = true;
    putKey(p.tracks.root, 0, pose([0.3, 0, 0]));
    const w = library(p),
      source = w.clips[0];
    let dependent = addAnimationLayer(createProject({}, false), 'additive');
    dependent.layers![0].static = true;
    dependent.layers![0].poseLinks = [{ clipId: source.id, frame: 0 }];
    const linked = entry(dependent),
      body = entry(createBodyAction(source.project, source.id));
    body.previewId = source.id;
    w.clips.push(linked, body);
    const s = new StudioStore();
    s.open(refreshBases(w));
    const before = s.snapshot()!,
      expected = before.clips.map((c) => evaluate(c.project, 6));
    s.deleteAnimation(source.id);
    const after = s.snapshot()!;
    expect(after.clips.find((c) => c.id === linked.id)!.project.layers![0].poseLinks).toEqual([]);
    expect(after.clips.find((c) => c.id === body.id)!.previewId).toBeUndefined();
    after.clips.forEach((c) =>
      expect(evaluate(c.project, 6)).toEqual(
        expected[before.clips.findIndex((old) => old.id === c.id)],
      ),
    );
    expect(() => validateLibrary(after)).not.toThrow();
    expect(before.clips[1].project.layers![0].poseLinks).toHaveLength(1);
    s.undo();
    const restored = s.snapshot()!;
    expect(restored.clips.map((c) => c.id)).toEqual(before.clips.map((c) => c.id));
    expect(restored.clips.find((c) => c.id === linked.id)!.project.layers![0].poseLinks).toEqual(
      before.clips.find((c) => c.id === linked.id)!.project.layers![0].poseLinks,
    );
    expect(restored.clips.find((c) => c.id === body.id)!.previewId).toBe(source.id);
  });

  it('restores a saved pose with Undo and reapplies its deletion with Redo', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.savePose('Keep this');
    const before = s.snapshot()!.poses[0];
    s.removePose(before.id);
    expect(s.snapshot()!.poses).toHaveLength(0);
    s.undo();
    expect(s.snapshot()!.poses).toEqual([before]);
    s.redo();
    expect(s.snapshot()!.poses).toHaveLength(0);
  });

  it('keeps deletion behind an unrelated active rename in Undo order', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const deleted = s.state.workspace!.activeId;
    s.addAnimation({});
    const active = s.state.workspace!.activeId;
    s.deleteAnimation(deleted);
    s.renameAnimation(active, 'Renamed after delete');
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([active]);
    expect(s.state.project!.name).toBe('New animation');
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([deleted, active]);
  });
  it('invalidates a deleted clip redo after a new project edit', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const deleted = s.state.workspace!.activeId;
    s.addAnimation({});
    const active = s.state.workspace!.activeId;
    s.deleteAnimation(deleted);
    s.undo();
    s.updateProject({ name: 'Edited after restore' });
    s.undo();
    s.redo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([deleted, active]);
    expect(s.state.project!.name).toBe('Edited after restore');
  });
  it('orders workspace-only edits ahead of a deletion', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const originalName = s.state.workspace!.name;
    const deleted = s.state.workspace!.activeId;
    s.addAnimation({});
    const active = s.state.workspace!.activeId;
    s.deleteAnimation(deleted);
    s.renameWorkspace('Renamed after delete');
    s.setPreviewTiming('phase');
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([active]);
    expect(s.state.workspace!.name).toBe('Renamed after delete');
    expect(s.state.workspace!.clips[0].previewSync).toBeUndefined();
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([active]);
    expect(s.state.workspace!.name).toBe(originalName);
    s.undo();
    expect(s.state.workspace!.clips.map((c) => c.id)).toEqual([deleted, active]);
  });
  it('clears a project redo branch when a workspace edit follows it', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const originalName = s.state.workspace!.name;
    s.editWorld('root', pose([1, 0, 0]));
    s.undo();
    s.renameWorkspace('Workspace edit');
    s.redo();
    expect(evaluate(s.state.project!, 0).root.p).toEqual([0, 0, 0]);
    s.undo();
    expect(s.state.workspace!.name).toBe(originalName);
  });
  it('ignores a stale delete action', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const before = s.state;
    s.deleteAnimation('missing');
    expect(s.state).toBe(before);
  });
});
