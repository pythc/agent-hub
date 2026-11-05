import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {afterEach,it,expect} from 'vitest'
import {preparePersonalSetup,rememberPersonalPort} from '../src/personal-setup.ts'
const roots:string[]=[],close:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const stop of close.splice(0))await stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function directory(){const root=mkdtempSync(join(tmpdir(),'agenthub-personal-'));roots.push(root);return root}
it('creates a private, read-only setup without hand-written config and preserves subsequent user edits',()=>{
 const root=directory(),first=preparePersonalSetup(root)
 expect(first.created).toBe(true);expect(first.config.port).toBe(0);expect(first.config.sources[0]).toMatchObject({kind:'local',sandbox:'read-only',allowedActors:['operator']});expect(statSync(first.file).mode&0o777).toBe(0o600)
 rememberPersonalPort(first.file,4321);expect(JSON.parse(readFileSync(first.file,'utf8')).port).toBe(4321)
 const edited={...first.config,port:4567,model:'user-model'};writeFileSync(first.file,JSON.stringify(edited));const before=readFileSync(first.file,'utf8')
 expect(preparePersonalSetup(root).created).toBe(false);rememberPersonalPort(first.file,9999);expect(readFileSync(first.file,'utf8')).toBe(before)
})
it('refuses symlinked setup locations and configuration files',()=>{
 const root=directory(),target=directory();symlinkSync(target,join(root,'linked'))
 expect(()=>preparePersonalSetup(join(root,'linked'))).toThrow('symbolic link')
 const file=join(root,'config.json');writeFileSync(join(root,'other.json'),'{}');symlinkSync(join(root,'other.json'),file);expect(()=>preparePersonalSetup(root)).toThrow('regular file')
})
it('starts from one setup command, remembers its chosen port, and reuses the running host on the next command',async()=>{
 const root=directory(),args=['--import',join(process.cwd(),'node_modules/tsx/dist/loader.mjs'),join(process.cwd(),'src/cli.ts'),'setup',root],child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']})
 const ended=new Promise<void>(r=>child.once('close',()=>r()));close.push(async()=>{child.kill('SIGTERM');await ended})
 const boot=await new Promise<any>((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Setup did not start')),10000);child.once('error',reject);child.stdout.on('data',chunk=>{output+=chunk;const line=output.split('\n').find(l=>l.startsWith('{'));if(line){clearTimeout(timer);try{resolve(JSON.parse(line))}catch(error){reject(error)}}});child.stderr.resume()})
 expect(boot.url).toContain('/configure#pair=');const origin=new URL(boot.url).origin
 expect((await fetch(origin+'/health')).ok).toBe(true);expect(JSON.parse(readFileSync(join(root,'config.json'),'utf8')).port).toBe(Number(new URL(origin).port))
 const next=await promisify(execFile)(process.execPath,args,{timeout:10000,encoding:'utf8'}),reused=JSON.parse(next.stdout)
 expect(reused.reused).toBe(true);expect(new URL(reused.url).origin).toBe(origin)
},15000)
