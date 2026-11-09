import {z} from 'zod'
import {stableDigest} from '../../src/sources.ts'
import {WebhookError,type CloudEvent} from '../../src/webhook-protocol.ts'

/** One narrow platform adapter: signed GitHub Actions workflow_run deliveries. */
const payloadSchema=z.object({action:z.enum(['requested','in_progress','completed']),repository:z.object({id:z.number().int().positive(),full_name:z.string()}),workflow_run:z.object({id:z.number().int().positive(),run_attempt:z.number().int().positive(),head_sha:z.string().regex(/^[a-f0-9]{40}$/),status:z.enum(['queued','in_progress','completed','requested','waiting','pending']),conclusion:z.string().nullable(),updated_at:z.iso.datetime({offset:true})})})
export function githubWorkflowEvent(raw:unknown,binding:{repositoryId:number;repository:string},approvedAt:number,now:number):CloudEvent {
 const p=payloadSchema.parse(raw),w=p.workflow_run
 if(p.repository.id!==binding.repositoryId||p.repository.full_name.toLowerCase()!==binding.repository.toLowerCase())throw new WebhookError(403,'github_repository_outside_grant')
 if(Date.parse(w.updated_at)<approvedAt-300000||Date.parse(w.updated_at)>now+300000)throw new WebhookError(403,'github_event_outside_authorization_time')
 if(p.action==='completed'&&w.status!=='completed'||p.action!=='completed'&&w.conclusion!==null)throw new WebhookError(400,'github_workflow_state_mismatch')
 // Delivery/type headers are not signed by GitHub. Business identity comes
 // exclusively from the signed body and is independent of transport redelivery.
 return {specversion:'1.0',id:'gh_'+stableDigest([p.repository.id,w.id,w.run_attempt,p.action,w.status,w.conclusion]),source:'https://github.com/'+binding.repository,subject:String(w.id),type:'github.workflow_run.'+p.action+(p.action==='completed'?'.'+w.conclusion:''),time:w.updated_at,data:{repository:binding.repository,runId:String(w.id),attempt:w.run_attempt,sha:w.head_sha,conclusion:w.conclusion??'',status:w.status}}
}
