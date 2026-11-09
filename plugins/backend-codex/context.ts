import {existsSync,readFileSync} from 'node:fs'
import {protocolBytes} from '../../src/context-budget.ts'

type Item=Record<string,any>
interface Entry {key:string;item:Item;record?:number}
interface History {baseInstructions?:unknown;dynamicTools?:unknown;items:Entry[];observed:Entry[];retired:Set<string>;lastLine:number}
const identity=(item:Item)=>typeof item.id==='string'?'id:'+item.type+':'+item.id:typeof item.call_id==='string'?'call:'+item.type+':'+item.call_id:undefined
const texts=(item:Item)=>Array.isArray(item.content)?item.content.flatMap((p:any)=>typeof p.text==='string'?[p.text]:[]):[]
const ordered=(v:any):any=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v
const containsDeclaration=(value:any,declaration:string):boolean=>Array.isArray(value)?value.some(v=>containsDeclaration(v,declaration)):!!value&&typeof value==='object'&&(JSON.stringify(ordered(value))===declaration||value.type==='namespace'&&Array.isArray(value.tools)&&containsDeclaration(value.tools,declaration))

/** Only actual response items survive; compaction replaces the live context. */
export function readNativeHistory(path:string):History{
 const text=readFileSync(path,'utf8'),lines=text.split('\n'),observed:Entry[]=[],retired=new Set<string>()
 let baseInstructions:unknown,dynamicTools:unknown,items:Entry[]=[]
 for(let i=0;i<lines.length;i++){
  const line=lines[i]!;if(!line)continue
  let r:any
  try{r=JSON.parse(line)}catch(error){if(i!==lines.length-1||text.endsWith('\n'))throw error;r={type:'response_item',payload:{unparsedTail:line}}}
  if(r.type==='session_meta'){baseInstructions=r.payload?.base_instructions;dynamicTools=r.payload?.dynamic_tools}
  if(r.type==='response_item'){
   const item=r.payload as Item,entry={key:identity(item)??'record:'+i,item,record:i};observed.push(entry);items.push(entry)
  }else if(r.type==='compacted'&&Array.isArray(r.payload?.replacement_history)){
   for(const e of items)retired.add(e.key)
   items=r.payload.replacement_history.map((item:Item,n:number)=>({key:identity(item)??'replacement:'+i+':'+n,item}))
   for(const e of items)retired.delete(e.key)
  }
 }
 return {baseInstructions,dynamicTools,items,observed,retired,lastLine:lines.length-1-(text.endsWith('\n')?1:0)}
}
export function nativeProtocolHistory(path:string){const h=readNativeHistory(path);return {baseInstructions:h.baseInstructions,dynamicTools:h.dynamicTools,items:h.items.map(e=>e.item)}}

interface PendingMessage {role:string;text:string;before:Set<string>;beforeLine:number;done?:boolean}
interface PendingTool {value:Item;parents:Set<string>;returned?:boolean}
/** Reconcile copies of owned native items, never identical text from different calls. */
export class NativeContext {
 private path?:string
 private raw:Entry[]=[]
 private sequence=0
 private messages:PendingMessage[]=[]
 private tools=new Set<PendingTool>()
 private consumed=new Set<string>()
 constructor(private config:{instructions:string;input:string;schema:unknown;tools?:unknown;parameters?:unknown;baseInstructions?:string}){}
 setPath(path?:string){this.path=path}
 setInstructions(text:string){this.config.instructions=text}
 private snapshot(){
  const h=this.path&&existsSync(this.path)?readNativeHistory(this.path):{items:[],observed:[],retired:new Set<string>(),lastLine:-1} as History
  const items=[...h.items],positions=new Map(items.map((e,i)=>[e.key,i]))
  for(const e of this.raw){
   if(h.retired.has(e.key))continue
   const n=positions.get(e.key)
   if(n===undefined){positions.set(e.key,items.length);items.push(e)}
   else if(protocolBytes(e.item)>protocolBytes(items[n]!.item))items[n]=e
  }
  return {...h,items,observed:[...h.observed,...this.raw]}
 }
 observe(item:Item){
  // An unidentifiable event is retained conservatively, never text-deduplicated.
  const key=identity(item)??'raw:'+this.sequence++,n=this.raw.findIndex(e=>e.key===key)
  if(n===-1)this.raw.push({key,item});else this.raw[n]={key,item}
 }
 /** Called before turn/start, after any acknowledged pre-turn compaction. */
 begin(){this.message('user',this.config.input)}
 message(role:string,text:string){const h=this.snapshot(),p={role,text,before:new Set(h.observed.map(e=>e.key)),beforeLine:h.lastLine};this.messages.push(p);return p}
 discard(p:PendingMessage){this.messages=this.messages.filter(x=>x!==p)}
 tool(callId:string,name:string,args:unknown){
  const s=this.snapshot(),finished=new Set(s.observed.filter(e=>['function_call_output','custom_tool_call_output'].includes(e.item.type)).map(e=>e.item.call_id))
  const p:PendingTool={value:{callId,name,args},parents:new Set(s.items.filter(e=>['function_call','custom_tool_call'].includes(e.item.type)&&!finished.has(e.item.call_id)).map(e=>String(e.item.call_id)))}
  this.tools.add(p);return p
 }
 toolResult(p:PendingTool,result:unknown){p.value.result=result}
 toolReturned(p:PendingTool){p.returned=true}
 envelope(){
  const h=this.snapshot(),finished=new Set(h.observed.filter(e=>['function_call_output','custom_tool_call_output'].includes(e.item.type)).map(e=>String(e.item.call_id)))
  for(const p of this.messages)if(!p.done){
   const e=h.observed.find(e=>(e.record===undefined||e.record>p.beforeLine)&&!p.before.has(e.key)&&!this.consumed.has(e.key)&&e.item.type==='message'&&e.item.role===p.role&&texts(e.item).includes(p.text))
   if(e){p.done=true;this.consumed.add(e.key)}
  }
  // Dynamic tools and MCP code-mode calls have different host/native IDs. An
  // enclosing native call's output acknowledges its returned host results.
  // Unknown parent identities stay conservatively pending.
  for(const p of this.tools)if(p.returned&&p.parents.size&&[...p.parents].every(id=>finished.has(id)))this.tools.delete(p)
  const instructionsCovered=h.items.some(e=>e.item.role==='developer'&&texts(e.item).some(t=>t.includes(this.config.instructions)))
  const tools=this.config.tools??h.dynamicTools,catalogs=h.items.filter(e=>e.item.type==='additional_tools').map(e=>e.item.tools)
  // A native-only catalog need not expose the configured dynamic tools. Only
  // an exact declaration proves coverage; ambiguous wrappers remain counted.
  const toolsCovered=Array.isArray(tools)&&tools.every(tool=>catalogs.some(c=>containsDeclaration(c,JSON.stringify(ordered(tool)))))
  return {baseInstructions:h.baseInstructions??this.config.baseInstructions,
   ...(!instructionsCovered?{instructions:this.config.instructions}:{}),schema:this.config.schema,parameters:this.config.parameters,
   ...(!toolsCovered?{tools}:{}),history:h.items.map(e=>e.item),
   ...(!this.messages.length?{input:this.config.input}:{}),pendingMessages:this.messages.filter(p=>!p.done).map(p=>({role:p.role,text:p.text})),pendingTools:[...this.tools].map(p=>p.value)}
 }
}
