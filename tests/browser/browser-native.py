"""Real Codex Router and two Workers, real Chrome, synthetic local accounts only."""
import json,urllib.request,time,uuid,sys,subprocess,asyncio
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True);info=json.loads((root/'browser.json').read_text());base=info['base'];client=str(uuid.uuid4())
def api(path,data=None):
 req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers={'Cookie':info['cookie'],'Origin':base,'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=40))
assert info['native']
assert not api('/api/browser')['profiles'], 'Use a fresh isolated native acceptance host'
p=api('/api/browser/profiles',{'name':'Native Browser Lab','allowedWorkers':['research','review']})
a=api('/api/browser/accounts',{'profileId':p['id'],'label':'Local demo','url':info['site']+'/login','username':'demo','password':'Roppo-demo-2026!'})
s=api('/api/browser/profiles/'+p['id']+'/open',{'client':client})
def action(op):return api('/api/browser/sessions/'+s['id']+'/action',{'client':client,'epoch':s['epoch'],'operation':op})
action({'action':'login','credentialId':a['id']})
api('/api/browser/sessions/'+s['id']+'/input',{'client':client,'epoch':s['epoch'],'event':{'type':'key','key':'Enter'}})
for _ in range(30):
 v=api('/api/browser/sessions/'+s['id'])
 if v['url'].endswith('/dashboard'):break
 time.sleep(.2)
else:raise AssertionError('Native setup login failed')
api('/api/browser/sessions/'+s['id']+'/release',{'client':client,'epoch':s['epoch']})
c=api('/api/chat/conversations',{})
message='这是本机浏览器验收。请直接使用现有 research 和 review 两个 Worker 并行执行下面相同任务，分别派给他们，不要新建 Worker，不要修改文件：通过 superagent_browser 工具 profiles 获取授权的 Native Browser Lab 浏览器资料，再 open 打开 '+info['site']+'/dashboard（带 profileId 复用登录），确认页面显示 Welcome, Alice。在各自隔离的浏览器里通过 snapshot 返回的元素 ref 和 revision 点击 Add one 一次，随后 snapshot 验证计数为 1。最后调用 request_takeover 保留浏览器让我人工检查，以 waiting 报告具体观察结果。不要自行登录或读取密码，不要调用 shell 绕过浏览器工具。你汇总两个 Worker 结果。'
r=api('/api/chat/conversations/'+c['id']+'/messages',{'text':message,'clientMessageId':str(uuid.uuid4())})
(root/'check.json').write_text(json.dumps({'conversationId':c['id'],'run':r,'profileId':p['id'],'personalId':s['id']}));print(json.dumps({'started':True,'conversationId':c['id']}),flush=True)
for n in range(180):
 d=api('/api/browser');workers=[s for s in d['sessions'] if not s['personal']]
 if len(workers)==2 and all(s['control']=='paused' for s in workers):
  print(json.dumps({'browserWorkersPaused':True,'workers':[s['workerId'] for s in workers]}),flush=True);break
 if n%10==0:print(json.dumps({'elapsed':n*2,'workers':[(s['workerId'],s['control']) for s in workers]}),flush=True)
 time.sleep(2)
else:raise AssertionError('Native browser Workers did not reach takeover')

results=[]
for session in api('/api/browser')['sessions']:
 directory=root/'state/browser'/('profiles' if session['personal'] else 'tasks')/(session['profileId'] if session['personal'] else session['id'])
 cmd=['node_modules/.bin/agent-browser','--config',str(root/'state/browser/driver.json'),'--session','roppo-'+session['id'],'--profile',str(directory),'--json']
 def read(*args):
  result=subprocess.run(cmd+list(args),capture_output=True,text=True);assert result.returncode==0
  data=json.loads(result.stdout);assert data['success'];return data['data']
 assert 'Welcome, Alice' in read('snapshot','-c')['snapshot']
 count=read('get','text','#count')['text'];assert count==('0' if session['personal'] else '1')
 results.append({'role':'personal' if session['personal'] else session['workerId'],'authenticated':True,'count':int(count),'control':session['control']})
view=api('/api/chat/conversations/'+c['id'])
report={'passed':True,'realBrowser':True,'realModels':{'router':'gpt-6.1-terra medium','workers':'gpt-6.1-sol high'},'sessions':results,'tools':[{'name':v['name'],'worker':v.get('workerId'),'state':v['state']} for v in view['calls']],'externalAccountsUsed':False}
(out/'native-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))

from playwright.async_api import async_playwright,expect
async def main():
 check=json.loads((root/'check.json').read_text())
 async with async_playwright() as p:
  b=await p.chromium.launch();c=await b.new_context(viewport={'width':1500,'height':960});n,v=info['cookie'].split('=',1);await c.add_cookies([{'name':n,'value':v,'url':info['base']}]);page=await c.new_page()
  async def api(path):return await(await page.request.get(info['base']+path)).json()
  await page.goto(info['url']+'&conversation='+check['conversationId']);d=await api('/api/browser');s=next(s for s in d['sessions'] if s.get('workerId')=='research')
  before=await api('/api/chat/conversations/'+check['conversationId']);old={c['id'] for c in before['calls']}
  await page.get_by_label('Browser session',exact=True).select_option(s['id']);await page.get_by_role('button',name='Take control',exact=True).click();await expect(page.get_by_label('Website address',exact=True)).to_be_enabled();await page.get_by_alt_text('Live browser page').wait_for()
  await page.screenshot(path=str(out/'native-router-browser-light.png'))
  await page.get_by_role('button',name='Switch to dark mode',exact=True).click();await page.screenshot(path=str(out/'native-router-browser-dark.png'))
  await page.get_by_role('button',name='Return to Worker',exact=True).click()
  for _ in range(90):
   view=await api('/api/chat/conversations/'+check['conversationId']);new=[c for c in view['calls'] if c['id'] not in old and c.get('workerId')=='research' and c['name']=='superagent_browser' and c['state']=='completed']
   if new:break
   await asyncio.sleep(1)
  else:raise AssertionError('Native Worker did not resume browser tools after handoff')
  report=json.loads((out/'native-result.json').read_text());report['humanHandoff']={'uiTakeover':True,'uiReturn':True,'newSuccessfulBrowserCalls':len(new)};(out/'native-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report['humanHandoff']));await b.close()
asyncio.run(main())
