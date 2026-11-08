import {it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../src/store.ts'
import {records,recordPages} from '../plugins/records.ts'
it('keeps legacy paged reads source-filtered and stable for unsorted duplicate IDs',async()=>{
 const root=mkdtempSync(join(tmpdir(),'record-fallback-')),store=new Store(join(root,'state.sqlite')),ctx={store}
 try{
  for(let i=0;i<100;i++)store.put('trigger','a'+i,{source:'other'})
  store.put('trigger','z',{source:'feishu'});store.put('trigger','b',{source:'feishu'})
  expect((await records(ctx,'trigger',{sourceId:'feishu',limit:1})).items.map(r=>r.id)).toEqual(['b'])
  const result=[];for await(const page of recordPages(ctx,'trigger',{ids:['z','b','b'],limit:1}))result.push(...page)
  expect(result).toHaveLength(2)
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
})
