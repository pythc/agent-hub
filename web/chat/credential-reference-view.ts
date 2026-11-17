export type InformationState='present'|'missing'|'unknown'|'not_declared'
export interface CredentialInformation {
 observedAt:number;settingsRevision:number
 connections:{kind:'source'|'tool'|'backend';id:string;state:InformationState}[]
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const time=(value:unknown):value is number=>integer(value)&&value<=8.64e15
/** Validate the wire contract and rebuild display-only facts. No slots, names,
 * field labels, environment material or raw provider data survive this view. */
export function readCredentialInformation(value:unknown):CredentialInformation {
 try{
  if(!object(value)||value.schema!==1||value.scope!=='host'||!time(value.observedAt)||!integer(value.settingsRevision)||!Array.isArray(value.connections)||value.connections.length>10_000)throw Error()
  const seen=new Set<string>(),connections:CredentialInformation['connections']=[]
  for(const item of value.connections){
   if(!object(item)||typeof item.kind!=='string'||!['source','tool','backend'].includes(item.kind)||typeof item.id!=='string'||!/^[a-z][a-z0-9_-]*$/.test(item.id)||typeof item.state!=='string'||!['present','missing','unknown','not_declared'].includes(item.state)||item.verification!=='not_checked'||!Array.isArray(item.references)||item.references.length>10_000)throw Error()
   const key=item.kind+':'+item.id;if(seen.has(key))throw Error();seen.add(key)
   let missing=false,unknown=false
   for(const [slot,reference] of item.references.entries()){
    if(!object(reference)||reference.slot!==slot||typeof reference.purpose!=='string'||!['authentication','process_environment'].includes(reference.purpose)||typeof reference.state!=='string'||!['present','missing','unknown'].includes(reference.state))throw Error()
    if(reference.state==='missing')missing=true;if(reference.state==='unknown')unknown=true
   }
   if(missing?item.state!=='missing':unknown?item.state!=='unknown':item.references.length?!['present','unknown'].includes(String(item.state)):!['not_declared','unknown'].includes(String(item.state)))throw Error()
   connections.push({kind:item.kind as 'source'|'tool'|'backend',id:item.id,state:item.state as InformationState})
  }
  return {observedAt:value.observedAt,settingsRevision:value.settingsRevision,connections}
 }catch{throw Error('credential_information_unavailable')}
}
export function credentialInformationLabel(state:InformationState):[string,string]{
 return {present:['Found in this environment','已在当前环境找到'],missing:['Some information is missing','缺少部分资料'],unknown:['Cannot check here','暂无法检查'],not_declared:['Nothing to check here','暂无可检查项']}[state] as [string,string]
}
