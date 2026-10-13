import {useEffect,useState} from 'react';
import {studio} from '../core/store';
export function RecentProjects({open}:{open:(value:unknown)=>void}){
 const [projects,setProjects]=useState<{path:string;name:string;openedAt:string}[]>([]),[error,setError]=useState('');
 useEffect(()=>{window.studioDesktop?.recentProjects().then(setProjects).catch(e=>setError(e.message));},[]);
 if(!window.studioDesktop)return null;
 return <section className="recent-projects" aria-label="Recent projects"><h4>Recent projects</h4>{projects.map(p=><button className="recent-project" key={p.path} title={p.path} onClick={async()=>{try{open(await window.studioDesktop!.openRecentProject(p.path));}catch(e){setError((e as Error).message);studio.patch({message:(e as Error).message});}}}><strong>{p.name}</strong><small>{p.path}</small></button>)}{!projects.length&&<p>Projects you open or save appear here.</p>}{error&&<p role="alert">{error}</p>}{projects.length>0&&<button onClick={async()=>{await window.studioDesktop!.clearRecentProjects();setProjects([]);setError('');}}>Clear recent list</button>}</section>;
}
