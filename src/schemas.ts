import { z } from 'zod'
export const assessment = z.object({
  action: z.enum(['accept', 'ignore','attach','stop']), title: z.string(), scope: z.string(), reason: z.string(),
  rules: z.array(z.string()),
  targetTicketId:z.string().nullable().optional(),
  ruleAssessments:z.array(z.object({id:z.string(),matched:z.boolean(),reason:z.string().min(1)}).strict()).optional(),
}).strict()
export const assessmentSchema = {
  type: 'object', additionalProperties: false,
  properties: { action: { type: 'string', enum: ['accept', 'ignore','attach','stop'] }, title: { type: 'string' }, scope: { type: 'string' }, reason: { type: 'string' }, rules: { type: 'array', items: { type: 'string' } },targetTicketId:{type:['string','null']},ruleAssessments:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},matched:{type:'boolean'},reason:{type:'string'}},required:['id','matched','reason']}} },
  required: ['action', 'title', 'scope', 'reason', 'rules','targetTicketId','ruleAssessments'],
}
export const report = z.object({
  state: z.enum(['ready', 'waiting', 'blocked', 'failed', 'dropped']),
  summary: z.string(), reply: z.string(), question: z.string().nullable(),
  handbacks: z.array(z.object({ triggerId: z.string(), reason: z.string() }).strict()),
}).strict()
export const reportSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    state: { type: 'string', enum: ['ready', 'waiting', 'blocked', 'failed', 'dropped'] },
    summary: { type: 'string' }, reply: { type: 'string' }, question: { type: ['string', 'null'] },
    handbacks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { triggerId: { type: 'string' }, reason: { type: 'string' } }, required: ['triggerId', 'reason'] } },
  }, required: ['state', 'summary', 'reply', 'question', 'handbacks'],
}
