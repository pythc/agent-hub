import {it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {makePolicy} from '../src/policy.ts'
import type {Mandate,Thread,Ticket,Trigger} from '../src/vendor/dsh-core/index.ts'
const config=()=>configSchema.parse({acceptMode:'auto',rules:[{id:'r',instruction:'Review'}],sources:[{id:'chat',kind:'custom',cwd:'.',allowedActors:['alice'],admission:{default:{unlistedAddressed:'explicit',unlistedUnaddressed:'inferred'}}}]})
it('revalidates inferred admission at its original strength and with current membership',()=>{
 const c=config(),p=makePolicy(c,()=>false)
 const m:Mandate={strength:'inferred',policyVersion:p.version,actor:{source:'chat',id:'bob'},scope:'Review',basis:{via:'admission',source:'chat',row:'default',cell:'unlistedUnaddressed',rules:['r']}}
 expect(p.revalidate(m)).toBe(true)
 c.sources[0]!.admission.default!.unlistedUnaddressed='ignore'
 expect(makePolicy(c,()=>false).revalidate(m)).toBe(false)
 c.sources[0]!.allowedActors.push('bob')
 expect(makePolicy(c,()=>false).revalidate(m)).toBe(true)
 c.acceptMode='observe'
 expect(makePolicy(c,()=>false).revalidate(m)).toBe(false)
})
it('preserves explicit follow-up authority while checking source scope',()=>{
 const c=config(),m:Mandate={strength:'explicit',policyVersion:'old',actor:{source:'chat',id:'removed'},scope:'Review',basis:{via:'followup',row:'default'}}
 expect(makePolicy(c,()=>false).revalidate(m)).toBe(true)
 c.sources[0]!.listenScopes=['other']
 expect(makePolicy(c,()=>false).revalidate(m)).toBe(false)
})
it('treats a listed unaddressed follow-up as explicit and bots only as inferred',()=>{
 const c=config(),p=makePolicy(c,()=>false)
 const trigger={id:'x',source:'chat',actor:{source:'chat',id:'alice'},human:true,at:'now',text:'stop',threads:[{source:'chat',id:'topic'}],meta:{}} as Trigger
 const thread={ref:trigger.threads[0]} as Thread
 const tickets=[{channels:[{source:'chat',thread:'topic'}]}] as Ticket[]
 expect(p.gate(trigger,thread,tickets)).toMatchObject({admissible:true,strength:'explicit',basis:{via:'followup'}})
 c.sources[0]!.allowedBots=['bot']
 expect(makePolicy(c,()=>false).gate({...trigger,human:false,actor:{source:'chat',id:'bot'}},thread,tickets)).toMatchObject({strength:'inferred'})
})
it('does not infer new work from unaddressed GitHub events in mention-only scopes',()=>{
 const c=config();c.sources[0]!.kind='github';c.sources[0]!.repository='owner/repo';c.sources[0]!.allowedBots=['bot']
 const trigger={id:'x',source:'chat',actor:{source:'chat',id:'alice'},human:true,at:'now',text:'change',threads:[{source:'chat',id:'t'}],meta:{}} as Trigger
 const thread={ref:trigger.threads[0],subscriptions:[]} as unknown as Thread
 expect(makePolicy(c,()=>false).gate(trigger,thread,[]).admissible).toBe(false)
 expect(makePolicy(c,()=>false).gate({...trigger,human:false,actor:{source:'chat',id:'bot'}},thread,[]).admissible).toBe(false)
})
