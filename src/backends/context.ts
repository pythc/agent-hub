import type {ToolSpec,ToolContent} from '../model.ts'

export const recallSpec:ToolSpec={type:'function',name:'backend_recall',description:'Read retained history from this API conversation. Omit IDs to list/search prior turns; turnId pages a complete turn; callId pages an original tool result or returns its original images. Archived/pruned context remains here. This tool cannot execute work.',inputSchema:{type:'object',properties:{turnId:{type:'string'},callId:{type:'string'},query:{type:'string',maxLength:500},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:8000}},additionalProperties:false}}
interface History {messages:any[];turns:any[];effects:Record<string,{result?:{contentItems:ToolContent[];success:boolean}}>}
const clipped=(value:string,callId:string)=>value.length>8192?value.slice(0,4096)+'\n[Tool result shortened; backend_recall callId='+callId+' retains the original '+value.length+' characters.]\n'+value.slice(-1024):value

/** A wire projection only: canonical messages, original results and tool receipts are never rewritten. */
export function contextProjection(history:History,budgetBytes:number){
 const projected=history.messages.map(m=>{
  if(m.role==='tool'&&typeof m.content==='string')return {...m,content:clipped(m.content,m.tool_call_id)}
  if(m.type==='function_call_output')return {...m,output:typeof m.output==='string'?clipped(m.output,m.call_id):m.output.map((c:any)=>c.type==='input_text'?{...c,text:clipped(c.text,m.call_id)}:c)}
  if(m.role==='user'&&Array.isArray(m.content))return {...m,content:m.content.map((c:any)=>c.type==='tool_result'?{...c,content:typeof c.content==='string'?clipped(c.content,c.tool_use_id):c.content.map((p:any)=>p.type==='text'?{...p,text:clipped(p.text,c.tool_use_id)}:p)}:c)}
  return m
 })
 let start=0
 // Cut only at recorded turn boundaries, after interrupted tool results have been reconciled.
 // Old records without boundaries are retained until a later, known-safe boundary is available.
 const boundaries=history.turns.map(t=>t.wireStart).filter((n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<projected.length)
 let messages=projected
 for(const boundary of boundaries){if(Buffer.byteLength(JSON.stringify(messages))<=budgetBytes)break;start=boundary;messages=projected.slice(start)}
 const archived=history.turns.filter(t=>Number.isSafeInteger(t.wireStart)&&t.wireStart<start).map(t=>t.id)
 return {messages,notice:start?'Earlier conversation blocks are archived, not forgotten or summarized. Use backend_recall to search/read them before relying on missing details. Recent archived turn IDs: '+archived.slice(-8).join(', '):''}
}

export function recall(history:History,input:{turnId?:string;callId?:string;query?:string;offset?:number;limit?:number}){
 let value:unknown
 if(input.callId){
  const result=history.effects[input.callId]?.result;if(!result)throw Error('Unknown retained tool result')
  const images=result.contentItems.filter(c=>c.type==='inputImage')
  value={success:result.success,contentItems:result.contentItems.filter(c=>c.type==='inputText')}
  const text=JSON.stringify(value),offset=input.offset??0,limit=input.limit??4000
  return {success:true,contentItems:[{type:'inputText' as const,text:JSON.stringify({text:text.slice(offset,offset+limit),characters:text.length,nextOffset:offset+limit<text.length?offset+limit:null})},...(offset===0?images:[])]}
 }
 const legacy=history.turns.some(t=>!Number.isSafeInteger(t.wireStart))
 if(input.turnId){value=input.turnId==='legacy-messages'&&legacy?history.messages.slice(0,history.turns.find(t=>Number.isSafeInteger(t.wireStart))?.wireStart):history.turns.find(t=>t.id===input.turnId);if(!value)throw Error('Unknown retained turn')}
 else value=[...(legacy?[{id:'legacy-messages',status:'archive',input:'Original wire messages recorded before turn boundaries were introduced'}]:[]),...history.turns.filter(t=>!input.query||JSON.stringify(t).toLowerCase().includes(input.query.toLowerCase())).map(t=>({id:t.id,status:t.status,input:typeof t.input==='string'?t.input.slice(0,160):undefined}))]
 const text=JSON.stringify(value),offset=input.offset??0,limit=input.limit??4000
 return {success:true,contentItems:[{type:'inputText' as const,text:JSON.stringify({text:text.slice(offset,offset+limit),characters:text.length,nextOffset:offset+limit<text.length?offset+limit:null})}]}
}
