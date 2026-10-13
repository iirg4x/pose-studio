/** Presentation time is independent of authored key times and the store's
 * integer playback cursor. Only small cursor leaves subscribe to this clock. */
export class DisplayClock {
 private frame=0;
 private listeners=new Set<()=>void>();
 getSnapshot=()=>this.frame;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 publish(frame:number){if(frame===this.frame||!Number.isFinite(frame))return;this.frame=frame;for(const listener of this.listeners)listener();}
}
