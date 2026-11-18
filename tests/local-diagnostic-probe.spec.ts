import {expect,it,vi} from 'vitest'
import {existsSync} from 'node:fs'
const runner=vi.hoisted(()=>({calls:[] as {command:string;args:string[];options:any}[],error:null as null|Error}))
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),execFile:(command:string,args:string[],options:any,callback:Function)=>{
 runner.calls.push({command,args,options});callback(runner.error,{stdout:'agenthub-sandbox-probe',stderr:''})
}}))
import {probeSandbox} from '../src/sandbox.ts'
it.skipIf(process.platform!=='linux')('uses a fixed network-disabled read-only probe, finite forced timeout, and cleans only its temporary directory',async()=>{
 runner.calls=[];runner.error=null
 await probeSandbox('bubblewrap','never-invoke-model')
 const call=runner.calls[0]!
 expect(call.command).toMatch(/bwrap$/);expect(call.args).toContain('--unshare-all');expect(call.args).not.toContain('--share-net')
 expect(call.args.slice(-3)).toEqual(['/bin/sh','-c','printf agenthub-sandbox-probe'])
 expect(call.options).toMatchObject({timeout:10000,killSignal:'SIGKILL',maxBuffer:64000})
 expect(call.options.env.HOME).not.toBe(process.env.HOME);expect(call.options.env).not.toHaveProperty('HTTP_PROXY')
 expect(existsSync(call.options.cwd)).toBe(false)
})
it.skipIf(process.platform!=='linux').each(['ENOENT','ETIMEDOUT'])('cleans failed %s probes without falling back',async code=>{
 runner.calls=[];runner.error=Object.assign(Error('private diagnostic'),{code})
 await expect(probeSandbox('bubblewrap','never-invoke-model')).rejects.toThrow('Sandbox process probe failed')
 expect(runner.calls).toHaveLength(1);expect(existsSync(runner.calls[0]!.options.cwd)).toBe(false)
})
