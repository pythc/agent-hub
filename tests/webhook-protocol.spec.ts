import {it,expect,vi,afterEach} from 'vitest'
import {EventEmitter} from 'node:events'
const mocks=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}))
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}))
vi.mock('node:https',()=>({request:mocks.request}))
import {postWebhook,WebhookError} from '../src/webhook-protocol.ts'
afterEach(()=>vi.resetAllMocks())

it('rejects a public hostname resolving to any private address before connecting',async()=>{
 mocks.lookup.mockResolvedValue([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])
 await expect(postWebhook('https://receiver.example/callback','{}',{},[],new AbortController().signal)).rejects.toThrow('callback_dns_forbidden')
 expect(mocks.request).not.toHaveBeenCalled()
})
it('pins the checked DNS address to the connection and does not follow a redirect',async()=>{
 mocks.lookup.mockResolvedValueOnce([{address:'8.8.8.8',family:4}]).mockResolvedValue([{address:'127.0.0.1',family:4}])
 mocks.request.mockImplementation((url,options,receive)=>{
  expect(url.hostname).toBe('receiver.example');expect(options.agent).toBe(false)
  options.lookup(url.hostname,{all:true},(error:any,addresses:any)=>{expect(error).toBeNull();expect(addresses).toEqual([{address:'8.8.8.8',family:4}])})
  options.lookup(url.hostname,{all:false},(error:any,address:any,family:any)=>{expect(error).toBeNull();expect(address).toBe('8.8.8.8');expect(family).toBe(4)})
  const req=Object.assign(new EventEmitter(),{setTimeout:vi.fn(),end:()=>receive({statusCode:302,headers:{location:'http://127.0.0.1'},destroy:vi.fn()})});return req
 })
 expect((await postWebhook('https://receiver.example/callback','{}',{},[],new AbortController().signal)).status).toBe(302)
 expect(mocks.lookup).toHaveBeenCalledTimes(1);expect(mocks.request).toHaveBeenCalledTimes(1)
})
it('rechecks revoked authority after asynchronous DNS resolution, before any request',async()=>{
 let finish!:(addresses:any)=>void,authorized=true
 mocks.lookup.mockReturnValue(new Promise(r=>{finish=r}))
 const pending=postWebhook('https://receiver.example/callback','{}',{},[],new AbortController().signal,()=>{if(!authorized)throw new WebhookError(403,'revoked')})
 authorized=false;finish([{address:'8.8.8.8',family:4}]);await expect(pending).rejects.toThrow('revoked');expect(mocks.request).not.toHaveBeenCalled()
})
it('can stop a stalled DNS attempt without waiting for the resolver',async()=>{
 mocks.lookup.mockReturnValue(new Promise(()=>{}));const controller=new AbortController()
 const pending=postWebhook('https://receiver.example/callback','{}',{},[],controller.signal);controller.abort(Error('Host closed'))
 await expect(pending).rejects.toThrow('Host closed');expect(mocks.request).not.toHaveBeenCalled()
})
