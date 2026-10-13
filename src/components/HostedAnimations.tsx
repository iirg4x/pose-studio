import {MotionPresence} from './Motion';
import {X,Library} from 'lucide-react';
import {useStudioChrome} from '../hooks';
import {AnimationFolderList} from './AnimationFolderList';
export function HostedAnimations({close,open=true}:{open?:boolean;close:()=>void}){
 const catalog=window.poseHost!,s=useStudioChrome({frame:'none'});
 return <MotionPresence show={open}><section className="library-panel hosted-library" aria-label="PC animation library" data-editor-overlay onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
 <header><h3><Library size={16}/>Project animations <small>{catalog.clips.length}</small></h3><button aria-label="Close animation library" onClick={close}><X size={18}/></button></header>
 <div className="hosted-source"><span className="hosted-connected"/>Streamed from your PC</div>
 <AnimationFolderList clips={catalog.clips} activeId={s.workspace?.activeId} onOpen={id=>{window.dispatchEvent(new CustomEvent('pose-open-host-clip',{detail:id}));close();}}/>
 </section></MotionPresence>;
}
