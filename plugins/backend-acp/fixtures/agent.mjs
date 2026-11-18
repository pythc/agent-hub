/** Original deterministic ACP peer for cloud acceptance. No model, network or external messages. */
import {createInterface} from 'node:readline'
import {mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
const directory=resolve(process.argv[2]??'.local/acp-peer'),mode=process.argv[3]??'normal'
mkdirSync(directory,{recursive:true,mode:0o700})
const send=frame=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...frame})+'\n')
const reply=(id,result)=>send({id,result})
const path=id=>join(directory,id+'.json')
const valid=id=>typeof id==='string'&&/^fixture-[a-f0-9-]+$/.test(id)
let active,prompt
function answer(){
 const state=JSON.parse(readFileSync(path(active),'utf8'));state.turns++;writeFileSync(path(active),JSON.stringify(state),{mode:0o600})
 send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'Synthetic internal thought; must be hidden.'}}}})
 send({method:'session/update',params:{sessionId:active,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({answer:'ACP fixture turn '+state.turns})}}}})
 reply(prompt,{stopReason:'end_turn'});prompt=undefined
}
createInterface({input:process.stdin}).on('line',line=>{
 const message=JSON.parse(line)
 appendFileSync(join(directory,'methods.jsonl'),JSON.stringify({method:message.method??'response',sessionId:message.params?.sessionId??null})+'\n',{mode:0o600})
 if(message.method==='initialize')return reply(message.id,{protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{close:{}}},authMethods:[]})
 if(message.method==='session/new'){
  active='fixture-'+randomUUID();writeFileSync(path(active),JSON.stringify({id:active,turns:0}),{mode:0o600});return reply(message.id,{sessionId:active})
 }
 if(message.method==='session/load'){
  if(!valid(message.params.sessionId))return send({id:message.id,error:{code:-32002,message:'Unknown session'}})
  try{active=JSON.parse(readFileSync(path(message.params.sessionId),'utf8')).id;return reply(message.id,{})}catch{return send({id:message.id,error:{code:-32002,message:'Unknown session'}})}
 }
 if(message.method==='session/prompt'){
  prompt=message.id
  if(mode==='crash')process.exit(7)
  if(mode==='wait')return
  if(mode==='permission')return send({id:'permission',method:'session/request_permission',params:{sessionId:active,toolCall:{toolCallId:'synthetic-call',kind:'edit'},options:[{optionId:'reject',kind:'reject_once',name:'Reject'},{optionId:'allow',kind:'allow_once',name:'Allow this synthetic request'}]}})
  return answer()
 }
 if(message.id==='permission'){
  writeFileSync(join(directory,'permission-outcome.json'),JSON.stringify(message.result),{mode:0o600});return answer()
 }
 if(message.method==='session/cancel'){if(prompt!==undefined){reply(prompt,{stopReason:'cancelled'});prompt=undefined}return}
 if(message.method==='session/close')return reply(message.id,{})
 if(message.id!==undefined)send({id:message.id,error:{code:-32601,message:'Unavailable fixture method'}})
})
