/** Optional real Codex acceptance: a source correction must reach the current turn. */
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {CodexModel,type NativeControl} from '../src/codex.ts'
import {reportSchema} from '../src/schemas.ts'

const parent=resolve('.local/parity-acceptance');mkdirSync(parent,{recursive:true})
const root=mkdtempSync(join(parent,'native-'))
const model=new CodexModel({codex:process.env.AGENTHUB_CODEX??'codex',effort:'low',turnTimeoutMs:120000})
let control:NativeControl|undefined,read=0,calls=0,selectedModel:string|undefined
const events:string[]=[]
const correction=JSON.stringify({kind:'source_inputs',inputs:[{id:'correction',event:{text:'Correction: the final reply must be exactly B, replacing the original A.'}}]})
const result=await model.run({
  cwd:root,sandbox:'read-only',managed:true,privateState:join(root,'private'),archiveOnComplete:true,
  title:'AgentHub parity: same-turn source correction',schema:reportSchema,
  instructions:'This is a bounded integration check. Call checkpoint exactly once before answering. Apply any later source_inputs correction. Return a ready report with the chosen one-letter reply, no question, askedBy null, and no handbacks. Do not call any other tool.',
  input:'The original requested reply is A. First call checkpoint, then return the current requested reply.',
  tools:[{type:'function',name:'checkpoint',description:'Read the current fixture marker.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],
  onActive:value=>{control=value},onModel:value=>{selectedModel=value},onProgress:event=>{events.push(event)},
  onTool:async name=>{
    assert.equal(name,'checkpoint');assert.equal(++calls,1);assert.ok(control)
    await control.steer(correction,()=>{read++})
    return {success:true,contentItems:[{type:'inputText',text:'The original fixture marker is A. Honor any newer source input.'}]}
  },
})
const output=JSON.parse(result.text)
const history=await model.history(result.threadId,root)
const userMessages=history.turns.flatMap((turn:any)=>turn.items.filter((item:any)=>item.type==='userMessage').flatMap((item:any)=>item.content.map((part:any)=>part.text)))
const evidence={root,selectedModel,result,output,calls,read,turnCount:history.turns.length,
  historyHasCorrection:userMessages.includes(correction),userMessages,events}
writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2))
assert.equal(output.reply,'B');assert.equal(read,1);assert.equal(calls,1)
assert.equal(history.turns.length,1);assert.equal(evidence.historyHasCorrection,true)
console.log(JSON.stringify({root,model:selectedModel,threadId:result.threadId,reply:output.reply,calls,read,turns:history.turns.length}))
