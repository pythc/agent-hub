import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
import { serve } from '../src/server.ts'
import type { Model } from '../src/codex.ts'

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })
it('serves authenticated APIs and connects a real stdio MCP client to the same host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-interface-'))
  const config = configSchema.parse({ stateDir: join(root,'state'), port: 0, prompts: {shared:'Saved shared instructions',router:'Saved Router instructions',worker:'Saved Worker instructions'}, sources: [{ id:'local',kind:'local',allowedActors:['operator'],cwd:root }] })
  const model: Model = { async run(r) {
    const routing = r.ephemeral
    r.onThread?.('test-native');r.onTurn?.('turn-test')
    return {threadId:'test-native',turnId:'turn-test',text:JSON.stringify(routing
      ? { action:'accept',title:'Analyze',scope:'Read documents',reason:'request',rules:[] }
      : { state:'ready',summary:'Compared',reply:'Done',question:null,handbacks:[] }) }
  } }
  const runtime = new Runtime(config,{model})
  const host = await serve(runtime)
  const client = new Client({name:'test-client',version:'1.0.0'})
  const transport = new StdioClientTransport({
    command:process.execPath,
    args:['--import',join(process.cwd(),'node_modules/tsx/dist/loader.mjs'),join(process.cwd(),'src/cli.ts'),'mcp',host.url,host.tokenPath],
    stderr:'pipe',
  })
  close = async () => {
    await client.close()
    await new Promise<void>(resolve => host.server.close(()=>resolve()))
    await runtime.close()
    rmSync(root,{recursive:true,force:true})
  }
  expect((await fetch(host.url+'/status')).status).toBe(401)
  await client.connect(transport)
  const tools = await client.listTools()
  expect(tools.tools.map(t=>t.name)).toEqual(expect.arrayContaining(['agent_send','agent_status','agent_stop','agent_takeover','agent_return']))
  // Exercise the SDK's Zod-to-JSON-Schema bridge and its real argument parser.
  const read = tools.tools.find(t=>t.name==='agent_read')!.inputSchema
  expect(read.required).toEqual(['resource'])
  expect(read.properties).toMatchObject({ offset: { default: 0 }, limit: { default: 4000 }, pageSize: { default: 20 } })
  const workers = tools.tools.find(t=>t.name==='worker_manage')!.inputSchema
  expect(workers.required).toEqual(['action'])
  expect(workers.properties).toMatchObject({ patch: { type: 'object' }, profile: { type: 'object' } })
  const save = tools.tools.find(t=>t.name==='agent_settings_save')!.inputSchema
  expect(save.required).toEqual(['revision','patch'])
  expect(save.properties).toMatchObject({ patch: { type: 'object', additionalProperties: {} } })
  const catalog = await client.callTool({name:'agent_read',arguments:{resource:'catalog'}})
  expect(catalog.isError).toBe(false)
  expect(JSON.parse((catalog.content as {text:string}[])[0]!.text).resources).toBeInstanceOf(Array)
  const before = structuredClone(runtime.settings.current())
  const saved = await client.callTool({name:'agent_settings_save',arguments:{revision:before.revision,patch:{effort:'low'}}})
  expect(saved.isError).toBe(false)
  expect(runtime.settings.current().config).toEqual({...before.config,effort:'low'})
  const after = structuredClone(runtime.settings.current())
  for (const role of ['router','worker']) {
    const preview = await client.callTool({name:'agent_prompt_preview',arguments:{role}})
    expect(preview.isError).toBe(false)
    const text = JSON.parse((preview.content as {text:string}[])[0]!.text).text
    expect(text).toContain('Saved shared instructions')
    expect(text).toContain(role==='router'?'Saved Router instructions':'Saved Worker instructions')
  }
  for (const patch of [[], {typo:true}]) {
    const rejected = await client.callTool({name:'agent_settings_save',arguments:{revision:after.revision,patch}})
    expect(rejected.isError).toBe(true)
    expect(runtime.settings.current()).toEqual(after)
  }
  const sent = await client.callTool({name:'agent_send',arguments:{source:'local',discussion:'doc-review',requestId:'request-1',text:'Compare the supplied documents'}})
  expect(sent.isError).toBe(false)
  for(let i=0;i<100 && !runtime.store.deliveries().some(d=>d.kind==='reply');i++)await new Promise(resolve=>setTimeout(resolve,20))
  const status=await client.callTool({name:'agent_status',arguments:{}})
  const payload=JSON.parse((status.content as {text:string}[])[0]!.text)
  expect(payload.tickets).toHaveLength(1)
  expect(payload.tickets[0].ended.outcome).toBe('completed')
  const auth={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim(),'content-type':'application/json'}
  for (const [prompts, marker] of [[{shared:'Unsaved draft'},'Unsaved draft'],[{},undefined]] as const) {
    const preview = await fetch(host.url+'/prompt-preview',{method:'POST',headers:auth,body:JSON.stringify({role:'worker',prompts})})
    expect(preview.status).toBe(200)
    const {text} = await preview.json() as {text:string}
    expect(text).not.toContain('Saved shared instructions')
    if(marker)expect(text).toContain(marker)
    expect(runtime.settings.current()).toEqual(after)
  }
  const spoof=await fetch(host.url+'/send',{method:'POST',headers:auth,body:JSON.stringify({source:'local',actor:'admin',event:{id:'bad',thread:'x',text:'bad'}})})
  expect(spoof.status).toBe(400)
})
