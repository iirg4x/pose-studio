import {decodeProject} from '../../shared/project-codec.mjs';
import {validateLibrary} from '../core/library';
import type {AnimationLibrary} from '../core/library';
import {restoreAssets} from './portableAssets';

// Only fresh file bytes can create a prepared document. The opening UI consumes
// the receipt once; subsequent uses validate normally rather than trusting a
// potentially edited object. No in-memory editing snapshot transfers ownership.
const prepared=new WeakSet<object>();
export async function readProjectDocument(bytes:Uint8Array,writeAsset:(id:string,data:Uint8Array)=>Promise<void>):Promise<AnimationLibrary>{
 const parsed=await decodeProject(bytes);
 const library=validateLibrary(parsed,{takeOwnership:true});
 await restoreAssets(parsed,writeAsset);
 prepared.add(library);return library;
}
export function consumeProjectDocument(input:unknown):AnimationLibrary{
 if(input&&typeof input==='object'&&prepared.delete(input))return input as AnimationLibrary;
 return validateLibrary(input);
}
