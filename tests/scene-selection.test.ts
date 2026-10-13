import {describe,it,expect} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {ControlVisual} from '../src/scene/controlVisual';
import {mouseAxis,unrealAxis,boxControls} from '../src/scene/selection';
describe('scene selection',()=>{
 const camera=new PerspectiveCamera(40,1,.01,20);camera.position.set(2,1,3);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 it('locks each Unreal axis from its projected mouse direction',()=>{const pivot=new Vector3(),start=pivot.clone().project(camera);for(const axis of ['x','y','z'] as const){const end=unrealAxis(axis).multiplyScalar(.25).project(camera);expect(mouseAxis(camera,pivot,800,800,(end.x-start.x)*400,-(end.y-start.y)*400)).toBe(axis);}expect(mouseAxis(camera,pivot,800,800,0,0)).toBe(null);});
 it('selects intersecting outlines and excludes hidden/disabled controls and the player preview',()=>{const m=new ControlVisual('rifle');m.updateMatrixWorld();const r={left:300,top:300,right:500,bottom:500};expect(boxControls([m],camera,800,800,r,()=>true)).toEqual(['rifle']);expect(boxControls([m],camera,800,800,r,()=>false)).toEqual([]);expect(boxControls([m],camera,800,800,r,()=>true,{left:0,top:0,right:800,bottom:800})).toEqual([]);m.visible=false;expect(boxControls([m],camera,800,800,r,()=>true)).toEqual([]);m.dispose();});
});
