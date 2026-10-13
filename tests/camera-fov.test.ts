import {describe,it,expect} from 'vitest';
import {createProject,evaluate,putKey,rawForWorld,validateProject,sample} from '../src/core/model';
import {addAnimationLayer,activeAnimationLayer,ensureLayers} from '../src/core/layers';
import {StudioStore} from '../src/core/store';

describe('camera field of view editing',()=>{
 it('edits FOV on a pose layer that initially excludes the camera and survives undo/redo',()=>{
  const s=new StudioStore();s.open(addAnimationLayer(createProject({},false),'pose'));s.setFrame(12);
  s.beginGesture();s.editCameraFov(95);s.endGesture();
  expect(evaluate(s.state.project!,80).camera.fov).toBeCloseTo(95);
  expect(activeAnimationLayer(s.state.project!)!.excluded).not.toContain('camera');
  s.undo();expect(evaluate(s.state.project!,12).camera.fov).toBeCloseTo(65);
  s.redo();expect(evaluate(s.state.project!,12).camera.fov).toBeCloseTo(95);
 });
 it('keeps a linked base intact and adds an editable camera layer',()=>{
  const p=ensureLayers(createProject({},false));p.layers![0].static=true;p.layers![0].poseLinks=[{clipId:'source',frame:0}];
  const s=new StudioStore();s.open(p);const base=JSON.stringify(s.state.project!.layers![0]);s.editCameraFov(85);
  expect(JSON.stringify(s.state.project!.layers![0])).toBe(base);
  expect(evaluate(s.state.project!,0).camera.fov).toBeCloseTo(85);
  expect(activeAnimationLayer(s.state.project!)!.name).toBe('Camera');
 });
 it('supports the full FOV range through a weighted additive layer and its scalar curves',()=>{
  const p=addAnimationLayer(createProject({},false),'additive'),layer=activeAnimationLayer(p)!;layer.excluded=[];layer.weight=.25;
  for(const [frame,fov] of [[0,20],[10,120]])putKey(p.tracks.camera,frame,rawForWorld(p,'camera',frame,{...evaluate(p,frame).camera,fov}));
  expect(evaluate(p,0).camera.fov).toBeCloseTo(20);expect(evaluate(p,10).camera.fov).toBeCloseTo(120);
  expect(evaluate(p,5).camera.fov).toBeCloseTo(70);expect(()=>validateProject(p)).not.toThrow();
  p.tracks.camera.curves={fov:{keys:[{frame:0,value:-110,interpolation:'linear'},{frame:10,value:290,interpolation:'linear'}],modifiers:[]}};
  expect(sample(p.tracks.camera,0).fov).toBeCloseTo(-110);expect(evaluate(p,5).camera.fov).toBeCloseTo(70);
 });
});
