import type {ConnectorLayer,DiagnosticStatus} from '../../src/connector-management.ts'
export type ConnectorCheckState=DiagnosticStatus|'not_checked'
export interface ConnectorCheckView {state:ConnectorCheckState;at:number|null;fixture:boolean;code:string}
const codes:Record<ConnectorLayer,readonly string[]>={configuration:['configuration_valid','configuration_invalid'],reachable:['service_reachable','service_unreachable','reachability_probe_unavailable'],authentication:['identity_verified','identity_unverified','authentication_not_verified','identity_probe_unavailable'],capabilities:['directory_read_verified','directory_not_verified','directory_probe_unavailable']}
const evidenceCodes=['adapter_restart_required','credential_changed','credential_missing','adapter_changed','evidence_lifecycle_changed','credential_basis_unavailable']
const passedCodes:Record<ConnectorLayer,string>={configuration:'configuration_valid',reachable:'service_reachable',authentication:'identity_verified',capabilities:'directory_read_verified'}
const states:readonly string[]=['running','passed','failed','unsupported','unknown','stale','interrupted']
export function connectorTime(value:unknown):number|null{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000?value:null}
/** Rendering only: a retained check never implies message access, delivery or a Worker grant. */
export function connectorCheck(record:unknown,layer:ConnectorLayer,revision:number):ConnectorCheckView{
 const unknown:ConnectorCheckView={state:'unknown',at:null,fixture:false,code:''}
 if(record==null)return {...unknown,state:'not_checked'}
 if(typeof record!=='object')return unknown
 const value=record as Record<string,unknown>,at=connectorTime(value.finishedAt??value.startedAt),fixture=value.evidenceMode==='fixture'
 if(at===null||value.level!==layer||!states.includes(String(value.status))||value.realCall!==false||!['configured-adapter','fixture'].includes(String(value.evidenceMode)))return {...unknown,at,fixture}
 const evidenceCode=(layer==='authentication'||layer==='capabilities')&&typeof value.code==='string'&&evidenceCodes.includes(value.code)?value.code:''
 if(evidenceCode)return {state:evidenceCode==='credential_basis_unavailable'?'unknown':'stale',at,fixture,code:evidenceCode}
 if(value.current===false||Number.isInteger(value.revision)&&value.revision!==revision)return {state:'stale',at,fixture,code:'configuration_changed'}
 if(value.current!==true||value.revision!==revision)return {...unknown,at,fixture}
 let code=typeof value.code==='string'&&(codes[layer].includes(value.code)||['configuration_changed','probe_interrupted','probe_running','diagnostic_store_unavailable'].includes(value.code))?value.code:''
 if(value.status!=='passed'&&code===passedCodes[layer])code=''
 if(value.status==='passed'&&(code!==passedCodes[layer]||layer==='capabilities'&&(!Array.isArray(value.checkedCapabilities)||value.checkedCapabilities.length!==1||value.checkedCapabilities[0]!=='member_directory'||!Number.isInteger(value.checkedScopes)||Number(value.checkedScopes)<1||Number(value.checkedScopes)>20)))return {...unknown,at,fixture}
 return {state:value.status as DiagnosticStatus,at,fixture,code}
}
export const connectorLayerNames:Record<ConnectorLayer,[string,string]>={configuration:['Local settings','本地配置'],reachable:['Service response','服务响应'],authentication:['Account identity','账号身份'],capabilities:['Member directory','成员目录']}
export function connectorCheckLabel(state:ConnectorCheckState,layer:ConnectorLayer):[string,string]{
 if(state==='passed')return ({configuration:['Fields valid','字段有效'],reachable:['Responded','有响应'],authentication:['Identity verified','身份已验证'],capabilities:['Directory readable','可读取成员目录']} as Record<ConnectorLayer,[string,string]>)[layer]
 return ({failed:['Check failed','检查未通过'],running:['Checking…','检查中…'],unsupported:['Check unavailable','暂不支持检查'],unknown:['Not verified','尚未验证'],stale:['Check again','需重新检查'],interrupted:['Check stopped','检查已中断'],not_checked:['Not checked','尚未检查']} as Record<Exclude<ConnectorCheckState,'passed'>,[string,string]>)[state]
}
