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
  const config = configSchema.parse({ stateDir: join(root,'state'), port: 0, sources: [{ id:'local',kind:'local',allowedActors:['operator'],cwd:root }] })
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
  const sent = await client.callTool({name:'agent_send',arguments:{source:'local',discussion:'doc-review',requestId:'request-1',text:'Compare the supplied documents'}})
  expect(sent.isError).toBe(false)
  for(let i=0;i<100 && !runtime.store.deliveries().some(d=>d.kind==='reply');i++)await new Promise(resolve=>setTimeout(resolve,20))
  const status=await client.callTool({name:'agent_status',arguments:{}})
  const payload=JSON.parse((status.content as {text:string}[])[0]!.text)
  expect(payload.tickets).toHaveLength(1)
  expect(payload.tickets[0].ended.outcome).toBe('completed')
  const auth={authorization:'Bearer '+readFileSync(host.tokenPath,'utf8').trim(),'content-type':'application/json'}
  const spoof=await fetch(host.url+'/send',{method:'POST',headers:auth,body:JSON.stringify({source:'local',actor:'admin',event:{id:'bad',thread:'x',text:'bad'}})})
  expect(spoof.status).toBe(400)
})
