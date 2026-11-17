import {z} from 'zod'
import {automationTemplateSchema} from './webhooks.ts'

type Template=z.infer<typeof automationTemplateSchema>
export const skillParametersSchema=z.array(z.object({name:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label:z.string().min(1).max(100)}).strict()).max(20).default([])
export type SkillParameter=z.infer<typeof skillParametersSchema>[number]
const token=/\{\{([a-z][a-z0-9_]{0,39})\}\}/g
/** Replace content and evidence paths only, never topology, workers or authority. */
function transform(template:Template,replace:(text:string)=>string):Template{
 return {...template,title:replace(template.title),objective:replace(template.objective),plan:template.plan?.map(replace),nextAction:template.nextAction&&replace(template.nextAction),
  nodes:template.nodes.map(n=>({...n,title:replace(n.title),instruction:replace(n.instruction),outputs:n.outputs?.map(replace)})),
  criteria:template.criteria.map(c=>({...c,description:replace(c.description),files:c.files.map(replace),check:c.check?{...c.check,path:replace(c.check.path),...(c.check.kind==='text_contains'?{text:replace(c.check.text)}:{})}:undefined})),
 }
}
export function validateSkillParameters(template:Template,parameters:SkillParameter[]){
 const names=parameters.map(p=>p.name),used=new Set<string>()
 if(new Set(names).size!==names.length)throw Error('Duplicate skill parameter')
 transform(template,text=>{for(const m of text.matchAll(token))used.add(m[1]!);return text.replace(token,'input')})
 const sanitized=transform(template,text=>text.replace(token,'input'))
 if(JSON.stringify(sanitized).includes('{{'))throw Error('Placeholders are only supported in titles, instructions, plans and evidence paths/text')
 if([...used].some(name=>!names.includes(name))||names.some(name=>!used.has(name)))throw Error('Skill parameters must match every template placeholder')
}
export function bindSkillParameters(template:Template,parameters:SkillParameter[],value:unknown={}){
 const inputs=z.record(z.string(),z.string().min(1).max(2000)).parse(value)
 if(Object.keys(inputs).some(k=>!parameters.some(p=>p.name===k))||parameters.some(p=>!Object.hasOwn(inputs,p.name)))throw Error('Supply exactly the declared skill inputs')
 if(Object.values(inputs).some(v=>v.includes('{{')))throw Error('Nested skill placeholders are not supported')
 return automationTemplateSchema.parse(transform(template,text=>text.replace(token,(_,key:string)=>inputs[key]!)))
}
