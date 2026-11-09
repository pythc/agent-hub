import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {isRepositorySource} from './repository-source.ts'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type { Runtime } from './runtime.ts'
import type { Run } from './store.ts'
const exec=promisify(execFile)

/** Explicit operator delivery, fenced while the configured repository is updated. */
export async function deliverDraft(runtime:Runtime,id:string,sourceId:string,title:string,body:string,workerAssignment?:string){
  const ticket=runtime.store.tickets.get(id),run=runtime.store.get<Run>('run',id),source=runtime.sources.get(sourceId)
  if(!ticket||!run||!isRepositorySource(source)||ticket.ended||(workerAssignment?run.assignmentId!==workerAssignment||!['running','background'].includes(run.phase):run.phase!=='idle'))throw Error('Work is not ready for draft delivery')
  if(ticket.mandate.actor.source!==sourceId)throw Error('Delivery source must match the work mandate')
  const gitEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_TRACE:'0',GIT_TRACE_CURL:'0'}
  const git=async(...args:string[])=>(await exec('git',['-c','core.hooksPath=/dev/null','-c','http.version=HTTP/1.1','-c','http.lowSpeedLimit=1024','-c','http.lowSpeedTime=20',...args],{cwd:run.cwd,encoding:'utf8',timeout:60000,env:gitEnv})).stdout.trim()
  const origin=await git('remote','get-url','origin'),pushUrls=(await git('remote','get-url','--push','--all','origin')).split('\n')
  if(!source.code.remotes.includes(origin))throw Error('Worktree remote does not match the configured source')
  if(!pushUrls.length||pushUrls.some(url=>!source.code.remotes.includes(url)))throw Error('Push destination does not match the configured source')
  const branch=await git('branch','--show-current')
  if(!/^superagent\/[a-z0-9-]+$/.test(branch))throw Error('Delivery requires an isolated superagent branch')
  const key=id+':'+branch
  const saved=runtime.store.get<any>('pr-delivery',key)
  if(saved&&['creating','uncertain'].includes(saved.phase))throw Error('Previous PR creation outcome requires reconciliation before publication')
  if(saved?.url&&!(await git('status','--porcelain'))&&await git('rev-parse','HEAD')===saved.sha)return saved
  const previousPhase=run.phase
  runtime.store.put('run',id,{...run,phase:'delivering'})
  try{
    const assertLive=()=>{const live=runtime.store.tickets.get(id);if(!runtime.canWrite()||!source.config.enabled||!source.config.capabilities.replies||!live||live.ended||!runtime.validWork({ticketId:id,assignmentId:run.assignmentId,cwd:run.cwd,sandbox:'workspace-write',depth:0})||workerAssignment&&live.assignments.at(-1)?.id!==workerAssignment)throw Error('Publication assignment ended')}
    assertLive()
    await runtime.merger.beforePush(id,sourceId,branch)
    if(await git('status','--porcelain')){
      await git('add','--all','--','.')
      const stats=await git('diff','--cached','--numstat')
      const lines=stats.split('\n').reduce((sum,line)=>sum+line.split('\t').slice(0,2).reduce((n,v)=>n+(v==='-'?10000:Number(v)),0),0)
      if(lines>runtime.config.delivery.maxDraftLines)throw Error('Draft delivery exceeds configured changed-line limit')
      await git('-c','user.name='+runtime.config.delivery.commitName,'-c','user.email='+runtime.config.delivery.commitEmail,'-c','commit.gpgsign=false','commit','-m',title)
    }
    assertLive()
    const sha=await git('rev-parse','HEAD')
    runtime.store.put('pr-delivery',key,{phase:'pushing',id,branch,sha})
    assertLive()
    if(saved?.phase!=='pushed'||saved.sha!==sha){
      const credential=source.code.pushCredential
      if(credential.kind==='helper'){
        const quoted=[credential.command,...credential.args].map(s=>"'"+s.replaceAll("'","'\\''")+"'").join(' ')
        await git('-c','credential.helper=','-c','credential.helper=!'+quoted,'push','origin','HEAD:refs/heads/'+branch)
      }else{
        if(pushUrls.some(url=>!url.startsWith('https://')))throw Error('Token publication requires HTTPS remotes')
        const token=process.env[credential.variable];if(!token)throw Error('Repository publication credential is unavailable')
        const scratch=mkdtempSync(join(tmpdir(),'agenthub-git-auth-')),askpass=join(scratch,'askpass')
        try{
          writeFileSync(askpass,'#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" "$AGENTHUB_GIT_USERNAME";; *) printf "%s\\n" "$AGENTHUB_GIT_PASSWORD";; esac\n',{mode:0o700})
          await exec('git',['-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','http.version=HTTP/1.1','push','origin','HEAD:refs/heads/'+branch],{cwd:run.cwd,encoding:'utf8',timeout:60000,env:{...gitEnv,GIT_ASKPASS:askpass,AGENTHUB_GIT_USERNAME:credential.username,AGENTHUB_GIT_PASSWORD:token}})
        }catch{throw Error('Repository push did not confirm success; reconcile the remote head before retrying')}
        finally{rmSync(scratch,{recursive:true,force:true})}
      }
    }
    runtime.store.put('pr-delivery',key,{phase:'pushed',id,branch,sha})
    if(runtime.store.tickets.get(id)?.ended)throw Error('Work stopped during push. Reconcile the remote branch before proceeding.')
    runtime.store.put('pr-delivery',key,{phase:'creating',id,branch,sha})
    let pull:any
    try{pull=await source.draft(branch,title,body,()=>{assertLive();return true})}
    catch(error){runtime.store.put('pr-delivery',key,{phase:'uncertain',id,branch,sha});throw error}
    if(!Number.isSafeInteger(pull?.number)||pull.number<1||!source.validThread?.(source.code.threadPrefix+pull.number)||typeof pull.html_url!=='string'){runtime.store.put('pr-delivery',key,{phase:'uncertain',id,branch,sha});throw Error('Published PR identity is unconfirmed')}
    const result={ticketId:id,sourceId,repository:source.code.id,branch,url:pull.html_url,number:pull.number,sha,draft:typeof pull.draft==='boolean'?pull.draft:undefined,confirmedAt:Date.now(),phase:'draft'}
    runtime.store.put('pr-delivery',key,result)
    runtime.engine.bindThread(id,{source:sourceId,id:source.code.threadPrefix+pull.number},true)
    return result
  }finally{
    const current=runtime.store.get<Run>('run',id)
    if(current?.phase==='delivering')runtime.store.put('run',id,{...current,phase:previousPhase})
  }
}
