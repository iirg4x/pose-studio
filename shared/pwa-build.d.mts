import type {Plugin} from 'vite';
export const APP_ASSETS:string[];
export function serviceWorkerSource(files:string[],revision:string):string;
export function posePwa():Plugin;
