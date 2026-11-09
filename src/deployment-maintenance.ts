import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {marketBlockers} from './plugin-market.ts'

export class DeploymentError extends Error {constructor(readonly code:string,message:string,readonly status=409){super(message)}}
const command=z.object({action:z.enum(['prepare','finish','abort']),operationId:z.string().uuid(),expectedRevision:z.number().int().nonnegative().optional()}).strict()
interface Maintenance {id:string;state:'preparing'|'prepared'|'finished'|'aborted'|'failed';wasPaused:boolean;pauseSeq?:number;at:number;resumed?:boolean;reason?:string}
export function pauseControl(host:Runtime){
 const row=host.store.db.prepare("SELECT seq,body FROM audit WHERE json_extract(body,'$.type')='pause' ORDER BY seq DESC LIMIT 1").get()
 return row?{seq:Number(row.seq),...JSON.parse(String(row.body))}:undefined
}
function blockers(host:Runtime){
 const items=marketBlockers(host).filter(i=>i.kind!=='goals')
 const count=(kind:string,n:number)=>{if(n)items.push({kind,count:n})}
 count('goals',host.store.list<any>('router-goal').filter(g=>g.objective&&!g.deleted&&!['completed','cancelled'].includes(g.state)).length)
 count('active-models',host.activeExecutions)
 count('delegated-work',host.store.list<any>('delegation-outbound').filter(t=>t.contract&&!t.deleted&&!(t.remote&&['ready','cancelled'].includes(t.remote.state)&&(t.acceptance==='passed'||t.desired==='cancelled'&&t.remote.controlEpoch>=t.controlEpoch))).length)
 for(const table of ['webhook_inbox','webhook_deliveries']){
  const exists=host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
  if(exists)count(table,Number(host.store.db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE state IN ('received','pending','sending','held','uncertain')").get()!.n))
 }
 return items
}
export async function deploymentMaintenance(host:Runtime,input:unknown){
 const x=command.parse(input),store=host.store,old=store.get<Maintenance>('deployment-maintenance',x.operationId)
 if(x.action!=='prepare'){
  if(!old){if(x.action==='abort')return {operationId:x.operationId,state:'not_found',resumed:false};throw new DeploymentError('maintenance_not_found','Known maintenance operation required')}
  if(old.state==='failed'&&x.action==='abort'){store.put('deployment-maintenance',old.id,{...old,state:'aborted'});return {operationId:old.id,state:'aborted',resumed:false}}
  if(['finished','aborted'].includes(old.state))return {operationId:old.id,state:old.state,resumed:old.resumed??false,...(old.reason?{reason:old.reason}:{})}
  if(old.state!=='prepared'&&!(old.state==='preparing'&&x.action==='abort'))throw new DeploymentError('maintenance_not_prepared','Maintenance did not reach the prepared state; abort interrupted preparation')
  const control=pauseControl(host),owned=control?.controlId===old.id&&(old.state==='preparing'||control.seq===old.pauseSeq)
  // A later human pause/resume always wins over the installer receipt.
  if(owned&&!old.wasPaused)host.pause(false)
  const state=x.action==='finish'?'finished':'aborted'
  store.put('deployment-maintenance',old.id,{...old,state,resumed:owned&&!old.wasPaused,...(!owned?{reason:'pause_control_changed'}:{})})
  return {operationId:old.id,state,resumed:owned&&!old.wasPaused,...(!owned?{reason:'pause_control_changed'}:{})}
 }
 if(old){if(old.state!=='prepared')throw new DeploymentError('maintenance_operation_ended','Use a new maintenance operation');return {operationId:old.id,state:old.state,wasPaused:old.wasPaused}}
 if(x.expectedRevision!==host.settings.current().revision)throw new DeploymentError('settings_conflict','Read the current settings revision before maintenance')
 if(store.list<Maintenance>('deployment-maintenance').some(m=>['preparing','prepared'].includes(m.state)))throw new DeploymentError('maintenance_in_progress','Finish or abort the existing maintenance first')
 const busy=blockers(host);if(busy.length)throw new DeploymentError('deployment_busy','Unsettled work blocks upgrade: '+JSON.stringify(busy))
 const record:Maintenance={id:x.operationId,state:'preparing',wasPaused:host.schedulingPaused,at:Date.now()}
 store.put('deployment-maintenance',record.id,record)
 try{
  await host.pauseForConfiguration(record.id)
  if(store.get<Maintenance>('deployment-maintenance',record.id)?.state!=='preparing')throw new DeploymentError('maintenance_cancelled','Maintenance preparation was cancelled')
  const control=pauseControl(host)
  if(control?.controlId!==record.id)throw new DeploymentError('maintenance_pause_changed','Pause control changed during preparation')
  const pending=blockers(host);if(pending.length)throw new DeploymentError('deployment_busy','New work arrived while preparing upgrade: '+JSON.stringify(pending))
  store.put('deployment-maintenance',record.id,{...record,state:'prepared',pauseSeq:control.seq})
  return {operationId:record.id,state:'prepared',wasPaused:record.wasPaused}
 }catch(error){
  if(pauseControl(host)?.controlId===record.id)host.pause(record.wasPaused)
  if(store.get<Maintenance>('deployment-maintenance',record.id)?.state==='preparing')store.put('deployment-maintenance',record.id,{...record,state:'failed'})
  throw error
 }
}
