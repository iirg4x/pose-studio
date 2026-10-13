const fs=require('node:fs/promises'),path=require('node:path');
function createRecentProjects(file){
 let queue=Promise.resolve();
 async function list(){try{const rows=JSON.parse(await fs.readFile(file,'utf8'));return Array.isArray(rows)?rows.filter(r=>r&&typeof r.path==='string'&&path.isAbsolute(r.path)&&typeof r.name==='string'&&typeof r.openedAt==='string').slice(0,12):[];}catch{return [];}}
 function update(change){queue=queue.catch(()=>{}).then(async()=>{const rows=change(await list());await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(rows,null,2));await fs.rename(file+'.tmp',file);return rows;});return queue;}
 return {list,record:(filename)=>update(rows=>{const resolved=path.resolve(filename);return [{path:resolved,name:path.basename(resolved).replace(/(?:\.(?:pose|manny))?\.json$|\.pose$/i,''),openedAt:new Date().toISOString()},...rows.filter(r=>r.path.toLowerCase()!==resolved.toLowerCase())].slice(0,12);}),clear:()=>update(()=>[]),async resolve(filename){const row=(await list()).find(r=>r.path===filename);if(!row)throw Error('This project is not in your recent list.');return row.path;}};
}
module.exports={createRecentProjects};
