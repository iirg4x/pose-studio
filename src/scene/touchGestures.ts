export type TouchPoint={id:number;x:number;y:number;kind:'touch'|'pen'};
export interface TouchActions {
 beginPose(point:TouchPoint):boolean;
 startPose(point:TouchPoint):void;
 movePose(point:TouchPoint):void;
 finishPose(cancel:boolean):void;
 tap(point:TouchPoint):void;
 orbit(dx:number,dy:number):void;
 panZoom(dx:number,dy:number,scale:number):void;
}
// Own a gesture from first contact to final lift. A second finger always wins
// navigation and rolls back any tentative pose, so pinching never creates keys.
export class TouchGestures {
 private points=new Map<number,TouchPoint>();
 private start?:TouchPoint;private previous?:TouchPoint;
 private pose=false;private moved=false;private multi=false;
 // CSS pixels keep the tap tolerance independent of render resolution/DPI.
 constructor(private actions:TouchActions,private slop=7,private poseSlop={touch:14,pen:10}){}
 get active(){return this.points.size>0;}
 down(point:TouchPoint){
  if(point.kind==='touch'&&[...this.points.values()].some(p=>p.kind==='pen'))return;
  if(point.kind==='pen'&&this.points.size)this.cancel();
  this.points.set(point.id,point);
  if(this.points.size===1){this.start=this.previous=point;this.moved=this.multi=false;this.pose=this.actions.beginPose(point);}
  else{if(this.pose)this.actions.finishPose(true);this.pose=false;this.multi=true;}
 }
 move(point:TouchPoint){
  if(!this.points.has(point.id))return;
  const before=[...this.points.values()].slice(0,2);this.points.set(point.id,point);
  if(this.multi){if(this.points.size<2)return;const after=[...this.points.values()].slice(0,2);
   const distance=(p:TouchPoint[])=>Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
   this.actions.panZoom((after[0].x+after[1].x-before[0].x-before[1].x)/2,(after[0].y+after[1].y-before[0].y-before[1].y)/2,Math.max(1,distance(before))/Math.max(1,distance(after)));return;
  }
  if(!this.start||!this.previous)return;
  if(!this.moved){
   const dx=point.x-this.start.x,dy=point.y-this.start.y,distance=Math.hypot(dx,dy),threshold=this.pose?this.poseSlop[this.start.kind]:this.slop;
   if(distance<=threshold)return;
   this.moved=true;
   // Consume the deadzone once, then keep this anchor even when reversing.
   // The first visible movement is only the distance beyond the threshold.
   if(this.pose)this.actions.startPose({...this.start,x:this.start.x+dx*threshold/distance,y:this.start.y+dy*threshold/distance});
  }
  if(this.pose)this.actions.movePose(point);else this.actions.orbit(point.x-this.previous.x,point.y-this.previous.y);this.previous=point;
 }
 up(point:TouchPoint){
  if(!this.points.has(point.id))return;
  if(!this.multi){if(this.pose)this.actions.finishPose(false);else if(!this.moved)this.actions.tap(point);}
  this.points.delete(point.id);if(!this.points.size){this.start=this.previous=undefined;this.pose=this.moved=this.multi=false;}
 }
 cancel(pointerId?:number){if(pointerId!==undefined&&!this.points.has(pointerId))return;if(this.pose)this.actions.finishPose(true);this.points.clear();this.start=this.previous=undefined;this.pose=this.moved=this.multi=false;}
}
