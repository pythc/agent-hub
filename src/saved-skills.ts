import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import {skillRefSchema,validateGraph} from './goal-contract.ts'
import {automationTemplateSchema} from './webhooks.ts'
import {stableDigest} from './sources.ts'
import {workerProfiles} from './worker-pool.ts'
import type {ToolSpec} from './model.ts'

type Template=z.infer<typeof automationTemplateSchema>
type Ref=z.infer<typeof skillRefSchema>
interface SkillVersion extends Ref {
  scopeId:string
  entryId:string
  goalId:string
  acceptanceId:string
  template:Template
}
const id=z.string().min(1).max(300)
const command=z.discriminatedUnion('action',[
  z.object({action:z.literal('draft'),goalId:id}).strict(),
  z.object({action:z.literal('save'),goalId:id,expectedVersion:z.number().int().nonnegative(),template:automationTemplateSchema}).strict(),
  z.object({action:z.literal('run'),skill:skillRefSchema,triggerId:id,authorizationQuote:z.string().min(1).max(16000),operationId:id}).strict(),
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
    return this.versions().filter(v=>v.template&&v.scopeId===scopeId&&this.visible(scopeId,v.entryId,context)).map(({id,version,entryId,goalId,template})=>({id,version,entryId,goalId,title:template.title}))
      .sort((a,b)=>a.title.localeCompare(b.title)||b.version-a.version)
  }
  resolve(ref:Ref,scopeId:string,entryId:string,context?:ScopeContext){
    const item=this.host.store.get<SkillVersion>('skill-version',stableDigest([ref.id,ref.version]))
    if(!item?.template||item.scopeId!==scopeId||item.entryId!==entryId||!this.visible(scopeId,entryId,context))throw Error('Skill version is unavailable in this entry')
    return item
  }
  read(value:unknown){
    const input=skillRefSchema.extend({scopeId:id,entryId:id}).parse(value)
    return this.resolve(input,input.scopeId,input.entryId)
  }
  readTool(value:unknown,context:ScopeContext){
    this.host.scopes.assertCurrent(context)
    const query=z.discriminatedUnion('action',[z.object({action:z.literal('list')}).strict(),skillRefSchema.extend({action:z.literal('read')}).strict()]).parse(value)
    return query.action==='list'?this.list(context.route.scopeId,context):this.resolve(query,context.route.scopeId,context.route.entryId,context)
  }
  private workers(template:Template,scopeId:string){
    validateGraph(template.nodes,template.criteria)
    const scope=this.host.scopes.scope(scopeId),profiles=workerProfiles(this.host.config)
    for(const node of template.nodes){
      const profile=profiles.find(worker=>worker.id===node.workerId)
      if(!profile||profile.state&&profile.state!=='enabled'||!scope.workerIds.includes(profile.id)||!scope.backendIds.includes(profile.backend))throw Error('Skill Worker is unavailable in this scope')
    }
  }
  execute(ref:Ref,context:ScopeContext,operationId:string,quote:string){
    const {template}=this.resolve(ref,context.route.scopeId,context.route.entryId,context)
    this.workers(template,context.route.scopeId)
    return this.host.goals.command({...template,action:'start',operationId,expectedRevision:0,authorizationQuote:quote},context,undefined,ref)
  }
  command(value:unknown){
    const input=command.parse(value)
    if(input.action==='run'){
      const trigger=this.host.store.triggers.get(input.triggerId)
      const context=trigger?.human&&this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)
      if(!context||this.host.scopes.binding(context.route.entryId).privateActor||!this.host.scopes.canManage(context))throw Error('Choose an explicit request in the skill entry')
      return this.execute(input.skill,context,input.operationId,input.authorizationQuote)
    }
    const goal=this.host.goals.get(input.goalId)
    if(!goal||!this.visible(goal.scopeId,goal.entryId)||goal.state!=='completed'||!goal.finalRoundId||this.host.store.get<{state:string}>('goal-verification',goal.finalRoundId)?.state!=='passed')throw Error('Choose a goal with a passed final acceptance')
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
    this.workers(input.template,goal.scopeId)
    if(!goal.nodes?.length||goal.nodes.some(node=>!node.workerId))throw Error('A reusable method requires a local Worker plan')
    if(latest&&stableDigest(latest.template)===stableDigest(input.template))return latest
    if(input.expectedVersion!==(latest?.version??0))throw Error('Skill changed. Refresh the version before saving.')
    const item:SkillVersion={id,scopeId:goal.scopeId,entryId:goal.entryId,goalId:goal.id,acceptanceId:goal.finalRoundId,version:input.expectedVersion+1,template:input.template}
    this.host.store.atomic(()=>{this.host.store.requireWorkflowSchema();this.host.store.put('skill-version',stableDigest([id,item.version]),item)})
    return item
  }
}
