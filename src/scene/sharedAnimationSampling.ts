import * as T from 'three';

export interface SharedSamplingInfo {
 sampleRate:number;factor:number;positionError:number;rotationError:number;
}
export interface SharedSamplingOptions {
 positionTolerance?:number;rotationTolerance?:number;maxFactor?:number;
}

/** FBX/AnimSequence playback interpolates local transforms. Check the resulting
 * hierarchy, including long lever arms, before choosing its uniform sample rate. */
export async function sampleSharedAnimation(bones:T.Bone[],fps:number,end:number,sample:(frame:number)=>void,progress:(value:number)=>void,options:SharedSamplingOptions={}){
 const positionTolerance=options.positionTolerance??.0002,rotationTolerance=options.rotationTolerance??T.MathUtils.degToRad(.08),maxFactor=options.maxFactor??64;
 if(!bones.length||!Number.isInteger(fps)||fps<1||!Number.isInteger(end)||end<1||!Number.isInteger(maxFactor)||maxFactor<1||maxFactor>64||(maxFactor&(maxFactor-1))!==0||!(positionTolerance>0)||!(rotationTolerance>0))throw Error('Invalid shared animation sampling settings.');
 const indices=new Map(bones.map((b,i)=>[b,i])),parents=bones.map((b,i)=>{const parent=indices.get(b.parent as T.Bone)??-1;if(parent>=i)throw Error('Export bones must be ordered parent first.');return parent;});
 const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3(),bp=new T.Vector3(),bq=new T.Quaternion(),bs=new T.Vector3(),local=new T.Matrix4();
 const worlds=bones.map(()=>new T.Matrix4()),roots=bones.map(b=>b.parent!.matrixWorld.clone());
 const capture=()=>{const values=new Float32Array(bones.length*10);for(let i=0;i<bones.length;i++){const b=bones[i],at=i*10;values.set(b.position.toArray(),at);values.set(b.quaternion.clone().normalize().toArray(),at+3);values.set(b.scale.toArray(),at+7);if(!values.subarray(at,at+10).every(Number.isFinite))throw Error('Non-finite export transform: '+b.name);}return values;};
 const compare=(a:Float32Array,b:Float32Array,t:number)=>{
  let position=0,rotation=0,bone='';
  for(let i=0;i<bones.length;i++){
   const at=i*10;p.fromArray(a,at).lerp(bp.fromArray(b,at),t);q.fromArray(a,at+3).normalize().slerp(bq.fromArray(b,at+3).normalize(),t);s.fromArray(a,at+7).lerp(bs.fromArray(b,at+7),t);
   local.compose(p,q,s);worlds[i].multiplyMatrices(parents[i]<0?roots[i]:worlds[parents[i]],local);
   const error=p.setFromMatrixPosition(worlds[i]).distanceTo(bp.setFromMatrixPosition(bones[i].matrixWorld));
   worlds[i].decompose(p,q,s);bones[i].matrixWorld.decompose(bp,bq,bs);const angle=q.normalize().angleTo(bq.normalize());
   if(!Number.isFinite(error)||!Number.isFinite(angle))throw Error('Non-finite export transform: '+bones[i].name);
   if(error>position||angle>rotation)bone=bones[i].name;position=Math.max(position,error);rotation=Math.max(rotation,angle);
  }
  return {position,rotation,bone};
 };
 let lastFailure={frame:0,bone:'',position:0,rotation:0};
 const attempts=Math.log2(maxFactor)+1;
 for(let factor=1,attempt=0;factor<=maxFactor;factor*=2,attempt++){
  sample(0);for(let i=0;i<bones.length;i++)if(parents[i]<0)roots[i].copy(bones[i].parent!.matrixWorld);
  const frames:Float32Array[]=[capture()];let positionError=0,rotationError=0,failed=false;
  for(let tick=1;tick<=end*factor;tick++){
   const frame=tick/factor;sample(frame);const next=capture(),previous=frames[frames.length-1];
   // An irrational probe avoids missing cyclic motion that lands on every
   // quarter-frame probe, such as four modifier cycles inside one interval.
   for(const fraction of [.25,.5,.75,(Math.sqrt(5)-1)/2]){
    const probe=(tick-1+fraction)/factor;sample(probe);const error=compare(previous,next,fraction);
    positionError=Math.max(positionError,error.position);rotationError=Math.max(rotationError,error.rotation);
    if(error.position>positionTolerance||error.rotation>rotationTolerance){lastFailure={frame:probe,...error};failed=true;break;}
   }
   if(failed)break;frames.push(next);
   if(tick%16===0){progress((attempt+tick/(end*factor))/attempts);await new Promise(resolve=>setTimeout(resolve,0));}
  }
  if(!failed){progress(1);return {frames,info:{sampleRate:fps*factor,factor,positionError,rotationError} satisfies SharedSamplingInfo};}
 }
 throw Error(`Could not preserve ${lastFailure.bone} near frame ${lastFailure.frame.toFixed(3)} at ${fps*maxFactor} samples/second (${(lastFailure.position*1000).toFixed(3)} mm, ${T.MathUtils.radToDeg(lastFailure.rotation).toFixed(3)}°). The source may contain an abrupt change; no approximate animation was exported.`);
}
