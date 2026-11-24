import {z} from 'zod'
import {skillRefSchema} from './goal-contract.ts'
import {automationTemplateSchema} from './webhooks.ts'
import {stableDigest} from './sources.ts'

type Template=z.infer<typeof automationTemplateSchema>
type SkillRef=z.infer<typeof skillRefSchema>
type Method={template:Template;parameters?:unknown}
const text=z.string().min(1).max(16000)
export const overlayEditSchema=z.discriminatedUnion('field',[
  z.object({field:z.literal('title'),value:text}).strict(),
  z.object({field:z.literal('objective'),value:text}).strict(),
  z.object({field:z.literal('instruction'),nodeId:z.string().min(1).max(200),value:text}).strict(),
])
type Edit=z.infer<typeof overlayEditSchema>
type Patch={edit:Edit;expected:string}

export interface SkillOverlay {
  base:SkillRef
  baseDigest:string
  patch:Patch[]
  resolvedVersion:string
}

const key=(edit:Edit)=>'nodeId' in edit?'instruction:'+edit.nodeId:edit.field
const read=(template:Template,edit:Edit)=>'nodeId' in edit?template.nodes.find(n=>n.id===edit.nodeId)?.instruction:template[edit.field]
export function capturePatch(template:Template,edits:Edit[]):Patch[]{
  const seen=new Set<string>()
  const patch:Patch[]=[]
  for(const edit of edits){
    const field=key(edit),expected=read(template,edit)
    if(seen.has(field)||expected===undefined)throw Error('Overlay edit must target one existing field exactly once')
    seen.add(field)
    if(edit.value!==expected)patch.push({edit,expected})
  }
  if(!patch.length)throw Error('An overlay needs at least one changed field')
  return patch
}

export function overlayConflicts(template:Template,patch:Patch[]){
  return patch.flatMap(({edit,expected})=>{
    const next=read(template,edit)
    return next===expected?[]:[{field:key(edit),oldBase:expected,overlay:edit.value,newBase:next??null}]
  })
}

export function applyPatch(template:Template,patch:Patch[]){
  const conflictDetails=overlayConflicts(template,patch)
  if(conflictDetails.length)return {conflicts:conflictDetails.map(conflict=>conflict.field),conflictDetails}
  const resolved={...template,nodes:template.nodes.map(node=>({...node}))}
  for(const {edit} of patch){
    if('nodeId' in edit)resolved.nodes.find(n=>n.id===edit.nodeId)!.instruction=edit.value
    else resolved[edit.field]=edit.value
  }
  return {template:automationTemplateSchema.parse(resolved)}
}

export const methodDigest=(method:Method)=>stableDigest([method.template,method.parameters??[]])

export function bindOverlay(base:SkillRef,baseMethod:Method,patch:Patch[],resolved:Method):SkillOverlay{
  const baseDigest=methodDigest(baseMethod)
  return {base,baseDigest,patch,resolvedVersion:stableDigest(['saved-skill-overlay-v1',base,baseDigest,patch,methodDigest(resolved)])}
}
