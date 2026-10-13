const ROOT=new URL('./',self.location.href);
const PREFIX='pose-studio-shell:'+ROOT.href+':';
const CACHE=PREFIX+"397edb1d330dfb918031";
const URLS=["assets/androidAnimation-Dn2fjZOE.js","assets/axe.json","assets/builtin-axe.glb","assets/builtin-magazine.glb","assets/builtin-rifle.glb","assets/controller-shapes.json","assets/curveReduction.worker-Bss1mdLi.js","assets/example-fantasy-female.glb","assets/example-fantasy-male.glb","assets/exportRecording-DXRlhfoV.js","assets/index-0--AVp2H.js","assets/index-FoLZmz4k.css","assets/manny.glb","assets/sha2-DO3U7qTQ.js","assets/three-C88qyTJg.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","manifest.webmanifest"].map(file=>new URL(file,ROOT).href);
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
