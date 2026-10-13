const codec=import('../shared/project-codec.mjs');
const {app,BrowserWindow,ipcMain,dialog,shell,session,screen}=require('electron');
const {createRecentProjects}=require('./recent-projects.cjs');
const {createRecordingWriter}=require('./recording.cjs');
const {createCharacters}=require('./characters.cjs');
const {createSharedExporter}=require('./shared-export.cjs');
const {createAssetImport}=require('./asset-import.cjs');
const {PROJECT_FILTERS,projectFilename,projectSavePath,projectArguments,createProjectQueue,registerProjectAssociation}=require('./project-files.cjs');
const fs=require('node:fs/promises');const path=require('node:path');const {pathToFileURL}=require('node:url');const {runExport}=require('./backend.cjs');
let win,blender=null,exporting=false,closingAllowed=false;const exportedDirectories=new Set();
const projectQueue=createProjectQueue();
function queueProject(filename){projectQueue.add(filename);if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();win.webContents.send('studio:project-queued');}}
if(!app.requestSingleInstanceLock()){app.quit();}else{
 for(const filename of projectArguments(process.argv,process.cwd(),app.isPackaged))queueProject(filename);
 app.on('second-instance',(_event,argv,cwd)=>{for(const filename of projectArguments(argv,cwd,app.isPackaged))queueProject(filename);if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.on('open-file',(event,filename)=>{event.preventDefault();queueProject(filename);});
}
const recordings=createRecordingWriter(),recordedFiles=new Set();let choosingRecording=false;
const base=path.resolve(__dirname,'..'),entry=path.join(base,'dist','index.html');
const backend=()=>app.isPackaged?path.join(process.resourcesPath,'backend'):path.join(base,'backend');
async function detectBlender(){
 try {const p=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8')).blender;if(typeof p==='string'&&path.basename(p).toLowerCase()==='blender.exe'){await fs.access(p);return p;}}catch{}
 for(const version of ['5.2','5.1','5.0','4.5','4.4','4.3','4.2','4.1']){const p=path.join(process.env.ProgramFiles||'C:/Program Files','Blender Foundation','Blender '+version,'blender.exe');try{await fs.access(p);return p;}catch{}}
 return null;
}
function trusted(event){if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==pathToFileURL(entry).href)throw Error('Untrusted request.');}
function handle(name,fn){ipcMain.handle('studio:'+name,async(event,...args)=>{trusted(event);return fn(...args);});}
function safeName(name){return String(name||'animation').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,60)||'animation';}
app.whenReady().then(async()=>{
 if(!app.hasSingleInstanceLock())return;
 if(app.isPackaged)registerProjectAssociation(process.execPath,path.join(process.resourcesPath,'refresh-file-associations.ps1')).catch(e=>console.error('Could not register .pose projects:',e.message));
 const characters=createCharacters(path.join(app.getPath('userData'),'characters'),path.join(base,'dist','assets'),backend());
 const shared=createSharedExporter(backend(),id=>characters.filename(id));
 const imports=createAssetImport(path.join(app.getPath('userData'),'imports'),backend(),characters);
 const recents=createRecentProjects(path.join(app.getPath('userData'),'recent-projects.json'));
 async function readProject(filename){let stat;try{stat=await fs.stat(filename);}catch{throw Error('Project file is missing. Use Open project to locate it.');}if(stat.size>512*1024*1024)throw Error('Project file is too large.');const p=await (await codec).decodeProject(await fs.readFile(filename));await recents.record(filename);return characters.restore(p);}
 handle('recents',()=>recents.list());handle('clear-recents',()=>recents.clear());handle('open-recent',async filename=>readProject(await recents.resolve(filename)));
 handle('take-project',async()=>{if(exporting||recordings.busy||choosingRecording)return null;const filename=projectQueue.take();return filename?readProject(filename):null;});
 blender=await detectBlender();
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
 win=new BrowserWindow({width:Math.min(1560,area.width),height:Math.min(1000,area.height),minWidth:Math.min(1024,area.width),minHeight:Math.min(720,area.height),maximizable:true,resizable:true,backgroundColor:'#101318',frame:false,show:false,title:'Pose',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
 handle('status',()=>({blender,maximized:win.isMaximized()}));
 const windowState=()=>win.webContents.send('studio:window-state',{maximized:win.isMaximized()});
 win.on('maximize',windowState);win.on('unmaximize',windowState);win.on('restore',windowState);
 handle('choose-blender',async()=>{const r=await dialog.showOpenDialog(win,{title:'Choose Blender',filters:[{name:'Blender executable',extensions:['exe']}],properties:['openFile']});if(r.canceled)return null;const p=r.filePaths[0];if(path.basename(p).toLowerCase()!=='blender.exe')throw Error('Select blender.exe.');blender=p;await fs.writeFile(path.join(app.getPath('userData'),'settings.json'),JSON.stringify({blender}));return blender;});
 handle('save',async p=>{const text=await (await codec).encodeProject(await characters.embed(p));const r=await dialog.showSaveDialog(win,{title:'Save Pose project',defaultPath:projectFilename(p.name),filters:[PROJECT_FILTERS[0]]});if(r.canceled)return null;const filename=projectSavePath(r.filePath);if(filename!==r.filePath){try{await fs.access(filename);const confirmation=await dialog.showMessageBox(win,{type:'question',message:'Replace this Pose project?',detail:filename,buttons:['Cancel','Replace'],defaultId:0,cancelId:0});if(confirmation.response!==1)return null;}catch(e){if(e.code!=='ENOENT')throw e;}}await fs.writeFile(filename,text);await recents.record(filename);return filename;});
 handle('open',async()=>{const r=await dialog.showOpenDialog(win,{title:'Open Pose project',filters:[{name:'All Pose projects',extensions:['pose','json']},...PROJECT_FILTERS],properties:['openFile']});if(r.canceled)return null;return readProject(r.filePaths[0]);});
 handle('character-read',id=>characters.read(id));
 handle('shared-begin',async plan=>{
  if(exporting||recordings.busy||choosingRecording)throw Error('Wait for the current export.');
  exporting=true;try{const r=await dialog.showOpenDialog(win,{title:'Export shared Unreal skeleton',properties:['openDirectory','createDirectory']});if(r.canceled){exporting=false;return null;}return await shared.begin(r.filePaths[0],plan);}catch(e){exporting=false;throw e;}
 });
 handle('shared-write',(id,item,bytes)=>shared.write(id,item,bytes));
 handle('shared-finish',async id=>{const result=await shared.finish(id,blender);exporting=false;exportedDirectories.add(result.directory);return result;});
 handle('shared-cancel',async id=>{await shared.cancel(id);exporting=false;});
 async function ensureBlender(){if(blender)return blender;const r=await dialog.showOpenDialog(win,{title:'Choose Blender for FBX / Blender file conversion',filters:[{name:'Blender',extensions:['exe']}],properties:['openFile']});if(r.canceled)throw Error('Conversion cancelled. Choose Blender to import this format.');if(path.basename(r.filePaths[0]).toLowerCase()!=='blender.exe')throw Error('Select blender.exe.');blender=r.filePaths[0];await fs.writeFile(path.join(app.getPath('userData'),'settings.json'),JSON.stringify({blender}));return blender;}
 handle('prop-import',async()=>{if(exporting||recordings.busy)throw Error('Wait for the current export.');const r=await dialog.showOpenDialog(win,{title:'Import prop',filters:[{name:'3D prop',extensions:['glb','gltf','fbx','obj','blend']}],properties:['openFile']});if(r.canceled)return null;exporting=true;try{return await imports.prop(r.filePaths[0],path.extname(r.filePaths[0]).toLowerCase()==='.glb'?blender:await ensureBlender());}finally{exporting=false;}});
 handle('animation-inspect',async()=>{if(exporting||recordings.busy)throw Error('Wait for the current export.');const r=await dialog.showOpenDialog(win,{title:'Import animation',filters:[{name:'Animation',extensions:['fbx','glb','gltf','blend','bvh']}],properties:['openFile']});if(r.canceled)return null;exporting=true;try{return await imports.inspect(r.filePaths[0],await ensureBlender());}finally{exporting=false;}});
 handle('animation-sample',async(token,options)=>{if(exporting||recordings.busy)throw Error('Wait for the current export.');exporting=true;try{return await imports.sample(token,options,await ensureBlender());}finally{exporting=false;}});
 handle('open-example',async()=>characters.restore(JSON.parse(await fs.readFile(path.join(base,'dist','examples','Axe studio.pose.json'),'utf8'))));
 handle('character-import',async()=>{
  if(exporting||recordings.busy)throw Error('Wait for the current export.');
  const result=await dialog.showOpenDialog(win,{title:'Import humanoid character',filters:[{name:'Rigged character',extensions:['fbx','glb','gltf']}],properties:['openFile']});if(result.canceled)return null;
  exporting=true;try{return await characters.importFile(result.filePaths[0],path.extname(result.filePaths[0]).toLowerCase()==='.glb'?blender:await ensureBlender());}finally{exporting=false;}
 });
 handle('character-export',async(bytes,options)=>{
  if(exporting||recordings.busy)throw Error('Wait for the current export.');if(!options||!['glb','fbx'].includes(options.format)||!Number.isInteger(options.fps)||options.fps<1||options.fps>120||!Number.isInteger(options.end)||options.end<1||options.end>2400)throw Error('Invalid character export.');
  const result=await dialog.showSaveDialog(win,{title:'Export retargeted animation',defaultPath:safeName(options.name)+'.'+options.format,filters:[{name:options.format.toUpperCase(),extensions:[options.format]}]});if(result.canceled)return null;
  exporting=true;try{const file=await characters.exportFile(bytes,result.filePath,options.format,blender,options.fps,options.end);recordedFiles.add(file);return file;}finally{exporting=false;}
 });
 handle('recording-begin',async options=>{
  if(exporting||recordings.busy||choosingRecording)throw Error('An export is already running.');
  if(!options||!['mp4','webm'].includes(options.format))throw Error('Invalid video format.');
  choosingRecording=true;
  try{const r=await dialog.showSaveDialog(win,{title:'Export recording',defaultPath:safeName(options.name)+'.'+options.format,filters:[{name:options.format==='mp4'?'MP4 video':'WebM video',extensions:[options.format]}]});if(r.canceled||!r.filePath)return null;return await recordings.begin(r.filePath);}finally{choosingRecording=false;}
 });
 handle('recording-write',(id,data,position)=>recordings.write(id,data,position));
 handle('recording-finish',async id=>{const filename=await recordings.finish(id);recordedFiles.add(filename);return filename;});
 handle('recording-cancel',id=>recordings.cancel(id));
 handle('recording-reveal',filename=>{if(!recordedFiles.has(filename))throw Error('Unknown recording.');shell.showItemInFolder(filename);});
 handle('export',async(payload,options)=>{
  if(exporting||recordings.busy||choosingRecording)throw Error('An export is already running.');if(!blender)throw Error('Select Blender first.');
  const r=await dialog.showOpenDialog(win,{title:'Choose export destination',properties:['openDirectory','createDirectory']});if(r.canceled)return {canceled:true,directory:'',files:[]};
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');const directory=path.join(r.filePaths[0],safeName(payload?.name)+'_'+stamp);exporting=true;
  try{payload.assetFiles=Object.fromEntries(Object.entries(payload.project?.props??{}).map(([id,p])=>[id,characters.filename(p.asset)]));const result=await runExport({blender,backend:backend(),directory,payload,includeMesh:options?.includeMesh===true});exportedDirectories.add(directory);return result;}finally{exporting=false;}
 });
 handle('folder',directory=>{if(!exportedDirectories.has(directory))throw Error('Unknown export folder.');return shell.openPath(directory);});
 ipcMain.on('studio:window',(e,action)=>{trusted(e);if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();});
 handle('confirm-close',()=>{closingAllowed=true;win.close();});
 win.on('close',e=>{if(exporting||recordings.busy||choosingRecording){e.preventDefault();closingAllowed=false;dialog.showMessageBox(win,{message:'An export is still running.',detail:'Wait for it to finish, or cancel the recording before closing the editor.',buttons:['OK']});return;}if(!closingAllowed){e.preventDefault();win.webContents.send('studio:request-close');}});
 await win.loadFile(entry);win.show();
});
app.on('window-all-closed',()=>app.quit());
