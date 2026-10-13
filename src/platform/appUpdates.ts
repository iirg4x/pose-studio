import {registerPlugin} from '@capacitor/core';
import type {PluginListenerHandle} from '@capacitor/core';
export interface AppUpdate {currentVersion:string;currentCode:number;available:boolean;version:string;size:number;notes:string;ready:boolean;metered:boolean}
interface Updates {check():Promise<AppUpdate>;download():Promise<AppUpdate>;install():Promise<{permissionNeeded?:boolean}>;addListener(event:'progress'|'resume',fn:(event:{progress?:number})=>void):Promise<PluginListenerHandle>}
export const appUpdates=registerPlugin<Updates>('PoseUpdates');
