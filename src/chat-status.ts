import {z} from 'zod'
import type {ToolSpec} from './model.ts'

export const chatStatusSchema=z.object({
 phase:z.enum(['thinking','working','reviewing']),
 label:z.string().trim().min(1).max(48).refine(value=>!/[\r\n\x00-\x1f]/.test(value),'Use one short line'),
}).strict()
export type ChatStatus= z.infer<typeof chatStatusSchema> & {updatedAt:number}
export const chatStatusTool:ToolSpec={
 type:'function',name:'superagent_status',
 description:'Update the short public Chat status for your current work. Use the user language, about 6–12 Chinese characters or 3–7 words, e.g. 正在审查输入组件. Report only an observable task stage, without private reasoning, secrets, or a claim of completion. Call once when starting substantial work and when the stage changes, not for every step. This only updates the interface; it does not send a message or change task state.',
 inputSchema:{type:'object',additionalProperties:false,properties:{phase:{type:'string',enum:['thinking','working','reviewing']},label:{type:'string',minLength:1,maxLength:48}},required:['phase','label']},
}
