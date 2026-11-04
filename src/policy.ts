import { createHash } from 'node:crypto'
import type { Config, SourceConfig } from './config.ts'
import { threadKey, type Policy, type SourceScope, type Mandate } from './vendor/dsh-core/index.ts'

function rowOf(source: SourceConfig, scope: string) {
  return source.admission[scope] ?? source.admission.default ?? {
    listedUnaddressed: 'inferred' as const, unlistedAddressed: 'ignore' as const, unlistedUnaddressed: 'ignore' as const,
  }
}
export function makePolicy(config: Config, paused: () => boolean): Policy {
  const version = createHash('sha256').update(JSON.stringify({ sources: config.sources.map(({id,allowedActors,allowedBots,admission})=>({id,allowedActors,allowedBots,admission})), rules: config.rules, mode: config.acceptMode })).digest('hex')
  const find = (id: string) => config.sources.find(s => s.id === id)
  function authorized(mandate: Mandate): boolean {
    const source = find(mandate.actor.source)
    if (!source?.enabled) return false
    const row = mandate.basis.row ?? 'default'
    if (source.listenScopes && !source.listenScopes.includes(row)) return false
    if (mandate.basis.via === 'followup') return true
    if (mandate.basis.via === 'bot') return source.allowedBots.includes(mandate.actor.id)
    const listed=source.allowedActors.includes(mandate.actor.id)
    if(mandate.basis.via!=='admission')return listed
    const cell=mandate.basis.cell
    if(cell==='unlistedAddressed'&&listed)return true
    if(cell==='listedUnaddressed'&&!listed)return false
    const now=cell==='unlistedUnaddressed'&&listed?'listedUnaddressed':cell
    const mode=rowOf(source,row)[now]
    return mode==='explicit'||(mandate.strength==='inferred'&&mode==='inferred')
  }
  return {
    version, get paused() { return paused() }, evalTimeoutMs: config.turnTimeoutMs,
    gate(trigger,thread,tickets) {
      const source = find(trigger.source)
      if (!source?.enabled) return { admissible:false,reason:'sourceDisabled' }
      const row = String(trigger.meta.scope ?? 'default')
      const observed=source.kind!=='github'||!!source.github?.receiveAll
      const listed = source.allowedActors.includes(trigger.actor.id)
      const base = { source:trigger.source,row,scope:{scope:row} }
      if (!trigger.human) {
        if ((!trigger.addressed&&!observed)||!source.allowedBots.includes(trigger.actor.id) || config.acceptMode==='off' || !config.rules.length) return {admissible:false,reason:'botNotAdmitted'}
        return {admissible:true,strength:'inferred',basis:{...base,via:'bot',observation:{mode:config.acceptMode}}}
      }
      if (listed && trigger.addressed) return {admissible:true,strength:'explicit',basis:{...base,via:'addressed',addressed:trigger.addressed}}
      const cell = listed ? 'listedUnaddressed' : trigger.addressed ? 'unlistedAddressed' : 'unlistedUnaddressed'
      const mode = trigger.addressed||observed?rowOf(source,row)[cell]:'ignore'
      if(mode==='explicit')return {admissible:true,strength:'explicit',basis:{...base,via:'admission',cell,addressed:trigger.addressed}}
      const participating=[...(thread.subscriptions??[]),...tickets.map(t=>t.id)].some(id=>!thread.context?.includes(id))
      if(participating && !(trigger.addressed==='direct'&&!listed) && (listed||config.acceptMode!=='off'))return {admissible:true,strength:listed?'explicit':'inferred',basis:{...base,via:'followup'}}
      if(mode==='inferred' && config.acceptMode!=='off' && config.rules.length) return {admissible:true,strength:'inferred',basis:{...base,via:'admission',cell,observation:{mode:config.acceptMode}}}
      return {admissible:false,reason:'notAdmitted'}
    },
    revalidate: mandate => authorized(mandate) && (mandate.strength==='explicit' || (config.acceptMode==='auto' && !!mandate.basis.rules?.length && mandate.basis.rules.every(id=>config.rules.some(r=>r.id===id)))),
    admitsInferred: rules=>config.acceptMode==='auto' && rules.length>0 && rules.every(id=>config.rules.some(r=>r.id===id)),
  }
}
export function makeScope(config: Config): SourceScope {
  return { scope:({source,meta})=>{
    const configured=config.sources.find(s=>s.id===source)
    if(!configured?.enabled)return {listened:false,reason:'sourceDisabled'}
    if(configured.listenScopes && !configured.listenScopes.includes(String(meta.scope??'default')))return {listened:false,reason:'scopeNotListened'}
    return {listened:true,observed:configured.kind!=='github'||!!configured.github?.receiveAll,row:String(meta.scope??'default')}
  }}
}
