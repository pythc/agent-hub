import {z} from 'zod'

const id=z.string().min(1).max(200)
export const skillRefSchema=z.object({id,version:z.number().int().positive()}).strict()
const path=z.string().min(1).max(1000)
export const criterionSchema=z.object({
 id,description:z.string().min(1).max(4000),
 files:z.array(path).max(20).default([]),
 documents:z.array(id).max(20).default([]),
 check:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('file_exists'),path}).strict(),
  z.object({kind:z.literal('xlsx_cell_equals'),path,sheet:id,cell:z.string().regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i),expected:z.union([z.string(),z.number(),z.boolean()]),sumRange:z.string().regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}:\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i).optional()}).strict(),
  z.object({kind:z.literal('text_contains'),path,text:z.string().min(1).max(16000)}).strict(),
  z.object({kind:z.literal('json_equals'),path,pointer:z.string().max(1000).refine(p=>p===''||p.startsWith('/'),'JSON pointer must be empty or start with /'),expected:z.unknown().refine(v=>v!==undefined,'expected is required')}).strict(),
 ]).optional(),
}).strict()
export type GoalCriterion=z.infer<typeof criterionSchema>
export const nodeSchema=z.object({id,title:z.string().min(1).max(300),instruction:z.string().min(1).max(16000),workerId:id.optional(),teamTargetId:id.optional(),dependsOn:z.array(id).max(100).default([]),criterionIds:z.array(id).max(50),derivedFrom:id.optional(),supports:z.array(id).min(1).max(50).optional(),outputs:z.array(path).min(1).max(20).optional()}).strict().refine(n=>!!n.workerId!==!!n.teamTargetId,'A node needs exactly one workerId or teamTargetId')
export interface GoalNode extends z.infer<typeof nodeSchema> {
 ticketId?:string;delegationId?:string;state:'pending'|'running'|'verifying'|'passed'|'held'|'waiting_dependency';roundId?:string;
 repairs:number;recoveries:number;repairStart?:number;refreshFrom?:string;retryAt?:number;failure?:GoalFailure;reason?:string;
}
export interface GoalFailure {kind:'transient'|'quota'|'environment'|'uncertain'|'quality'|'protocol';reason:string;retryAt?:number}
export function classifyGoalFailure(error:string,now:number,attempt:number):GoalFailure {
 const reason=error.slice(0,1000)
 if(/uncertain|reconciliation|could not be confirmed|interrupted|host stopped/i.test(error))return {kind:'uncertain',reason}
 if(/\b429\b|quota|rate.?limit|usage limit/i.test(error))return {kind:'quota',reason,retryAt:now+Math.min(8*3600000,1800000*2**attempt)}
 if(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|HTTP (408|5\d\d)|temporar|network|connection reset|stream disconnected/i.test(error))return {kind:'transient',reason,retryAt:now+Math.min(1800000,120000*2**attempt)}
 if(/credential|unauthori[sz]ed|forbidden|permission|ENOENT|not installed|not found|outside|revoked/i.test(error))return {kind:'environment',reason}
 return {kind:'quality',reason}
}
export function classifyVerificationFailure(error:string,now:number,attempt:number):GoalFailure {return error.includes('Verification protocol:')?{kind:'protocol',reason:error.slice(0,1000),retryAt:now}:classifyGoalFailure(error,now,attempt)}
export function validateGraph(nodes:z.infer<typeof nodeSchema>[],criteria:GoalCriterion[]) {
 const byId=new Map(nodes.map(n=>[n.id,n]));if(byId.size!==nodes.length)throw Error('Duplicate goal node id')
 const criterionIds=new Set(criteria.map(c=>c.id))
 for(const n of nodes){
  if(!n.criterionIds.length&&(!n.derivedFrom||!byId.has(n.derivedFrom)||!n.supports?.length||!n.outputs?.length))throw Error('Intermediate nodes need an original parent, supported criteria and outputs')
  if(n.supports?.some(id=>!criterionIds.has(id)))throw Error('Unknown supported criterion')
  if(new Set(n.criterionIds).size!==n.criterionIds.length||n.criterionIds.some(id=>!criterionIds.has(id)))throw Error('Unknown or duplicate node criterion')
  if(new Set(n.dependsOn).size!==n.dependsOn.length||n.dependsOn.some(id=>!byId.has(id)))throw Error('Unknown or duplicate dependency')
 }
 const visiting=new Set<string>(),done=new Set<string>()
 const visit=(id:string)=>{if(visiting.has(id))throw Error('Cyclic goal dependency');if(done.has(id))return;visiting.add(id);for(const d of byId.get(id)!.dependsOn)visit(d);visiting.delete(id);done.add(id)}
 for(const id of byId.keys())visit(id)
 if(nodes.length&&criteria.some(c=>!nodes.some(n=>n.criterionIds.includes(c.id))))throw Error('Every goal criterion needs a task node')
}
