import {expect,it} from 'vitest'
import {partialReply} from '../src/partial-reply.ts'
import {readResponsesStream,readChatStream,readAnthropicStream} from '../src/backends/stream.ts'
import {TransientModelError,type ModelOutput} from '../src/model.ts'
const signal=()=>new AbortController().signal
const frame=(v:unknown)=>'data: '+(typeof v==='string'?v:JSON.stringify(v))+'\r\n\r\n'
function reader(text:string,size=3){const bytes=new TextEncoder().encode(text);let i=0;return new ReadableStream<Uint8Array>({pull(c){if(i===bytes.length)c.close();else{c.enqueue(bytes.slice(i,i+size));i=Math.min(i+size,bytes.length)}}}).getReader()}

it.each(['你好，世界 🌍\n第二行 "引号" \\ 路径','tabs\treturn\rback\bform\f','👩‍💻'])('decodes a Router reply safely at every text chunk boundary: %s',text=>{
  const raw=JSON.stringify({reply:text})
  for(let i=0;i<=raw.length;i++){const value=partialReply(raw.slice(0,i));if(value!==undefined){expect(text.startsWith(value)).toBe(true);expect(/[\uD800-\uDBFF]$/.test(value)).toBe(false)}}
  expect(partialReply(raw)).toBe(text)
})
it('handles incomplete Unicode escapes and never projects other JSON properties or malformed escapes',()=>{
  expect(partialReply('{"reply":"\\u4f60\\u597d \\ud83c')).toBe('你好 ')
  expect(partialReply('{"reply":"\\u4f60\\u597d \\ud83c\\udf0d"}')).toBe('你好 🌍')
  for(const s of ['{"reasoning":"private","reply":"not yet"}','{"nested":{"reply":"private"}}','{"reply":"\\x"}','{"reply":"bad\ncontrol"}'])expect(partialReply(s)).toBeUndefined()
})
it('delivers actual Responses deltas before completion across UTF-8 boundaries without exposing reasoning',async()=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;const output:ModelOutput[]=[]
  const stream=new ReadableStream<Uint8Array>({start(c){controller=c}}),promise=readResponsesStream(stream.getReader(),10000,signal(),e=>output.push(e));let complete=false;void promise.then(()=>complete=true)
  const first=frame({type:'response.reasoning_text.delta',delta:'private'})+frame({type:'response.output_text.delta',item_id:'m',delta:'{"reply":"你好'})
  const bytes=new TextEncoder().encode(first);for(const b of bytes)controller.enqueue(Uint8Array.of(b))
  await new Promise(r=>setTimeout(r,5));expect(complete).toBe(false);expect(output.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('{"reply":"你好')
  const response={status:'completed',output:[]};controller.enqueue(new TextEncoder().encode(frame({type:'response.completed',response})))
  expect(await promise).toEqual(response)
})
it('assembles Chat Completions tool fragments and preserves opaque reasoning only in backend history',async()=>{
  const output:ModelOutput[]=[]
  const text=frame({model:'model',choices:[{index:0,delta:{reasoning_content:'private',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'read_',arguments:'{"path":'}}]}}]})+
    frame({choices:[{index:0,delta:{tool_calls:[{index:0,function:{name:'marker',arguments:'"a"}'}}]},finish_reason:'tool_calls'}]})+frame('[DONE]')
  const result=await readChatStream(reader(text,1),10000,signal(),e=>output.push(e))
  expect(result.choices[0]!.message.tool_calls).toEqual([{id:'call-1',type:'function',function:{name:'read_marker',arguments:'{"path":"a"}'}}])
  expect(result.choices[0]!.message.reasoning_content).toBe('private');expect(output).toHaveLength(0)
})
it('streams Chat text while respecting finish_reason and DONE',async()=>{
  const output:ModelOutput[]=[]
  const text=frame({choices:[{index:0,delta:{content:'你好'}}]})+frame({choices:[{index:0,delta:{content:' 🌍'},finish_reason:'stop'}]})+frame('[DONE]')
  const result=await readChatStream(reader(text,1),10000,signal(),e=>output.push(e))
  expect(result.choices[0]!.message.content).toBe('你好 🌍');expect(output.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('你好 🌍')
})
it('assembles Anthropic text, signatures and tools while exposing only text blocks',async()=>{
  const output:ModelOutput[]=[]
  const values=[{type:'message_start',message:{id:'m',model:'model'}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'private'}},{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'opaque'}},{type:'content_block_stop',index:0},{type:'content_block_start',index:1,content_block:{type:'text',text:''}},{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'你好 🌍'}},{type:'content_block_stop',index:1},{type:'content_block_start',index:2,content_block:{type:'tool_use',id:'call',name:'read_marker',input:{}}},{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'{"path":'}},{type:'content_block_delta',index:2,delta:{type:'input_json_delta',partial_json:'"a"}'}},{type:'content_block_stop',index:2},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}]
  const result=await readAnthropicStream(reader(values.map(frame).join(''),1),10000,signal(),e=>output.push(e))
  expect(result.content).toEqual([{type:'thinking',thinking:'private',signature:'opaque'},{type:'text',text:'你好 🌍'},{type:'tool_use',id:'call',name:'read_marker',input:{path:'a'}}])
  expect(output.filter(e=>e.type==='delta').map(e=>e.text).join('')).toBe('你好 🌍')
})
it.each([readResponsesStream,readChatStream,readAnthropicStream])('does not equate disconnected transport with successful completion (%#)',async parse=>{
  await expect(parse(reader('data: {}\n\n'),1000,signal())).rejects.toBeInstanceOf(TransientModelError)
})
it.each([readResponsesStream,readChatStream,readAnthropicStream])('rejects provider error events and excessive stream size (%#)',async parse=>{
  await expect(parse(reader(frame({type:'error',error:{code:'bad'}})),1000,signal())).rejects.toThrow('stream failed')
  await expect(parse(reader('x'.repeat(100)),10,signal())).rejects.toThrow('size limit')
})
it('aborts a pending stream read without waiting for a provider to send another chunk',async()=>{
  const controller=new AbortController(),stream=new ReadableStream<Uint8Array>()
  const pending=readResponsesStream(stream.getReader(),1000,controller.signal);controller.abort(Error('Cancelled'))
  await expect(pending).rejects.toThrow('Cancelled')
})
it('rejects an Anthropic terminal with unfinished tool blocks',async()=>{
  const text=[{type:'message_start',message:{}},{type:'content_block_start',index:0,content_block:{type:'tool_use'}},{type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}].map(frame).join('')
  await expect(readAnthropicStream(reader(text),10000,signal())).rejects.toThrow('Incomplete')
})
