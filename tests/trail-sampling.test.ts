import {describe,it,expect} from 'vitest';
import {TrailSamples} from '../src/scene/trailSampling';
describe('incremental motion trail sampling',()=>{
 it('includes an odd final frame without duplicating endpoints',()=>{const job=new TrailSamples<number>(5);while(!job.done)job.step(f=>f);expect(job.points).toEqual([0,2,4,5]);job.step(()=>99);expect(job.points).toEqual([0,2,4,5]);});
 it('does only one pose solve per step even on the longest clip',()=>{const job=new TrailSamples<number>(2400);let calls=0;job.step(f=>{calls++;return f;});expect(calls).toBe(1);expect(job.done).toBe(false);expect(job.points).toEqual([0]);while(!job.done)job.step(f=>f);expect(job.points).toHaveLength(1201);expect(job.points.at(-1)).toBe(2400);});
 it('does not advance past a failed pose evaluation',()=>{const job=new TrailSamples<number>(2);expect(()=>job.step(()=>{throw Error('sample failed');})).toThrow();expect(job.points).toEqual([]);job.step(f=>f);expect(job.points).toEqual([0]);});
});
