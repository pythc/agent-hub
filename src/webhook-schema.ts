import type {DatabaseSync} from 'node:sqlite'

/** Other features can raise the DB barrier without activating Webhook v2. */
export function webhookProtocol(db:DatabaseSync):1|2 {
 const row=db.prepare("SELECT body FROM records WHERE kind='webhook-protocol' AND id='current'").get()
 if(row){
  const version=JSON.parse(String(row.body)).version
  if(version!==1&&version!==2)throw Error('Unsupported Webhook protocol activation')
  return version
 }
 return Number(db.prepare('PRAGMA user_version').get()!.user_version)>=9?2:1
}
export function retainWebhookProtocol(db:DatabaseSync){
 if(!db.prepare("SELECT id FROM records WHERE kind='webhook-protocol' AND id='current'").get()){
  db.prepare("INSERT INTO records(kind,id,body) VALUES('webhook-protocol','current',?)").run(JSON.stringify({version:webhookProtocol(db)}))
 }
}
