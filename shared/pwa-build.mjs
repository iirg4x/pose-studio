import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Only application resources belong in the public PWA. Project files and the
// PC's /api library must never be copied into the publication or offline cache.
export const APP_ASSETS=['manny.glb','axe.json','controller-shapes.json','builtin-axe.glb','builtin-rifle.glb','builtin-magazine.glb','example-fantasy-male.glb','example-fantasy-female.glb'];
export function serviceWorkerSource(files,revision){
 return `const ROOT=new URL('./',self.location.href);
const PREFIX='pose-studio-shell:'+ROOT.href+':';
const CACHE=PREFIX+${JSON.stringify(revision)};
const URLS=${JSON.stringify(files)}.map(file=>new URL(file,ROOT).href);
const SHELL=new Set(URLS);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{for(const url of URLS){const response=await fetch(new Request(url,{cache:'reload'}));if(!response.ok)throw Error('Could not download '+url);await cache.put(url,response);}}
 catch(error){await caches.delete(CACHE);throw error;}
 // Do not skipWaiting: an update must not replace an editor with unsaved work.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
 const clean=new URL(url.pathname,ROOT.origin).href;
 // API responses, uploaded models and project files are never cached here.
 const entry=request.mode==='navigate'&&(clean===ROOT.href||clean===new URL('index.html',ROOT).href)?new URL('index.html',ROOT).href:clean;
 if(!SHELL.has(entry))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(entry)||fetch(request);})());
});
`;
}
export function posePwa(){
 return {name:'pose-installable-app',apply:'build',transformIndexHtml(html){return html.replace('<title>Pose</title>','<title>Pose Studio</title>').replace('</head>','<link rel="manifest" href="./manifest.webmanifest"/><link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"/><link rel="icon" type="image/png" href="./icons/icon-192.png"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/><meta name="apple-mobile-web-app-title" content="Pose"/></head>');},async writeBundle(options){
  const out=path.resolve(options.dir);
  for(const name of APP_ASSETS){await fs.mkdir(path.join(out,'assets'),{recursive:true});await fs.copyFile(path.join(root,'public/assets',name),path.join(out,'assets',name));}
  await fs.cp(path.join(root,'pwa'),out,{recursive:true});
  async function filesAt(dir){const entries=await fs.readdir(dir,{withFileTypes:true});const all=[];for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isDirectory())all.push(...await filesAt(file));else all.push(path.relative(out,file).replaceAll('\\','/'));}return all;}
  const files=(await filesAt(out)).filter(file=>file!=='sw.js'&&!file.startsWith('.')&&!file.endsWith('.map')).sort();
  const hash=createHash('sha256');for(const file of files){hash.update(file);hash.update(await fs.readFile(path.join(out,file)));}
  await fs.writeFile(path.join(out,'sw.js'),serviceWorkerSource(files,hash.digest('hex').slice(0,20)));
  await fs.writeFile(path.join(out,'.nojekyll'),'');
 }};
}
