import {runInNewContext} from 'node:vm'
import {expect,it} from 'vitest'
import {memoryWorkbenchPage} from '../src/ui/memory-workbench.ts'

const deferred=()=>{let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const fact={id:'fact',subject:'Project',content:'Project owner is Lin',state:'active',kind:'fact',revision:1,sources:[]}
const inventory=()=>({enabled:true,policy:{},items:[fact],observations:[],topics:[],uses:[],archived:[]})
const result=(ids:string[])=>({status:'complete',mode:'verified',items:ids.map(id=>({id}))})
class Element {
  value='';textContent='';className='';hidden=false;disabled=false;dataset={};children:Element[]=[]
  onclick:any;onchange:any;onsubmit:any;listeners:Record<string,()=>void>={}
  elements=new Proxy({} as Record<string,Element>,{get:(target,key:string)=>target[key]??=new Element()})
  append(...children:Element[]){this.children.push(...children)}
  replaceChildren(...children:Element[]){this.children=children}
  addEventListener(name:string,callback:()=>void){this.listeners[name]=callback}
  setAttribute(){} focus(){}
}
async function page(){
  const elements=new Map<string,Element>(),get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!}
  get('context').value='scope-a';get('state').value='all';get('kind').value='all'
  const network={search:async(_query:string):Promise<any>=>result(['fact']),inspect:async():Promise<any>=>inventory()}
  runInNewContext(memoryWorkbenchPage.match(/<script>([\s\S]*?)<\/script>/)![1]!,{
    document:{querySelector:(selector:string)=>get(selector.slice(1)),createElement:()=>new Element()},
    crypto:{randomUUID:()=> 'operation'},confirm:()=>false,
    fetch:async(path:string,options:any)=>{
      const body=options.body?JSON.parse(options.body):undefined
      const value=path==='/router-management/catalog'?{contexts:[{id:'scope-a',label:'A'},{id:'scope-b',label:'B'}]}:
        body.command.action==='search'?await network.search(body.command.query):await network.inspect()
      return {ok:true,json:async()=>value}
    }
  })
  await new Promise(resolve=>setImmediate(resolve))
  expect(get('status').textContent).toBe('记忆已刷新。')
  return {get,network,input(id:string,value:string){get(id).value=value;get(id).listeners.input!()},
    search(){return get('semantic-search').onclick()},cards(){return get('items').children.filter(e=>Object.hasOwn(e.dataset,'memoryId'))}}
}

it.each(['query','state','kind'])('discards a pending search when %s changes',async(field)=>{
  const p=await page(),pending=deferred();p.network.search=()=>pending.promise
  p.input('query','Project');const work=p.search()
  p.input(field,field==='query'?'unrelated':field==='state'?'candidate':'preference')
  pending.resolve(result(['fact']));await work
  expect(p.cards()).toHaveLength(0)
  expect(p.get('status').textContent).toBe('已更新筛选条件。')
})
it('keeps the newest search when responses finish out of order',async()=>{
  const p=await page(),old=deferred(),latest=deferred();let calls=0
  p.network.search=()=>++calls===1?old.promise:latest.promise
  p.input('query','Project');const first=p.search(),second=p.search()
  latest.resolve(result([]));await second;old.resolve(result(['fact']));await first
  expect(p.cards()).toHaveLength(0)
  expect(p.get('status').textContent).toBe('已显示通过原文证据验证的相关记忆。')
})
it('does not show stale failures after a newer successful search',async()=>{
  const p=await page(),old=deferred();let calls=0
  p.network.search=()=>++calls===1?old.promise:Promise.resolve(result(['fact']))
  p.input('query','Project');const first=p.search();await p.search()
  old.reject(Error('old failure'));await first
  expect(p.cards()).toHaveLength(1)
  expect(p.get('status').className).toBe('')
  expect(p.get('status').textContent).toBe('已显示通过原文证据验证的相关记忆。')
})
it('invalidates searches launched while a newer inventory is still loading',async()=>{
  const p=await page(),fresh=deferred(),search=deferred();p.network.inspect=()=>fresh.promise
  const refresh=p.get('refresh').onclick();p.input('query','Project');p.network.search=()=>search.promise;const work=p.search()
  fresh.resolve(inventory());await refresh;search.resolve(result([]));await work
  expect(p.cards()).toHaveLength(1)
  expect(p.get('status').textContent).toBe('记忆已刷新。')
})
it('allows inventory refresh to finish after filter edits',async()=>{
  const p=await page(),fresh=deferred();p.network.inspect=()=>fresh.promise
  const refresh=p.get('refresh').onclick();p.input('query','unrelated')
  fresh.resolve({...inventory(),items:[{...fact,content:'unrelated new fact'}]});await refresh
  expect(p.cards()).toHaveLength(1)
  expect(p.get('status').textContent).toBe('记忆已刷新。')
})
it('does not overwrite the new context with an old search error',async()=>{
  const p=await page(),old=deferred();p.network.search=()=>old.promise
  p.input('query','Project');const work=p.search();p.get('context').value='scope-b';p.get('context').onchange()
  await new Promise(resolve=>setImmediate(resolve))
  old.reject(Error('old context'));await work
  expect(p.get('status').textContent).toBe('记忆已刷新。')
})
