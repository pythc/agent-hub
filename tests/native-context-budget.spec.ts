import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,writeFileSync,appendFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {NativeContext,nativeProtocolHistory} from '../plugins/backend-codex/context.ts'
import {protocolBytes} from '../src/context-budget.ts'
const roots:string[]=[]
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true})})
const message=(id:string,role:string,text:string)=>({type:'message',id,role,content:[{type:'input_text',text}]})
const record=(item:unknown)=>JSON.stringify({type:'response_item',payload:item})+'\n'
function fixture(input='request'){
 const root=mkdtempSync(join(tmpdir(),'native-budget-'));roots.push(root);const path=join(root,'rollout.jsonl')
 writeFileSync(path,JSON.stringify({type:'session_meta',payload:{base_instructions:{text:'base'},dynamic_tools:[]}})+'\n')
 const context=new NativeContext({input,instructions:'mandate',schema:{},tools:[],baseInstructions:'base'});context.setPath(path)
 return {context,path,append:(item:unknown)=>appendFileSync(path,record(item))}
}
it('moves a fresh input from pending to raw to persisted once without swallowing identical old input',()=>{
 const f=fixture('same input');f.append(message('old','user','same input'));f.context.begin()
 expect(f.context.envelope().pendingMessages).toHaveLength(1)
 const current=message('current','user','same input');f.context.observe(current)
 const raw=f.context.envelope();expect(raw.pendingMessages).toHaveLength(0);expect(raw.history).toHaveLength(2)
 f.append(current);expect(protocolBytes(f.context.envelope())).toBe(protocolBytes(raw))
})
it('counts current raw items while a history file exists but lags, preserving different IDs with the same body',()=>{
 const f=fixture();f.context.begin();const a=message('a','assistant','same body'),b=message('b','assistant','same body')
 f.context.observe(a);const first=protocolBytes(f.context.envelope());f.context.observe(a);expect(protocolBytes(f.context.envelope())).toBe(first)
 f.context.observe(b);expect(f.context.envelope().history).toHaveLength(2);f.append(a);f.append(b);expect(f.context.envelope().history).toHaveLength(2)
})
it('retains unidentifiable raw events conservatively instead of globally deduplicating text',()=>{
 const f=fixture();f.context.observe({type:'message',role:'assistant',content:[{text:'same'}]});f.context.observe({type:'message',role:'assistant',content:[{text:'same'}]})
 expect(f.context.envelope().history).toHaveLength(2)
})
it('retires returned MCP results only when their enclosing native call has an output',()=>{
 const f=fixture();f.context.begin();const result={success:true,contentItems:[{type:'inputText',text:'original output'}]}
 f.context.observe({type:'custom_tool_call',id:'exec-a',call_id:'outer-a',input:'code'})
 const p=f.context.tool('random-mcp-id','read',{});f.context.toolResult(p,result);f.context.toolReturned(p)
 expect(f.context.envelope().pendingTools).toHaveLength(1)
 const output={type:'custom_tool_call_output',id:'out-a',call_id:'outer-a',output:result};f.context.observe(output)
 const raw=f.context.envelope();expect(raw.pendingTools).toHaveLength(0);f.append(output);expect(protocolBytes(f.context.envelope())).toBe(protocolBytes(raw))
 f.context.observe({type:'custom_tool_call',id:'exec-b',call_id:'outer-b',input:'code'})
 const q=f.context.tool('different-mcp-id','read',{});f.context.toolResult(q,result);f.context.toolReturned(q)
 f.context.observe({...output,id:'out-b',call_id:'outer-b'})
 const final=f.context.envelope();expect(final.pendingTools).toHaveLength(0);expect(final.history.filter(x=>x.type==='custom_tool_call_output')).toHaveLength(2)
})
it('keeps concurrent or unknown-parent results pending until all relevant native outputs exist',()=>{
 const f=fixture();f.context.observe({type:'custom_tool_call',id:'a',call_id:'a'});f.context.observe({type:'custom_tool_call',id:'b',call_id:'b'})
 const p=f.context.tool('mcp','read',{});f.context.toolResult(p,{text:'receipt'});f.context.toolReturned(p)
 f.context.observe({type:'custom_tool_call_output',id:'out-a',call_id:'a',output:'first'});expect(f.context.envelope().pendingTools).toHaveLength(1)
 f.context.observe({type:'custom_tool_call_output',id:'out-b',call_id:'b',output:'second'});expect(f.context.envelope().pendingTools).toHaveLength(0)
 const unknown=f.context.tool('unknown','read',{});f.context.toolReturned(unknown);expect(f.context.envelope().pendingTools).toHaveLength(1)
})
it('does not swallow a repeated steer or refresh from prior history or RPC acknowledgement',()=>{
 const f=fixture();f.append(message('old-u','user','followup'));f.append(message('old-d','developer','refresh'));f.context.begin()
 f.context.message('user','followup');f.context.message('user','followup');f.context.message('developer','refresh')
 expect(f.context.envelope().pendingMessages).toHaveLength(4)
 f.context.observe(message('new-u1','user','followup'));expect(f.context.envelope().pendingMessages).toHaveLength(3)
 f.context.observe(message('new-u2','user','followup'));f.context.observe(message('new-d','developer','refresh'))
 expect(f.context.envelope().pendingMessages).toEqual([{role:'user',text:'request'}])
})
it('uses compaction replacement while retaining uncovered input and retiring covered tool results',()=>{
 const f=fixture();f.append(message('old','user','large old context'));f.context.begin();f.context.message('user','unread steering')
 f.context.observe({type:'custom_tool_call',id:'exec',call_id:'outer'})
 const p=f.context.tool('mcp','read',{});f.context.toolResult(p,{text:'old result'});f.context.toolReturned(p)
 f.append({type:'custom_tool_call',id:'exec',call_id:'outer'});f.append({type:'custom_tool_call_output',id:'out',call_id:'outer',output:'old result'})
 appendFileSync(f.path,JSON.stringify({type:'compacted',payload:{replacement_history:[message('summary','developer','retained summary')]}})+'\n')
 const result=f.context.envelope();expect(result.history).toEqual([message('summary','developer','retained summary')]);expect(result.pendingTools).toHaveLength(0);expect(result.pendingMessages).toHaveLength(2)
})
it('counts base instructions and covered declarations once while retaining changed tools and the schema',()=>{
 const f=fixture();f.append(message('dev','developer','mandate'));f.append({type:'additional_tools',id:'catalog',tools:[]});f.context.begin()
 const value=f.context.envelope();expect(value.instructions).toBeUndefined();expect(value.tools).toBeUndefined();expect(value.baseInstructions).toEqual({text:'base'});expect(value.schema).toEqual({})
 const other=new NativeContext({instructions:'mandate',input:'x',schema:{required:['x']},tools:[{name:'new-tool'}]});other.setPath(f.path);other.begin();expect(other.envelope().tools).toEqual([{name:'new-tool'}])
})
it('retains an incomplete tail without dropping it and rejects malformed complete history',()=>{
 const f=fixture();appendFileSync(f.path,'\n'+JSON.stringify({type:'response_item',payload:message('next','user','unfinished')}).slice(0,-5))
 expect(JSON.stringify(nativeProtocolHistory(f.path))).toContain('unparsedTail')
 appendFileSync(f.path,'\n');expect(()=>nativeProtocolHistory(f.path)).toThrow()
})
it('does not acknowledge new input from an older partial record completed after the send watermark',()=>{
 const f=fixture('same text'),old=record(message('old','user','same text')),split=old.length-5
 appendFileSync(f.path,old.slice(0,split));f.context.begin();appendFileSync(f.path,old.slice(split))
 expect(f.context.envelope().pendingMessages).toHaveLength(1)
 f.append(message('new','user','same text'));expect(f.context.envelope().pendingMessages).toHaveLength(0)
})
