import {createHash} from 'node:crypto'
import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs'
import {basename,extname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import * as XLSX from 'xlsx'
import type {Runtime} from './runtime.ts'
import type {GoalCriterion} from './goal-contract.ts'
import type {VerificationRound} from './goal-verification.ts'
import type {RouterGoal} from './router-goals.ts'
import type {WorkOwner} from './work.ts'
import {stableDigest} from './sources.ts'
import {atomicPrivateFile} from './managed-config.ts'

const mimeTypes:Record<string,string>={'.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pdf':'application/pdf','.mp4':'video/mp4'}
export interface ArtifactVersion {id:string;goalId:string;ticketId:string;nodeId:string;path:string;version:number;sha256:string;size:number;mime:string}
type CellCheck=Extract<NonNullable<GoalCriterion['check']>,{kind:'xlsx_cell_equals'}>

/** Read the same file descriptor used to check the workspace boundary and size. */
export function evidenceBytes(cwd:string,path:string,limit:number):Buffer|undefined{
  if(isAbsolute(path)||path.split(/[\\/]/).includes('..'))throw Error('Evidence path must stay inside the task workspace')
  const root=realpathSync(cwd),file=resolve(root,path),rel=relative(root,file)
  if(!rel||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Evidence path escapes workspace')
  try{
    let part=root
    for(const segment of rel.split(sep)){
      part=join(part,segment)
      if(lstatSync(part).isSymbolicLink())throw Error('Evidence symlinks are not allowed')
    }
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW)
    try{
      const before=fstatSync(fd)
      if(!before.isFile()||before.size>limit)throw Error('Evidence must be a regular file no larger than '+(limit/1024)+' KiB')
      const bytes=Buffer.alloc(before.size+1)
      let size=0,count=0
      while(size<bytes.length&&(count=readSync(fd,bytes,size,bytes.length-size,size))>0)size+=count
      const after=fstatSync(fd),live=lstatSync(file)
      if(size!==before.size||before.mtimeMs!==after.mtimeMs||live.ino!==after.ino||live.dev!==after.dev||realpathSync(file)!==file)throw Error('Evidence changed while reading')
      return bytes.subarray(0,size)
    }finally{closeSync(fd)}
  }catch(error:any){if(error.code==='ENOENT')return;throw error}
}

function workbookObservation(bytes:Buffer,checks:CellCheck[]){
  if(bytes.readUInt16BE(0)!==0x504b)throw Error('Expected an XLSX workbook')
  const workbook=XLSX.read(bytes,{type:'buffer',sheets:[...new Set(checks.map(c=>c.sheet))],cellFormula:false})
  const cells=checks.map(check=>{
    const sheet=workbook.Sheets[check.sheet],cell=sheet?.[check.cell.replace(/\$/g,'').toUpperCase()]
    const value=cell&&['s','n','b'].includes(cell.t)?cell.v:null
    let sum:number|null=null
    if(check.sumRange&&sheet){
      const {s,e}=XLSX.utils.decode_range(check.sumRange.replace(/\$/g,'').toUpperCase())
      const valid=e.r>=s.r&&e.c>=s.c&&e.r<1048576&&e.c<16384
      if(valid){
        sum=0
        for(const address of Object.keys(sheet)){
          if(address.startsWith('!'))continue
          const point=XLSX.utils.decode_cell(address)
          if(point.r<s.r||point.r>e.r||point.c<s.c||point.c>e.c)continue
          const item=sheet[address]!
          if(item.t==='e'){sum=null;break}
          if(item.t==='n')sum+=item.v
        }
      }
    }
    return {sheet:check.sheet,cell:check.cell,value,...(check.sumRange?{range:check.sumRange,sum}:{})}
  })
  return {sheets:workbook.SheetNames,cells}
}

export class GoalArtifacts {
  constructor(private host:Runtime){
    host.store.db.exec(`CREATE TABLE IF NOT EXISTS goal_artifact_bytes(id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
      CREATE TRIGGER IF NOT EXISTS erase_goal_artifact AFTER UPDATE OF body ON records
      WHEN NEW.kind='goal-artifact' AND json_extract(NEW.body,'$.mime') IS NULL
      BEGIN DELETE FROM goal_artifact_bytes WHERE id=NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS delete_goal_artifact AFTER DELETE ON records WHEN OLD.kind='goal-artifact'
      BEGIN DELETE FROM goal_artifact_bytes WHERE id=OLD.id; END;`)
  }
  evidence(goal:RouterGoal,nodeId:string,ticketId:string,cwd:string,path:string,criteria:GoalCriterion[],head?:string){
    const mime=mimeTypes[extname(path).toLowerCase()]
    const limit=mime?32*1024*1024:128*1024
    const bytes=head?this.host.projectCode.blob(goal,head,path,limit):evidenceBytes(cwd,path,limit)
    if(!bytes)return {content:'',missing:true}
    if(!mime)return {content:bytes.toString('utf8')}
    const sha256=createHash('sha256').update(bytes).digest('hex'),id=stableDigest([goal.id,nodeId,path,sha256])
    const store=this.host.store
    let artifact=store.get<ArtifactVersion>('goal-artifact',id)
    if(!artifact){
      artifact=store.atomic(()=>{
        const count=store.db.prepare("SELECT count(*) AS n FROM records WHERE kind='goal-artifact' AND json_extract(body,'$.goalId')=? AND json_extract(body,'$.nodeId')=? AND json_extract(body,'$.path')=?").get(goal.id,nodeId,path)!
        const item={id,goalId:goal.id,nodeId,ticketId,path,version:Number(count.n)+1,sha256,size:bytes.length,mime}
        if(this.host.memory.cleanup.blocked('goal-artifact',id,item))throw Error('Artifact history was deleted')
        store.requireWorkflowSchema()
        store.put('goal-artifact',id,item)
        store.db.prepare('INSERT INTO goal_artifact_bytes VALUES(?,?)').run(id,bytes)
        return item
      })
    }
    const checks=criteria.flatMap(c=>c.check?.kind==='xlsx_cell_equals'&&c.check.path===path?[c.check]:[])
    let observation:unknown
    if(checks.length){
      const cache=stableDigest([id,checks])
      observation=store.get<{observation:unknown}>('workbook-observation',cache)?.observation
      if(!observation){
        try{observation=workbookObservation(bytes,checks)}catch{observation={error:'Workbook could not be read'}}
        store.put('workbook-observation',cache,{artifactId:id,ticketId,observation})
      }
    }
    return {artifact,content:JSON.stringify({kind:'binary_artifact',artifact,observation:observation??'File identity only. Content has not been inspected.'})}
  }
  private bytes(id:string){
    const row=this.host.store.db.prepare('SELECT bytes FROM goal_artifact_bytes WHERE id=?').get(id)
    if(!row)throw Error('Artifact version unavailable')
    return Buffer.from(row.bytes as Uint8Array)
  }
  download(id:string){
    const artifact=this.host.store.get<ArtifactVersion>('goal-artifact',id)
    const goal=artifact?.goalId&&this.host.goals.get(artifact.goalId)
    if(!artifact?.mime||!goal||this.host.scopes.binding(goal.entryId).privateActor)throw Error('Artifact is outside the operator workspace')
    this.host.goals.context(goal)
    return {artifact,bytes:this.bytes(id)}
  }
  open(owner:WorkOwner,id:string){
    const goal=this.host.goals.forTask(owner.ticketId)
    const node=goal?.nodes?.find(n=>n.ticketId===owner.ticketId)
    if(!goal||!node||!this.host.validWork(owner))throw Error('An active dependent task is required')
    this.host.goals.context(goal)
    const rounds=node.dependsOn.map(dep=>goal.nodes!.find(n=>n.id===dep)).filter(n=>n?.state==='passed').map(n=>this.host.store.get<VerificationRound>('goal-verification',n!.roundId!))
    const round=rounds.find(r=>r?.state==='passed'&&r.snapshot.evidence.some(e=>e.artifact?.id===id))
    if(!round||!this.host.verification.current(round,goal))throw Error('Artifact is outside the accepted prerequisites of this task')
    const artifact=round.snapshot.evidence.find(e=>e.artifact?.id===id)!.artifact!
    const assetId=stableDigest([owner.ticketId,id]),directory=join(this.host.config.stateDir,'assets',assetId)
    const path=join(directory,basename(artifact.path))
    atomicPrivateFile(path,this.bytes(id),0o400)
    const asset={id:assetId,path,name:basename(path),bytes:artifact.size,ticketId:owner.ticketId,artifactId:id,resource:'asset/'+assetId}
    this.host.store.put('asset',assetId,asset)
    return {...asset,version:artifact.version,sha256:artifact.sha256}
  }
}
