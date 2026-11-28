import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InputQueue, routerProcessing } from '../src/terminal/input-queue.ts'
import type { Snapshot } from '../src/terminal/client.ts'
const roots:string[]=[]
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})))
const view=(busy=false,contextVersion=1)=>({conversation:{contextVersion},run:busy?{state:'running'}:null,reply:null,tasks:[{state:'running'}]}) as unknown as Snapshot
function fixture(send:ConstructorParameters<typeof InputQueue>[2]){
 const root=mkdtempSync(join(tmpdir(),'roppo-queue-'));roots.push(root)
 const path=join(root,'queue.json');return {path,q:new InputQueue(path,()=>{},send)}
}
it('holds queued drafts out of Router input, preserves edited order and sends one at a time',async()=>{
 const sent:string[]=[],f=fixture(async item=>{sent.push(item.text)})
 f.q.add('first',[],1);f.q.add('second',['/file'],1);f.q.add('third',[],1)
 await f.q.drain(view(true));expect(sent).toEqual([])
 const second=f.q.items[1]!.id
 f.q.move(second,-1);f.q.hold(second);f.q.edit(second,'updated')
 await f.q.drain(view());expect(sent).toEqual([])
 f.q.release(second);await f.q.drain(view());expect(sent).toEqual(['updated'])
 f.q.remove(f.q.items[1]!.id);await f.q.drain(view());expect(sent).toEqual(['updated','first'])
 expect(f.q.items).toEqual([])
})
it('restores pending drafts paused and retains identity and uploads after an uncertain send',async()=>{
 let fail=true
 const f=fixture(async item=>{f.q.uploaded(item.id,['uploaded']);if(fail)throw Error('offline')})
 f.q.add('keep me',['/file'],1);const id=f.q.items[0]!.id
 await expect(f.q.drain(view())).rejects.toThrow('offline')
 expect(f.q.paused).toBe(true)
 const restored=new InputQueue(f.path,()=>{},async item=>{expect(item.id).toBe(id);expect(item.attachments).toEqual(['uploaded'])})
 expect(restored.paused).toBe(true);await restored.drain(view());expect(restored.items).toHaveLength(1)
 restored.toggle();await restored.drain(view());expect(restored.items).toEqual([])
})
it('promotes a selected draft without dispatching its neighbors and blocks stale context',async()=>{
 const sent:string[]=[],f=fixture(async(item,mode)=>{sent.push(mode+':'+item.text)})
 f.q.add('first',[],1);f.q.add('steer me',[],1)
 await f.q.deliver(f.q.items[1]!.id,'steer');expect(sent).toEqual(['steer:steer me'])
 await f.q.drain(view(false,2));expect(f.q.paused).toBe(true);expect(sent).toHaveLength(1)
})
it('does not dispatch the next draft while an earlier send is in flight',async()=>{
 let release!:()=>void
 const wait=new Promise<void>(resolve=>{release=resolve}),sent:string[]=[]
 const f=fixture(async item=>{sent.push(item.text);await wait})
 f.q.add('first',[],1);f.q.add('second',[],1)
 const sending=f.q.drain(view());await f.q.drain(view());expect(sent).toEqual(['first'])
 release();await sending;expect(f.q.items.map(item=>item.text)).toEqual(['second'])
 expect(routerProcessing({...view(),reply:{state:'running'}} as Snapshot)).toBe(true)
})
