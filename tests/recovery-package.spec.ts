import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync,symlinkSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createRecoveryPackage,verifyRecoveryPackage} from '../src/recovery-package.ts'
import {recoveryPackageSchema} from '../src/recovery-package-contract.ts'
import {readRecoveryPackageFile} from '../src/recovery-package-cli.ts'
const roots:string[]=[]
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function sample(){return createRecoveryPackage({id:'SECRET_TASK',state:'uncertain',unknownEffects:true,observed:'SECRET_OBSERVATION',revision:42,status:{effects:{state:'unknown'},delivery:{state:'uncertain'}},recovery:{session:'unavailable',nextSafeAction:'inspect_state',checkpoints:[{stage:'tool',origin:'transition',cursor:124}],ticketId:'SECRET_TASK'}} as any)}
it('exports only explicit fields with fresh aliases and conservatively reconciles unknown effects',()=>{
 const value=sample(),text=JSON.stringify(value)
 expect(text).not.toMatch(/SECRET_|cursor|124|revision|observed/)
 expect(sample().payload.taskAlias).not.toBe(value.payload.taskAlias)
 expect(verifyRecoveryPackage(text)).toMatchObject({valid:true,authenticity:'not_verified',unknownEffects:true,nextSafeAction:'reconcile_effects',replayAllowed:false,restorationSupported:false})
 const reordered={sha256:value.sha256,payload:Object.fromEntries(Object.entries(value.payload).reverse())}
 expect(verifyRecoveryPackage(JSON.stringify(reordered))).toEqual(verifyRecoveryPackage(text))
})
it('rejects altered, oversized, malformed and unknown fields without echoing input',()=>{
 const value=sample()
 for(const text of ['SECRET_BAD_JSON',' '.repeat(16385),JSON.stringify({...value,secret:'SECRET_BAD_FIELD'}),JSON.stringify({...value,sha256:'0'.repeat(64)}),JSON.stringify({...value,payload:{...value.payload,schema:2}})])expect(()=>verifyRecoveryPackage(text)).toThrow(/^Invalid recovery diagnostic package$/)
 for(const payload of [{...value.payload,replayAllowed:true},{...value.payload,nextSafeAction:'review_result'},{...value.payload,checkpoints:[...value.payload.checkpoints,...value.payload.checkpoints]},{...value.payload,unknownEffects:false,nextSafeAction:'inspect_original_session'}])expect(recoveryPackageSchema.safeParse({...value,payload}).success).toBe(false)
})
it('reads only bounded regular files and rejects symlinks, invalid UTF8, directories and FIFO',async()=>{
 const root=mkdtempSync(join(tmpdir(),'recovery-package-'));roots.push(root)
 const file=join(root,'valid.json');writeFileSync(file,JSON.stringify(sample()))
 expect(readRecoveryPackageFile(file).valid).toBe(true)
 const link=join(root,'link');symlinkSync(file,link)
 const bad=join(root,'bad');writeFileSync(bad,Buffer.from([0xff,0xfe]))
 const large=join(root,'large');writeFileSync(large,' '.repeat(16385))
 for(const path of [root,link,bad,large,join(root,'missing')])expect(()=>readRecoveryPackageFile(path)).toThrow(/^Invalid or unreadable recovery diagnostic package$/)
 if(process.platform!=='win32'){const fifo=join(root,'fifo');await promisify(execFile)('mkfifo',[fifo]);expect(()=>readRecoveryPackageFile(fifo)).toThrow('Invalid or unreadable')}
})
it('runs the standalone verifier with a broken environment-file setting and creates no state',async()=>{
 const root=mkdtempSync(join(tmpdir(),'offline-recovery-'));roots.push(root)
 const file=join(root,'diagnostic.json');writeFileSync(file,JSON.stringify(sample()))
 const script=resolve('src/recovery-package-cli.ts'),tsx=resolve('node_modules/tsx/dist/esm/index.mjs')
 const {stdout}=await promisify(execFile)(process.execPath,['--import',tsx,script,file],{cwd:root,env:{...process.env,AGENTHUB_ENV_FILE:join(root,'DO_NOT_READ_ENV'),HOME:root},timeout:20000})
 expect(JSON.parse(stdout)).toMatchObject({valid:true,restorationSupported:false,authenticity:'not_verified'})
 expect(readdirSync(root)).toEqual(['diagnostic.json'])
})
