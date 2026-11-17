import {it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {configurationScripts} from '../src/ui/configuration-assets.ts'
const source=readFileSync(new URL('../src/ui/task-permissions-card.js',import.meta.url),'utf8')
class Element {children:Element[]=[];constructor(readonly tag:string,readonly cls='',readonly text=''){}append(...nodes:Element[]){this.children.push(...nodes)}}
const walk=(e:Element):Element[]=>[e,...e.children.flatMap(walk)],words=(e:Element)=>walk(e).map(x=>x.text).join(' ')
const dto=()=>({schema:1,readOnly:true,authorization:false,observedAt:1,subject:{kind:'task',id:'one'},reason:'current',action:'task_followup',execution:'not_assessed'})
function fixture(){const api=vi.fn(()=>{throw Error('no actions')}),c=createContext({Object,Array,Number,L:(a:string,b:string)=>b,el:(t:string,c:string,v:string)=>new Element(t,c,v),fetch:api,api});runInContext(source,c);return{api,render:(v:unknown)=>{c.v=v;return runInContext("taskPermissionsCard(v,'one')",c) as Element|null}}}
it('shows different scope/member repairs, explains no grant, and offers no effect controls',()=>{
 const f=fixture();for(const reason of ['scope_not_listened','member_not_admitted','request_scope_missing','requester_or_manager_required','current']){const card=f.render({...dto(),reason})!;expect(words(card)).toContain('未修改任何权限');expect(words(card)).toContain('另行核验');expect(walk(card).some(e=>['button','input','a'].includes(e.tag))).toBe(false)}
 expect(words(f.render({...dto(),reason:'scope_not_listened'})!)).toContain('监听范围');expect(words(f.render({...dto(),reason:'member_not_admitted'})!)).toContain('成员资格');expect(f.api).not.toHaveBeenCalled()
})
it('rejects foreign, malformed, authority-bearing or getter DTOs without rendering arbitrary text',()=>{
 const f=fixture(),getter=vi.fn(()=>{throw Error('secret')});const v=dto();Object.defineProperty(v,'reason',{get:getter})
 for(const bad of [v,{...dto(),reason:'SECRET'},{...dto(),authorization:true},{...dto(),subject:{kind:'task',id:'other'}},{...dto(),grant:'secret'},{...dto(),execution:'allowed'}])expect(f.render(bad)).toBeNull()
 expect(getter).not.toHaveBeenCalled()
})
it('registers before the drawer and uses native disclosure without effects or motion',()=>{expect(configurationScripts).toContain('task-permissions-card.js');expect(configurationScripts.indexOf('task-permissions-card.js')).toBeLessThan(configurationScripts.indexOf('operator-workspace.js'));expect(source).not.toMatch(/fetch\(|api\(|setTimeout\(|setInterval\(|innerHTML/);expect(fixture().render(dto())?.tag).toBe('details')})
