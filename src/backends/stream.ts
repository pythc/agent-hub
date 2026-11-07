import {TransientModelError,type ModelRequest} from '../model.ts'
type Output=ModelRequest['onOutput']

/** SSE framing across UTF-8 and CR/LF chunk boundaries. EOF alone never means model success. */
async function* events(reader:ReadableStreamDefaultReader<Uint8Array>,maxBytes:number,signal:AbortSignal){
  const decoder=new TextDecoder();let buffer='',bytes=0,data:string[]=[]
  const abort=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',abort,{once:true})
  try{
    for(;;){
      signal.throwIfAborted()
      let chunk:ReadableStreamReadResult<Uint8Array>
      try{chunk=await reader.read()}catch{signal.throwIfAborted();throw new TransientModelError('Backend stream connection interrupted')}
      signal.throwIfAborted()
      if(!chunk.done){bytes+=chunk.value.length;if(bytes>maxBytes)throw Error('Backend response size limit exceeded')}
      buffer+=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true})
      for(;;){
        const match=/\r\n|\n|\r/.exec(buffer)
        if(!match||!chunk.done&&match[0]==='\r'&&match.index===buffer.length-1)break
        const line=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length)
        if(line===''){if(data.length){yield data.join('\n');data=[]}}
        else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''))
      }
      if(chunk.done){if(buffer.startsWith('data:'))data.push(buffer.slice(5).replace(/^ /,''));if(data.length)yield data.join('\n');return}
    }
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{})}
}
function parse(data:string){try{return JSON.parse(data)}catch{throw Error('Invalid backend stream event')}}
function providerError(value:any){if(value.error||value.type==='error')throw Error('Backend stream failed: '+String(value.error?.code??value.error?.type??'provider_error').slice(0,120))}

export async function readResponsesStream(reader:ReadableStreamDefaultReader<Uint8Array>,maxBytes:number,signal:AbortSignal,onOutput?:Output){
  const phases=new Map<string,'answer'|'commentary'>(),started=new Set<string>()
  for await(const data of events(reader,maxBytes,signal)){
    if(data==='[DONE]')continue
    const value=parse(data);providerError(value)
    if(['response.failed','response.incomplete'].includes(value.type))throw Error('Responses stream '+value.type)
    if(value.type==='response.output_item.added'&&value.item?.type==='message')phases.set(value.item.id,value.item.phase==='commentary'?'commentary':'answer')
    if(value.type==='response.output_text.delta'&&typeof value.delta==='string'){
      const id=String(value.item_id??value.output_index??'answer')+':'+(value.content_index??0),phase=phases.get(value.item_id)??'answer'
      if(!started.has(id)){started.add(id);onOutput?.({id,type:'start',phase})}
      onOutput?.({id,type:'delta',phase,text:value.delta})
    }
    if(value.type==='response.completed'){if(value.response?.status!=='completed')throw Error('Invalid completed response');return value.response}
  }
  throw new TransientModelError('Responses stream disconnected before response.completed')
}

export async function readChatStream(reader:ReadableStreamDefaultReader<Uint8Array>,maxBytes:number,signal:AbortSignal,onOutput?:Output,id='chat'){
  let content='',reasoning='',finish:string|null=null,model:string|undefined,refusal='',started=false
  const calls=new Map<number,any>()
  for await(const data of events(reader,maxBytes,signal)){
    if(data==='[DONE]'){
      if(!finish)throw new TransientModelError('Chat stream ended before finish_reason')
      return {model,choices:[{finish_reason:finish,message:{role:'assistant',content:content||null,...(reasoning?{reasoning_content:reasoning}:{}),...(refusal?{refusal}:{}),...(calls.size?{tool_calls:[...calls].sort((a,b)=>a[0]-b[0]).map(([,v])=>v)}:{})}}]}
    }
    const value=parse(data);providerError(value);if(typeof value.model==='string')model=value.model
    const choice=value.choices?.find((c:any)=>c.index===0)??value.choices?.[0];if(!choice)continue
    const delta=choice.delta??{}
    if(typeof delta.content==='string'){
      if(!started){started=true;onOutput?.({id,type:'start',phase:'answer'})}
      content+=delta.content;onOutput?.({id,type:'delta',phase:'answer',text:delta.content})
    }
    if(typeof delta.reasoning_content==='string')reasoning+=delta.reasoning_content
    if(typeof delta.refusal==='string')refusal+=delta.refusal
    for(const part of delta.tool_calls??[]){
      if(!Number.isInteger(part.index)||part.index<0)throw Error('Invalid streamed tool index')
      const call=calls.get(part.index)??{id:'',type:'function',function:{name:'',arguments:''}}
      if(part.id)call.id+=part.id;if(part.type)call.type=part.type
      if(part.function?.name)call.function.name+=part.function.name
      if(part.function?.arguments)call.function.arguments+=part.function.arguments
      calls.set(part.index,call)
    }
    if(choice.finish_reason)finish=choice.finish_reason
  }
  throw new TransientModelError('Chat stream disconnected before DONE')
}

export async function readAnthropicStream(reader:ReadableStreamDefaultReader<Uint8Array>,maxBytes:number,signal:AbortSignal,onOutput?:Output,id='anthropic'){
  let message:any,stopped=false
  const blocks=new Map<number,any>(),inputs=new Map<number,string>(),closed=new Set<number>()
  for await(const data of events(reader,maxBytes,signal)){
    const value=parse(data);providerError(value)
    if(value.type==='message_start')message={...value.message,content:[]}
    if(value.type==='content_block_start'){
      if(!Number.isInteger(value.index)||blocks.has(value.index))throw Error('Invalid content block index')
      blocks.set(value.index,{...value.content_block})
      if(value.content_block?.type==='tool_use')inputs.set(value.index,'')
      if(value.content_block?.type==='text'){
        onOutput?.({id:id+':'+value.index,type:'start',phase:'answer'})
        if(value.content_block.text)onOutput?.({id:id+':'+value.index,type:'delta',phase:'answer',text:value.content_block.text})
      }
    }
    if(value.type==='content_block_delta'){
      const block=blocks.get(value.index),d=value.delta;if(!block||closed.has(value.index))throw Error('Unknown or closed content block')
      if(d?.type==='text_delta'&&block.type==='text'){block.text=(block.text??'')+d.text;onOutput?.({id:id+':'+value.index,type:'delta',phase:'answer',text:d.text})}
      else if(d?.type==='input_json_delta'&&block.type==='tool_use')inputs.set(value.index,(inputs.get(value.index)??'')+d.partial_json)
      else if(d?.type==='thinking_delta')block.thinking=(block.thinking??'')+d.thinking
      else if(d?.type==='signature_delta')block.signature=(block.signature??'')+d.signature
      else if(d?.type==='citations_delta')block.citations=[...(block.citations??[]),d.citation]
    }
    if(value.type==='content_block_stop'){
      const block=blocks.get(value.index);if(!block)throw Error('Unknown content block')
      if(block.type==='tool_use'&&inputs.get(value.index))block.input=parse(inputs.get(value.index)!)
      closed.add(value.index)
    }
    if(value.type==='message_delta'){
      if(!message)throw Error('Missing message start')
      message={...message,...value.delta,usage:{...message.usage,...value.usage}};stopped=!!message.stop_reason
    }
    if(value.type==='message_stop'){
      if(!message||!stopped||closed.size!==blocks.size)throw Error('Incomplete Anthropic stream')
      return {...message,content:[...blocks].sort((a,b)=>a[0]-b[0]).map(([,v])=>v)}
    }
  }
  throw new TransientModelError('Anthropic stream disconnected before message_stop')
}
