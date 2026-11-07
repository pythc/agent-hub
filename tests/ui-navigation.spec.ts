import {readFileSync} from 'node:fs'
import {createContext,runInContext} from 'node:vm'
import {expect,it} from 'vitest'

function inventoryBrowser(){
  const context=createContext({URL,URLSearchParams,structuredClone,Map,Set,
    document:{getElementById:()=>null,addEventListener(){}},localStorage:{getItem:()=>null},window:{addEventListener(){}},
    location:{hash:'',pathname:'/configure',href:'http://localhost/configure'},history:{replaceState(){}},
    workspaceContext:{epoch:0},adopted:[] as any[]})
  for(const file of ['controls.js','entry-session.js'])runInContext(readFileSync(new URL('../src/ui/'+file,import.meta.url),'utf8'),context)
  runInContext(`S.base={revision:1};function adopt(value){adopted.push(value)};`,context)
  return {context,get:(code:string)=>runInContext(code,context)}
}
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise(r=>resolve=r);return {promise,resolve}}

it('does not let a slow older inventory replace a newer refresh',async()=>{
  const b=inventoryBrowser(),old=deferred(),latest=deferred();let calls=0
  b.context.api=()=>++calls===1?old.promise:latest.promise
  const first=b.get('readEntryInventory()'),second=b.get('readEntryInventory()')
  latest.resolve({revision:1,entries:[{id:'new'}]});await second
  old.resolve({revision:1,entries:[{id:'old'}]});await first
  expect(b.get('entryState.data.entries')).toEqual([{id:'new'}])
  expect(b.get('entryState.inventoryLoading')).toBe(false)
})
it('discards an inventory from a workspace that is no longer selected',async()=>{
  const b=inventoryBrowser(),pending=deferred();b.context.api=()=>pending.promise
  const result=b.get('readEntryInventory()');b.context.workspaceContext.epoch++
  pending.resolve({revision:1,entries:[{id:'private-old-workspace'}]});await result
  expect(b.get('entryState.data')).toBeNull()
  expect(b.get('entryState.inventoryError')).toBe(false)
})
it('does not adopt an old settings snapshot after inventory refresh was superseded',async()=>{
  const b=inventoryBrowser(),snap=deferred();let calls=0
  b.context.api=async()=>({revision:++calls===1?2:1,entries:[{id:calls===1?'old':'new'}]})
  b.context.snapshot=()=>snap.promise
  const old=b.get('readEntryInventory()');await Promise.resolve()
  await b.get('readEntryInventory()');snap.resolve({current:{revision:2}});await old
  expect(b.context.adopted).toEqual([])
  expect(b.get('entryState.data.entries')).toEqual([{id:'new'}])
})
it('retains a valid inventory on failed refresh and allows explicit retry',async()=>{
  const b=inventoryBrowser();b.context.api=async()=>({revision:1,entries:[{id:'saved'}]})
  await b.get('readEntryInventory()')
  b.context.api=async()=>{throw Error('offline')}
  await expect(b.get('readEntryInventory()')).rejects.toThrow('offline')
  expect(b.get('entryState.data.entries')).toEqual([{id:'saved'}])
  expect(b.get('entryState.inventoryError')).toBe(true)
  expect(b.get('entryState.inventoryLoading')).toBe(false)
  b.context.api=async()=>({revision:1,entries:[{id:'recovered'}]})
  await b.get('readEntryInventory()')
  expect(b.get('entryState.inventoryError')).toBe(false)
  expect(b.get('entryState.data.entries')).toEqual([{id:'recovered'}])
})
