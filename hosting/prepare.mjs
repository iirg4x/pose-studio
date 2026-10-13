import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {decodeProject} from '../shared/project-codec.mjs';
import {inferPoseLinks,poseDependencies} from '../shared/pose-links.mjs';
export async function prepare(source, cache){
 await fs.mkdir(cache,{recursive:true});
 const bytes=await fs.readFile(source),revision=createHash('sha256').update(bytes).digest('hex');
 try{const prior=JSON.parse(await fs.readFile(path.join(cache,'catalog.json'),'utf8'));if(prior.revision===revision)return prior;}catch{}
 console.log('Preparing project for on-demand browser access…');
 const data=inferPoseLinks(await decodeProject(bytes)),byId=new Map(data.clips.map(c=>[c.id,c]));
 await fs.mkdir(path.join(cache,'clips'),{recursive:true});await fs.mkdir(path.join(cache,'assets'),{recursive:true});
 for(const [id,base64] of Object.entries(data.characterAssets??{})){if(!/^(?:[a-f0-9]{64}|builtin-[a-z-]+|example-fantasy-(?:male|female))$/.test(id))throw Error('Invalid asset ID');const asset=Buffer.from(base64,'base64');if(/^[a-f0-9]{64}$/.test(id)&&createHash('sha256').update(asset).digest('hex')!==id)throw Error('Asset checksum mismatch');await fs.writeFile(path.join(cache,'assets',id+'.glb'),asset);}
 const {clips,characterAssets,...metadata}=data;
 for(const clip of clips){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(clip.id))throw Error('Invalid clip ID');
  const selected=new Map();const include=id=>{const c=byId.get(id);if(!c||selected.has(id))return;selected.set(id,c);if(c.previewId)include(c.previewId);if(c.project.bodyBase?.sourceId)include(c.project.bodyBase.sourceId);for(const source of poseDependencies(c.project))include(source);};include(clip.id);
  const subset={...metadata,activeId:clip.id,openIds:[clip.id],clips:[...selected.values()]};
  await fs.writeFile(path.join(cache,'clips',clip.id+'.json.gz'),gzipSync(JSON.stringify(subset),{level:6}));
 }
 const catalog={name:data.name,revision,activeId:data.activeId,clips:clips.map(c=>({id:c.id,name:c.project.name,folder:c.folder,layer:c.project.editing,fps:c.project.fps,end:c.project.end}))};
 await fs.writeFile(path.join(cache,'catalog.json'),JSON.stringify(catalog));console.log('Ready: '+clips.length+' animations.');return catalog;
}
