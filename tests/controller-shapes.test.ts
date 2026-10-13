import {describe,it,expect} from 'vitest';
import {controllerShape} from '../src/scene/controlShapes';
import {ControlVisual,pickControl} from '../src/scene/controlVisual';
import {IDS} from '../src/core/model';
import shapes from '../public/assets/controller-shapes.json';
import {PerspectiveCamera,Vector3} from 'three';

describe('controller silhouettes',()=>{
 it('provides finite paired segments for every registered controller',()=>{for(const id of IDS){const shape=controllerShape(id,shapes[id as keyof typeof shapes]);expect(shape.positions.length%6,id).toBe(0);expect(shape.positions.length,id).toBeGreaterThan(12);expect(shape.positions.every(Number.isFinite),id).toBe(true);}});
 it('keeps roll handles centered on the rig pivot even with legacy mesh offsets',()=>{for(const id of ['heel_l','heel_r','ball_l','ball_r'] as const){const shape=controllerShape(id,shapes[id]);expect(Math.max(...shape.positions.map(Math.abs))).toBeLessThan(.04);}});
 it('makes a small finger selectable without inflating its geometry',()=>{const camera=new PerspectiveCamera(45,1,.01,20);camera.position.set(0,0,2);camera.updateMatrixWorld();const visual=new ControlVisual('index_02_l',shapes.index_02_l);visual.updateMatrixWorld();const position=visual.points[0].clone().project(camera),before=visual.points.map(p=>p.toArray());visual.style(800,800,true,false,true,1);expect(pickControl([visual],camera,800,800,(position.x+1)*400,(1-position.y)*400,()=>true)[0]?.id).toBe('index_02_l');expect(visual.scale.equals(new Vector3(1,1,1))).toBe(true);expect(visual.points.map(p=>p.toArray())).toEqual(before);visual.dispose();});
});
