import {TransformControls} from 'three/addons/controls/TransformControls.js';
import type {Camera} from 'three';
export function framePointer(pointer:{x:number;y:number},width:number,height:number,frame:{x:number;y:number;w:number;h:number}){
 return {x:(((pointer.x+1)*.5*width-frame.x)/frame.w)*2-1,y:1-(((1-pointer.y)*.5*height-frame.y)/frame.h)*2};
}
// TransformControls receives NDC for the entire canvas. Camera framing may
// letterbox that canvas, so normalize its public pointer API to the drawn frame.
export class ViewportTransformControls extends TransformControls {
 constructor(camera:Camera,element:HTMLElement,private frame:()=>{x:number;y:number;w:number;h:number}){super(camera,element);}
 private framed(pointer:PointerEvent|null){if(!pointer)return null;const r=this.domElement!.getBoundingClientRect();return {...pointer,...framePointer(pointer,r.width,r.height,this.frame())} as PointerEvent;}
 override pointerHover(pointer:PointerEvent|null){super.pointerHover(this.framed(pointer));}
 override pointerDown(pointer:PointerEvent|null){super.pointerDown(this.framed(pointer));}
 override pointerMove(pointer:PointerEvent|null){super.pointerMove(this.framed(pointer));}
}
