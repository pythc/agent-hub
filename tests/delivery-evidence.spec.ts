import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource,bodyDigest,stableDigest,UncertainDelivery} from '../src/sources.ts'
import {connectorDeliveryEvidence,retainDeliveryReceipt} from '../src/delivery-evidence.ts'
import {ConnectorManagement} from '../src/connector-management.ts'
import {SlackSource} from '../plugins/slack/index.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'delivery-evidence-'));roots.push(root)
 const registry=new SourceRegistry();registry.register({apiVersion:1,kind:'fixture-im',label:'Fixture',create:c=>new MessageSource(c),scopes:()=>['C1']})
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false},sources:[{id:'team',kind:'fixture-im',cwd:root,allowedActors:['u'],capabilities:{replies:true,resources:true,events:true}}]})
 const host=new Runtime(config,{sourceRegistry:registry,model:{async run(){throw Error('No model call')}}});hosts.push(host)
 const source=host.sources.get('team')!,message={id:'delivery1',kind:'reply' as const,text:'private content',channel:{source:'team',thread:'C1:123',address:{chat:'C1'}}}
 const receipt={providerAccepted:true as const,messageId:message.id,thread:message.channel.thread,remoteMessageId:'remote1',contentDigest:bodyDigest(message.text)}
 const view=()=>connectorDeliveryEvidence(host.store,source.config,host.settings.current().revision)
 return {host,source,message,receipt,view}
}
it('retains bound provider acknowledgement through the real outbox without claiming observation',async()=>{
 const f=fixture();f.source.deliver=vi.fn(async()=>f.receipt);f.host.store.outbox.send(f.message)
 await f.host.flush();await f.host.flush()
 expect(f.source.deliver).toHaveBeenCalledTimes(1);expect(f.host.store.outbox.status(f.message.id)).toBe('sent')
 expect(f.view()).toMatchObject({status:'not_verified',blockedBy:[],receipts:[{messageId:'delivery1',remoteMessageId:'remote1',providerAccepted:true,observed:false,current:true}]})
 expect(JSON.stringify(f.view())).not.toContain('private content')
 expect(new ConnectorManagement(()=>f.host).snapshot().instances[0]).toMatchObject({realCall:{status:'not_tested'},deliveryEvidence:{status:'not_verified'}})
})
it.each(['messageId','thread','contentDigest','remoteMessageId'])('quarantines malformed %s acknowledgement without automatic replay',async(field)=>{
 const f=fixture();f.source.deliver=vi.fn(async()=>({...f.receipt,[field]:field==='remoteMessageId'?'':'wrong'}));f.host.store.outbox.send(f.message)
 await f.host.flush();await f.host.flush()
 expect(f.source.deliver).toHaveBeenCalledTimes(1);expect(f.host.store.deliveries()[0]?.status).toBe('uncertain');expect(f.view().receipts).toEqual([])
})
it('preserves legacy void returns without fabricating a provider receipt',async()=>{
 const f=fixture();f.source.deliver=vi.fn(async()=>{});f.host.store.outbox.send(f.message);await f.host.flush()
 expect(f.host.store.outbox.status(f.message.id)).toBe('sent');expect(f.view().receipts).toEqual([])
})
it('does not record unknown outcomes and never infers receipts from sent status',async()=>{
 const f=fixture();f.source.deliver=vi.fn(async()=>{throw new UncertainDelivery('unknown')});f.host.store.outbox.send(f.message);await f.host.flush()
 expect(f.view().receipts).toEqual([]);f.host.store.delivered(f.message.id);expect(f.view().receipts).toEqual([])
})
it('binds retained history to source and configuration without elevating it to current connectivity',async()=>{
 const f=fixture();f.source.deliver=async()=>f.receipt;f.host.store.outbox.send(f.message);await f.host.flush()
 expect(connectorDeliveryEvidence(f.host.store,{...f.source.config,id:'other'},0).receipts).toEqual([])
 expect(connectorDeliveryEvidence(f.host.store,f.source.config,1).receipts[0]?.current).toBe(false)
 expect(connectorDeliveryEvidence(f.host.store,{...f.source.config,enabled:false},0)).toMatchObject({blockedBy:['disabled'],receipts:[{current:false}]})
 expect(connectorDeliveryEvidence(f.host.store,{...f.source.config,capabilities:{...f.source.config.capabilities,replies:false}},0).blockedBy).toEqual(['sending_disabled'])
 f.host.store.db.prepare("UPDATE outbox SET status='uncertain' WHERE id=?").run(f.message.id);expect(f.view().receipts).toEqual([])
})
it('never stores arbitrary adapter response fields',()=>{
 const f=fixture();expect(()=>retainDeliveryReceipt(f.host.store,f.message,{...f.receipt,token:'secret'},0,stableDigest(f.source.config))).toThrow(UncertainDelivery)
 expect(f.host.store.list('delivery-provider-receipt')).toEqual([])
})
it('Slack returns the checked provider message id and exact request binding',async()=>{
 const config=configSchema.parse({sources:[{id:'slack',kind:'slack',cwd:'.',options:{channels:['C1'],teamId:'T1',tokenEnv:'NONE'}}]}).sources[0]!
 const api=vi.fn(async(_method:string,operation:string)=>operation==='auth.test'?{team_id:'T1',user_id:'U1',bot_id:'B1'}:{channel:'C1',ts:'1234567890.000001'})
 const source=new SlackSource(config,api),message={id:'slack-message',kind:'reply' as const,text:'hello',channel:{source:'slack',thread:'C1:1234567890.000000',address:{chat:'C1',root:'1234567890.000000'}}}
 expect(await source.deliver(message)).toEqual({providerAccepted:true,messageId:message.id,remoteMessageId:'1234567890.000001',thread:message.channel.thread,contentDigest:bodyDigest(message.text)})
 expect(api.mock.calls.map(call=>call[1])).toEqual(['auth.test','chat.postMessage'])
})

it.each(['receipt','completion'])('does not replay an accepted message if local %s persistence fails',async(stage)=>{
 const f=fixture();f.source.deliver=vi.fn(async()=>f.receipt);f.host.store.outbox.send(f.message)
 if(stage==='receipt'){const put=f.host.store.put.bind(f.host.store);vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='delivery-provider-receipt')throw Error('disk failure');return put(kind,id,value)})}
 else vi.spyOn(f.host.store,'delivered').mockImplementation(()=>{throw Error('disk failure')})
 await f.host.flush();await f.host.flush()
 expect(f.source.deliver).toHaveBeenCalledTimes(1);expect(f.host.store.deliveries()[0]?.status).toBe('uncertain');expect(f.view().receipts).toEqual([])
})
