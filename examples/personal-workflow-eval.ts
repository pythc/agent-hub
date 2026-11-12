/** Matched native-model acceptance of one local XLSX task, with one or two Workers. */
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as XLSX from 'xlsx'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'

const output=process.argv[2]?resolve(process.argv[2]):mkdtempSync(join(tmpdir(),'roppo-xlsx-eval-'))
mkdirSync(output,{recursive:true})
const model=process.env.ROPPO_EVAL_MODEL??'gpt-6.1-terra'
const rows=Array.from({length:900},(_,i)=>['run-'+(i+1),i%7,'CI job '+String(i).padEnd(180,'x')])
const total=rows.reduce((n,r)=>n+Number(r[1]),0)
const book=XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Job','Failures','Description'],...rows]),'Runs')
const input=XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:false}) as Buffer
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const objective='Audit the CI export input.xlsx. Preserve all Runs data, write its failures total in Runs!B902 in audited.xlsx, and report the verified total in summary.json as {"failures":number}. Check both deliverables. Work locally.'
const workbook='Read input.xlsx and write audited.xlsx, preserving the 900 original data rows and adding the sum of B2:B901 in B902. '
const summary='Read the resulting audited.xlsx and independently check the row values and total. Write summary.json. '
const tools='The same xlsx.mjs library is available in the workspace. In Node ESM use fs.readFileSync and XLSX.read(bytes,{type:"buffer"}), and fs.writeFileSync with XLSX.write. Use the managed shell for file access.'
async function measure(count:1|2){
  const root=join(output,count+'-worker'),cwd=join(root,'workspace')
  if(existsSync(root))throw Error('Choose a fresh output directory')
  mkdirSync(cwd,{recursive:true});writeFileSync(join(cwd,'input.xlsx'),input)
  copyFileSync(fileURLToPath(new URL('../node_modules/xlsx/xlsx.mjs',import.meta.url)),join(cwd,'xlsx.mjs'))
  const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',model,effort:'medium',turnTimeoutMs:240000,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',network:false},
    execution:{router:{mode:'host',model,effort:'medium',prompt:'The operator already started this managed goal. The host schedules its nodes. Return an empty reply during work. When the host verifies completion, report the verified number of failures to the original requester once. Do not start or assign additional tasks.'},management:{enabled:true,maxWorkers:2},workers:['one','two'].map(id=>({id,model,backend:'codex',effort:'medium'}))},
    sources:[{id:'local',kind:'local',cwd,workspace:{mode:'source'},sandbox:'workspace-write',allowedActors:['owner']}]})
  const host=new Runtime(config),start=Date.now()
  try{
    host.scopes.command({action:'scope.put',operationId:'eval',expectedRevision:0,scope:{id:'eval',name:'Eval',tenantId:'eval',managers:[JSON.stringify(['local','owner'])],workerIds:['one','two'],backendIds:['codex'],sourceIds:['local']}})
    host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'eval',sourceId:'local',nativeId:'audit',accountNamespace:'local',history:'group'})
    host.receive('local','owner',{id:'request',scope:'audit',thread:'audit',addressed:true,text:objective})
    const trigger=host.store.triggers.get('local:request')!,context=host.scopes.context(trigger,'local:audit')!
    const goal=host.goals.command({action:'start',operationId:'run',expectedRevision:0,authorizationQuote:objective,title:'CI audit',objective,maxRepairs:1,maxReplans:0,
      criteria:[{id:'book',description:'Check the actual failures cell and source range',check:{kind:'xlsx_cell_equals',path:'audited.xlsx',sheet:'Runs',cell:'B902',expected:total,sumRange:'B2:B901'}},{id:'summary',description:'Verify the JSON total',check:{kind:'json_equals',path:'summary.json',pointer:'/failures',expected:total}}],
      nodes:count===1?[{id:'audit',workerId:'one',title:'Audit and report',instruction:workbook+summary+tools,criterionIds:['book','summary']}]:[
        {id:'audit',workerId:'one',title:'Prepare audited workbook',instruction:workbook+tools,criterionIds:['book']},
        {id:'check',workerId:'two',title:'Independently check the workbook',instruction:'Use superagent_artifact_read on the accepted prerequisite and read the returned file. '+summary+tools,criterionIds:['summary'],dependsOn:['audit']}]},context)
    while(Date.now()-start<7*60000){
      await host.tick()
      const state=host.goals.get(goal.id)!.state
      if(['completed','held','needs_input','cancelled'].includes(state))break
      await new Promise(r=>setTimeout(r,250))
    }
    const result=host.goals.get(goal.id)!,acceptedAt=Date.now()
    const busy=()=>!!host.store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('pending','running') LIMIT 1").get()||host.activeExecutions>0||host.store.deliveries().some(d=>['pending','sending'].includes(d.status))
    do{
      await host.tick()
      if(!busy())break
      await new Promise(r=>setTimeout(r,250))
    }while(Date.now()-acceptedAt<120000)
    const settled=!busy(),usage=host.usage.summary()
    const publicReplies=host.store.deliveries().filter(m=>m.kind==='reply'&&m.status==='sent'&&!m.channel.address.routerInbox)
    const humanFollowups=host.store.list<import('../src/vendor/dsh-core/index.ts').Trigger>('trigger').filter(t=>t.human&&t.id!==trigger.id&&!t.channel?.address.routerInbox).length
    const acceptedArtifactReads=host.activity.list().filter(c=>c.kind==='tool'&&c.name==='superagent_artifact_read'&&c.state==='completed').length
    let verified=false
    if(result.state==='completed'){
      const sheet=XLSX.read(readFileSync(join(cwd,'audited.xlsx')),{type:'buffer'}).Sheets.Runs!
      verified=rows.every((row,i)=>['A','B','C'].every((c,j)=>row[j]===sheet[c+(i+2)]?.v))&&sheet.B902?.v===total&&JSON.parse(readFileSync(join(cwd,'summary.json'),'utf8')).failures===total
    }
    const report={workers:count,model,inputSha256:sha(input),state:result.state,reason:result.reason,verified,inputBytes:input.length,acceptedAfterMs:acceptedAt-start,elapsedMs:Date.now()-start,settled,
      humanFollowups,publicReplies:publicReplies.length,extraPublicReplies:Math.max(0,publicReplies.length-1),finalReplyDelivered:publicReplies.some(m=>m.text.replaceAll(',','').includes(String(total))),acceptedArtifactReads,
      taskCount:result.taskIds.length,providerTokens:usage.tokens,reportedCalls:usage.reportedCalls,unknownCalls:usage.unknownCalls}
    writeFileSync(join(root,'metrics.json'),JSON.stringify(report,null,2)+'\n')
    return report
  }finally{await host.close()}
}
const runs=[]
for(const count of [1,2] as const){const result=await measure(count);runs.push(result);console.log(JSON.stringify(result))}
writeFileSync(join(output,'comparison.json'),JSON.stringify(runs,null,2)+'\n')
if(runs.some(r=>!r.verified||!r.settled||!r.finalReplyDelivered))process.exitCode=1
