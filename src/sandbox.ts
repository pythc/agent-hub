import {existsSync,realpathSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {resolve,delimiter,relative,sep,join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile,spawn,spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {hostPrivateFiles} from './private-files.ts'
export type SandboxDriver='codex'|'seatbelt'|'bubblewrap'|'disabled'
export interface CommandSpec {sandboxDriver?:SandboxDriver;codex:string;cwd:string;sandbox:'read-only'|'workspace-write';privateState?:string;privatePaths?:string[];network:boolean;gitDirectory?:string;attachments?:string[];writablePaths?:string[];command:string;scratch:string}
const canon=(p:string)=>existsSync(p)?realpathSync(p):resolve(p)
const q=(p:string)=>JSON.stringify(canon(p))
const nested=(parent:string,p:string)=>{const r=relative(canon(parent),canon(p));return !!r&&r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep)}
export function sandboxCommand(s:CommandSpec,platform=process.platform):{command:string;args:string[];profile?:string;developerBin?:string}{
 const driver=s.sandboxDriver??'codex'
 if(driver==='disabled')throw Error('Managed shell is disabled; configure an installed sandbox driver')
 const shell=platform==='win32'?['cmd.exe','/d','/s','/c',s.command]:['/bin/sh','-c',s.command]
 let developerDir:string|undefined
 if(platform==='darwin'&&(driver==='seatbelt'||driver==='codex')){
  // Apple's /usr/bin tools load libraries from the system-selected CLT or Xcode installation.
  const selection=spawnSync('/usr/bin/xcode-select',['--print-path'],{encoding:'utf8',env:{},timeout:2000})
  if(selection.status===0)developerDir=selection.stdout.trim()
 }
 const developerBin=developerDir&&join(developerDir,'usr','bin')
 if(driver==='codex'){
  const profile='superagent-managed',entries:Record<string,string>={':root':'deny',':minimal':'read','/opt/homebrew':'read',':tmpdir':'write',':slash_tmp':'write',[s.cwd]:s.sandbox==='read-only'?'read':'write'}
  if(developerDir)entries[developerDir]='read'
  if(s.privateState)entries[s.privateState]='deny';if(s.gitDirectory)entries[s.gitDirectory]='read';for(const p of s.attachments??[])entries[p]='read';for(const p of s.writablePaths??[])entries[p]='write'
  for(const p of s.privatePaths??[])entries[p]='deny'
  return {command:s.codex,args:['sandbox','-P',profile,'-c','permissions.'+profile+'.extends='+JSON.stringify(s.sandbox==='read-only'?':read-only':':workspace'),'-c','permissions.'+profile+'.network.enabled='+String(s.network),'-c','permissions.'+profile+'.filesystem={'+Object.entries(entries).map(([p,a])=>JSON.stringify(p)+'='+JSON.stringify(a)).join(',')+'}','-C',s.cwd,'--',...shell],developerBin}
 }
 if(driver==='seatbelt'){
  if(platform!=='darwin')throw Error('Seatbelt sandbox requires macOS')
  const reads=['/System','/usr','/bin','/sbin','/opt/homebrew','/private/etc','/dev/null','/dev/random','/dev/urandom',...(developerDir?[developerDir]:[]),s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[]),...(s.writablePaths??[])].filter(existsSync)
  const rules=['(version 1)','(deny default)','(import "system.sb")','(allow process-exec process-fork)','(allow signal (target self) (target children))','(allow sysctl-read)','(allow file-read-metadata)','(allow file-read* '+reads.map(p=>'(subpath '+q(p)+')').join(' ')+')','(allow file-write* (literal "/dev/null") (subpath '+q(s.scratch)+')'+(s.sandbox==='workspace-write'?' (subpath '+q(s.cwd)+')':'')+(s.writablePaths??[]).map(p=>' (subpath '+q(p)+')').join('')+')']
  if(s.network){
   rules.push('(allow network*)')
   // TLS certificate evaluation and DNS require these platform services even
   // when socket access is allowed. Do not grant arbitrary Mach lookup.
   rules.push('(allow mach-lookup '+['com.apple.SecurityServer','com.apple.networkd','com.apple.ocspd','com.apple.trustd.agent','com.apple.TrustEvaluationAgent','com.apple.SystemConfiguration.DNSConfiguration','com.apple.SystemConfiguration.configd'].map(name=>'(global-name '+JSON.stringify(name)+')').join(' ')+')')
  }
  if(s.privateState){
   const exceptions=[s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.writablePaths??[])].filter(p=>nested(s.privateState!,p)).map(p=>'(require-not (subpath '+q(p)+'))')
   exceptions.push(...(s.attachments??[]).filter(p=>nested(s.privateState!,p)).map(p=>'(require-not (literal '+q(p)+'))'))
   const hidden='(subpath '+q(s.privateState)+')'
   rules.push('(deny file-read* file-write* '+(exceptions.length?'(require-all '+hidden+' '+exceptions.join(' ')+')':hidden)+')')
  }
  for(const p of s.privatePaths??[])rules.push('(deny file-read* file-write* (literal '+q(p)+'))')
  return {command:'/usr/bin/sandbox-exec',args:['-p',rules.join('\n'),...shell],profile:rules.join('\n'),developerBin}
 }
 if(platform!=='linux')throw Error('Bubblewrap sandbox requires Linux')
 const args=['--die-with-parent','--new-session','--unshare-all',...(s.network?['--share-net']:[]),'--proc','/proc','--dev','/dev','--tmpfs','/tmp']
 // Construct a minimal mount namespace rather than exposing the user's home.
 const mounts=new Set<string>()
 for(const p of ['/usr','/bin','/sbin','/lib','/lib64','/etc','/opt',s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[]),...(s.writablePaths??[])])if(existsSync(p))for(const target of new Set([resolve(p),canon(p)]))if(!mounts.has(target)){mounts.add(target);args.push(p===s.cwd&&s.sandbox==='workspace-write'||p===s.scratch||s.writablePaths?.includes(p)?'--bind':'--ro-bind',canon(p),target)}
 if(s.privateState){
  for(const p of new Set([resolve(s.privateState),canon(s.privateState)]))args.push('--tmpfs',p)
  // Workspaces and assigned attachments may live under stateDir. Re-expose only
  // those mounts after masking the parent, never the database or sibling jobs.
  for(const p of [s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[]),...(s.writablePaths??[])])if(existsSync(p)&&nested(s.privateState,p))for(const target of new Set([resolve(p),canon(p)]))args.push(p===s.cwd&&s.sandbox==='workspace-write'||p===s.scratch||s.writablePaths?.includes(p)?'--bind':'--ro-bind',canon(p),target)
 }
 // Apply last so a workspace/attachment mount cannot reveal host credentials.
 // bwrap refuses a symlink mount target; masking the resolved target also
 // protects reads through every symlink alias without changing the host link.
 for(const p of new Set((s.privatePaths??[]).filter(existsSync).map(canon)))args.push('--ro-bind','/dev/null',p)
 args.push('--chdir',canon(s.cwd),'--',...shell)
 const command=(process.env.PATH??'').split(delimiter).map(p=>resolve(p,'bwrap')).find(existsSync)??'bwrap'
 return {command,args}
}
export function sandboxEnvironment(scratch:string,developerBin?:string){
 const env=Object.fromEntries(['PATH','USER','LOGNAME','LANG','LC_ALL','SYSTEMROOT','SystemRoot'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]!]))
 Object.assign(env,{HOME:scratch,TMPDIR:scratch,TMP:scratch,TEMP:scratch})
 // Apple's system shim writes outside the job's temp directory. Keep higher-priority tools first.
 if(developerBin&&env.PATH){
  const paths=env.PATH.split(delimiter),systemBin=paths.indexOf('/usr/bin')
  if(systemBin>=0){paths.splice(systemBin,0,developerBin);env.PATH=paths.join(delimiter)}
 }
 return env
}
export function startSandboxRunner(specPath:string){
 const runner=fileURLToPath(new URL('./work-runner.ts',import.meta.url))
 const loader=fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url))
 return spawn(process.execPath,['--import',loader,runner,specPath],{detached:process.platform!=='win32',stdio:'ignore',shell:false})
}
/** Check actual namespace/process startup, rather than just finding bwrap on PATH. */
export async function probeSandbox(driver:SandboxDriver,codex:string){
 if(driver==='disabled')return {driver,commandsEnabled:false,verified:false}
 const root=mkdtempSync(join(tmpdir(),'agenthub-sandbox-probe-')),cwd=join(root,'files'),scratch=join(root,'tmp')
 mkdirSync(cwd);mkdirSync(scratch)
 try{
  const launch=sandboxCommand({sandboxDriver:driver,codex,cwd,scratch,privatePaths:hostPrivateFiles(),sandbox:'read-only',network:false,command:process.platform==='win32'?'echo agenthub-sandbox-probe':'printf agenthub-sandbox-probe'})
  const env=Object.fromEntries(['PATH','USER','LOGNAME','LANG','LC_ALL','SYSTEMROOT','SystemRoot'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]!]))
  Object.assign(env,{HOME:scratch,TMPDIR:scratch,TMP:scratch,TEMP:scratch})
  const result=await promisify(execFile)(launch.command,launch.args,{cwd,env,timeout:10000,maxBuffer:64000,encoding:'utf8'})
  if(result.stdout.trim()!=='agenthub-sandbox-probe')throw Error('Unexpected sandbox probe output')
  return {driver,commandsEnabled:true,verified:true,platform:process.platform}
 }catch(error:any){
  const stderr=String(error.stderr??'')
  if(driver==='bubblewrap'&&/namespace|mount proc|Operation not permitted/.test(stderr))throw Error('Bubblewrap startup denied by namespace/proc policy. Check the Linux host or outer container policy; see docs/LINUX.md. No unrestricted fallback was used.')
  throw Error('Sandbox process probe failed ('+driver+'): '+String(error.code??error.message).slice(0,160))
 }finally{rmSync(root,{recursive:true,force:true})}
}
