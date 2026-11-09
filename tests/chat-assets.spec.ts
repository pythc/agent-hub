import {expect,it} from 'vitest'
import {mkdtempSync,rmSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'

it('serves bundled application badges with browser-decodable MIME types',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chat-brand-assets-'))
 const runtime=new Runtime(configSchema.parse({stateDir:root,port:0,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}]}),{model:{async run(){throw Error('No model invocation in asset checks')}}})
 const host=await serve(runtime)
 try{
  const files=readdirSync(new URL('../dist/chat/',import.meta.url))
  for(const [extension,type] of [['svg','image/svg+xml'],['ico','image/x-icon'],['png','image/png']]){
   const name=files.find(name=>name.endsWith('.'+extension));expect(name).toBeDefined()
   const response=await fetch(host.url+'/chat-assets/'+name)
   expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(type)
   expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
   const head=await fetch(host.url+'/chat-assets/'+name,{method:'HEAD'})
   expect(head.headers.get('content-type')).toBe(type);expect(await head.text()).toBe('')
  }
 }finally{host.server.closeAllConnections();await new Promise<void>(r=>host.server.close(()=>r()));await host.closeRuntime();rmSync(root,{recursive:true,force:true})}
})
