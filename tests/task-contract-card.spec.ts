import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it,vi} from 'vitest'
import {configurationScripts,configurationStyles} from '../src/ui/configuration-assets.ts'
import type {TaskContractViewV1} from '../src/task-contract-view.ts'
const source=readFileSync(new URL('../src/ui/task-contract-card.js',import.meta.url),'utf8')
function dto():TaskContractViewV1{return {schema:1,readOnly:true,observedAt:1000,subject:{kind:'task',id:'task'},availability:'available',contentSource:'router_saved_goal',basis:{contract:{kind:'goal_contract',digest:'a'.repeat(64)},goalId:'INTERNAL_GOAL_ID',goalRevision:3,planRevision:1,assignmentId:'INTERNAL_ASSIGNMENT_ID',ownerEpoch:1,dataRevision:2,bindingRevision:1},objective:'Analyze the project without changing files',scope:null,criteria:[{id:'INTERNAL_CRITERION_ID',description:'Explain the relevant findings'}],deliverables:{files:['analysis.md'],documents:['INTERNAL_DOCUMENT_ID']},budget:null}}
class Element{
 children:Element[]=[];dataset:Record<string,string>={};attributes:Record<string,string>={};textContent=''
 constructor(readonly tagName:string,readonly className='',text=''){this.textContent=text}
 append(...values:Element[]){this.children.push(...values)}setAttribute(name:string,value:string){this.attributes[name]=value}
 set innerHTML(_v:string){throw Error('HTML injection forbidden')}
}
function fixture(language='en'){
 const api=vi.fn(()=>{throw Error('No API calls permitted')}),fetch=vi.fn(()=>{throw Error('No network permitted')})
 const context=createContext({Object,Array,Number,String,Set,Error,lang:language,L:(en:string,zh:string)=>language==='zh'?zh:en,el:(tag:string,css='',text='')=>new Element(tag,css,text),api,fetch})
 runInContext(source,context)
 return {api,fetch,render:(value:unknown,id='task')=>{context.value=value;context.id=id;return runInContext('taskContractCard(value,id)',context)as Element}}
}
const all=(node:Element):Element[]=>[node,...node.children.flatMap(all)]
const text=(node:Element):string=>all(node).map(n=>n.textContent).filter(Boolean).join(' ')
it('shows only saved typed goals and acceptance descriptions, with one optional closed detail',()=>{
 const f=fixture(),card=f.render({...dto(),raw:'SECRET_RAW',prompt:'SECRET_PROMPT'}),body=text(card)
 expect(card.dataset.state).toBe('available');expect(body).toContain('Saved goal');expect(body).toContain('Acceptance criteria');expect(body).toContain('Analyze the project without changing files');expect(body).toContain('Explain the relevant findings')
 expect(body).not.toMatch(/SECRET|INTERNAL|[a-f0-9]{64}|version|revision|scope|Authorization/)
 const details=all(card).filter(n=>n.tagName==='details');expect(details).toHaveLength(1);expect(details[0]!.attributes).not.toHaveProperty('open');expect(text(details[0]!)).toContain('not proof of completed or accepted work')
 expect(all(card).filter(n=>['button','a','input','form'].includes(n.tagName))).toHaveLength(0);expect(f.api).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled()
})
it('uses ordinary Chinese for the saved goal and incomplete cases without internal identifiers',()=>{
 const f=fixture('zh'),card=f.render(dto());expect(text(card)).toContain('已保存目标');expect(text(card)).toContain('验收条件');expect(text(card)).toContain('查看约定详情');expect(text(card)).toContain('关联文档：1 份');expect(text(card)).not.toContain('INTERNAL')
 expect(text(f.render({...dto(),availability:'not_captured'}))).toBe('暂无可显示的验收条件。');expect(text(f.render(null))).toBe('任务约定暂不可用。')
})
it('does not invent execution scope, non-goals, deadlines, authority controls or a missing budget',()=>{
 const card=fixture().render(dto()),body=text(card);expect(body).not.toMatch(/scope|non-goal|deadline|balance|Approve|Retry|Stop|budget/);expect(all(card).filter(n=>n.tagName==='details')).toHaveLength(1)
 const minimal=dto();minimal.deliverables={files:[],documents:[]};expect(all(fixture().render(minimal)).some(n=>n.tagName==='details')).toBe(false)
})
it('keeps a configured project estimate optional and never labels it a balance or hard deadline',()=>{
 const value=dto();value.budget={scope:'code_project',basis:'configured_estimate',maxMinutes:30,maxUsd:5};const card=fixture().render(value),details=all(card).find(n=>n.tagName==='details')!
 expect(text(details)).toContain('Time budget: 30 minutes');expect(text(details)).toContain('Estimated cost ceiling: US$5');expect(text(details)).toContain('not an account balance or a guaranteed final cost');expect(details.attributes).not.toHaveProperty('open')
 value.budget.maxUsd=1e-9;expect(text(fixture().render(value))).not.toContain('US$0 ')
})
it('passes untrusted descriptions as literal textContent without links or HTML interpretation',()=>{
 const value=dto();value.objective='<img src=x onerror=alert(1)>';value.criteria[0]!.description='<script>not executable</script>'
 const card=fixture().render(value);expect(text(card)).toContain(value.objective);expect(text(card)).toContain(value.criteria[0]!.description);expect(all(card).some(n=>['img','script','a'].includes(n.tagName))).toBe(false)
})
it('never reuses old content after unavailable, missing, malformed or mismatched task data',()=>{
 const f=fixture();expect(text(f.render(dto()))).toContain('Analyze the project')
 for(const input of [null,undefined,{...dto(),availability:'unavailable'}, {...dto(),schema:2},{...dto(),subject:{kind:'task',id:'other'}}]){const card=f.render(input);expect(card.dataset.state).toBe('unavailable');expect(text(card)).toBe('The saved task agreement is unavailable.');expect(text(card)).not.toContain('Analyze')}
 const notCaptured=f.render({...dto(),availability:'not_captured',objective:'SECRET_OLD'});expect(text(notCaptured)).not.toMatch(/SECRET|findings|Analyze/);expect(all(notCaptured)).toHaveLength(2)
})
for(const [name,mutate]of [
 ['readOnly',(v:any)=>v.readOnly=false],['time',(v:any)=>v.observedAt=-1],['availability',(v:any)=>v.availability='passed'],['source',(v:any)=>v.contentSource='raw_prompt'],['scope',(v:any)=>v.scope='SECRET_SCOPE'],['objective',(v:any)=>v.objective=null],['criteria missing',(v:any)=>v.criteria=[]],['bad criterion',(v:any)=>v.criteria[0].description=3],['duplicate criteria',(v:any)=>v.criteria.push({...v.criteria[0]})],['contract kind',(v:any)=>v.basis.contract.kind='mandate'],['contract digest',(v:any)=>v.basis.contract.digest='SECRET'],['basis missing',(v:any)=>delete v.basis.dataRevision],['unsafe version',(v:any)=>v.basis.goalRevision=Number.MAX_SAFE_INTEGER+1],['bad assignment',(v:any)=>v.basis.assignmentId=3],['traversal',(v:any)=>v.deliverables.files=['../SECRET']],['absolute path',(v:any)=>v.deliverables.files=['/SECRET']],['Windows path',(v:any)=>v.deliverables.files=['C:\\SECRET']],['bad document',(v:any)=>v.deliverables.documents=[3]],['unsafe budget',(v:any)=>v.budget={scope:'account',basis:'configured_estimate',maxUsd:5,maxMinutes:null}],['empty budget',(v:any)=>v.budget={scope:'code_project',basis:'configured_estimate',maxUsd:null,maxMinutes:null}],['zero budget',(v:any)=>v.budget={scope:'code_project',basis:'configured_estimate',maxUsd:0,maxMinutes:null}],
]as const)it('fails closed for '+name+' without showing stale content',()=>{const value=dto();mutate(value);const card=fixture().render(value);expect(card.dataset.state).toBe('unavailable');expect(text(card)).not.toMatch(/SECRET|Analyze|findings/)})
it('does not invoke getter properties or copy extra metadata into the card',()=>{
 const getter=vi.fn(()=>{throw Error('SECRET_GETTER')});const value=dto();Object.defineProperty(value,'objective',{get:getter});expect(fixture().render(value).dataset.state).toBe('unavailable');expect(getter).not.toHaveBeenCalled()
 const extra=dto();Object.defineProperty(extra,'raw',{get:getter});expect(fixture().render(extra).dataset.state).toBe('available');expect(getter).not.toHaveBeenCalled()
})
it('does not coerce malformed hashes or invoke caller-owned array methods and iterators',()=>{
 const getter=vi.fn(()=>{throw Error('SECRET_GETTER')}),bad=dto();(bad.basis.contract as any).digest={toString:getter};expect(fixture().render(bad).dataset.state).toBe('unavailable');expect(getter).not.toHaveBeenCalled()
 const value=dto();Object.defineProperty(value.criteria,'map',{get:getter});Object.defineProperty(value.deliverables.files,Symbol.iterator,{get:getter});expect(fixture().render(value).dataset.state).toBe('available');expect(getter).not.toHaveBeenCalled()
})
it('rejects backslash traversal without treating a path as a clickable action',()=>{
 const value=dto();value.deliverables.files=['..'+String.fromCharCode(92)+'SECRET'];expect(fixture().render(value).dataset.state).toBe('unavailable')
})
it('accepts nullable legacy basis versions as missing, without printing a fabricated version',()=>{
 const value=dto();value.basis.goalRevision=null;value.basis.planRevision=null;value.basis.dataRevision=null;expect(fixture().render(value).dataset.state).toBe('available')
})
it('registers only the new display assets in the existing configuration pipeline',()=>{
 expect(configurationScripts.filter(name=>name==='task-contract-card.js')).toHaveLength(1);expect(configurationScripts.indexOf('task-contract-card.js')).toBeLessThan(configurationScripts.indexOf('operator-workspace.js'));expect(configurationStyles.filter(name=>name==='task-contract-card.css')).toHaveLength(1)
 const css=readFileSync(new URL('../src/ui/task-contract-card.css',import.meta.url),'utf8');expect(css).toMatch(/task-contract-card[^}]*font-size:14px/);expect(css).toContain('summary:focus-visible');expect(css).toContain('prefers-reduced-motion:reduce');expect(css).toContain('max-width:700px');expect(css).not.toMatch(/font-size:(?:1[0123]|[0-9])px/)
})

function extended(){return {...dto(),details:{nonGoals:['Do not deploy'],inputs:['User supplied brief'],deadline:'Friday afternoon, if possible'},lineage:{state:'current',previousState:'available',previous:{objective:'Earlier goal',criteria:[{id:'INTERNAL_OLD_CRITERION',description:'Earlier acceptance'}]}}}}
it('separates current agreement details from a stopped previous agreement without showing internal versions',()=>{
 const f=fixture(),card=f.render(extended()),body=text(card),details=all(card).filter(n=>n.tagName==='details')
 expect(body).toContain('Current agreement');expect(body).toContain('Requested deadline');expect(body).toContain('Friday afternoon, if possible');expect(body).toContain('Do not deploy');expect(body).toContain('User supplied brief')
 expect(details).toHaveLength(2);expect(text(details[0]!)).not.toContain('Earlier');expect(text(details[1]!)).toContain('Previous agreement · no longer authorized to execute');expect(text(details[1]!)).toContain('Previous acceptance criteria');expect(text(details[1]!)).not.toContain('Analyze the project');expect(body).not.toMatch(/INTERNAL|revision|version|automatic stop|hard deadline/)
 expect(details.every(d=>!Object.hasOwn(d.attributes,'open'))).toBe(true);expect(all(card).some(n=>['button','a','input','form'].includes(n.tagName))).toBe(false);expect(f.fetch).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled()
})
it('distinguishes uncaptured details from captured empty lists and hides unverifiable history',()=>{
 const f=fixture('zh'),value:any=extended();value.details={nonGoals:null,inputs:[],deadline:null};value.lineage={state:'replaced',previousState:'unavailable',previous:null};const body=text(f.render(value))
 expect(body).toContain('非目标 未记录');expect(body).toContain('输入 已记录为空');expect(body).toContain('请求截止时间 未记录');expect(body).toContain('已替代 · 不再授权执行');expect(body).toContain('此前约定不可用');expect(body).not.toContain('Earlier')
 value.lineage={state:'current',previousState:'none',previous:null};expect(text(f.render(value))).not.toContain('此前约定');expect(text(f.render(dto()))).not.toMatch(/非目标|请求截止时间|当前约定/)
})
it('keeps all new free text literal including deadline and previous content',()=>{
 const value=extended();value.details.nonGoals=['<script>non-goal</script>'];value.details.inputs=['<img src=x>'];value.details.deadline='<a href=x>deadline</a>';value.lineage.previous.objective='<svg>previous</svg>';value.lineage.previous.criteria[0]!.description='<iframe>criterion</iframe>'
 const card=fixture().render(value),body=text(card);for(const content of [...value.details.nonGoals,...value.details.inputs,value.details.deadline,value.lineage.previous.objective,value.lineage.previous.criteria[0]!.description])expect(body).toContain(content);expect(all(card).some(n=>['a','script','img','svg','iframe'].includes(n.tagName))).toBe(false)
})
for(const [name,mutate]of [
 ['details null',(v:any)=>v.details=null],['missing detail',(v:any)=>delete v.details.inputs],['long input',(v:any)=>v.details.inputs=['x'.repeat(4001)]],['too many non-goals',(v:any)=>v.details.nonGoals=Array(31).fill('x')],['sparse inputs',(v:any)=>v.details.inputs=Array(1)],['deadline type',(v:any)=>v.details.deadline=123],['deadline length',(v:any)=>v.details.deadline='x'.repeat(1001)],['unknown lineage',(v:any)=>v.lineage.state='active'],['unverified prior',(v:any)=>v.lineage.previousState='unavailable'],['missing prior',(v:any)=>v.lineage.previous=null],['invalid prior criteria',(v:any)=>v.lineage.previous.criteria=[]],['duplicate prior criteria',(v:any)=>v.lineage.previous.criteria.push({...v.lineage.previous.criteria[0]})],['long prior objective',(v:any)=>v.lineage.previous.objective='x'.repeat(16001)],
]as const)it('fails closed for malformed new agreement '+name,()=>{const value=extended();mutate(value);expect(fixture().render(value).dataset.state).toBe('unavailable')})
it('does not invoke new nested getters or caller-owned iterators',()=>{
 const getter=vi.fn(()=>{throw Error('Getter forbidden')}),value=extended();Object.defineProperty(value.details,'inputs',{get:getter});expect(fixture().render(value).dataset.state).toBe('unavailable');expect(getter).not.toHaveBeenCalled()
 const top=extended();Object.defineProperty(top,'lineage',{get:getter});expect(fixture().render(top).dataset.state).toBe('unavailable');expect(getter).not.toHaveBeenCalled()
 const safe=extended();Object.defineProperty(safe.details.inputs,Symbol.iterator,{get:getter});Object.defineProperty(safe.lineage.previous.criteria,'map',{get:getter});expect(fixture().render(safe).dataset.state).toBe('available');expect(getter).not.toHaveBeenCalled()
})

it('compares prior details and estimates inside history without mixing them with the current agreement',()=>{
 const value:any=extended();value.budget={scope:'code_project',basis:'configured_estimate',maxMinutes:60,maxUsd:10};value.lineage.previous.details={nonGoals:['Old exclusion'],inputs:['Old source'],deadline:'Old deadline'};value.lineage.previous.budget={scope:'code_project',basis:'configured_estimate',maxMinutes:30,maxUsd:5}
 const card=fixture().render(value),details=all(card).filter(n=>n.tagName==='details'),current=text(details[0]!),prior=text(details[1]!)
 for(const str of ['Old exclusion','Old source','Old deadline','Time budget: 30 minutes','Estimated cost ceiling: US$5']){expect(prior).toContain(str);expect(current).not.toContain(str)}
 expect(current).toContain('Time budget: 60 minutes');expect(prior).not.toContain('Friday afternoon');expect(text(card)).not.toContain('stopped')
 value.lineage.previous.details=null;value.lineage.previous.budget=null;const unknown=text(all(fixture('zh').render(value)).filter(n=>n.tagName==='details')[1]!);expect(unknown).toContain('非目标 未记录');expect(unknown).toContain('输入 未记录');expect(unknown).toContain('请求截止时间 未记录');expect(unknown).toContain('项目配置预算 未记录');expect(unknown).not.toContain('已停止')
})
it('validates historical details and budgets with the same safe bounds as current values',()=>{
 for(const extra of [{details:{nonGoals:Array(31).fill('x'),inputs:null,deadline:null}},{details:{nonGoals:null,inputs:null,deadline:123}},{budget:{scope:'account',basis:'configured_estimate',maxMinutes:30,maxUsd:5}}]){const value:any=extended();Object.assign(value.lineage.previous,extra);expect(fixture().render(value).dataset.state).toBe('unavailable')}
 const getter=vi.fn(()=>{throw Error('Forbidden')});const value=extended();Object.defineProperty(value.lineage.previous,'details',{get:getter});expect(fixture().render(value).dataset.state).toBe('unavailable');expect(getter).not.toHaveBeenCalled()
})
