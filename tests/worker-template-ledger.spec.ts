import {expect,it} from 'vitest'
import {TemplateRequestLedger,templateLedgerScope,type TemplateLedgerScope} from '../web/chat/worker-template-requests.ts'
const scope:TemplateLedgerScope={origin:'http://localhost:1234',managed:true,workspaceId:'studio',accountId:'account-a',sessionIsolation:'page-one'}
const body=(workerId='reviewer')=>({id:'recipe',version:'1.0.0',digest:'a'.repeat(64),revision:1,settingsRevision:2,workerId,label:'Private worker name',backend:'codex'})
function memory(){const data=new Map<string,string>(),reads:string[]=[],writes:string[]=[];return {data,reads,writes,getItem(key:string){reads.push(key);return data.get(key)??null},setItem(key:string,value:string){writes.push(key);data.set(key,value)}}}
it('retains the exact request and body across inventory revisions and known-account reloads',()=>{
 const storage=memory(),first=new TemplateRequestLedger(scope,storage),attempt=first.prepare('/create',body())
 const again=new TemplateRequestLedger({...scope,sessionIsolation:'new-page'},storage).prepare('/create',{...body(),revision:99,settingsRevision:100})
 expect(again).toEqual(attempt);expect(again.body.settingsRevision).toBe(2);expect(Object.isFrozen(again.body)).toBe(true)
})
it.each([
 {origin:'http://localhost:4321'},{workspaceId:'other'},{accountId:'account-b'},{managed:false,workspaceId:''}
])('does not expose or adopt another partition: %j',change=>{
 const storage=memory(),a=new TemplateRequestLedger(scope,storage),attempt=a.prepare('/create',body()),keys=[...storage.data.keys()]
 const b=new TemplateRequestLedger({...scope,...change},storage)
 expect(b.pendingCreations()).toEqual([]);expect(storage.data.get(keys[0]!)).toContain(attempt.requestId)
 const second=b.prepare('/create',body());expect(second.requestId).not.toBe(attempt.requestId)
 expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual([attempt])
})
it('isolates account-unknown pages without fabricating a stable identity or losing their original intent',()=>{
 const storage=memory(),a={...scope,accountId:null},attempt=new TemplateRequestLedger(a,storage).prepare('/create',body())
 expect(new TemplateRequestLedger({...a,sessionIsolation:'another-page'},storage).pendingCreations()).toEqual([])
 expect(new TemplateRequestLedger(a,storage).pendingCreations()).toEqual([attempt])
})
it('preserves the legacy key verbatim without displaying bodies, assigning context or offering replay',()=>{
 const storage=memory(),legacy=JSON.stringify([{path:'/create',requestId:crypto.randomUUID(),body:body()}])
 storage.data.set('roppo.worker-template.pending.v1',legacy)
 const a=new TemplateRequestLedger(scope,storage)
 expect(a.hasUnattributedLegacy).toBe(true);expect(a.pendingCreations()).toEqual([])
 const next=a.prepare('/create',body());expect(legacy).not.toContain(next.requestId)
 expect(storage.data.get('roppo.worker-template.pending.v1')).toBe(legacy);expect(storage.writes).not.toContain('roppo.worker-template.pending.v1')
})
it('does not let an older completion erase a newer pending request with the same intent',()=>{
 const storage=memory(),ledger=new TemplateRequestLedger(scope,storage),old=ledger.prepare('/create',body())
 ledger.finish(old);const current=ledger.prepare('/create',body());ledger.finish(old)
 expect(current.requestId).not.toBe(old.requestId);expect(ledger.pendingCreations()).toEqual([current])
})
it('does not silently evict old unresolved creations when the bounded partition fills',()=>{
 const storage=memory(),ledger=new TemplateRequestLedger(scope,storage),all=Array.from({length:20},(_,i)=>ledger.prepare('/create',body('worker-'+i)))
 expect(()=>ledger.prepare('/create',body('worker-21'))).toThrow('template_pending_review_required')
 expect(ledger.prepare('/create',{...body('worker-0'),revision:200})).toEqual(all[0])
 expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual(all)
 ledger.finish(all[0]!);expect(ledger.prepare('/create',body('worker-21')).requestId).toBeTruthy();expect(ledger.pendingCreations()).toHaveLength(20)
})
it.each(['not-json','{}','[{}]',JSON.stringify([{path:'/other',requestId:crypto.randomUUID(),body:body()}]),JSON.stringify([{path:'/create',requestId:crypto.randomUUID(),body:{...body(),secret:'never replay'}}]),' '.repeat(128001)])('quarantines malformed current storage without overwriting it',raw=>{
 const storage=memory(),valid=new TemplateRequestLedger(scope,storage),attempt=valid.prepare('/create',body()),key=storage.writes[0]!
 storage.data.set(key,raw);storage.writes.length=0
 const restored=new TemplateRequestLedger(scope,storage)
 expect(restored.hasUnrecognizedPending).toBe(true);expect(restored.pendingCreations()).toEqual([])
 expect(()=>restored.prepare('/create',body())).toThrow('template_pending_review_required');restored.finish(attempt)
 expect(storage.data.get(key)).toBe(raw);expect(storage.writes).toEqual([])
})
it('retains a valid request alongside unrecognized records without rewriting or replaying the unrecognized data',()=>{
 const storage=memory(),ledger=new TemplateRequestLedger(scope,storage),attempt=ledger.prepare('/create',body()),key=storage.writes[0]!
 const original=JSON.stringify([attempt,{body:{label:'Unattributed private text'}}]);storage.data.set(key,original);storage.writes.length=0
 const restored=new TemplateRequestLedger(scope,storage);expect(restored.hasUnrecognizedPending).toBe(true)
 expect(restored.pendingCreations()).toEqual([attempt]);expect(restored.prepare('/create',{...body(),revision:100})).toEqual(attempt)
 restored.finish(attempt);expect(storage.data.get(key)).toBe(original);expect(storage.writes).toEqual([])
})
it.each([{managed:true,workspaceId:''},{managed:false,workspaceId:'studio'},{origin:'file:///tmp/app'},{origin:'http://user:password@localhost'},{accountId:''},{sessionIsolation:''}])('rejects an unproven namespace instead of using a default: %j',change=>{
 expect(()=>new TemplateRequestLedger({...scope,...change},memory())).toThrow()
})
it('requires a ready existing workspace observation before constructing scope',()=>{
 const context={state:'pending',code:null,managed:false,activeId:'',epoch:1,accountId:null,sessionIsolation:'page'} as const
 expect(()=>templateLedgerScope(context,'http://localhost')).toThrow('template_ledger_context_invalid')
 expect(templateLedgerScope({...context,state:'ready'},'http://localhost')).toMatchObject({origin:'http://localhost',managed:false,workspaceId:'',accountId:null,sessionIsolation:'page'})
})

it('does not overwrite a second instance when finishing or preparing from an old snapshot',()=>{
 const storage=memory(),first=new TemplateRequestLedger(scope,storage),old=first.prepare('/create',body('old-worker')),second=new TemplateRequestLedger(scope,storage)
 const newer=second.prepare('/create',body('new-worker'));first.finish(old)
 expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual([newer])
 const third=first.prepare('/create',body('third-worker'));expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual([newer,third])
 second.finish(old);expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual([newer,third])
})
it('does not send a new creation intent when persistence fails, lies, or is unavailable',()=>{
 for(const storage of [
  {getItem:()=>null,setItem(){throw Error('SECRET_QUOTA')}},
  {getItem:()=>null,setItem(){}},
  {getItem(){throw Error('SECRET_STORAGE')},setItem(){}}
 ]){
  const ledger=new TemplateRequestLedger(scope,storage);let sent=0
  try{ledger.prepare('/create',body());sent++}catch(error){expect(String(error)).toBe('Error: template_storage_unavailable')}
  expect(sent).toBe(0);expect(ledger.pendingCreations()).toEqual([])
 }
})
it('keeps unresolved creation bytes if a later delete fails and retries its original request',()=>{
 const storage=memory(),ledger=new TemplateRequestLedger(scope,storage),old=ledger.prepare('/create',body()),write=storage.setItem.bind(storage)
 storage.setItem=()=>{throw Error('SECRET_QUOTA')};expect(()=>ledger.finish(old)).toThrow('template_storage_unavailable')
 storage.setItem=write;expect(new TemplateRequestLedger(scope,storage).prepare('/create',{...body(),revision:8})).toEqual(old)
})

it('keeps the original request if deletion persisted but its readback reply was lost',()=>{
 const storage=memory(),ledger=new TemplateRequestLedger(scope,storage),attempt=ledger.prepare('/create',body()),read=storage.getItem.bind(storage),write=storage.setItem.bind(storage);let lost=false
 storage.setItem=(key,value)=>{write(key,value);if(value==='[]')lost=true}
 storage.getItem=key=>{if(lost){lost=false;throw Error('SECRET_LOST_READBACK')}return read(key)}
 expect(()=>ledger.finish(attempt)).toThrow('template_storage_unavailable')
 expect(ledger.pendingCreations()).toEqual([attempt])
 const retry=ledger.prepare('/create',{...body(),revision:8});expect(retry.requestId).toBe(attempt.requestId);expect(retry.body).toEqual(attempt.body)
 expect(new TemplateRequestLedger(scope,storage).pendingCreations()).toEqual([attempt])
})
