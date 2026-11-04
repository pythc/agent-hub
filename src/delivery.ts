import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GithubSource } from './connectors/github.ts'
import type { Runtime } from './runtime.ts'
import type { Run } from './store.ts'
const exec=promisify(execFile)

/** Explicit operator delivery, fenced while the configured repository is updated. */
export async function deliverDraft(runtime:Runtime,id:string,sourceId:string,title:string,body:string,workerAssignment?:string){
  const ticket=runtime.store.tickets.get(id),run=runtime.store.get<Run>('run',id),source=runtime.sources.get(sourceId)
  if(!ticket||!run||!(source instanceof GithubSource)||ticket.ended||(workerAssignment?run.assignmentId!==workerAssignment||!['running','background'].includes(run.phase):run.phase!=='idle'))throw Error('Work is not ready for draft delivery')
  if(ticket.mandate.actor.source!==sourceId)throw Error('Delivery source must match the work mandate')
  const git=async(...args:string[])=>(await exec('git',['-c','http.version=HTTP/1.1','-c','http.lowSpeedLimit=1024','-c','http.lowSpeedTime=20',...args],{cwd:run.cwd,encoding:'utf8',timeout:60000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trim()
  const origin=await git('remote','get-url','origin'),pushUrls=(await git('remote','get-url','--push','--all','origin')).split('\n'),expected=source.config.repository!
  if(!['https://github.com/'+expected+'.git','https://github.com/'+expected,'git@github.com:'+expected+'.git'].includes(origin))throw Error('Worktree remote does not match the configured source')
  if(!pushUrls.length||pushUrls.some(url=>!['https://github.com/'+expected+'.git','https://github.com/'+expected,'git@github.com:'+expected+'.git'].includes(url)))throw Error('Push destination does not match the configured source')
  const branch=await git('branch','--show-current')
  if(!/^superagent\/[a-z0-9-]+$/.test(branch))throw Error('Delivery requires an isolated superagent branch')
  const key=id+':'+branch
  const saved=runtime.store.get<any>('pr-delivery',key)
  if(saved?.url&&!(await git('status','--porcelain'))&&await git('rev-parse','HEAD')===saved.sha)return saved
  const previousPhase=run.phase
  runtime.store.put('run',id,{...run,phase:'delivering'})
  try{
    const assertLive=()=>{const live=runtime.store.tickets.get(id);if(!runtime.canWrite()||!live||live.ended||workerAssignment&&live.assignments.at(-1)?.id!==workerAssignment)throw Error('Publication assignment ended')}
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
    const gh=source.config.github?.gh??'gh'
    const quotedGh="'"+gh.replaceAll("'","'\\''")+"'"
    assertLive()
    if(saved?.phase!=='pushed'||saved.sha!==sha)await git('-c','credential.helper=','-c','credential.helper=!'+quotedGh+' auth git-credential','push','origin','HEAD:refs/heads/'+branch)
    runtime.store.put('pr-delivery',key,{phase:'pushed',id,branch,sha})
    if(runtime.store.tickets.get(id)?.ended)throw Error('Work stopped during push. Reconcile the remote branch before proceeding.')
    const pull=await source.draft(branch,title,body)
    const result={url:pull.html_url,number:pull.number,sha,phase:'draft'}
    runtime.store.put('pr-delivery',key,result)
    runtime.engine.bindThread(id,{source:sourceId,id:expected+'#'+pull.number},true)
    return result
  }finally{
    const current=runtime.store.get<Run>('run',id)
    if(current?.phase==='delivering')runtime.store.put('run',id,{...current,phase:previousPhase})
  }
}
