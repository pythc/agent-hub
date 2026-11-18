import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it,vi} from 'vitest'
import {configurationScripts,configurationStyles} from '../src/ui/configuration-assets.ts'
const source=readFileSync(new URL('../src/ui/task-decisions-card.js',import.meta.url),'utf8')
class Element{children:Element[]=[];attributes:Record<string,string>={};constructor(readonly tagName:string,readonly className='',readonly textContent=''){}append(...children:Element[]){this.children.push(...children)}setAttribute(k:string,v:string){this.attributes[k]=v}set innerHTML(_v:string){throw Error('No HTML')}}
const walk=(n:Element):Element[]=>[n,...n.children.flatMap(walk)],text=(n:Element)=>walk(n).map(x=>x.textContent).join(' ')
const content=()=>({kind:'decision',text:'Consider two chart options.',recordedAt:1234,sources:[{speaker:'user',text:'You could consider a chart. Do not deploy.',recordedAt:1000}]}),dto=()=>({schema:3,readOnly:true,taskState:'active',operations:{items:[] as any[],more:false},subject:{kind:'task',id:'task'},observedAt:2000,items:[{...content(),confirmation:'not_recorded',execution:'not_recorded',historyMore:false,history:[{...content(),text:'Old recorded choice.'}],previous:{...content(),text:'Old recorded choice.'}}],more:false})
function fixture(language='en'){const forbidden=vi.fn(()=>{throw Error('No effects')}),context=createContext({Date,Object,Array,Number,Reflect,lang:language,L:(en:string,zh:string)=>language==='zh'?zh:en,el:(t:string,c='',v='')=>new Element(t,c,v),fetch:forbidden,api:forbidden,setInterval:forbidden,setTimeout:forbidden});runInContext(source,context);return{forbidden,render:(v:unknown,id='task')=>{context.value=v;context.id=id;return runInContext('taskDecisionsCard(value,id)',context)as Element|null}}}
it('shows recorded interpretations, exact quoted words and explicit predecessor in one native disclosure without approval/execution claims',()=>{
 const f=fixture('zh'),card=f.render(dto())!;expect(text(card)).toContain('助手记录');expect(text(card)).toContain('用户原话');expect(text(card)).toContain('已被替代的记录');expect(text(card)).toContain('could consider');expect(text(card)).not.toMatch(/已批准|已执行|用户尚未确认|待批准|确认通过|decision|commitment|not_recorded/)
 const details=walk(card).filter(n=>n.tagName==='details');expect(details).toHaveLength(1);expect(walk(details[0]!).filter(n=>n.tagName==='details')).toHaveLength(1);expect(walk(card).some(n=>['button','a','input','form'].includes(n.tagName))).toBe(false);expect(f.forbidden).not.toHaveBeenCalled()
})
it('labels requirements only as quotations and mentions the bounded related set only when more is true',()=>{
 const value=dto();value.items[0]!.kind='requirement';const f=fixture('zh');expect(text(f.render(value)!)).toContain('原话摘录');expect(text(f.render(value)!)).not.toContain('五条');expect(text(f.render({...value,more:true})!)).toContain('这里只显示最近五条相关记录。')
})
it('does not promise a previous version when the retained record has none',()=>{const value=dto();delete(value.items[0]as any).previous;value.items[0]!.history=[];const card=fixture('zh').render(value)!;expect(text(card)).toContain('查看原话');expect(text(card)).not.toContain('上一版')})
it('rejects unknown confirmation/execution/foreign subjects or malformed source data instead of displaying raw fields',()=>{
 const f=fixture()
 for(const value of [null,{}, {...dto(),schema:1},{...dto(),readOnly:false},{...dto(),subject:{kind:'task',id:'other'}},{...dto(),observedAt:-1},{...dto(),more:'yes'},{...dto(),items:[]},{...dto(),items:[{...dto().items[0],confirmation:'confirmed'}]},{...dto(),items:[{...dto().items[0],executed:true}]},{...dto(),items:[{...content(),confirmation:'not_recorded',sources:[{speaker:'human',text:'SECRET',recordedAt:1000}]}]},{...dto(),raw:'SECRET'}])expect(f.render(value)).toBeNull()
 expect(f.render(dto(),'other')).toBeNull()
})
it('does not evaluate nested getters, array accessors or extra source properties',()=>{
 const f=fixture(),getter=vi.fn(()=>{throw Error('SECRET')})
 for(const field of ['schema','subject','items']){const value=dto();Object.defineProperty(value,field,{get:getter});expect(f.render(value)).toBeNull()}
 const value=dto();Object.defineProperty(value.items,'0',{get:getter});expect(f.render(value)).toBeNull()
 const nested=dto();Object.defineProperty(nested.items[0]!.sources[0]!,'text',{get:getter});expect(f.render(nested)).toBeNull();expect(getter).not.toHaveBeenCalled()
})
it('registers before the drawer, keeps ordinary readable type and adds no motion or effects',()=>{
 expect(configurationScripts.indexOf('task-decisions-card.js')).toBeLessThan(configurationScripts.indexOf('operator-workspace.js'));expect(configurationStyles.filter(x=>x==='task-decisions-card.css')).toHaveLength(1)
 const css=readFileSync(new URL('../src/ui/task-decisions-card.css',import.meta.url),'utf8');expect(css).toContain('font-size: 14px');expect(css).toContain(':focus-visible');expect(css).not.toMatch(/font-size:\s*(?:1[0123]|[0-9])px|animation|transition/);expect(source).not.toMatch(/fetch\(|api\(|setInterval\(|setTimeout\(/)
})
it('renders the whole supplied history with separate unknown confirmation/execution and no authority controls',()=>{
 const value=dto();value.items[0]!.history.push({...content(),text:'Earliest suggestion only.'});value.items[0]!.historyMore=true
 const card=fixture('zh').render(value)!;expect(text(card)).toContain('Earliest suggestion only.');expect(text(card)).toContain('确认：未记录');expect(text(card)).toContain('执行：未记录');expect(text(card)).toContain('更早的历史不完整')
})
it('rejects inconsistent predecessor and history rather than mixing revisions',()=>{
 const value=dto();value.items[0]!.history[0]!.text='Conflicting body';expect(fixture().render(value)).toBeNull()
})
it('shows record categories, replacement impact, ended history and separate exact operation evidence',()=>{
 const value=dto();value.taskState='ended';value.items.push({...value.items[0]!,kind:'commitment',text:'A promise'});value.operations.items.push({kind:'workflow_status',label:'Local task',from:'Todo',to:'Done',proposedAt:1000,confirmation:'approved',confirmationAt:1100,execution:'observed_only',finishedAt:1200})
 const card=fixture('zh').render(value)!,body=text(card)
 for(const text of ['决定 · 助手记录','承诺 · 助手记录','影响：','任务已结束','确认：已批准','写入方未确认','不据此认定上面的文字记录'])expect(body).toContain(text)
 expect(walk(card).some(n=>['button','a','input','form'].includes(n.tagName))).toBe(false)
})
it('rejects effect claims without readback timestamp or approval and operation accessors',()=>{
 const value=dto(),op={kind:'workflow_status',label:'Local',from:'Todo',to:'Done',proposedAt:1,confirmation:'not_recorded',execution:'applied_readback'};value.operations.items=[op]
 expect(fixture().render(value)).toBeNull()
 const getter=vi.fn();Object.defineProperty(op,'label',{get:getter});expect(fixture().render(value)).toBeNull();expect(getter).not.toHaveBeenCalled()
})
