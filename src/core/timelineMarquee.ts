import {mirrorDriver} from './liveMirror';
import {readCurve} from './curves';
import type {Project} from './model';
import type {TimelineRow} from './timelineChannels';
import {trackFrames,uniqueKeys} from './timelineKeys';
import type {TimelineKey} from './timelineKeys';
export type MarqueeBox={x:number;y:number;toX:number;toY:number};
export function timelineMarqueeKeys(project:Project,rows:TimelineRow[],box:MarqueeBox,layout:{width:number;rowHeight:number;rulerHeight:number;scrollTop:number}):TimelineKey[]{
 const left=Math.min(box.x,box.toX),right=Math.max(box.x,box.toX),top=Math.min(box.y,box.toY),bottom=Math.max(box.y,box.toY),hits:TimelineKey[]=[];
 const summaryTop=Math.max(layout.rulerHeight,layout.scrollTop+layout.rulerHeight);
 rows.forEach((row,i)=>{
  // The sticky summary must not unexpectedly select every bone while a box
  // crosses it during edge scrolling. It participates when the drag starts there.
  if(row.key==='all'&&(box.y<summaryTop||box.y>summaryTop+layout.rowHeight))return;
  const y=(row.key==='all'?summaryTop:layout.rulerHeight+i*layout.rowHeight)+layout.rowHeight/2;
  if(y<top-3||y>bottom+3)return;
  for(const id of row.ids){if(mirrorDriver(project,id))continue;const frames=row.channel?readCurve(project.tracks[id],row.channel).keys.map(k=>k.frame):trackFrames(project.tracks[id]);
   for(const frame of frames){const x=frame/project.end*layout.width;if(frame<=project.end&&x>=left-4&&x<=right+4)hits.push({id,frame});}
  }
 });return uniqueKeys(hits);
}
export function marqueeScrollSpeed(point:number,start:number,end:number){const edge=Math.min(28,(end-start)/4);return point<start+edge?-Math.min(18,(start+edge-point)*.7):point>end-edge?Math.min(18,(point-end+edge)*.7):0;}
