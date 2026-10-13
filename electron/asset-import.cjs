const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {blenderJob}=require('./characters.cjs');
function createAssetImport(directory,backend,characters){
 const sources=new Map();
 async function job(mode,source,blender,options={}){
  await fs.mkdir(directory,{recursive:true});const output=path.join(directory,randomUUID()+(mode==='prop'?'.glb':'.json'));
  try{await blenderJob(blender,path.join(backend,'import_asset.py'),[mode,source,output,JSON.stringify(options)],output+'.log');const data=await fs.readFile(output);return mode==='prop'?data:JSON.parse(data);}finally{await fs.unlink(output).catch(()=>{});}
 }
 return {
  async prop(source,blender){const data=path.extname(source).toLowerCase()==='.glb'?await fs.readFile(source):await job('prop',source,blender);const asset=await characters.cache(data);return {asset,name:path.basename(source,path.extname(source)),data:new Uint8Array(data)};},
  async inspect(source,blender){const data=await job('inspect',source,blender),token=randomUUID();sources.set(token,source);while(sources.size>12)sources.delete(sources.keys().next().value);return {...data,token,filename:path.basename(source)};},
  async sample(token,options,blender){const source=sources.get(token);if(!source)throw Error('Choose the animation file again.');return job('sample',source,blender,options);}
 };
}
module.exports={createAssetImport};
