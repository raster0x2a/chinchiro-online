export type ChatPosition={right:number;bottom:number};
export function clampChatPosition(position:ChatPosition,width:number,height:number,viewportWidth:number,viewportHeight:number):ChatPosition{
 return {right:Math.max(8,Math.min(Number.isFinite(position.right)?position.right:24,Math.max(8,viewportWidth-width-8))),bottom:Math.max(8,Math.min(Number.isFinite(position.bottom)?position.bottom:20,Math.max(8,viewportHeight-height-8)))};
}
