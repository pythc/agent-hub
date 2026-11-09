import {z} from 'zod'

export const delegationId=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
export const permissionsSchema=z.object({
 write:z.boolean().default(false),shell:z.boolean().default(false),
 network:z.boolean().default(false),subagents:z.boolean().default(false),
}).strict()
export const limitsSchema=z.object({
 maxActivations:z.number().int().min(2).max(100).default(12),
 maxConcurrent:z.number().int().min(1).max(10).default(2),
 durationMs:z.number().int().min(5000).max(3600000).default(600000),
}).strict()
export const teamTargetSchema=z.object({
 id:delegationId,label:z.string().trim().min(1).max(100),connectionId:delegationId,
 mode:z.literal('managed-team').default('managed-team'),
 state:z.enum(['enabled','paused']).default('enabled'),
 permissions:permissionsSchema.prefault({}),limits:limitsSchema.prefault({}),
}).strict()
export const delegationConfigSchema=z.object({
 enabled:z.boolean().default(false),port:z.number().int().min(0).max(65535).default(0),
 sourceId:z.string().regex(/^[a-z][a-z0-9_-]*$/).default('delegation'),
 pollMs:z.number().int().min(100).max(60000).default(1000),
 leaseMs:z.number().int().min(2000).max(120000).default(30000),
 maxRemoteActivations:z.number().int().min(2).max(1000).default(48),
}).strict().prefault({})
export const contractSchema=z.object({
 version:z.literal(1),delegationId:delegationId,rootId:delegationId,parentTriggerId:z.string().min(1).max(500),
 issuer:delegationId,target:delegationId,ancestors:z.array(delegationId).min(1).max(2),
 principal:z.object({source:z.string().min(1).max(300),actor:z.string().min(1).max(300)}).strict(),
 text:z.string().trim().min(1).max(24000),acceptance:z.string().trim().min(1).max(8000),
 artifacts:z.array(z.string().min(1).max(200).refine(p=>!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(x=>!x.startsWith('.')&&x!==''),'Use relative public artifact paths')).max(10).default([]),
 permissions:permissionsSchema,limits:limitsSchema,
 createdAt:z.number().int().positive(),deadline:z.number().int().positive(),
}).strict()
export type DelegationContract=z.infer<typeof contractSchema>
export type TeamTarget=z.infer<typeof teamTargetSchema>
export type DelegationPermissions=z.infer<typeof permissionsSchema>
export type DelegationLimits=z.infer<typeof limitsSchema>
export const teamCommandSchema=z.object({
 action:z.enum(['list','assign','inspect','cancel','accept']),id:delegationId.optional(),
 targetId:delegationId.optional(),operationId:delegationId.optional(),expectedRevision:z.number().int().nonnegative().optional(),
 text:z.string().min(1).max(24000).optional(),acceptance:z.string().min(1).max(8000).optional(),
 artifacts:z.array(contractSchema.shape.artifacts.unwrap().element).max(10).optional().describe('Required for assign. Exact relative file paths to transfer, such as input.txt; use [] for text-only work. Mentioning files in text does not authorize artifact capture.'),
 evidence:z.array(z.string().min(1).max(300)).max(130).optional(),
}).strict()
export const teamSpecs=[{
 type:'function' as const,name:'team_delegate',
 description:'Delegate a bounded subgoal to an authorized independent Roppo team. list discovers current targets and revision. assign requires targetId, text, acceptance, artifacts, stable operationId and expectedRevision. Explicitly set artifacts to the relative files to transfer (for example ["input.txt"]), or [] for text-only work. A filename in text does not declare an artifact. Never omit artifacts. Accepted is asynchronous, not completed. inspect reads actual remote state and immutable evidence. accept records your parent-side review only after inspecting the returned evidence IDs. cancel affects this delegation only. Do not poll in a loop; terminal results wake this Router. Never claim independent acceptance merely from a remote self-report.',
 inputSchema:z.toJSONSchema(teamCommandSchema,{io:'input',target:'draft-7'}),
}]
export class DelegationError extends Error {
 constructor(readonly code:string,readonly status=400){super(code)}
}
export function requireDelegation(condition:unknown,code:string,status=400):asserts condition {
 if(!condition)throw new DelegationError(code,status)
}
