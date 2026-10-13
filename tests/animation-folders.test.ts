import {describe,it,expect} from 'vitest';
import {animationFolderRows,validateFolder} from '../src/core/animationFolders';
import type {FolderClip} from '../src/core/animationFolders';
const clip=(id:string,folder:string[],name=id):FolderClip=>({id,name,folder,layer:'firstPerson',fps:30,end:90});
describe('animation folders',()=>{
 const clips=[clip('empty',['Rifles','AR 01','First person','Reloads'],'Reload Empty'),clip('tactical',['Rifles','AR 01','First person','Reloads'],'Reload Tactical'),clip('idle',['Rifles','AR 02','Full body','Poses']),clip('loose',[])];
 it('shows one folder with recursive counts, then only the children of the opened folder',()=>{
  expect(animationFolderRows(clips,[])).toEqual([{kind:'folder',name:'Rifles',path:['Rifles'],count:3},{kind:'clip',clip:clips[3]}]);
  expect(animationFolderRows(clips,['Rifles']).map(r=>r.kind==='folder'&&[r.name,r.count])).toEqual([['AR 01',2],['AR 02',1]]);
  expect(animationFolderRows(clips,['Rifles','AR 01','First person','Reloads']).map(r=>r.kind==='clip'&&r.clip.id)).toEqual(['empty','tactical']);
 });
 it('searches names and folder paths globally, even inside another branch',()=>{
  expect(animationFolderRows(clips,['Rifles','AR 02'],'AR 01 empty')).toEqual([{kind:'clip',clip:clips[0]}]);
  expect(animationFolderRows(clips,[],'  ')).toEqual(animationFolderRows(clips,[]));
  expect(animationFolderRows(clips,[],'missing')).toEqual([]);
 });
 it('accepts a root folder and rejects malformed paths',()=>{
  expect(validateFolder([])).toEqual([]);expect(validateFolder([' Weapons ','Reloads'])).toEqual(['Weapons','Reloads']);
  for(const invalid of ['Weapons',{},[1],[''],['..'],['a/b'],['a\\b'],Array(9).fill('nested')])expect(()=>validateFolder(invalid)).toThrow();
 });
});
