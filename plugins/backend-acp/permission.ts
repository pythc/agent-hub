import {randomUUID} from 'node:crypto'
import type {ModelRequest} from '../backend-sdk.ts'
import {object,type AcpRequest} from './transport.ts'
const cancelled=()=>({outcome:{outcome:'cancelled'}})
const kinds=new Set(['read','edit','delete','move','search','execute','fetch','other'])
/** One-shot grants cannot outlive their exact live session, turn, request or deadline. */
export class AcpPermissions {
 private readonly pending=new Map<string,()=>void>()
 private closed=false
 constructor(private readonly sessionId:string,private readonly turnId:string,private readonly timeoutMs:number,
  private readonly human:ModelRequest['onHumanRequest'],private readonly now:()=>number=Date.now){}
 cancel(){this.closed=true;for(const cancel of this.pending.values())cancel();this.pending.clear()}
 async request(request:AcpRequest):Promise<unknown>{
  const p=request.params
  if(this.closed||p.sessionId!==this.sessionId||!object(p.toolCall)||typeof p.toolCall.toolCallId!=='string'||!p.toolCall.toolCallId||p.toolCall.toolCallId.length>200||!Array.isArray(p.options)||p.options.length>20)return cancelled()
  if(p.options.some((o:unknown)=>!object(o)||typeof o.optionId!=='string'||!o.optionId||o.optionId.length>200||!['allow_once','reject_once','allow_always','reject_always'].includes(o.kind))||new Set(p.options.map((o:any)=>o.optionId)).size!==p.options.length)return cancelled()
  const options=p.options.filter((o:any)=>['allow_once','reject_once'].includes(o.kind)) as {optionId:string;kind:string}[]
  if(!this.human){const reject=options.find(o=>o.kind==='reject_once');return reject?{outcome:{outcome:'selected',optionId:reject.optionId}}:cancelled()}
  const requestId=randomUUID(),expiresAt=this.now()+this.timeoutMs
  let timer:NodeJS.Timeout|undefined
  const ended=new Promise<undefined>(resolve=>{this.pending.set(requestId,()=>resolve(undefined));timer=setTimeout(()=>resolve(undefined),this.timeoutMs)})
  try{
   // Raw arguments/output, agent titles and remembered allow_always are excluded.
   const decision=await Promise.race([Promise.resolve(this.human({id:requestId,method:'acp/permission',params:{sessionId:this.sessionId,turnId:this.turnId,requestId,expiresAt,kind:kinds.has(p.toolCall.kind)?p.toolCall.kind:'other',options}})).catch(()=>undefined),ended])
   if(this.closed||this.now()>=expiresAt||!object(decision)||decision.sessionId!==this.sessionId||decision.turnId!==this.turnId||decision.requestId!==requestId||decision.expiresAt!==expiresAt||typeof decision.optionId!=='string'||!options.some(o=>o.optionId===decision.optionId))return cancelled()
   return {outcome:{outcome:'selected',optionId:decision.optionId}}
  }finally{if(timer)clearTimeout(timer);this.pending.delete(requestId)}
 }
}
