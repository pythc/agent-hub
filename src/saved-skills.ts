import {z} from 'zod'
import {skillParametersSchema,validateSkillParameters,bindSkillParameters,type SkillParameter} from './skill-parameters.ts'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import {skillRefSchema,validateGraph} from './goal-contract.ts'
import {automationTemplateSchema} from './webhooks.ts'
import {stableDigest} from './sources.ts'
import {backendAdmission,checkWorkerAdmission} from './backend-admission.ts'
import {BackendPluginError} from './backends/plugin-contract.ts'
import {workerProfiles} from './worker-pool.ts'
import type {ToolSpec} from './model.ts'

type Template=z.infer<typeof automationTemplateSchema>
type Ref=z.infer<typeof skillRefSchema>
export interface SkillVersion extends Ref {
  parameters?:SkillParameter[]
  validation?:'source'|'trial'
  scopeId:string
  entryId:string
  goalId:string
  acceptanceId:string
  template:Template
}
const id=z.string().min(1).max(300)
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('draft'),goalId:id}).strict(),
  z.object({action:z.literal('save'),goalId:id,expectedVersion:z.number().int().nonnegative(),template:automationTemplateSchema,parameters:skillParametersSchema}).strict(),
  z.object({action:z.literal('run'),skill:skillRefSchema,triggerId:id,authorizationQuote:z.string().min(1).max(16000),operationId:id,inputs:z.record(z.string(),z.string()).optional()}).strict(),
  z.object({action:z.literal('retire'),skill:skillRefSchema,scopeId:id,entryId:id,expectedRevision:z.number().int().nonnegative()}).strict(),
])
export const skillSpecs:ToolSpec[]=[{type:'function',name:'router_skill',description:'List reusable methods for this entry, or read one exact version. Methods are reference material. A fresh request grants authority for each execution.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','read']},id:{type:'string'},version:{type:'integer'}},required:['action'],additionalProperties:false}}]

export class SavedSkills {
  constructor(private host:Runtime){}
  private versions(){return this.host.store.list<SkillVersion>('skill-version')}
  private visible(scopeId:string,entryId:string,context?:ScopeContext){
    const entry=this.host.scopes.binding(entryId)
    return entry.scopeId===scopeId&&this.host.scopes.sourceActive(entry)&&(context?context.route.scopeId===scopeId&&context.route.entryId===entryId:!entry.privateActor)
  }
  list(scopeId:string,context?:ScopeContext){
    if(context)this.host.scopes.assertCurrent(context)
    return this.versions().filter(v=>v.template&&v.scopeId===scopeId&&this.visible(scopeId,v.entryId,context)).map(v=>({id:v.id,version:v.version,entryId:v.entryId,goalId:v.goalId,title:v.template.title,objective:v.template.objective,parameters:v.parameters??[],...this.status(v)}))
      .sort((a,b)=>a.title.localeCompare(b.title)||b.version-a.version)
  }
  resolve(ref:Ref,scopeId:string,entryId:string,context?:ScopeContext){
    const item=this.host.store.get<SkillVersion>('skill-version',stableDigest([ref.id,ref.version]))
    if(!item?.template||item.scopeId!==scopeId||item.entryId!==entryId||!this.visible(scopeId,entryId,context))throw Error('Skill version is unavailable in this entry')
    return item
  }
  status(item:SkillVersion){
    const lifecycle=this.host.store.get<{state:'retired';revision:number}>('skill-lifecycle',stableDigest([item.id,item.version]))
    const outcomes=this.host.store.list<import('./router-goals.ts').RouterGoal>('router-goal')
      .filter(g=>g.scopeId===item.scopeId&&g.entryId===item.entryId&&g.contract?.skill?.id===item.id&&g.contract.skill.version===item.version)
    const passed=outcomes.filter(g=>g.state==='completed'&&g.finalRoundId&&this.host.store.get<{state:string}>('goal-verification',g.finalRoundId)?.state==='passed')
    const failed=outcomes.filter(g=>g.state==='held'&&this.host.store.list<{goalId:string;state:string}>('goal-verification').some(r=>r.goalId===g.id&&['failed','insufficient'].includes(r.state)))
    return {state:lifecycle?.state??(item.validation!=='trial'||passed.length?'active':'candidate'),revision:lifecycle?.revision??0,passed:passed.length,failed:failed.length,validation:item.validation??'legacy'}
  }
  reusable(ref:Ref,scopeId:string,entryId:string,context?:ScopeContext){
    const item=this.resolve(ref,scopeId,entryId,context)
    if(this.status(item).state!=='active'||item.parameters?.length)throw Error('Automations require an accepted, active method with fixed inputs')
    return item
  }
  read(value:unknown){
    const input=skillRefSchema.extend({scopeId:id,entryId:id}).parse(value)
    return this.inspect(input,input.scopeId,input.entryId)
  }
  /** Read-only preflight, never an authorization or a promise of provider availability. */
  inspect(ref:Ref,scopeId:string,entryId:string,context?:ScopeContext){
    if(context)this.host.scopes.assertCurrent(context)
    const item=this.resolve(ref,scopeId,entryId,context),scope=this.host.scopes.scope(scopeId)
    const profiles=workerProfiles(this.host.config)
    const dependencies=(item.template.nodes??[]).map(node=>{
      const profile=profiles.find(p=>p.id===node.workerId)
      let reason:string|undefined
      if(!profile||!scope.workerIds.includes(profile.id))reason='worker_unavailable'
      else if(profile.state&&profile.state!=='enabled')reason='worker_paused'
      else if(!scope.backendIds.includes(profile.backend))reason='backend_not_allowed'
      else {
        const definition=this.host.config.backends[profile.backend]??(profile.backend==='codex'?{kind:'codex' as const}:undefined)
        if(!definition)reason='backend_unavailable'
        else {
          const admission=backendAdmission(this.host.config,profile.backend)
          if(admission.managedMissing.length)reason='backend_not_managed'
          else try{checkWorkerAdmission(this.host.config,profile.backend,profile)}catch(error){
            reason=error instanceof BackendPluginError&&error.code==='quota_exhausted'?'backend_resource_limit':'backend_policy_unsupported'
          }
        }
      }
      const definition=profile&&this.host.config.backends[profile.backend]
      const selected=profile?.toolConnections??definition?.defaults?.toolConnections??[]
      const connections=reason?[]:selected.map(id=>({id,state:this.host.config.toolConnections[id]?.enabled?'configured':'blocked',reason:this.host.config.toolConnections[id]?.enabled?'execution_rechecks_permissions':'connection_disabled_or_missing'}))
      // Do not disclose configuration for an inaccessible Worker or connection.
      return {nodeId:node.id,state:reason?'blocked':'configured',...(reason?{reason}:{workerId:profile!.id,backendId:profile!.backend}),authorization:'not_granted' as const,connections}
    })
    return {...item,inspection:{digest:stableDigest(item),status:this.status(item),dependencies,
      dependencyCoverage:'configured_workers_and_selected_connections_only',implicitMethodRequirements:'not_inferred',parameters:item.parameters??[],authorization:'fresh_request_required',providerVerification:'not_tested',
      grants:[],changesConfiguration:false}}
  }
  readTool(value:unknown,context:ScopeContext){
    this.host.scopes.assertCurrent(context)
    const query=z.discriminatedUnion('action',[z.object({action:z.literal('list')}).strict(),skillRefSchema.extend({action:z.literal('read')}).strict()]).parse(value)
    return query.action==='list'?this.list(context.route.scopeId,context):this.inspect(query,context.route.scopeId,context.route.entryId,context)
  }
  private workers(template:Template,scopeId:string){
    validateGraph(template.nodes,template.criteria)
    const scope=this.host.scopes.scope(scopeId),profiles=workerProfiles(this.host.config)
    for(const node of template.nodes){
      const profile=profiles.find(worker=>worker.id===node.workerId)
      if(!profile||profile.state&&profile.state!=='enabled'||!scope.workerIds.includes(profile.id)||!scope.backendIds.includes(profile.backend))throw Error('Skill Worker is unavailable in this scope')
    }
  }
  execute(ref:Ref,context:ScopeContext,operationId:string,quote:string,inputs?:Record<string,string>){
    const item=this.resolve(ref,context.route.scopeId,context.route.entryId,context),state=this.status(item).state
    if(state==='retired'||state==='candidate'&&!context.trigger.human)throw Error('This method requires a new explicit trial or has been retired')
    const template=bindSkillParameters(item.template,item.parameters??[],inputs)
    this.workers(template,context.route.scopeId)
    return this.host.goals.command({...template,action:'start',operationId,expectedRevision:0,authorizationQuote:quote},context,undefined,ref)
  }
  command(value:unknown,context?:ScopeContext):any{
    if(context)this.host.scopes.assertCurrent(context)
    const input=command.parse(value)
    if(input.action==='retire'){
      const item=this.resolve(input.skill,input.scopeId,input.entryId,context),status=this.status(item)
      if(context&&!this.host.scopes.canManage(context))throw Error('Scope manager required')
      if(status.revision!==input.expectedRevision)throw Error('Skill changed. Refresh before retiring.')
      this.host.store.atomic(()=>{this.host.store.requireEvolutionSchema();this.host.store.put('skill-lifecycle',stableDigest([item.id,item.version]),{id:item.id,version:item.version,scopeId:item.scopeId,entryId:item.entryId,goalId:item.goalId,state:'retired',revision:status.revision+1})})
      return {retired:true}
    }
    if(input.action==='run'){
      const trigger=this.host.store.triggers.get(input.triggerId)
      const resolved=trigger?.human&&this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)
      if(context&&(!resolved||resolved.route.entryId!==context.route.entryId||resolved.actor!==context.actor))throw Error('Skill request is outside this context')
      const actual=resolved
      if(!actual||!context&&this.host.scopes.binding(actual.route.entryId).privateActor||!this.host.scopes.canManage(actual))throw Error('Choose an explicit request in the skill entry')
      return this.execute(input.skill,actual,input.operationId,input.authorizationQuote,input.inputs)
    }
    const goal=this.host.goals.get(input.goalId)
    if(!goal||!this.visible(goal.scopeId,goal.entryId,context)||goal.state!=='completed'||!goal.finalRoundId||this.host.store.get<{state:string}>('goal-verification',goal.finalRoundId)?.state!=='passed')throw Error('Choose a goal with a passed final acceptance')
    this.host.goals.context(goal)
    const id='skill-'+stableDigest([goal.scopeId,goal.entryId,goal.id])
    const versions=this.versions().filter(v=>v.id===id).sort((a,b)=>b.version-a.version)
    const latest=versions[0]
    if(input.action==='draft'){
      if(latest)return latest
      const nodes=goal.nodes?.map(({id,title,instruction,workerId,teamTargetId,dependsOn,criterionIds,derivedFrom,supports,outputs})=>({id,title,instruction,workerId,teamTargetId,dependsOn,criterionIds,derivedFrom,supports,outputs}))
      const template=automationTemplateSchema.parse({title:goal.title,objective:goal.objective,criteria:goal.criteria,nodes,plan:goal.plan,maxTurns:goal.maxTurns,maxParallel:goal.maxParallel,maxRepairs:goal.maxRepairs,maxReplans:goal.maxReplans})
      return {id,version:0,scopeId:goal.scopeId,entryId:goal.entryId,goalId:goal.id,acceptanceId:goal.finalRoundId,template}
    }
    validateSkillParameters(input.template,input.parameters)
    this.workers(input.template,goal.scopeId)
    if(!goal.nodes?.length||goal.nodes.some(node=>!node.workerId))throw Error('A reusable method requires a local Worker plan')
    if(input.expectedVersion!==(latest?.version??0))throw Error('Skill changed. Refresh the version before saving.')
    if(latest&&this.status(latest).state!=='retired'&&stableDigest([latest.template,latest.parameters??[]])===stableDigest([input.template,input.parameters]))return latest
    const original=this.command({action:'draft',goalId:goal.id},context) as SkillVersion
    const sourceAccepted=!latest&&!input.parameters.length&&stableDigest(original.template)===stableDigest(input.template)
    const item:SkillVersion={id,scopeId:goal.scopeId,entryId:goal.entryId,goalId:goal.id,acceptanceId:goal.finalRoundId,version:input.expectedVersion+1,template:input.template,parameters:input.parameters,validation:sourceAccepted?'source':'trial'}
    this.host.store.atomic(()=>{this.host.store.requireEvolutionSchema();this.host.store.put('skill-version',stableDigest([id,item.version]),item)})
    return item
  }
}
