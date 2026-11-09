"""Two real Watchdog processes against an isolated fixture; no model calls expected."""
import json,urllib.request,hmac,hashlib,base64,time,subprocess,sys,uuid
from pathlib import Path
root=Path(sys.argv[1]);info=json.loads((root/'browser-info.json').read_text());keys=json.loads((root/'test-keys.json').read_text())
def api(path,body=None):
 token=(root/'state/watchdog-access-token').read_text().strip() if path=='/watchdog/snapshot' else info['token']
 req=urllib.request.Request(info['url']+path,headers={'authorization':'Bearer '+token,'content-type':'application/json'},data=json.dumps(body).encode() if body is not None else None)
 with urllib.request.urlopen(req) as r:return json.load(r)
config=api('/settings')['current']['config'];path=root/'watchdog-test-config.json';path.write_text(json.dumps(config));path.chmod(0o600)
snapshot=api('/webhooks');grant=next(g for g in snapshot['grants'] if g['id']==info['grantId']);assert grant['keys']['revision']==1
batch='daemon-'+uuid.uuid4().hex
raw=json.dumps({'specversion':'1.0','id':batch,'source':grant['eventSource'],'type':'test.request','data':{'batch':batch}},separators=(',',':')).encode();timestamp=str(int(time.time()));identifier='daemon-test';key=base64.b64decode(keys['WEBHOOK_UI_IN_NEXT'][6:]);sig=base64.b64encode(hmac.new(key,identifier.encode()+b'.'+timestamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode();req=urllib.request.Request(info['webhookUrl']+'/webhooks/'+grant['id'],headers={'content-type':'application/json','webhook-id':identifier,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+sig},data=raw)
with urllib.request.urlopen(req) as r:
 assert r.status==202;receipt=json.load(r)
for _ in range(100):
 snap=api('/webhooks');goal_id=next((r.get('goalId') for r in snap['receipts'] if r['receiptId']==receipt['receiptId']),None);wait=next((w for w in snap['waits'] if w['state']=='waiting' and w['goalId']==goal_id),None)
 if wait:break
 time.sleep(.1)
assert wait
target=next(t for t in api('/watchdog/snapshot')['targets'] if t['ticketId']==wait['ticketId'])
for _ in range(2):subprocess.run(['./node_modules/.bin/tsx','src/cli.ts','watchdog',str(path),'--once'],check=True,stdout=subprocess.DEVNULL)
query="""import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1],{readOnly:true}); console.log(JSON.stringify({observations:db.prepare("SELECT body FROM records WHERE kind='watchdog-observation'").all().map(r=>JSON.parse(r.body)),reviews:db.prepare("SELECT COUNT(*) n FROM records WHERE kind='watchdog-review'").get().n,health:JSON.parse(db.prepare("SELECT body FROM records WHERE kind='watchdog-health' AND id='daemon'").get().body)})); db.close()"""
result=json.loads(subprocess.check_output(['node','--input-type=module','-e',query,str(root/'state/watchdog/state.sqlite')],text=True));observations=[o for o in result['observations'] if o['id']==target['id']];reviews=result['reviews'];assert len(observations)==1 and len(observations[0]['samples'])==2 and reviews==0;assert result['health']['state']=='healthy'
goal=next(g for g in api('/webhooks/detail?id='+grant['id'])['goals'] if g['id']==wait['goalId']);api('/webhooks/goal',{'id':wait['goalId'],'action':'cancel','operationId':batch+'-cleanup','expectedRevision':goal['revision']})
proof={'ok':True,'realSeparateWatchdogProcesses':2,'healthyHTTPObservation':True,'samples':len(observations[0]['samples']),'unnecessaryModelReviews':reviews,'waitNotRestarted':next(w for w in api('/webhooks')['waits'] if w['id']==wait['id'])['assignmentId']==wait['assignmentId']};(root/'watchdog-evidence.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
