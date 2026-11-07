import {expect,it} from 'vitest'
import {contextProjection,recall} from '../src/backends/context.ts'

it('shortens large tool results across all three protocols without mutating history or losing images and errors',()=>{
 const text='开始'+('middle '.repeat(3000))+'结束',image={type:'input_image',image_url:'data:image/png;base64,aW1hZ2U='}
 const history={messages:[
  {role:'tool',tool_call_id:'chat',content:text},
  {type:'function_call_output',call_id:'responses',output:[{type:'input_text',text},image]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'anthropic',is_error:true,content:[{type:'text',text}]}]},
 ],turns:[{id:'one',wireStart:0}],effects:{responses:{result:{success:false,contentItems:[{type:'inputText' as const,text},{type:'inputImage' as const,imageUrl:image.image_url}]}}}}
 const original=JSON.stringify(history),wire=contextProjection(history,128000)
 expect(JSON.stringify(wire.messages).length).toBeLessThan(18000);expect(JSON.stringify(history)).toBe(original)
 expect(wire.messages[1].output[1]).toEqual(image);expect(wire.messages[2].content[0].is_error).toBe(true)
 expect(wire.messages[0].content).toContain('backend_recall callId=chat');expect(wire.messages[0].content).toContain('结束')
 const result=recall(history,{callId:'responses',limit:8000})
 expect(result.contentItems[1]).toEqual({type:'inputImage',imageUrl:image.image_url});expect(result.contentItems[0]!.text).toContain('false')
 expect(recall(history,{callId:'responses',offset:8000}).contentItems).toHaveLength(1)
})

it('archives whole turns while retaining paired calls/results, recoverable user input and original receipts',()=>{
 const call={type:'function_call',call_id:'call',name:'read',arguments:'{}'},result={type:'function_call_output',call_id:'call',output:'data'}
 const history={messages:[{role:'user',content:'old '.repeat(5000)},call,result,{role:'assistant',content:'old answer'},{role:'user',content:'new turn'},call,result],turns:[{id:'old',input:'old request',wireStart:0,status:'completed',items:[call,result]},{id:'new',input:'new turn',wireStart:4,status:'inProgress'}],effects:{call:{result:{success:true,contentItems:[{type:'inputText' as const,text:'data'}]}}}}
 const wire=contextProjection(history,4096)
 expect(wire.messages).toEqual(history.messages.slice(4));expect(wire.notice).toContain('old');expect(history.messages).toHaveLength(7)
 expect(recall(history,{turnId:'old'}).contentItems[0]!.text).toContain('old request')
 expect(recall(history,{query:'old request'}).contentItems[0]!.text).toContain('old')
})

it('keeps pre-upgrade wire messages readable after a known-safe new turn boundary',()=>{
 const history={messages:[{role:'user',content:'legacy '.repeat(1000)},{role:'assistant',content:'answer'},{role:'user',content:'new'}],turns:[{id:'legacy',items:[]},{id:'new',wireStart:2,input:'new'}],effects:{}}
 expect(contextProjection(history,4096).messages).toEqual([history.messages[2]])
 expect(recall(history,{}).contentItems[0]!.text).toContain('legacy-messages')
 expect(recall(history,{turnId:'legacy-messages'}).contentItems[0]!.text).toContain('legacy legacy')
 expect(()=>recall(history,{callId:'missing'})).toThrow('Unknown')
})

it('recalls and searches messages steered into an archived turn without including the next turn',()=>{
 const history={messages:[{role:'user',content:'initial'},{role:'user',content:'source correction: KEEP THE ORIGINAL'},{role:'assistant',content:'ack'},{role:'user',content:'unrelated next'}],turns:[{id:'old',wireStart:0,input:'initial',items:[]},{id:'next',wireStart:3,input:'unrelated next',items:[]}],effects:{}}
 const text=recall(history,{turnId:'old',limit:8000}).contentItems[0]!.text!
 expect(text).toContain('KEEP THE ORIGINAL');expect(text).not.toContain('unrelated next')
 expect(recall(history,{query:'KEEP THE ORIGINAL'}).contentItems[0]!.text).toContain('old')
})
