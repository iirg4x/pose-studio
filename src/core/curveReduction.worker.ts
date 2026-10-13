import {reduceTrack} from './curveReduction';
import type {ReductionInput,ReductionOptions,ReductionResult} from './curveReduction';
export interface ReductionRequest {inputs:ReductionInput[];options:ReductionOptions;end:number}
export type ReductionReply={progress:number;label:string}|{results:ReductionResult[]}|{error:string};
self.onmessage=(event:MessageEvent<ReductionRequest>)=>{
 try{
  const {inputs,options,end}=event.data,results:ReductionResult[]=[];
  for(const input of inputs){self.postMessage({progress:results.length/inputs.length,label:input.label} satisfies ReductionReply);results.push(reduceTrack(input,options,end));}
  self.postMessage({results} satisfies ReductionReply);
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)} satisfies ReductionReply);}
};
