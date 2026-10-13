import {it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {sparseMotion} from '../src/core/sparseMotion';
import {pose,sample} from '../src/core/model';
import type {Key,Track} from '../src/core/model';
const dense=(keys:Key[]):Track=>({keys,spaces:[],interpolation:'linear'});
it('fits sparse editable curves with bounded subframe error and unchanged endpoints',()=>{
 const keys=Array.from({length:121},(_,frame)=>({...pose([0,Math.sin(frame/120*Math.PI)*.02,0],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.sin(frame/120*Math.PI)*.6).toArray()),frame,interpolation:'linear' as const}));
 const track={...dense(keys),...sparseMotion(keys)},ref=dense(keys);expect(track.keys.length).toBeLessThan(25);expect(track.rotationMode).toBe('quaternion');expect(track.curves?.px?.keys).toHaveLength(1);
 for(let f=0;f<=120;f+=.25){const a=sample(track,f),b=sample(ref,f);expect(new Vector3(...a.p).distanceTo(new Vector3(...b.p))).toBeLessThan(.000201);expect(new Quaternion(...a.q).angleTo(new Quaternion(...b.q))).toBeLessThan(.251*Math.PI/180);}
 for(const f of [0,120])expect(sample(track,f).p).toEqual(sample(ref,f).p);
});
it('keeps constant tracks at one key and handles alternating quaternion signs',()=>{
 const q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.5).toArray();const keys=Array.from({length:30},(_,frame)=>({...pose([1,2,3],q.map(v=>frame%2?-v:v) as Key['q']),frame}));const result=sparseMotion(keys);expect(result.keys).toHaveLength(1);expect(Object.values(result.curves!).every(c=>c!.keys.length===1)).toBe(true);
});
it('preserves fast turns between adjacent keys instead of normalized linear rotation drift',()=>{
 const keys=[{...pose(),frame:0},{...pose([0,0,0],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),150*Math.PI/180).toArray()),frame:1}],track={...dense(keys),...sparseMotion(keys)},ref=dense(keys);
 for(let f=0;f<=1;f+=.125)expect(new Quaternion(...sample(track,f).q).angleTo(new Quaternion(...sample(ref,f).q))).toBeLessThan(.25*Math.PI/180);
});
it('retains holds and a sharp direction change',()=>{
 const keys=Array.from({length:41},(_,frame)=>({...pose([frame<10?0:frame<20?(frame-10)*.01:frame<30?(30-frame)*.01:0,0,0]),frame}));const track={...dense(keys),...sparseMotion(keys)};expect(track.keys.length).toBeLessThan(15);for(let f=0;f<=40;f+=.25)expect(Math.abs(sample(track,f).p[0]-sample(dense(keys),f).p[0])).toBeLessThan(.000201);
});
