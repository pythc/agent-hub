"""Run prepare, restart the isolated browser acceptance host, then run verify."""
import json,sys,uuid,urllib.request,subprocess
from pathlib import Path

mode=sys.argv[1];root=Path(sys.argv[2]).resolve();out=Path(sys.argv[3]);out.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text());assert not info['native']
client=str(uuid.uuid4())
def api(path,data=None):
 req=urllib.request.Request(info['base']+'/api/browser'+path,data=None if data is None else json.dumps(data).encode(),headers={'Cookie':info['cookie'],'Origin':info['base'],'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=40))
def remote(s,*args):
 cmd=['node_modules/.bin/agent-browser','--config',str(root/'state/browser/driver.json'),'--session','roppo-'+s['id'],'--profile',str(root/'state/browser/profiles'/s['profileId']),'--json',*args]
 result=subprocess.run(cmd,capture_output=True,text=True);assert result.returncode==0
 value=json.loads(result.stdout);assert value['success'];return value['data']
d=api('');p=next(p for p in d['profiles'] if p['name']=='Browser Lab')
s=api('/profiles/'+p['id']+'/open',{'client':client})
s=api('/sessions/'+s['id']+'/takeover',{'client':client,'force':True})
def action(op):return api('/sessions/'+s['id']+'/action',{'client':client,'epoch':s['epoch'],'operation':op})
if mode=='prepare':
 s=action({'action':'new_tab','url':info['site']+'/login'});s=action({'action':'select_tab','tab':s['tabs'][0]['id']})
 expected={'profileId':p['id'],'previousSession':s['id'],'tabs':s['tabs'],'note':remote(s,'get','value','#note')['value']}
 (root/'restart-expected.json').write_text(json.dumps(expected));print('Prepared restart evidence')
else:
 expected=json.loads((root/'restart-expected.json').read_text());assert s['id']!=expected['previousSession']
 assert [t['url'] for t in s['tabs']]==[t['url'] for t in expected['tabs']]
 assert next(t['index'] for t in s['tabs'] if t['active'])==0
 assert 'Welcome, Alice' in remote(s,'snapshot','-c')['snapshot']
 assert remote(s,'get','value','#note')['value']==expected['note']
 account=next(a for a in d['credentials'] if a['profileId']==p['id'])
 action({'action':'select_tab','tab':s['tabs'][1]['id']});action({'action':'login','credentialId':account['id']})
 assert 'Roppo-demo-2026!' not in remote(s,'snapshot','-c')['snapshot']
 api('/sessions/'+s['id']+'/input',{'client':client,'epoch':s['epoch'],'event':{'type':'key','key':'Enter'}})
 assert 'Welcome, Alice' in remote(s,'snapshot','-c')['snapshot']
 action({'action':'select_tab','tab':s['tabs'][0]['id']})
 result={'passed':True,'realBrowser':True,'checks':['host restart preserves authenticated profile and local storage','tab URLs and active tab restored','saved account decrypts and fills after host restart','password remains absent from accessibility snapshot'],'externalAccountsUsed':False}
 (out/'restart-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
