import {Quaternion} from 'three';
import {handles,readCurve,channelsFor} from './curves';
import type {Channel,Curve,CurveKey} from './curves';
import {sample} from './model';
import type {ControlId,Track} from './model';

export interface ReductionOptions {
 position:number; rotation:number; scalar:number;
 fit:'auto'|'bezier'|'linear'; skimHandles:boolean; preserveExtrema:boolean;
 range?:[number,number];
}
export const DEFAULT_REDUCTION:ReductionOptions={position:.02,rotation:.1,scalar:.1,fit:'auto',skimHandles:true,preserveExtrema:true};
export interface ReductionInput {id:ControlId;label:string;track:Track;channels:Channel[];protectedFrames?:number[]}
export interface ReductionRow {channel:Channel;before:number;after:number;error:number;bound:number;tolerance:number;bezier:number;linear:number;reason?:string}
export interface ReductionResult {id:ControlId;label:string;track:Track;rows:ReductionRow[];before:number;after:number;positionError:number;rotationError:number;changed:boolean}
type Point=[number,number];
type Cubic=[Point,Point,Point,Point];
type Span={a:number;b:number;mode:'linear'|'bezier';right:Point;left:Point};
const cp=<T>(v:T):T=>structuredClone(v);
const lerp=(a:Point,b:Point,t:number):Point=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const cubic=(p:Cubic,t:number):Point=>{const a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t);return lerp(lerp(a,b,t),lerp(b,c,t),t);};
function split(p:Cubic,t:number):[Cubic,Cubic]{const a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t),d=lerp(a,b,t),e=lerp(b,c,t),f=lerp(d,e,t);return [[p[0],a,d,f],[f,e,c,p[3]]];}
function parameter(p:Cubic,frame:number){if(frame<=p[0][0])return 0;if(frame>=p[3][0])return 1;let lo=0,hi=1;for(let i=0;i<40;i++){const t=(lo+hi)/2;if(cubic(p,t)[0]<frame)lo=t;else hi=t;}return (lo+hi)/2;}
function slice(p:Cubic,from:number,to:number):Cubic{const a=parameter(p,from),b=parameter(p,to);return a===0?split(p,b)[0]:b===1?split(p,a)[1]:split(split(p,b)[0],a/b)[1];}
function points(curve:Curve,i:number):Cubic{
 const a=curve.keys[i],b=curve.keys[i+1],first:Point=[a.frame,a.value],last:Point=[b.frame,b.value];
 if(a.interpolation==='linear')return [first,lerp(first,last,1/3),lerp(first,last,2/3),last];
 const r=handles(curve,i).right,l=handles(curve,i+1).left,span=b.frame-a.frame,total=r[0]-l[0],scale=total>span?span/total:1;
 return [first,[a.frame+r[0]*scale,a.value+r[1]*scale],[b.frame+l[0]*scale,b.value+l[1]*scale],last];
}
function explicit(curve:Curve):Curve{return {...cp(curve),keys:curve.keys.map((k,i)=>({...cp(k),handle:'free',...handles(curve,i)}))};}
const primitive=(k:CurveKey)=>k.interpolation==='step'||k.interpolation==='spring'||k.interpolation==='bounce';

/** The convex hull bounds the entire difference, not just the fit samples.
 * Subtracting a common line tightens the hull for fast, nearly linear motion.
 * Both cubics are restricted to the same time interval before subdivision. */
function certify(source:Cubic,target:Cubic,tolerance:number){
 const identical=source.every((p,i)=>p.every((v,j)=>Math.abs(v-target[i][j])<1e-12));
 if(identical)return {passed:true,peak:0,bound:0,worstFrame:source[0][0]};
 // baseCurve inverts Bezier time with 24 bisections. Account for that numeric
 // error as well as the continuous mathematical curves being compared here.
 const numeric=(p:Cubic)=>3*Math.max(...p.slice(1).map((v,i)=>Math.abs(v[1]-p[i][1])))*2**-24;
 const margin=numeric(source)+numeric(target);
 if(margin>tolerance)return {passed:false,peak:0,bound:margin,worstFrame:(source[0][0]+source[3][0])/2};
 let peak=0,bound=0,worstFrame=source[0][0],calls=0;
 const pending:[Cubic,Cubic,number][]=[[source,slice(target,source[0][0],source[3][0]),0]];
 while(pending.length){
  const [a,b,depth]=pending.pop()!,from=a[0][0],to=a[3][0],mid=(from+to)/2;
  for(const f of [from,mid,to]){const error=Math.abs(cubic(a,parameter(a,f))[1]-cubic(b,parameter(b,f))[1]);if(error>peak){peak=error;worstFrame=f;}if(error>tolerance)return {passed:false,peak,bound:error,worstFrame};}
  const slope=(a[3][1]-a[0][1])/(to-from),line=(p:Point)=>p[1]-a[0][1]-slope*(p[0]-from),av=a.map(line),bv=b.map(line);
  const ceiling=Math.max(Math.abs(Math.min(...av)-Math.max(...bv)),Math.abs(Math.max(...av)-Math.min(...bv)))+margin+1e-10;
  if(ceiling<=tolerance){bound=Math.max(bound,ceiling);continue;}
  if(depth>=16||++calls>8192)return {passed:false,peak,bound:ceiling,worstFrame:mid};
  const [al,ar]=split(a,parameter(a,mid)),[bl,br]=split(b,parameter(b,mid));pending.push([ar,br,depth+1],[al,bl,depth+1]);
 }
 return {passed:true,peak,bound,worstFrame};
}

function fitSpan(source:Curve,a:number,b:number,options:ReductionOptions,tolerance:number):{span?:Span;error:number;bound:number;split:number}{
 const ka=source.keys[a],kb=source.keys[b],length=kb.frame-ka.frame;
 const fitSamples:Point[]=[];
 const stride=Math.max(1,Math.ceil((b-a)/48));
 for(let i=a;i<b;i+=stride){const p=points(source,i);for(const t of [.0,.2113248654,.5,.7886751346])fitSamples.push(cubic(p,t));}
 fitSamples.push([kb.frame,kb.value]);
 const cycles=!!source.loop||source.modifiers.some(m=>m.enabled&&m.type==='cycles');
 const lockStart=cycles&&a===0,lockEnd=cycles&&b===source.keys.length-1;
 const startSlope=handles(source,a).right[1]/handles(source,a).right[0],endSlope=handles(source,b).left[1]/handles(source,b).left[0];
 const make=(r:number,l:number):Cubic=>{
  const p:Cubic=[[ka.frame,ka.value],[ka.frame+length*r,ka.value+length*r*startSlope],[kb.frame-length*l,kb.value-length*l*endSlope],[kb.frame,kb.value]];
  let aa=0,ab=0,bb=0,ay=0,by=0;
  for(const [f,v] of fitSamples){const u=parameter(p,f),w1=3*(1-u)**2*u,w2=3*(1-u)*u*u,y=v-(1-u)**3*ka.value-u**3*kb.value-(lockStart?w1*p[1][1]:0)-(lockEnd?w2*p[2][1]:0);aa+=w1*w1;ab+=w1*w2;bb+=w2*w2;ay+=w1*y;by+=w2*y;}
  const det=aa*bb-ab*ab;
  if(!lockStart&&!lockEnd&&det>1e-14){p[1][1]=(ay*bb-by*ab)/det;p[2][1]=(by*aa-ay*ab)/det;}
  else{if(!lockStart&&aa>1e-14)p[1][1]=ay/aa;if(!lockEnd&&bb>1e-14)p[2][1]=by/bb;}
  return p;
 };
 const score=(p:Cubic)=>fitSamples.reduce((sum,[f,v])=>sum+(cubic(p,parameter(p,f))[1]-v)**2,0);
 const check=(p:Cubic)=>{let error=0,bound=0,worst=a+1;
  for(let i=a;i<b;i++){const v=certify(points(source,i),p,tolerance);if(v.peak>error){error=v.peak;worst=Math.max(a+1,Math.min(b-1,Math.abs(v.worstFrame-source.keys[i].frame)<Math.abs(v.worstFrame-source.keys[i+1].frame)?i:i+1));}bound=Math.max(bound,v.bound);if(!v.passed)return {passed:false,error,bound,split:worst};}
  return {passed:true,error,bound,split:worst};
 };
 const finish=(p:Cubic,mode:'linear'|'bezier',v:ReturnType<typeof check>)=>({...v,span:v.passed?{a,b,mode,right:[p[1][0]-ka.frame,p[1][1]-ka.value] as Point,left:[p[2][0]-kb.frame,p[2][1]-kb.value] as Point}:undefined});
 const line:Cubic=[[ka.frame,ka.value],lerp([ka.frame,ka.value],[kb.frame,kb.value],1/3),lerp([ka.frame,ka.value],[kb.frame,kb.value],2/3),[kb.frame,kb.value]];
 if(options.fit!=='bezier'&&(!lockStart&&!lockEnd||options.fit==='linear')){const v=check(line);if((lockStart&&Math.abs(startSlope-(kb.value-ka.value)/length)>1e-9)||(lockEnd&&Math.abs(endSlope-(kb.value-ka.value)/length)>1e-9))v.passed=false;if(v.passed||options.fit==='linear')return finish(line,'linear',v);}
 let r=1/3,l=1/3,best=make(r,l),bestScore=score(best);
 if(options.skimHandles)for(const step of [.2,.1,.05,.025])for(const axis of [0,1])for(const direction of [-1,1]){
  const nr=axis===0?Math.max(.01,Math.min(.95,r+step*direction)):r,nl=axis===1?Math.max(.01,Math.min(.95,l+step*direction)):l;
  if(nr+nl>.99)continue;const p=make(nr,nl),s=score(p);if(s<bestScore){r=nr;l=nl;best=p;bestScore=s;}
 }
 return finish(best,'bezier',check(best));
}

/** Reduce one editable scalar curve. Existing modifiers and non-polynomial
 * interpolation remain procedural; their boundary segments are not rewritten. */
export function reduceCurve(curve:Curve,tolerance:number,options:ReductionOptions,protectedFrames:number[]=[]){
 if(!Number.isFinite(tolerance)||tolerance<=0)throw Error('Choose a positive error tolerance.');
 const source=explicit(curve),keys=source.keys,n=keys.length;
 if(n>1&&!curve.loop&&!options.range&&!protectedFrames.length&&!curve.modifiers.some(m=>m.type==='cycles')&&curve.keys.every(k=>k.value===curve.keys[0].value)&&curve.keys.slice(0,-1).every((k,i)=>primitive(k)||points(curve,i).every(p=>p[1]===k.value)))return {curve:{...cp(curve),keys:[cp(curve.keys[0])]},error:0,bound:0};
 if(n<3)return {curve:cp(curve),error:0,bound:0};
 const gain=curve.modifiers.reduce((g,m)=>m.enabled&&m.type==='scale'?g*Math.abs(m.factor):g,1),baseTolerance=tolerance/Math.max(1,gain);
 const pinned=new Set([0,n-1]);
 for(let i=0;i<n;i++){
  if(options.range&&(keys[i].frame<=options.range[0]||keys[i].frame>=options.range[1]))pinned.add(i);
  if(i<n-1&&primitive(keys[i])){pinned.add(i);pinned.add(i+1);}
  if(options.preserveExtrema&&i>0&&i<n-1){const left=keys[i].value-keys[i-1].value,right=keys[i+1].value-keys[i].value;if(left*right<0||(left===0)!==(right===0)){
   // Quantization chatter is not a meaningful extremum. Measure the adjacent
   // monotone runs, rather than pinning every tiny direction change in a bake.
   const excursion=(direction:number)=>{let j=i,sign=0;while(j+direction>=0&&j+direction<n){const d=keys[j+direction].value-keys[j].value;if(d&&sign&&Math.sign(d)!==sign)break;if(d)sign=Math.sign(d);j+=direction;}return Math.abs(keys[j].value-keys[i].value);};
   if(Math.max(excursion(-1),excursion(1))>baseTolerance*2)pinned.add(i);
  }}
 }
 // Protect the segments touching a switch, even when it falls between keys.
 for(const frame of protectedFrames){const i=keys.findIndex(k=>k.frame>=frame);if(i<0)continue;for(const j of [i-2,i-1,i,i+1])if(j>=0&&j<n)pinned.add(j);}
 const indexes=[...pinned].sort((a,b)=>a-b),pending=indexes.slice(1).map((b,i)=>[indexes[i],b] as [number,number]),segments:Span[]=[];
 let error=0,bound=0;
 while(pending.length){const [a,b]=pending.pop()!;
  if(b===a+1){segments.push({a,b,mode:keys[a].interpolation==='linear'?'linear':'bezier',right:handles(source,a).right,left:handles(source,b).left});continue;}
  const result=fitSpan(curve,a,b,options,baseTolerance);
  if(result.span){segments.push(result.span);error=Math.max(error,result.error*gain);bound=Math.max(bound,result.bound*gain);}
  else{const split=Math.max(a+1,Math.min(b-1,result.split));pending.push([a,split],[split,b]);}
 }
 segments.sort((a,b)=>a.a-b.a);
 if(segments.length+1>=n)return {curve:cp(curve),error:0,bound:0};
 const reduced:CurveKey[]=[cp(keys[0])];
 for(const segment of segments){const start=reduced.at(-1)!,end=cp(keys[segment.b]);if(segment.b>segment.a+1){start.interpolation=segment.mode;start.right=segment.right;end.left=segment.left;}reduced.push(end);}
 const candidate={...cp(curve),keys:reduced};
 // Recheck assembled neighbors too: freezing automatic handles, removing a
 // neighbor, or the evaluator's minimum handle width can affect those spans.
 let targetIndex=0;error=0;bound=0;
 for(let i=0;i<curve.keys.length-1;i++){
  while(candidate.keys[targetIndex+1].frame<=curve.keys[i].frame)targetIndex++;
  if(primitive(curve.keys[i]))continue;
  const result=certify(points(curve,i),points(candidate,targetIndex),baseTolerance);
  if(!result.passed)return {curve:cp(curve),error:0,bound:0};
  error=Math.max(error,result.peak*gain);bound=Math.max(bound,result.bound*gain);
 }
 return {curve:candidate,error,bound};
}

const rotation=(c:Channel)=>['rx','ry','rz','qx','qy','qz','qw'].includes(c);
const position=(c:Channel)=>['px','py','pz'].includes(c);
function times(track:Track,end:number){
 const boundaries=[...new Set([0,end,...track.keys.map(k=>k.frame),...Object.values(track.curves??{}).flatMap(c=>c!.keys.map(k=>k.frame)),...track.spaces.map(k=>k.frame),...(track.following??[]).map(k=>k.frame)])].sort((a,b)=>a-b),out:number[]=[];
 for(let i=0;i<boundaries.length-1;i++){const a=boundaries[i],b=boundaries[i+1],steps=Math.max(8,Math.ceil((b-a)*8));for(let j=0;j<steps;j++)out.push(a+(b-a)*j/steps);out.push(a+(b-a)*.38196601125);}
 out.push(boundaries.at(-1)!);return out;
}
function poseErrors(original:Track,next:Track,frames:number[]){let position=0,rotation=0;for(const f of frames){const a=sample(original,f),b=sample(next,f);position=Math.max(position,Math.hypot(...a.p.map((v,i)=>(v-b.p[i])*100)));rotation=Math.max(rotation,new Quaternion(...a.q).angleTo(new Quaternion(...b.q))*180/Math.PI);}return {position,rotation};}
function prunePoseKeys(track:Track,protectedFrames:number[]){
 const covered=(['px','py','pz'] as Channel[]).every(c=>track.curves?.[c])&&(track.rotationMode==='quaternion'?['qx','qy','qz','qw']:['rx','ry','rz']).every(c=>track.curves?.[c as Channel]);
 if(!covered)return;
 const first=track.keys[0];
 if(track.keys.some(k=>k.layerPosition!==first.layerPosition||k.fov!==first.fov&&!track.curves?.fov||k.grip.some((v,i)=>v!==first.grip[i]&&!track.curves?.[(['thumb','index','middle','ring','pinky'] as Channel[])[i]])))return;
 track.keys=track.keys.filter((_,i,all)=>i===0||i===all.length-1||protectedFrames.some(f=>i===all.findIndex(k=>k.frame>=f)||i===all.findIndex(k=>k.frame>=f)-1));
}
export function reduceTrack(input:ReductionInput,options:ReductionOptions,end:number):ReductionResult{
 for(const v of [options.position,options.rotation,options.scalar])if(!Number.isFinite(v)||v<=0)throw Error('Choose positive error tolerances.');
 const original=input.track,next=cp(original),rows:ReductionRow[]=[],protectedFrames=[...(input.protectedFrames??[]),...original.spaces.map(k=>k.frame),...(original.following??[]).map(k=>k.frame)];
 const frames=times(original,end);
 for(const channel of input.channels){
  const source=readCurve(original,channel),tolerance=position(channel)?options.position/Math.sqrt(3):channel.startsWith('q')?Math.sin(options.rotation*Math.PI/180/4)/2:rotation(channel)?options.rotation/3:options.scalar;
  const result=reduceCurve(source,tolerance,options,protectedFrames),candidate=result.curve;
  const row:ReductionRow={channel,before:source.keys.length,after:candidate.keys.length,error:result.error,bound:result.bound,tolerance,bezier:candidate.keys.filter(k=>k.interpolation==='bezier').length,linear:candidate.keys.filter(k=>k.interpolation==='linear').length};
  if(candidate.keys.length<source.keys.length){
   next.curves??={};next.curves[channel]=candidate;
   if(rotation(channel)||position(channel)){
    const error=poseErrors(original,next,frames);
    if(error.position>options.position||error.rotation>options.rotation){if(original.curves?.[channel])next.curves[channel]=cp(original.curves[channel]!);else delete next.curves[channel];Object.assign(row,{after:row.before,error:0,bound:0,reason:'Kept original: combined transform error exceeds tolerance'});}
   }
  }
  rows.push(row);
 }
 // Original pose keys are a fallback for channels that have not been made explicit.
 // Remove redundant fallback keys only when every changing value has a curve.
 if(!options.range)prunePoseKeys(next,protectedFrames);
 const error=poseErrors(original,next,frames);
 if(error.position>options.position||error.rotation>options.rotation)throw Error('The reduced track did not pass transform validation. Original keys are unchanged.');
 if(!original.curves&&next.curves&&!Object.keys(next.curves).length)delete next.curves;
 return {id:input.id,label:input.label,track:next,rows,before:rows.reduce((n,r)=>n+r.before,0),after:rows.reduce((n,r)=>n+r.after,0),positionError:error.position,rotationError:error.rotation,changed:JSON.stringify(original)!==JSON.stringify(next)};
}
export function reductionChannels(id:ControlId,track:Track,axis?:Channel){return axis?[axis]:channelsFor(id,track);}
