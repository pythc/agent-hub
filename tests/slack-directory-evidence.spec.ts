import {expect,it} from 'vitest'
import {SlackSource} from '../plugins/slack/index.ts'
import {configSchema} from '../src/config.ts'

function fixture(reply:(operation:string,input:any)=>any){
 const config=configSchema.parse({sources:[{id:'slack',kind:'slack',cwd:process.cwd(),allowedActors:['UUSER'],options:{channels:['CROOM'],teamId:'TTEAM',tokenEnv:'TEST_SLACK'}}]}).sources[0]!
 const calls:string[]=[]
 const source=new SlackSource(config,async(_,operation,input)=>{calls.push(operation);if(operation==='auth.test')return {team_id:'TTEAM',user_id:'UBOT',bot_id:'BBOT'};if(operation==='users.info')return {user:{is_bot:false}};return reply(operation,input)})
 return {source,calls}
}
for(const operation of ['members','probe'] as const){
 const field=operation==='members'?'members':'channels'
 it.each([{},null,{[field]:{}},{[field]:['']},{[field]:[null]}])(`${operation} rejects malformed directory evidence %j`,async response=>{
  const {source}=fixture(()=>response)
  await expect(source[operation]()).rejects.toThrow()
 })
 it(`${operation} accepts an explicitly empty directory`,async()=>{
  const {source}=fixture(()=>({[field]:[]}))
  const result=await source[operation]()
  expect(operation==='members'?result:(result as any).choices).toEqual([])
 })
 it(`${operation} accepts a null cursor as the final page`,async()=>{
  const {source,calls}=fixture(()=>({[field]:[],response_metadata:{next_cursor:null}}))
  const result=await source[operation]()
  expect(operation==='members'?result:(result as any).choices).toEqual([])
  expect(calls.filter(op=>op.startsWith('conversations.'))).toHaveLength(1)
 })
 it.each([{next_cursor:123},{next_cursor:[]},'invalid'])(`${operation} rejects malformed pagination %j`,async metadata=>{
  const {source}=fixture(()=>({[field]:[],response_metadata:metadata}))
  await expect(source[operation]()).rejects.toThrow()
 })
 it(`${operation} rejects non-adjacent cursor cycles before another request`,async()=>{
  const {source,calls}=fixture((_,input)=>({[field]:[],response_metadata:{next_cursor:input.cursor==='a'?'b':'a'}}))
  await expect(source[operation]()).rejects.toThrow('pagination did not advance')
  expect(calls.filter(op=>op.startsWith('conversations.'))).toHaveLength(3)
 })
}
it('continues through empty pages with a valid cursor and retains directory choices',async()=>{
 const {source}=fixture((_,input)=>input.cursor?{channels:[{id:'CROOM',name:'room',is_member:true}]}:{channels:[],response_metadata:{next_cursor:'next'}})
 expect(await source.probe()).toMatchObject({choices:[{id:'CROOM',label:'room'}]})
})

it('retains all validated members across pages without silently dropping pages',async()=>{
 const {source}=fixture((_,input)=>input.cursor?{members:['UOTHER']}:{members:['UUSER'],response_metadata:{next_cursor:'next'}})
 expect(await source.members()).toEqual([{id:'UUSER',name:undefined,bot:false},{id:'UOTHER',name:undefined,bot:false}])
})
