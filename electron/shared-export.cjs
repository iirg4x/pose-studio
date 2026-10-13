const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const safe=value=>String(value).replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,60)||'Project';
function validatePlan(p){
 const label=v=>typeof v==='string'&&v.length>0&&v.length<=160;
 if(!p||p.version!==2||!label(p.name)||!Array.isArray(p.characters)||!p.characters.length||p.characters.length>100||p.characters[0]?.id!=='manny'||!Array.isArray(p.clips)||!p.clips.length||!Array.isArray(p.sockets)||!Array.isArray(p.props))throw Error('Invalid shared export plan.');
 for(const list of[p.characters,p.clips,p.sockets,p.props])if(new Set(list.map(v=>v.id)).size!==list.length)throw Error('Duplicate export identity.');
 for(const c of p.characters)if(!label(c.id)||!label(c.name))throw Error('Invalid character identity.');
 for(const s of p.sockets)if(!label(s.id)||!/^pose_prop_[a-f0-9]{8}$/.test(s.bone)||!/^prop_[a-f0-9]{8}$/.test(s.socket)||!['root','hand_r','hand_l'].includes(s.parent))throw Error('Invalid prop socket.');
 if(new Set(p.sockets.map(s=>s.bone)).size!==p.sockets.length)throw Error('Conflicting prop socket names.');
 for(const v of p.props){const s=v.settings;if(!label(v.id)||!s||!label(s.name)||typeof s.asset!=='string'||!Number.isFinite(s.scale)||s.scale<=0||s.scale>1e4||[s.offset,s.rotation].some(a=>!Array.isArray(a)||a.length!==3||a.some(x=>!Number.isFinite(x)||Math.abs(x)>1e5)))throw Error('Invalid prop settings.');}
 for(const c of p.clips){if(!label(c.id)||!label(c.name)||!['body','firstPerson'].includes(c.type)||!Number.isInteger(c.fps)||c.fps<1||c.fps>120||!Number.isInteger(c.end)||c.end<1||c.end>2400||!Array.isArray(c.props))throw Error('Invalid animation.');for(const b of c.props)if(!p.sockets.some(s=>s.id===b.slot)||!p.props.some(v=>v.id===b.asset)||typeof b.visible!=='boolean')throw Error('Invalid animation prop binding.');}
 return structuredClone(p);
}
function validateGLB(bytes){const b=Buffer.from(bytes);if(b.length<20||b.length>200*1024*1024||b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('Invalid shared skeleton GLB.');return b;}
function validateSampleRate(clip,rate){if(!Number.isInteger(rate)||rate<clip.fps||rate>clip.fps*64||rate%clip.fps!==0)throw Error('Invalid animation sample rate.');return rate;}
function createSharedExporter(backend,assetFile){
 let session;
 const current=id=>{if(!session||session.id!==id)throw Error('Shared export session expired.');return session;};
 return {
  get busy(){return !!session;},
  async begin(parent,plan){if(session)throw Error('An export is already running.');plan=validatePlan(plan);const directory=path.resolve(parent,safe(plan.name)+'_Shared_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomUUID().slice(0,6)),stage=path.join(directory,'.source');await fs.mkdir(stage,{recursive:true});session={id:randomUUID(),directory,stage,plan,files:new Set(),finishing:false};return {id:session.id,directory};},
  async write(id,item,bytes){const s=current(id);if(s.finishing)throw Error('The export is already being written.');const ci=s.plan.characters.findIndex(c=>c.id===item?.characterId),ai=s.plan.clips.findIndex(c=>c.id===item?.clipId);if((ci>=0)===(ai>=0)||item?.characterId!==undefined&&item?.clipId!==undefined)throw Error('Unknown shared export item.');if(ai<0&&item.sampleRate!==undefined)throw Error('Sample rates apply to animations only.');const rate=ai>=0?validateSampleRate(s.plan.clips[ai],item.sampleRate??s.plan.clips[ai].fps):undefined;const filename=ai<0?'mesh_'+ci+'.glb':'animation_'+ai+'.glb';await fs.writeFile(path.join(s.stage,filename),validateGLB(bytes));if(ai>=0)s.plan.clips[ai].sampleRate=rate;s.files.add(filename);},
  async finish(id,blender){const s=current(id);if(s.finishing)throw Error('The export is already being written.');
   for(let c=0;c<s.plan.characters.length;c++)if(!s.files.has('mesh_'+c+'.glb'))throw Error('A character mesh is missing.');for(let a=0;a<s.plan.clips.length;a++)if(!s.files.has('animation_'+a+'.glb'))throw Error('A shared animation is missing.');
   if(!blender)throw Error('Choose Blender to write FBX files.');s.finishing=true;
   try{const plan={...s.plan,props:s.plan.props.map(p=>({...p,file:assetFile(p.settings.asset)}))};await fs.writeFile(path.join(s.stage,'plan.json'),JSON.stringify(plan));const log=await fs.open(path.join(s.directory,'export.log'),'w');
    try{await new Promise((resolve,reject)=>{const child=spawn(blender,['--background','--factory-startup','--disable-autoexec','--python-exit-code','1','--python',path.join(backend,'export_shared.py'),'--',s.stage,s.directory],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>{child.kill();reject(Error('Shared export timed out. Details: '+path.join(s.directory,'export.log')));},Math.max(300000,s.plan.characters.length*s.plan.clips.length*30000));child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Shared export failed. Details: '+path.join(s.directory,'export.log')));});});}finally{await log.close();}
    const manifest=JSON.parse(await fs.readFile(path.join(s.directory,'manifest.json'),'utf8'));if(!manifest.complete||!Array.isArray(manifest.files))throw Error('Shared export did not finish.');
    for(const file of manifest.files){const resolved=path.resolve(s.directory,file);if(path.isAbsolute(file)||!resolved.startsWith(s.directory+path.sep)||(await fs.stat(resolved)).size===0)throw Error('Invalid shared export output.');}
    // Only this session's private staging directory is removed; failed jobs keep
    // their source files and log for diagnosis.
    if(path.resolve(s.stage)===path.join(path.resolve(s.directory),'.source'))await fs.rm(s.stage,{recursive:true,force:true});session=undefined;return {directory:s.directory,files:manifest.files};
   }catch(e){s.finishing=false;throw e;}
  },
  async cancel(id){const s=current(id);if(s.finishing)throw Error('Wait for the FBX writer to finish.');await fs.writeFile(path.join(s.directory,'incomplete-export.txt'),'Export did not finish. Do not import this folder.\n');session=undefined;}
 };
}
module.exports={createSharedExporter,validatePlan,validateGLB,validateSampleRate};
