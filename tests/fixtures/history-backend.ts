// Local-only history adapter. Faults persist across actual plugin subprocesses.
import {existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {BackendPlugin} from '../../plugins/backend-sdk.ts'
export default {
 create(config,{dataDirectory}){
  const file=(id:string)=>join(dataDirectory,id+'.json')
  return {
   async probe(){return {available:true,authenticated:true,remoteVerified:false,accountIdentity:process.env.FIXTURE_ACCOUNT??'a'.repeat(64)}},
   async run(r){
    const id=r.threadId??'native-'+randomUUID(),turnId='turn-'+randomUUID()
    r.onThread?.(id);r.onTurn?.(turnId)
    writeFileSync(file(id),JSON.stringify({id,model:'fixture-model',turns:[{id:turnId,items:[{type:'userMessage',text:r.input}]}]}))
    return {threadId:id,turnId,text:'{}'}
   },
   async history(id){
    const history=JSON.parse(readFileSync(file(id),'utf8'))
    if(config.history==='wrong-id')history.id='another-native-session'
    if(config.history==='missing-id')delete history.id
    if(config.history==='invalid-turns')history.turns={}
    if(config.history==='array')return []
    return history
   },
   async purge(id){
    const counter=join(dataDirectory,id+'.purge-count'),attempt=existsSync(counter)?Number(readFileSync(counter,'utf8'))+1:1
    writeFileSync(counter,String(attempt))
    if(config.purge==='fail-before'&&attempt===1)throw Error('Deletion unavailable')
    if(config.purge==='invalid-receipt')return {local:'pending',provider:'not_managed'} as any
    rmSync(file(id),{force:true})
    if(config.purge==='fail-after'&&attempt===1)throw Error('Deletion reply lost')
    if(existsSync(file(id)))throw Error('History still present')
    return {local:'verified',provider:'not_managed'}
   }
  }
 }
} satisfies BackendPlugin
