import {companionStatus,type CompanionPhase,type CompanionStatus} from '../../web/chat/companion-state.ts'
import type {Snapshot} from './client.ts'

// Alpha silhouette sampled at 12×12 from src/ui/assets/agents/roppo-body.webp.
// Braille cells hold 2×4 dots; scale the original silhouette equally on both axes.
export const companionBody=[
 '............','....####....','...######...','..########..',
 '..########..','..########..','..#######...','..#######...',
 '..########..','..###.####..','...#...##...','............'
]
export type CompanionFrame={pixels:number[][];label:string;phase:CompanionPhase}
type Handoff=Snapshot['handoffs'][number]
const smooth=(t:number)=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x)}
export const companionSourceWidth=16
export const companionScale=1.2
export const companionWidth=Math.ceil(companionSourceWidth*companionScale)
export const companionRows=Math.ceil(companionBody.length*companionScale/4)
/** Center the uniformly enlarged frame in whole Braille cells, including blank padding. */
export function scaleCompanion(pixels:number[][]):number[][]{
 const left=(companionWidth*2-pixels[0]!.length*companionScale)/2
 const top=(companionRows*4-pixels.length*companionScale)/2
 return Array.from({length:companionRows*4},(_,y)=>Array.from({length:companionWidth*2},(_,x)=>
  pixels[Math.floor((y+.5-top)/companionScale)]?.[Math.floor((x+.5-left)/companionScale)]??0))
}
/** Rasterize both eyes after body scaling so rounding cannot make one eye larger. */
export function paintCompanionEyes(pixels:number[][],x:number,y:number,closed:boolean,angle=0){
 const left=(companionWidth*2-companionSourceWidth*2*companionScale)/2
 const top=(companionRows*4-companionBody.length*companionScale)/2
 const cos=Math.cos(angle),sin=Math.sin(angle)
 const centerX=Math.round(left+(x+.5)*companionScale-.5)
 const centerY=Math.round(top+(y+.5)*companionScale-.5)
 for(const offset of [-2,1]){
  const ex=centerX+Math.round(offset*cos),ey=centerY+Math.round(offset*sin)
  for(let i=0;i<2;i++){
   const px=ex+(closed?i:0),py=ey+(closed?0:i)
   if(pixels[py]?.[px]!==undefined)pixels[py]![px]=0
  }
 }
}
export function drawCompanion(phase:CompanionPhase,time:number,greeting=false,handoff?:{progress:number;worker:boolean},worker=false):number[][]{
 const pixels=Array.from({length:12},()=>Array<number>(companionSourceWidth*2).fill(0))
 const dot=(x:number,y:number,color=1)=>{x=Math.round(x);y=Math.round(y);if(pixels[y]?.[x]!==undefined)pixels[y]![x]=color}
 const rect=(x:number,y:number,w:number,h:number,color:number)=>{for(let j=0;j<h;j++)for(let i=0;i<w;i++)dot(x+i,y+j,color)}
 const eyes:{x:number;y:number;closed:boolean;angle:number}[]=[]
 const character=(x:number,p:CompanionPhase,color=1,wave=false)=>{
  const seconds=time/1000
  const angle=p==='thinking'?-.12*Math.sin(Math.PI*smooth((seconds%4)/4)):
   p==='reviewing'?.08*Math.sin(seconds*Math.PI*2/3.6):p==='completed'?.12*Math.sin(seconds*Math.PI*2/2.2):0
  const rise=wave?-Math.sin(Math.PI*Math.min(1,time/1180))*.8:p==='idle'?-.65*Math.sin(seconds*Math.PI*2/4.8):p==='working'?.4*Math.sin(seconds*Math.PI*2/1.3):0
  const mask=companionBody.map(row=>Array.from(row,value=>value==='#'))
  const blink=seconds%5.8>2.44&&seconds%5.8<2.67
  // Sample each destination dot back into the original silhouette. Forward rounding
  // can merge adjacent dots and leave a hole when the character tilts.
  const cos=Math.cos(angle),sin=Math.sin(angle)
  for(let py=0;py<pixels.length;py++)for(let px=Math.max(0,Math.floor(x)-2);px<Math.min(pixels[py]!.length,Math.ceil(x)+14);px++){
   const dx=px-x-6,dy=py-10-rise
   const sourceX=Math.round(6+dx*cos+dy*sin),sourceY=Math.round(10-dx*sin+dy*cos)
   if(mask[sourceY]?.[sourceX])dot(px,py,color)
  }
  // Face center follows the same rotation as the body; eyelids share one shape.
  eyes.push({x:x+6+.5*cos+6*sin,y:10+rise+.5*sin-6*cos,closed:blink||p==='completed'||p==='offline'||wave,angle})
  if(wave){const y=4+Math.sin(seconds*18)*1.6;dot(x+11,y,color);dot(x+12,y+1,color)}
  if(p==='thinking')for(let i=0;i<3;i++)dot(x+11+i*2,2+(Math.sin(seconds*Math.PI*2/1.8-i*.6)>.5?-1:0),3)
  if(p==='working'){
   rect(x+8,7,6,4,2);rect(x+9,8,4,2,0);rect(x+7,11,8,1,2)
   dot(x+6,9+Math.round(Math.sin(seconds*Math.PI*2/.48)),color)
  }
  if(p==='reviewing'){
   rect(x+9,6,4,5,2);for(let i=0;i<2;i++)rect(x+10,7+i*2,2,1,0)
   const y=7+Math.round((Math.sin(seconds*Math.PI*2/2.8)+1));dot(x+13,y,3);dot(x+14,y+1,3)
  }
 }
 if(handoff){
  const t=handoff.progress,walk=smooth((t-.08)/.44),meet=smooth((t-.52)/.11),pass=smooth((t-.63)/.135),leave=smooth((t-.78)/.21)
  const sender=24*walk-26*leave,receiver=32,camera=(24*walk*(1-meet)+28*meet)*(1-leave)+receiver*leave
  if(t<.96)character(10+sender-camera,'idle',handoff.worker?4:1)
  character(10+receiver-camera,'idle',handoff.worker?1:4)
  if(t<.9){const x=10+(sender+10)*(1-pass)+(receiver-1)*pass-camera;rect(x,7-Math.sin(Math.PI*pass),3,3,3)}
 }else character(10,phase,worker?4:1,greeting)
 const scaled=scaleCompanion(pixels)
 for(const eye of eyes)paintCompanionEyes(scaled,eye.x,eye.y,eye.closed,eye.angle)
 return scaled
}
/** Web phase selection and gesture durations, with terminal-owned playback and no history replay. */
export class TerminalCompanion {
 private cursor?:{id:string;sequence:number}
 private queue:Handoff[]=[]
 private eventStart=0
 private holder?:Handoff['to']
 private pendingStatus?:CompanionStatus
 private publishedAt=0
 private status:CompanionStatus={phase:'idle',label:''}
 private celebrateUntil=0
 private phaseStart=0
 constructor(now=Date.now()){this.phaseStart=now}
 update(view:Snapshot|undefined,connected:boolean,loading:boolean,enabled:boolean,now=Date.now()){
  if(view){
   const next={id:view.conversation.id,sequence:view.conversation.sequence}
   if(!enabled||this.cursor?.id!==next.id||next.sequence<this.cursor.sequence){
    this.queue=[];this.eventStart=0;this.holder=undefined
    const latest=view.handoffs?.at(-1)
    if(enabled&&latest&&view.tasks.some(t=>t.id===latest.ticketId&&['running','queued','waiting'].includes(t.state)))this.holder=latest.to
   }
   else this.queue.push(...(view.handoffs??[]).filter(h=>h.sequence>this.cursor!.sequence))
   this.cursor=next
  }
  const actor=this.queue[0]?.to??this.holder
  const next=companionStatus(view??null,english => english,{connected,loading,participantId:actor?.kind==='worker'?actor.id:undefined})
  if(next.runId===this.status.runId&&['thinking','working','reviewing'].includes(next.phase)&&now-this.publishedAt<1400){this.pendingStatus=next;return}
  this.publish(next,now)
 }
 private publish(next:CompanionStatus,now:number){
  this.pendingStatus=undefined
  if(next.phase!==this.status.phase||next.label!==this.status.label||next.runId!==this.status.runId)this.publishedAt=now
  if(next.phase==='completed'&&this.status.runId===next.runId&&['thinking','working','reviewing','waiting'].includes(this.status.phase))this.celebrateUntil=now+2400
  if(next.phase!==this.status.phase){this.phaseStart=now}
  this.status=next
 }
 frame(now=Date.now(),reduced=false):CompanionFrame{
  if(this.pendingStatus&&now-this.publishedAt>=1400)this.publish(this.pendingStatus,now)
  if(reduced){this.queue=[];this.eventStart=0}
  const event=this.queue[0]
  if(event&&!this.eventStart)this.eventStart=now
  if(event&&now-this.eventStart>=6000){this.holder=event.to;this.queue.shift();this.eventStart=0;return this.frame(now,reduced)}
  const phase=this.status.phase==='completed'&&now>=this.celebrateUntil?'idle':this.status.phase
  const label=event?event.from.label+' → '+event.to.label:this.status.label
  return {phase,label,pixels:drawCompanion(phase,reduced?0:now-this.phaseStart,false,event?{progress:(now-this.eventStart)/6000,worker:event.from.kind==='worker'}:undefined,this.holder?.kind==='worker')}
 }
}

export function brailleCells(pixels:number[][]){
 const bits=[[1,8],[2,16],[4,32],[64,128]]
 return Array.from({length:companionRows},(_,row)=>Array.from({length:companionWidth},(_,col)=>{
  let value=0,color=1
  for(let y=0;y<4;y++)for(let x=0;x<2;x++){const pixel=pixels[row*4+y]![col*2+x]!;if(pixel){value|=bits[y]![x]!;color=Math.max(color,pixel)}}
  return {text:value?String.fromCodePoint(0x2800+value):' ',color}
 }))
}
