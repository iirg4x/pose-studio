export interface FolderClip {id:string;name:string;folder?:string[];layer:string;fps:number;end:number}
export type FolderRow={kind:'folder';name:string;path:string[];count:number}|{kind:'clip';clip:FolderClip};
export function validateFolder(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>8||value.some(s=>typeof s!=='string'||!s.trim()||s.length>100||/[\\/\x00-\x1f]/.test(s)||s==='.'||s==='..'))throw Error('Invalid animation folder.');
 return value.map(s=>(s as string).trim());
}
export function animationFolderRows(clips:FolderClip[],path:string[],query=''):FolderRow[]{
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 if(terms.length)return clips.filter(c=>{const text=[...(c.folder??[]),c.name].join(' ').toLocaleLowerCase();return terms.every(t=>text.includes(t));}).map(clip=>({kind:'clip',clip}));
 const folders=new Map<string,{path:string[];count:number}>(),leaves:FolderRow[]=[];
 for(const clip of clips){const folder=clip.folder??[];if(!path.every((s,i)=>folder[i]===s))continue;
  if(folder.length===path.length)leaves.push({kind:'clip',clip});
  else{const name=folder[path.length],existing=folders.get(name);if(existing)existing.count++;else folders.set(name,{path:[...path,name],count:1});}
 }
 return [...[...folders].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([name,data])=>({kind:'folder' as const,name,...data})),...leaves];
}
export function animationLeafName(clip:FolderClip){return clip.folder?.length&&clip.name.includes(' · ')?clip.name.split(' · ').at(-1)!:clip.name;}
