import type {AnimationLibrary} from '../core/library';
export interface LinkedDocument {uri:string;name:string;hash:string;identity:string;ignoredHash?:string}
const opened=new WeakMap<object,LinkedDocument>();
const key='pose-linked-document';
export const documentIdentity=(data:AnimationLibrary)=>data.clips.map(c=>c.id).sort().join('|');
export function rememberDocument(data:object,source:LinkedDocument){opened.set(data,source);}
export function openedDocument(data:unknown){return data&&typeof data==='object'?opened.get(data):undefined;}
export function activateDocument(source?:LinkedDocument){if(source)localStorage.setItem(key,JSON.stringify(source));else localStorage.removeItem(key);window.dispatchEvent(new Event('pose-document-link'));}
export function linkedDocument(data:AnimationLibrary|null):LinkedDocument|undefined {
 try{const source=JSON.parse(localStorage.getItem(key)??'null');if(data&&typeof source?.identity==='string'&&source.identity.split('|').some((id:string)=>data.clips.some(c=>c.id===id))&&typeof source.uri==='string'&&source.uri.startsWith('content://')&&/^[a-f0-9]{64}$/.test(source.hash))return source;}catch{}
}
export function documentRevision(source:LinkedDocument,hash:string){return hash!==source.hash&&hash!==source.ignoredHash;}
