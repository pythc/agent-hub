import {expect,it} from 'vitest'
import {runInNewContext} from 'node:vm'
import {skillScript,skillSection} from '../src/ui/saved-skills.ts'
function fixture(){
 const nodes=new Map<string,any>(),requests:{resolve:(x:any)=>void}[]=[]
 const $=(key:string)=>{if(!nodes.has(key))nodes.set(key,{hidden:true,textContent:'',value:''});return nodes.get(key)}
 const ctx:any={$,scope:()=> 'scope',api:()=>new Promise(resolve=>requests.push({resolve})),JSON,notice:()=>{},state:{acceptedGoals:[],skills:[]},table:()=>{},options:()=>{throw Error('filter must not reset form options')}}
 runInNewContext(skillScript,ctx)
 return {ctx,$,requests}
}
const result=(title:string)=>({id:'method',version:1,template:{title},inspection:{dependencies:[]}})
it('shows full fixed version as text, not executable markup',async()=>{
 const f=fixture(),pending=f.ctx.previewSkill({id:'method',version:1,entryId:'e'})
 f.requests[0]!.resolve(result('<img onerror=alert(1)>'));await pending
 expect(f.$('#skill-preview-content').textContent).toContain('<img onerror=alert(1)>')
 expect(f.$('#skill-preview-status').textContent).toContain('v1')
 expect(skillSection).toContain('type="search"')
})
it.each(['close','scope','refresh','newer'])('discards stale version reads after %s',async action=>{
 const f=fixture(),first=f.ctx.previewSkill({id:'one',version:1})
 if(action==='close')f.$('#close-skill-preview').onclick()
 if(action==='refresh')f.ctx.clearSkillPreview()
 if(action==='scope')f.ctx.clearSkills()
 if(action==='newer'){const newer=f.ctx.previewSkill({id:'two',version:2});f.requests[1]!.resolve(result('newer'));await newer}
 f.requests[0]!.resolve(result('old-only'));await first
 expect(f.$('#skill-preview-content').textContent).not.toContain('old-only')
})

it('filter changes do not reset schedule or accepted goal selection',()=>{
 const f=fixture();f.$('#schedule-skill').value='pinned-v1';f.$('#accepted-goal').value='goal-one'
 f.$('#skill-search').value='review';f.$('#skill-search').oninput();f.$('#skill-state').onchange()
 expect(f.$('#schedule-skill').value).toBe('pinned-v1');expect(f.$('#accepted-goal').value).toBe('goal-one')
})
