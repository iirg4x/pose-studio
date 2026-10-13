export type MotionMode='spring'|'bounce';
export type EaseDirection='in'|'out'|'inOut';
export interface SpringSettings {oscillations:number;damping:number;strength:number}
export interface BounceSettings {bounces:number;height:number;decay:number;impact:number}
export interface MotionOptions {spring?:SpringSettings;bounce?:BounceSettings;easing?:EaseDirection}
export const DEFAULT_SPRING:SpringSettings={oscillations:2.5,damping:6,strength:1};
export const DEFAULT_BOUNCE:BounceSettings={bounces:3,height:.35,decay:.5,impact:.35};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const smooth=(t:number)=>t*t*(3-2*t);

function springOut(t:number,settings:SpringSettings){
 const w=2*Math.PI*settings.oscillations,d=settings.damping;
 const response=1-Math.exp(-d*t)*(Math.cos(w*t)+d/w*Math.sin(w*t));
 // Fade the residual smoothly to zero, so the next pose is exact and at rest.
 const settle=smooth(clamp((t-.65)/.35,0,1));
 const spring=response+(1-response)*settle;
 return smooth(t)+(spring-smooth(t))*settings.strength;
}
function bounceOut(t:number,settings:BounceSettings){
 if(t<=settings.impact)return (t/settings.impact)**2;
 const durations=Array.from({length:settings.bounces},(_,i)=>Math.sqrt(settings.decay)**i);
 const total=durations.reduce((a,b)=>a+b,0);
 // Leave a short rest after the final impact. Height and duration decrease together.
 const span=.98-settings.impact;
 let start=settings.impact;
 for(let i=0;i<durations.length;i++){
  const duration=span*durations[i]/total,end=start+duration;
  if(t<end){const u=(t-start)/duration;return 1-settings.height*settings.decay**i*4*u*(1-u);}
  start=end;
 }
 return 1;
}
export function motionProgress(mode:MotionMode,t:number,options:MotionOptions={}):number{
 if(t<=0)return 0;if(t>=1)return 1;
 const out=(u:number)=>mode==='spring'?springOut(u,options.spring??DEFAULT_SPRING):bounceOut(u,options.bounce??DEFAULT_BOUNCE);
 const direction=options.easing??'out';
 if(direction==='in')return 1-out(1-t);
 if(direction==='inOut')return t<.5?(1-out(1-2*t))/2:(1+out(2*t-1))/2;
 return out(t);
}
export function motionOptions(options:MotionOptions):MotionOptions{
 return {...(options.spring?{spring:{...options.spring}}:{}),...(options.bounce?{bounce:{...options.bounce}}:{}),...(options.easing?{easing:options.easing}:{})};
}
export function validateMotionOptions(options:MotionOptions){
 const range=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
 if(options.easing!==undefined&&!['in','out','inOut'].includes(options.easing))throw Error('Invalid easing direction.');
 if(options.spring!==undefined){
  const s=options.spring;
  if(!s||typeof s!=='object'||!range(s.oscillations,.5,8)||!range(s.damping,0,20)||!range(s.strength,0,2))throw Error('Invalid spring settings.');
 }
 if(options.bounce!==undefined){
  const s=options.bounce;
  if(!s||typeof s!=='object'||!Number.isInteger(s.bounces)||!range(s.bounces,1,8)||!range(s.height,0,1)||!range(s.decay,.1,.95)||!range(s.impact,.1,.8))throw Error('Invalid bounce settings.');
 }
}
