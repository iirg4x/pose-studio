import type {Curve,CurveKey} from './curves';

type Tangents={left:[number,number];right:[number,number]};
const cache=new WeakMap<CurveKey[],number>();
/** Solve the two boundary tangents only. The adjacent interior handles stay
 * authored: matching the endpoint slope and second derivative gives a C2 join
 * for Bézier segments without fitting a new spline through the whole clip. */
export function loopBoundarySlope(curve:Curve,ordinary:(index:number)=>Tangents):number{
 const cached=cache.get(curve.keys);if(cached!==undefined)return cached;
 const first=curve.keys.findIndex(k=>k.frame===curve.loop?.start),last=curve.keys.findIndex(k=>k.frame===curve.loop?.end);
 if(first<0||last<=first+1)return 0;
 const a=curve.keys[first],b=curve.keys[first+1],c=curve.keys[last-1],d=curve.keys[last];
 const right=b.frame-a.frame,left=d.frame-c.frame,insideRight=ordinary(first+1).left,insideLeft=ordinary(last-1).right;
 // Match baseCurve's shortening of overlapping Bézier handles.
 const sr=Math.min(1,right/(right/3-insideRight[0])),sl=Math.min(1,left/(left/3+insideLeft[0]));
 const dr=right/3*sr,dl=left/3*sl,xr=right+insideRight[0]*sr,xl=left-insideLeft[0]*sl;
 const yr=b.value+insideRight[1]*sr-a.value,yl=d.value-c.value-insideLeft[1]*sl;
 const slope=c.interpolation==='linear'?(d.value-c.value)/left:c.interpolation==='step'?0:(yr*dl*dl+yl*dr*dr)/(xr*dl*dl+xl*dr*dr);
 cache.set(curve.keys,Number.isFinite(slope)?slope:0);return cache.get(curve.keys)!;
}

/** Older Loop curves stamped the mode onto every key. Interior keys are
 * ordinary Bézier keys; only the explicit range endpoints own the seam. */
export function normalizeLoopKeys(curve:Curve){
 if(!curve.loop)return;
 for(const key of curve.keys)if(key.interpolation==='loop'&&key.frame!==curve.loop.start&&key.frame!==curve.loop.end)key.interpolation='bezier';
}

/** Editing either boundary edits the shared seam. Keep explicit handles paired. */
export function syncLoopSeam(curve:Curve,previous?:CurveKey[]){
 if(!curve.loop)return;
 normalizeLoopKeys(curve);
 const {start,end}=curve.loop,first=curve.keys.find(k=>k.frame===start),last=curve.keys.find(k=>k.frame===end);if(!first||!last)return;
 const oldFirst=previous?.find(k=>k.frame===start),oldLast=previous?.find(k=>k.frame===end);
 const source=oldFirst&&oldLast&&first.value===oldFirst.value&&last.value!==oldLast.value?last:first;
 first.value=last.value=source.value;
 for(const [key,old,other] of [[first,oldFirst,last],[last,oldLast,first]] as const){
  if(!old)continue;
  if(key.handle!==old.handle&&['flat','auto','clamped'].includes(key.handle)){other.handle=key.handle;key.left=key.right=other.left=other.right=undefined;break;}
  if(key.handle!==old.handle&&key.handle==='vector'){
   const next=curve.keys.find(k=>k.frame>start)!,prev=[...curve.keys].reverse().find(k=>k.frame<end)!,slope=key===first?(next.value-first.value)/(next.frame-start):(last.value-prev.value)/(end-prev.frame),left=(prev.frame-end)/3,right=(next.frame-start)/3;
   first.handle=last.handle='aligned';first.left=last.left=[left,left*slope];first.right=last.right=[right,right*slope];break;
  }
  if(key.handle!=='free'&&key.handle!=='aligned')continue;
  const changed=JSON.stringify([key.left,key.right])!==JSON.stringify([old.left,old.right]);if(!changed)continue;
  const h=key===first?key.right:key.left;if(!h||!h[0])continue;
  const next=curve.keys.find(k=>k.frame>start)!,prev=[...curve.keys].reverse().find(k=>k.frame<end)!;
  first.handle=last.handle='aligned';
  const slope=h[1]/h[0],left=(prev.frame-end)/3,right=(next.frame-start)/3;
  key.left=other.left=[left,left*slope];key.right=other.right=[right,right*slope];break;
 }
 cache.delete(curve.keys);
}
