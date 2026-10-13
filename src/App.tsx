import {DesktopWorkspace} from './components/DesktopWorkspace';
import {InstallStudio} from './components/InstallStudio';
import {isPwaBuild} from './platform/pwa';
import {MotionPresence,MotionOverlay} from './components/Motion';
import {isAndroid as nativeAndroid,portablePlatform} from './platform/storage';
import {decodeProject} from '../shared/project-codec.mjs';
import {TabletWorkspace,TabletDrawer,TabletSettings} from './components/TabletWorkspace';
import type {TabletPanel} from './components/TabletWorkspace';
import {isTouch as isAndroid,writeRecovery} from './platform/storage';
import {Updates} from './components/Updates';
import {AndroidExportDialog} from './components/AndroidExportDialog';
import {CharacterPanel,RetargetInspector,RetargetExport} from './components/RetargetPanel';
import {RecordingDialog} from './components/RecordingDialog';
import {useProjectFile} from './components/useProjectFile';
import {WindowControls} from './components/WindowControls';
import {KeyframeMenu} from './components/KeyframeMenu';
import {usePanelSizes} from './components/PanelDividers';
import {RecentProjects} from './components/RecentProjects';
import {NewActionDialog} from './components/NewActionDialog';
import type {RigLayer} from './core/model';
import {ControlList} from './components/ControlList';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Box,ChevronDown,Waypoints,Video,Upload,Check,LoaderCircle,Save,FolderOpen,FilePlus,X} from 'lucide-react';
import {studio} from './core/store';
import {useStudioChrome,usePresence} from './hooks';
import {SHORTCUTS,isTypingTarget} from './core/shortcuts';
import {AssetLibrary} from './components/AssetLibrary';
import {AnimationImport} from './components/AnimationImport';
import {blankProject} from './core/assets';
import {library} from './core/library';
import {Viewport} from './components/Viewport';
import {Inspector} from './components/Inspector';
import {Timeline} from './components/Timeline';
import {AnimationBar} from './components/AnimationBar';
import {ExportDialog} from './components/ExportDialog';
import type {StudioScene} from './scene/StudioScene';
export default function App(){
 const [installOpen,setInstallOpen]=useState(false);
 const panels=usePanelSizes(studio.state.tab==='curves'),pointer=useRef({x:innerWidth*.5,y:innerHeight*.35});
 useEffect(()=>{const move=(e:PointerEvent)=>{pointer.current={x:e.clientX,y:e.clientY};};window.addEventListener('pointermove',move);return()=>window.removeEventListener('pointermove',move);},[]);
 const [timelineExpanded,setTimelineExpanded]=useState(false);
 const [tabletPanel,setTabletPanel]=useState<TabletPanel|null>(null),[timelineOpen,setTimelineOpen]=useState(false);
 const panelPresence=usePresence(tabletPanel),timelinePresence=usePresence(timelineOpen?true:null),shownPanel=panelPresence.value;

 const [assets,setAssets]=useState(false),[importing,setImporting]=useState(false);
 const [newAction,setNewAction]=useState<RigLayer|null>(null);
 useEffect(()=>{const open=()=>setExporting(true);window.addEventListener('pose-export-shared',open);return()=>window.removeEventListener('pose-export-shared',open);},[]);
 const s=useStudioChrome({frame:'none'}),runtime=useRef<StudioScene|null>(null),[thumbs,setThumbs]=useState<string[]>([]),[menu,setMenu]=useState(false),[exporting,setExporting]=useState(false),[recording,setRecording]=useState(false),[characterExport,setCharacterExport]=useState(false),[saved,setSaved]=useState('Recovery copy'),[help,setHelp]=useState(false),fileInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{const dismiss=(event:Event)=>{if(menu){event.preventDefault();setMenu(false);}else if(tabletPanel){event.preventDefault();setTabletPanel(null);}else if(timelineOpen){event.preventDefault();setTimelineOpen(false);}};window.addEventListener('pose-dismiss-overlay',dismiss);return()=>window.removeEventListener('pose-dismiss-overlay',dismiss);},[menu,tabletPanel,timelineOpen]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{const t=e.target as HTMLElement;if(!t.closest('.title-menu'))setMenu(false);if(t.matches('.scene-canvas'))setTabletPanel(null);if(t.matches('.modal-backdrop')&&!recording&&!exporting){setAssets(false);setImporting(false);setHelp(false);setNewAction(null);}};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[recording,exporting]);
 const characterPreview=!!s.workspace?.previewCharacterId,retarget=s.retargetMode,setRetarget=(value:boolean)=>{if(isAndroid&&value)setTabletPanel('rig');if(value&&!studio.state.workspace?.previewCharacterId&&studio.state.workspace?.activeCharacterId)studio.selectPreviewCharacter(studio.state.workspace.activeCharacterId);studio.patch({retargetMode:value,retargetRest:value&&!studio.state.playing,playerView:false});runtime.current?.resetView();};
 const setRuntime=useCallback((r:StudioScene|null)=>{runtime.current=r;if(import.meta.env.DEV){window.__studio=studio;window.__scene=r;}},[]);
 useEffect(()=>{const flush=()=>{const data=studio.recoverySnapshot();if(data)try{void writeRecovery(data).catch(()=>{});}catch{}};const hidden=()=>{if(document.visibilityState==='hidden')flush();};window.addEventListener('beforeunload',flush);window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',hidden);return()=>{window.removeEventListener('beforeunload',flush);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',hidden);};},[]);
 const file=useProjectFile(s.ready,exporting||recording||characterExport||importing||assets||!!newAction),save=file.save;
 const importMode=useRef(false);
 const receive=(p:unknown,merge:boolean)=>{if(merge)studio.importAnimations(p);else file.requestOpen(p);};
 const open=async(merge=false)=>{importMode.current=merge;if(window.studioDesktop){try{const p=await window.studioDesktop.openProject();if(p)receive(p,merge);}catch(e){studio.patch({message:(e as Error).message});}}else fileInput.current?.click();setMenu(false);};
 const newClip=(demo:boolean)=>{if(!runtime.current||!s.ready)return;if(demo)studio.addAnimation(runtime.current.restControls,true);else setNewAction('firstPerson');setMenu(false);};
 const chooseAction=(layer:RigLayer)=>{const p=studio.state.project,w=studio.documentSnapshot();if(!p||!w||p.editing===layer)return;const target=w.clips.find(c=>c.id===p.bodyBase?.sourceId&&c.project.editing===layer)??w.clips.find(c=>c.project.editing===layer&&c.project.bodyBase?.sourceId===w.activeId);if(target)studio.activate(target.id);else setNewAction(layer);};
 useEffect(()=>{if(!s.project)return;setSaved('Saving…');const t=setTimeout(async()=>{try{const data=studio.recoverySnapshot();if(data)await writeRecovery(data);setSaved('Recovery copy up to date');}catch{setSaved('Save needed · autosave full');}},650);return()=>clearTimeout(t);},[s.project,s.workspace,s.drafts]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{
  const resetKey=e.key.toLowerCase();
  if(e.altKey&&!e.ctrlKey&&!e.metaKey&&(resetKey==='g'||resetKey==='r')&&!studio.state.keyframeMenu&&!exporting&&!recording&&!characterExport&&!retarget&&!help&&!newAction&&!file.pending&&!importing&&!assets){
   const target=e.target as HTMLElement;if(!target.closest('[role=dialog],[data-editor-overlay],.curve-editor,.timeline')&&(!isTypingTarget(target)||target.matches('input[type=number]'))){
    e.preventDefault();if(target.matches('input[type=number]'))target.blur();runtime.current?.handleTransformKey(new KeyboardEvent('keydown',{key:'Escape'}));studio.resetSelected(resetKey==='g'?'location':'rotation');return;
   }
  }
  if(studio.state.keyframeMenu||e.defaultPrevented||isTypingTarget(e.target)||exporting||recording||characterExport||help||newAction||file.pending||importing||assets||(e.target as HTMLElement).closest('[role=dialog],[data-editor-overlay]'))return;
  if(retarget){const k=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();save();}else if(k===' '){e.preventDefault();studio.patch({playing:!studio.state.playing,retargetRest:false});}else if(k==='arrowleft'||k==='arrowright'){e.preventDefault();studio.setFrame(studio.state.frame+(k==='arrowleft'?-1:1));}else if(k==='home'||k==='end'){e.preventDefault();studio.setFrame(k==='home'?0:studio.state.project?.end??0);}return;}
  if(e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='g'){e.preventDefault();runtime.current?.toggleGameView();return;}
  if(runtime.current?.handleTransformKey(e))return;
  if(e.code==='Numpad0'){e.preventDefault();studio.patch({playerView:!studio.state.playerView,message:studio.state.playerView?'Orbit view':'Player camera · Numpad 0 to return'});return;}
  // Like Blender, timeline shortcuts follow the editor under the pointer,
  // including after switching actions using the tabs above the viewport.
  const target=e.target as HTMLElement,hovered=document.elementFromPoint(pointer.current.x,pointer.current.y)?.closest('.dope-sheet');
  if(hovered&&!target.closest('.dope-sheet,.curve-editor')){
   const forwarded=new KeyboardEvent('keydown',{key:e.key,code:e.code,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,shiftKey:e.shiftKey,bubbles:true,cancelable:true});
   if(!hovered.dispatchEvent(forwarded)){e.preventDefault();return;}
  }
  const k=e.key.toLowerCase(),graph=!!(e.target as HTMLElement).closest('.curve-editor');
  if(!graph){
   if(e.altKey&&k==='r'){e.preventDefault();studio.resetSelected('rotation');return;}
   if(e.altKey&&k==='g'){e.preventDefault();studio.resetSelected('location');return;}
   if(e.altKey&&k==='h'){e.preventDefault();studio.showControls(true);return;}
   if(k==='a'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.altKey?studio.deselectAll():studio.selectAll();return;}
   if((e.ctrlKey||e.metaKey)&&k==='i'){e.preventDefault();studio.invertSelection();return;}
   if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
    if(k===','||k==='.'){e.preventDefault();window.dispatchEvent(new CustomEvent('transform-options',{detail:k===','?'orientation':'pivot'}));return;}
    if(k==='b'){e.preventDefault();runtime.current?.beginBoxSelection();return;}
    if(k==='g'||k==='r'){e.preventDefault();runtime.current?.beginTransform(k==='g'?'translate':'rotate');return;}
    if(k==='h'){e.preventDefault();studio.hideSelected(e.shiftKey);return;}
    if(k==='i'||k==='k'){e.preventDefault();studio.showKeyframeMenu(pointer.current.x,pointer.current.y);return;}
    if(e.code==='NumpadDecimal'||k==='f'){e.preventDefault();runtime.current?.frameSelected();return;}
    if(k==='home'){e.preventDefault();runtime.current?.resetView();return;}
   }
  }
  if(e.ctrlKey||e.metaKey){const key=e.key.toLowerCase();if(key==='c'){e.preventDefault();e.shiftKey?studio.copyPose('rig'):studio.copySelectedPose();return;}if(key==='v'){e.preventDefault();studio.pastePose();return;}if(key==='n'){e.preventDefault();if(runtime.current)setNewAction('firstPerson');return;}if(key==='tab'){e.preventDefault();const w=studio.state.workspace;if(w){const i=w.openIds.indexOf(w.activeId);studio.activate(w.openIds[(i+(e.shiftKey?-1:1)+w.openIds.length)%w.openIds.length]);}return;}}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?studio.redo():studio.undo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();studio.redo();return;}
  const key=e.key.toLowerCase();if(key===' '){e.preventDefault();studio.patch({playing:!studio.state.playing,drafts:{}});}
  else if(key==='k'){e.preventDefault();studio.addKey();}
  else if(key==='delete'){e.preventDefault();studio.removeKey();}
  else if(key==='arrowleft'){e.preventDefault();studio.setFrame(e.shiftKey?0:studio.state.frame-1);}
  else if(key==='arrowright'){e.preventDefault();studio.setFrame(e.shiftKey?studio.state.project?.end??96:studio.state.frame+1);}
  else if(key==='home'){e.preventDefault();studio.setFrame(0);}
  else if(key==='end'){e.preventDefault();studio.setFrame(studio.state.project?.end??96);}
  else if(key==='w')studio.patch({mode:'translate'});
  else if(key==='e')studio.patch({mode:'rotate'});
  else if(key==='q')studio.patch({mode:'select'});
  else if(key==='f')runtime.current?.frameSelected();
 };window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[save,exporting,recording,characterExport,retarget,help,file.pending,newAction,importing,assets]);
 const controls=retarget?<CharacterPanel runtime={runtime.current}/>:<ControlList/>;
 const inspector=retarget?<RetargetInspector runtime={runtime.current}/>:<Inspector runtime={runtime.current} attach={(target,position,rotation)=>runtime.current?.setAttachment(target,position,rotation)} pick={()=>runtime.current?.pickAttachment()} thumbs={thumbs} setBoneFollowing={(position,rotation)=>runtime.current?.setBoneFollowing(position,rotation)} switchLimb={(limb,mode)=>runtime.current?.switchLimb(limb,mode)}/>;
 return <div className={'app '+(!isAndroid?'desktop-workspace ':'')+(s.tab==='curves'?'curves-open':'')+(timelineExpanded&&(!isAndroid||timelinePresence.value)?' timeline-expanded':'')+(timelinePresence.value?' timeline-open':'')+(timelineOpen?' timeline-visible':'')+(shownPanel?' sheet-open':'')} style={panels.style}>
  <header className="titlebar"><div className="title-menu"><button className="brand" aria-label="Project menu" title="Project menu" disabled={recording||exporting} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Waypoints size={18}/><span>Pose</span><ChevronDown size={12}/></button><MotionPresence show={menu}><div className="file-menu" data-editor-overlay><label className="project-menu-field">Project<input aria-label="Library project name" disabled={!s.ready} maxLength={100} value={s.workspace?.name??''} onChange={e=>studio.renameWorkspace(e.target.value)}/></label><button onClick={()=>{const data=library(blankProject(runtime.current?.restControls??{}));data.name='Untitled project';file.requestOpen(data);setMenu(false);}}><FilePlus size={16}/>New project</button><button onClick={()=>newClip(false)}><FilePlus size={16}/>New animation</button><button disabled={!s.ready} onClick={()=>open()}><FolderOpen size={16}/>Open project…</button><button onClick={()=>{setAssets(true);setMenu(false);}}><Box size={16}/>Project assets…</button><button onClick={()=>{setImporting(true);setMenu(false);}}><FolderOpen size={16}/>Import animation…</button><button onClick={()=>{save();setMenu(false);}}><Save size={16}/>Save project… <kbd>Ctrl S</kbd></button>{isAndroid&&<><button onClick={()=>{setMenu(false);setRecording(true);}}><Video size={16}/>Record video…</button><button onClick={()=>{setMenu(false);setExporting(true);}}><Upload size={16}/>Export animation…</button></>}<RecentProjects open={p=>{receive(p,false);setMenu(false);}}/><hr/>{!isPwaBuild&&<button onClick={async()=>{setMenu(false);try{const data=await window.studioDesktop?.openExample();if(data)file.requestOpen(data);}catch(e){studio.patch({message:(e as Error).message});}}}>Open Axe studio example…</button>}{isPwaBuild&&<button onClick={()=>{setMenu(false);setInstallOpen(true);}}>Install Studio / app status…</button>}<button onClick={()=>{setHelp(true);setMenu(false);}}>Keyboard shortcuts</button>{nativeAndroid&&<button onClick={()=>{setMenu(false);window.dispatchEvent(new Event('pose-show-updates'));}}>App and project updates…</button>}</div></MotionPresence></div><span className="project-title" title={s.workspace?.name}>{s.workspace?.name}</span><span className={'save-indicator '+(saved==='Saving…'?'saving':'')} title={saved} aria-label={saved}>{saved==='Saving…'?<LoaderCircle size={14}/>:<Check size={14}/>}</span><div className="title-spacer"/>{nativeAndroid&&<Updates file={file} blocked={recording||exporting||characterExport||importing||assets||!!newAction||file.pending}/> }<button className="export-button" aria-label="Export recording" title="Export recording" disabled={!s.ready||recording||exporting} onClick={()=>{setMenu(false);setRecording(true);}}><Video size={18}/></button><button className="export-button" aria-label={isAndroid?"Export":"Export to Unreal"} title={isAndroid?"Export":"Export to Unreal"} disabled={!s.ready||recording||exporting} onClick={()=>{setMenu(false);if(characterPreview)setCharacterExport(true);else setExporting(true);}}><Upload size={18}/></button><WindowControls/></header>
  {installOpen&&<InstallStudio close={()=>setInstallOpen(false)}/>}
  {!isAndroid?<DesktopWorkspace scene={<Viewport onRuntime={setRuntime} onThumbs={setThumbs}/>} controls={controls} inspector={inspector} animations={<AnimationBar embedded create={()=>newClip(false)} importClips={()=>setImporting(true)}/>} tools={<TabletSettings retarget={retarget} setRetarget={setRetarget} chooseAction={chooseAction} openAssets={()=>setAssets(true)} runtime={runtime.current} save={save} help={()=>setHelp(true)}/>} sizes={panels.sizes} resize={panels.change} retarget={retarget}/>:<div className="workspace"><Viewport onRuntime={setRuntime} onThumbs={setThumbs}/></div>}
   {isAndroid&&<><TabletWorkspace pasteMirrored={()=>runtime.current?.pasteMirroredPose()} boxSelect={()=>runtime.current?.beginBoxSelection()} mirror={()=>runtime.current?.mirrorSelectedPose()} panel={tabletPanel} toggle={p=>setTabletPanel(current=>current===p?null:p)} timeline={timelineOpen} toggleTimeline={()=>setTimelineOpen(v=>!v)}/>{shownPanel&&<TabletDrawer panel={shownPanel} exiting={panelPresence.exiting} close={()=>setTabletPanel(null)}>{shownPanel==='rig'?controls:shownPanel==='properties'?inspector:shownPanel==='animations'?<AnimationBar embedded create={()=>newClip(false)} importClips={()=>setImporting(true)}/>:<TabletSettings retarget={retarget} setRetarget={setRetarget} chooseAction={chooseAction} openAssets={()=>setAssets(true)} runtime={runtime.current} save={save} help={()=>setHelp(true)}/>}</TabletDrawer>}</>}
  {isAndroid&&timelinePresence.value&&<Timeline exiting={isAndroid&&timelinePresence.exiting} expanded={timelineExpanded} expand={()=>setTimelineExpanded(v=>!v)} close={isAndroid?()=>setTimelineOpen(false):undefined}/>}<KeyframeMenu/>

  <footer className="statusbar"><span role="status">{s.message}</span><span>{s.retargetMode?'Retarget · '+(s.workspace?.characters?.find(c=>c.id===s.workspace?.activeCharacterId)?.name??'No character'):Object.keys(s.drafts).length?'Unkeyed pose':s.ready?(s.workspace?.characters?.find(c=>c.id===s.workspace?.previewCharacterId)?.name??'Manny')+' · shared Manny rig':'Loading'}<i/>v0.8.24</span></footer>
  <input ref={fileInput} type="file" accept=".pose,.json,.manny" hidden onChange={async e=>{const f=e.target.files?.[0];if(f)try{receive(await decodeProject(new Uint8Array(await f.arrayBuffer())),importMode.current);}catch(err){studio.patch({message:(err as Error).message});}e.target.value='';}}/>
  <MotionOverlay show={assets}><AssetLibrary runtime={runtime.current} close={()=>setAssets(false)} characterSetup={()=>setRetarget(true)} animationImport={()=>setImporting(true)}/></MotionOverlay>
   <MotionOverlay show={importing}><AnimationImport runtime={runtime.current} close={()=>setImporting(false)} nativeImport={()=>void open(true)}/></MotionOverlay>
   <MotionOverlay show={file.pending}>{file.dialog}</MotionOverlay>
  <MotionOverlay show={!!newAction}><NewActionDialog initial={newAction??'firstPerson'} rest={runtime.current?.restControls??{}} close={()=>setNewAction(null)}/></MotionOverlay>
  <MotionOverlay show={recording}><RecordingDialog runtime={runtime.current} close={()=>setRecording(false)}/></MotionOverlay>
  <MotionOverlay show={characterExport}><RetargetExport runtime={runtime.current} close={()=>setCharacterExport(false)}/></MotionOverlay>
  <MotionOverlay show={exporting}>{portablePlatform?<AndroidExportDialog runtime={runtime.current} save={save} close={()=>setExporting(false)}/>:<ExportDialog runtime={runtime.current} close={()=>setExporting(false)}/>}</MotionOverlay>
  <MotionPresence show={help} kind="overlay"><div className="modal-backdrop"><section className="modal compact-modal" role="dialog" aria-modal="true"><header><h2>Make your first animation</h2><button aria-label="Close help" onClick={()=>setHelp(false)}><X size={20}/></button></header><p>{isAndroid&&<>Touch or S Pen: drag a control to pose it, or use its axis handles. Drag empty space to orbit; use two fingers to pan and pinch. A second finger cancels a tentative pose before navigating. Rig, Pose, Clips and Tools open drawers; Timeline opens timing controls. </>}Use + above the viewport to add animations. Switch tabs to keep working without closing anything. Pick a control, choose a frame, and pose it. With Auto key enabled, each edit becomes a keyframe. Drag the diamonds to change timing.</p><dl className="shortcuts">{SHORTCUTS.map(([key,label])=><div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl><p className="help-text">Change “Following” to attach a hand or prop. Switching attachments preserves its current position. With Auto key off, press K before changing frames to keep your pose.</p></section></div></MotionPresence>
 </div>;
}
