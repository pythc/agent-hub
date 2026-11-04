import {existsSync,realpathSync} from 'node:fs'
import {resolve,delimiter,relative,sep} from 'node:path'
export type SandboxDriver='codex'|'seatbelt'|'bubblewrap'|'disabled'
export interface CommandSpec {sandboxDriver?:SandboxDriver;codex:string;cwd:string;sandbox:'read-only'|'workspace-write';privateState?:string;network:boolean;gitDirectory?:string;attachments?:string[];command:string;scratch:string}
const canon=(p:string)=>existsSync(p)?realpathSync(p):resolve(p)
const q=(p:string)=>JSON.stringify(canon(p))
const nested=(parent:string,p:string)=>{const r=relative(canon(parent),canon(p));return !!r&&r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep)}
export function sandboxCommand(s:CommandSpec,platform=process.platform):{command:string;args:string[];profile?:string}{
 const driver=s.sandboxDriver??'codex'
 if(driver==='disabled')throw Error('Managed shell is disabled; configure an installed sandbox driver')
 const shell=platform==='win32'?['cmd.exe','/d','/s','/c',s.command]:['/bin/sh','-c',s.command]
 if(driver==='codex'){
  const profile='superagent-managed',entries:Record<string,string>={':root':'deny',':minimal':'read','/opt/homebrew':'read',':tmpdir':'write',':slash_tmp':'write',[s.cwd]:s.sandbox==='read-only'?'read':'write'}
  if(s.privateState)entries[s.privateState]='deny';if(s.gitDirectory)entries[s.gitDirectory]='read';for(const p of s.attachments??[])entries[p]='read'
  return {command:s.codex,args:['sandbox','-P',profile,'-c','permissions.'+profile+'.extends='+JSON.stringify(s.sandbox==='read-only'?':read-only':':workspace'),'-c','permissions.'+profile+'.network.enabled='+String(s.network),'-c','permissions.'+profile+'.filesystem={'+Object.entries(entries).map(([p,a])=>JSON.stringify(p)+'='+JSON.stringify(a)).join(',')+'}','-C',s.cwd,'--',...shell]}
 }
 if(driver==='seatbelt'){
  if(platform!=='darwin')throw Error('Seatbelt sandbox requires macOS')
  const reads=['/System','/usr','/bin','/sbin','/opt/homebrew','/private/etc','/dev/null','/dev/random','/dev/urandom',s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[])].filter(existsSync)
  const rules=['(version 1)','(deny default)','(import "system.sb")','(allow process-exec process-fork)','(allow signal (target self))','(allow sysctl-read)','(allow file-read-metadata)','(allow file-read* '+reads.map(p=>'(subpath '+q(p)+')').join(' ')+')','(allow file-write* (literal "/dev/null") (subpath '+q(s.scratch)+')'+(s.sandbox==='workspace-write'?' (subpath '+q(s.cwd)+')':'')+')']
  if(s.network)rules.push('(allow network*)')
  if(s.privateState){
   const exceptions=[s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[])].filter(p=>nested(s.privateState!,p)).map(p=>'(require-not (subpath '+q(p)+'))')
   exceptions.push(...(s.attachments??[]).filter(p=>nested(s.privateState!,p)).map(p=>'(require-not (literal '+q(p)+'))'))
   const hidden='(subpath '+q(s.privateState)+')'
   rules.push('(deny file-read* file-write* '+(exceptions.length?'(require-all '+hidden+' '+exceptions.join(' ')+')':hidden)+')')
  }
  return {command:'/usr/bin/sandbox-exec',args:['-p',rules.join('\n'),...shell],profile:rules.join('\n')}
 }
 if(platform!=='linux')throw Error('Bubblewrap sandbox requires Linux')
 const args=['--die-with-parent','--new-session','--unshare-all',...(s.network?['--share-net']:[]),'--proc','/proc','--dev','/dev','--tmpfs','/tmp']
 // Construct a minimal mount namespace rather than exposing the user's home.
 const mounts=new Set<string>()
 for(const p of ['/usr','/bin','/sbin','/lib','/lib64','/etc','/opt',s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[])])if(existsSync(p))for(const target of new Set([resolve(p),canon(p)]))if(!mounts.has(target)){mounts.add(target);args.push(p===s.cwd&&s.sandbox==='workspace-write'||p===s.scratch?'--bind':'--ro-bind',canon(p),target)}
 if(s.privateState){
  for(const p of new Set([resolve(s.privateState),canon(s.privateState)]))args.push('--tmpfs',p)
  // Workspaces and assigned attachments may live under stateDir. Re-expose only
  // those mounts after masking the parent, never the database or sibling jobs.
  for(const p of [s.cwd,s.scratch,...(s.gitDirectory?[s.gitDirectory]:[]),...(s.attachments??[])])if(existsSync(p)&&nested(s.privateState,p))for(const target of new Set([resolve(p),canon(p)]))args.push(p===s.cwd&&s.sandbox==='workspace-write'||p===s.scratch?'--bind':'--ro-bind',canon(p),target)
 }
 args.push('--chdir',canon(s.cwd),'--',...shell)
 const command=(process.env.PATH??'').split(delimiter).map(p=>resolve(p,'bwrap')).find(existsSync)??'bwrap'
 return {command,args}
}
