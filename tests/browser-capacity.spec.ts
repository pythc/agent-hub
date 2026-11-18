import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {BrowserDriver,DriverSession} from '../src/browser-driver.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function gate(){let release!:()=>void;return {promise:new Promise<void>(r=>release=r),release:()=>release()}}
const tick=()=>new Promise(r=>setImmediate(r))
class Driver implements BrowserDriver{
 calls=0;opens=0;closes=0;inputs=0;openGate?:ReturnType<typeof gate>;closeGate?:ReturnType<typeof gate>;inputGate?:ReturnType<typeof gate>;failOpen=false;failInput=false
 async version(){return 'fixture'}
 async run(_s:DriverSession,args:string[]){this.calls++;if(args[0]==='open'){this.opens++;await this.openGate?.promise;if(this.failOpen)throw Error('open failed')}return args[0]==='tab'?{tabs:[]}:{snapshot:''}}
 async evaluate(){return {}} async state(){return {cookies:[],origins:[]}} async load(){} async frames(){return ()=>{}}
 async close(){this.closes++;await this.closeGate?.promise}
 async input(){this.inputs++;await this.inputGate?.promise;if(this.failInput)throw Error('input failed')}
}
function fixture(){const root=mkdtempSync(join(tmpdir(),'browser-capacity-'));roots.push(root);const driver=new Driver(),config=configSchema.parse({stateDir:join(root,'state'),browser:{enabled:true,maxSessions:1},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}],work:{sandboxDriver:'disabled'}});const host=new Runtime(config,{browserDriver:driver,model:{async run(){throw Error('No provider')}}});hosts.push(host);let seq=0;return {host,driver,open(){const profile=host.browser.saveProfile('alice',{name:'Profile '+(++seq),allowedWorkers:[]});return host.browser.openPersonal('alice',profile.id,'client')}}}
it('reserves concurrent initialization, reports full without inventing capacity waiters, and reads without effects',async()=>{
 const f=fixture();f.driver.openGate=gate();const pending=f.open();await tick();expect(f.host.browser.browserCapacity()).toMatchObject({limit:1,used:0,reserved:1,queuedActions:0,activeActions:0,waitReason:null,admission:'at_capacity'})
 const before=JSON.stringify(f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()),calls=f.driver.calls;for(let i=0;i<5;i++)f.host.browser.browserCapacity();expect(f.driver.calls).toBe(calls);expect(JSON.stringify(f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all())).toBe(before)
 await expect(f.open()).rejects.toMatchObject({code:'browser_capacity'});expect(f.host.browser.browserCapacity().queuedActions).toBe(0);f.driver.openGate.release();await pending;expect(f.host.browser.browserCapacity()).toMatchObject({used:1,reserved:0,activeActions:0})
})
it('releases a failed initialization only after driver cleanup',async()=>{
 const f=fixture();f.driver.failOpen=true;f.driver.closeGate=gate();const pending=f.open(),failed=expect(pending).rejects.toThrow('open failed');await tick();expect(f.host.browser.browserCapacity()).toMatchObject({used:0,reserved:1,admission:'at_capacity'});f.driver.closeGate.release();await failed;expect(f.host.browser.browserCapacity()).toMatchObject({used:0,reserved:0,admission:'available'})
})
it('keeps a ready closing session counted until close finishes',async()=>{
 const f=fixture(),session=await f.open();f.driver.closeGate=gate();const closing=f.host.browser.closeOwned('alice',session.id,'client',session.epoch);await tick();expect(f.host.browser.browserCapacity()).toMatchObject({used:1,reserved:0,admission:'at_capacity',waitReason:null});f.driver.closeGate.release();await closing;expect(f.host.browser.browserCapacity().used).toBe(0)
})
it('observes the existing serial action queue and returns counters after exceptions',async()=>{
 const f=fixture(),session=await f.open();f.driver.inputGate=gate();f.driver.failInput=true
 const first=f.host.browser.input('alice',session.id,'client',session.epoch,{type:'text',text:'one'}),rejected=expect(first).rejects.toThrow('input failed');await tick()
 const second=f.host.browser.input('alice',session.id,'client',session.epoch,{type:'text',text:'two'}),secondRejected=expect(second).rejects.toThrow('input failed');await tick();expect(f.driver.inputs).toBe(1);expect(f.host.browser.browserCapacity()).toMatchObject({activeActions:1,queuedActions:1,waitReason:'session_serialization'})
 f.driver.inputGate.release();await Promise.all([rejected,secondRejected]);expect(f.driver.inputs).toBe(2);expect(f.host.browser.browserCapacity()).toMatchObject({activeActions:0,queuedActions:0,waitReason:null})
})
it('reports disabled configuration without allocating sessions',()=>{const f=fixture();f.host.config.browser.enabled=false;expect(f.host.browser.browserCapacity()).toMatchObject({enabled:false,used:0,reserved:0,admission:'disabled'})})
