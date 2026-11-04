import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Runtime } from './runtime.ts'
import { incomingSchema } from './sources.ts'
import { deliverDraft } from './delivery.ts'
import { dashboard } from './web.ts'
import {configSchema} from './config.ts'
import {randomUUID} from 'node:crypto'
import {readSchema} from './resources.ts'
import {compose,promptStatus} from './prompts.ts'
import {configurationSnapshot} from './configuration.ts'
import {SettingsError} from './settings.ts'
import {configurationPage} from './ui/configuration.ts'

export async function serve(runtime: Runtime,options:{configurationPreview?:boolean}={}) {
  const tokenPath = join(runtime.config.stateDir, 'access-token')
  let token: string
  try { token = readFileSync(tokenPath, 'utf8').trim() }
  catch { token = randomBytes(32).toString('hex'); writeFileSync(tokenPath, token, { mode: 0o600, flag: 'wx' }) }
  const server = createServer((request, response) => { void handle(request, response).catch(error => {
    if(error instanceof SettingsError){send(response,error.status,{error:error.message,code:error.code,...(error.code==='settings_conflict'?{currentRevision:runtime.settings.current().revision}:{})});return}
    if(error instanceof z.ZodError){send(response,400,{error:'Configuration or request validation failed',code:'validation_error',issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))});return}
    send(response,400,{error:String(error).slice(0,500),code:'request_failed'})
  }) })
  function authorized(request: IncomingMessage, secret = token): boolean {
    const actual = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from('Bearer ' + secret)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  async function body(request: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 256_000) throw new Error('Request exceeds 256KB')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url!, 'http://localhost').pathname
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.method === 'GET' && ['/', '/configure', '/configure/'].includes(path)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" })
      res.end(path==='/'?dashboard:configurationPage)
      return
    }
    if (req.method === 'GET' && path === '/health') { send(res, 200, { ok: true, version: '0.8.0' }); return }
    if(options.configurationPreview&&req.method==='POST'&&!['/settings','/prompt-preview','/setup-check'].includes(path)){
      if(!authorized(req)){send(res,401,{error:'Access token required',code:'token_required'});return}
      send(res,403,{error:'This configuration preview cannot execute work or external actions',code:'preview_restricted'});return
    }
    if(req.method==='POST'&&path==='/worker'){
      const owner=runtime.workerTools.authenticate(req.headers.authorization)
      const input=z.object({name:z.string(),args:z.unknown()}).strict().parse(await body(req))
      send(res,200,await runtime.workerTools.call(owner,input.name,input.args));return
    }
    // Connector identities may only submit to their configured source.
    if (req.method === 'POST' && path.startsWith('/events/')) {
      const id = decodeURIComponent(path.slice('/events/'.length))
      const source = runtime.sources.get(id)?.config
      const secret = source?.tokenEnv && process.env[source.tokenEnv]
      if (!source || source.kind === 'local' || !secret || !authorized(req, secret)) { send(res, 401, { error: 'Unauthorized connector' }); return }
      const input = z.object({ actor: z.string(), human: z.boolean(), event: incomingSchema }).strict().parse(await body(req))
      send(res, 202, runtime.receive(id, input.actor, input.event, input.human))
      return
    }
    if (!authorized(req)) { send(res, 401, { error: 'Access token required',code:'token_required' }); return }
    if(req.method==='GET'&&path==='/configuration'){send(res,200,{...configurationSnapshot(runtime),preview:options.configurationPreview===true});return}
    if(req.method==='POST'&&path==='/merge-authorize'){
      const input=z.object({id:z.string(),source:z.string(),number:z.number().int().positive(),head:z.string().regex(/^[a-f0-9]{40}$/)}).strict().parse(await body(req))
      send(res,200,await runtime.merger.authorize(input.id,input.source,input.number,input.head));return
    }
    if(req.method==='POST'&&path==='/merge-revoke'){
      const input=z.object({source:z.string(),number:z.number().int().positive()}).strict().parse(await body(req))
      runtime.merger.revoke(input.source,input.number);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/setup-check'){send(res,200,await runtime.setup.check());return}
    if(req.method==='POST'&&path==='/members-preview'){const input=z.object({source:z.string(),scope:z.string().optional()}).strict().parse(await body(req));send(res,200,await runtime.setup.previewMembers(input.source,input.scope));return}
    if(req.method==='POST'&&path==='/members-apply'){const input=z.object({id:z.string()}).strict().parse(await body(req));send(res,200,runtime.setup.applyMembers(input.id));return}
    if(req.method==='POST'&&path==='/read'){const {ticketId,...input}=readSchema.extend({ticketId:z.string().optional()}).parse(await body(req));send(res,200,await runtime.resources.read(input,ticketId?{ticketId}:{}));return}
    if(req.method==='POST'&&path==='/prompt-preview'){
      const input=z.object({role:z.enum(['router','worker']),prompts:configSchema.shape.prompts.optional()}).strict().parse(await body(req)),id=randomUUID()
      const text=compose({...runtime.config,...(input.prompts?{prompts:input.prompts}:{})},input.role,{preview:true,cwd:'<task directory>',mandate:'<immutable task mandate>'},'preview')
      const result={id,role:input.role,text,revision:runtime.settings.current().revision,at:Date.now()};runtime.store.put('prompt-preview',id,result);send(res,200,{...result,resource:'prompt-preview/'+id});return
    }
    if(req.method==='GET'&&path==='/prompts'){send(res,200,{parts:promptStatus(runtime.config),history:runtime.store.list('prompt-use')});return}
    if(req.method==='POST'&&path==='/source-replay'){
      const input=z.object({source:z.string(),scope:z.string().optional(),since:z.string().datetime()}).strict().parse(await body(req))
      const source=runtime.sources.get(input.source)
      if(!source)throw Error('Unknown source')
      if(source.config.kind==='feishu'&&!source.config.feishu?.chats.includes(input.scope??''))throw Error('Chat not configured')
      const key=source.config.kind==='feishu'?input.source+':'+input.scope:input.source
      runtime.store.put('source-cursor',key,{since:source.config.kind==='feishu'?String(Math.floor(Date.parse(input.since)/1000)):input.since})
      send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/retry-delivery'){
      const input=z.object({id:z.string()}).strict().parse(await body(req))
      runtime.store.retryDelivery(input.id);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/deliver-pr'){
      const input=z.object({id:z.string(),source:z.string(),title:z.string().min(1),body:z.string()}).strict().parse(await body(req))
      send(res,200,await deliverDraft(runtime,input.id,input.source,input.title,input.body));return
    }
    if(req.method==='POST'&&path==='/domain'){
      const input=z.object({action:z.enum(['reevaluate','attach','bind','context','unrelated','unsubscribe','note','dismiss']),id:z.string(),source:z.string().optional(),thread:z.string().optional(),triggerId:z.string().optional(),text:z.string().optional()}).strict().parse(await body(req))
      if(input.action==='reevaluate')runtime.engine.reevaluate(input.id)
      else if(input.action==='dismiss')runtime.engine.dismiss(input.id)
      else if(input.action==='unsubscribe')runtime.engine.unsubscribe(input.id)
      else if(input.action==='note')runtime.engine.note(input.id,input.text??'')
      else if(input.action==='attach'){if(!input.triggerId)throw Error('triggerId required');runtime.engine.attach(input.id,input.triggerId)}
      else {
        if(!input.source||!input.thread)throw Error('source and thread required')
        const source=runtime.sources.get(input.source);if(!source)throw Error('Unknown source')
        if(source.validThread&&!source.validThread(input.thread))throw Error('Thread is outside configured source')
        if(input.action==='bind')runtime.engine.bindThread(input.id,{source:input.source,id:input.thread},true)
        else if(input.action==='context')runtime.engine.followForContext(input.id,{source:input.source,id:input.thread})
        else runtime.engine.markUnrelated(input.id,input.source+':'+input.thread,input.text??'Unrelated')
      }
      send(res,200,{ok:true});return
    }
    if(req.method==='GET'&&path==='/settings'){send(res,200,{current:runtime.settings.current(),history:runtime.settings.history()});return}
    if(req.method==='POST'&&path==='/settings'){
      const input=z.object({revision:z.number().int(),patch:z.unknown()}).strict().parse(await body(req))
      send(res,200,runtime.updateSettings(input.revision,input.patch));return
    }
    if(req.method==='POST'&&path==='/approval'){
      const input=z.object({id:z.string(),answer:z.unknown()}).strict().parse(await body(req))
      runtime.approvals.answer(input.id,input.answer);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/steer'){
      const input=z.object({id:z.string(),text:z.string().min(1).max(10000)}).strict().parse(await body(req))
      await runtime.steer(input.id,input.text);send(res,200,{accepted:true});return
    }
    if(req.method==='POST'&&path==='/watchdog'){
      const input=z.object({at:z.number(),uncertain:z.array(z.string()),stalled:z.array(z.string()).default([])}).strict().parse(await body(req))
      runtime.store.put('health','watchdog',input);send(res,200,{ok:true});return
    }
    if(req.method==='POST'&&path==='/context'){
      const input=z.object({source:z.string(),thread:z.string()}).strict().parse(await body(req))
      if(input.source==='$agent'){send(res,200,await runtime.resources.read({resource:input.thread}));return}
      const source=runtime.sources.get(input.source)
      if(!source?.context)throw Error('Source does not provide context reading')
      send(res,200,await source.context(input.thread));return
    }
    if (req.method === 'GET' && path === '/status') { send(res, 200, runtime.status()); return }
    if (req.method === 'POST' && path === '/send') {
      const input = z.object({ source: z.string(), event: incomingSchema }).strict().parse(await body(req))
      const source = runtime.sources.get(input.source)
      if (!source || source.config.kind !== 'local') throw new Error('Use the authenticated connector for external events')
      send(res, 202, runtime.receive(input.source, source.config.allowedActors[0]!, input.event))
      return
    }
    if (req.method === 'POST' && path === '/action') {
      const input = z.object({ action: z.enum(['pause', 'resume', 'stop', 'retry', 'takeover', 'return']), id: z.string().optional() }).strict().parse(await body(req))
      if (input.action === 'pause' || input.action === 'resume') runtime.pause(input.action === 'pause')
      else {
        if (!input.id) throw new Error('Select the work to control')
        if (input.action === 'stop') await runtime.stop(input.id)
        else if (input.action === 'retry') runtime.retry(input.id)
        else if (input.action === 'return') {
          runtime.returnControl(input.id)
          send(res,200,{ok:true,threadId:runtime.store.get<any>('run',input.id)?.threadId,next:'Release the desktop writer before retry. In Codex desktop, archive this worker chat with the official set_thread_archived tool and leave it archived, preserving history. The host unarchives it for each activation and archives it afterward. In CLI, exit codex resume. Then agent_retry resumes the same native thread.'});return
        }
        else { send(res, 200, await runtime.takeover(input.id)); return }
      }
      send(res, 200, { ok: true })
      return
    }
    send(res, 404, { error: 'Unknown endpoint' })
  }
  server.requestTimeout = 30_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(runtime.config.port, '127.0.0.1', resolve) })
  runtime.start()
  const address = server.address() as { port: number }
  runtime.endpoint='http://127.0.0.1:'+address.port
  return { server, url: 'http://127.0.0.1:' + address.port, tokenPath }
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}
