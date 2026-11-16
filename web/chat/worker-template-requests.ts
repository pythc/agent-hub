/** Keep the exact request across inventory refreshes; a new revision is not a new intent. */
export interface TemplateAttempt {path:string;body:Record<string,unknown>;requestId:string}
interface SessionStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const storageKey='roppo.worker-template.pending.v1'
function identity(path:string,body:Record<string,unknown>){const {revision,settingsRevision,...intent}=body;return path+JSON.stringify(Object.fromEntries(Object.entries(intent).sort(([a],[b])=>a.localeCompare(b))))}
export class TemplateRequestLedger {
 private attempts=new Map<string,TemplateAttempt>()
 constructor(private storage?:SessionStorage){
  if(!storage)try{this.storage=globalThis.sessionStorage}catch{}
  try{const saved=JSON.parse(this.storage?.getItem(storageKey)??'[]');if(Array.isArray(saved))for(const attempt of saved.slice(-20)){if(attempt?.path!=='/create'||typeof attempt.requestId!=='string'||!attempt.body||typeof attempt.body!=='object'||Array.isArray(attempt.body))continue;const body=attempt.body as Record<string,unknown>,allowed=['id','version','digest','revision','settingsRevision','workerId','label','backend','model'];if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.workerId!=='string'||typeof body.label!=='string')continue;this.attempts.set(identity(attempt.path,body),{path:attempt.path,body,requestId:attempt.requestId})}}catch{}
 }
 prepare(path:string,body:Record<string,unknown>):TemplateAttempt{const key=identity(path,body),old=this.attempts.get(key);if(old)return old;const attempt={path,body:structuredClone(body),requestId:crypto.randomUUID()};this.attempts.set(key,attempt);this.persist();return attempt}
 finish(attempt:TemplateAttempt){this.attempts.delete(identity(attempt.path,attempt.body));this.persist()}
 pendingCreations(){return [...this.attempts.values()].filter(a=>a.path==='/create')}
 private persist(){try{this.storage?.setItem(storageKey,JSON.stringify(this.pendingCreations().slice(-20)))}catch{}}
}
