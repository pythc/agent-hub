function agentOptionsEditor(id,profile,onChange){
 const panel=el('div','settings-stack')
 const effort=controlField(id+'-effort',L('Reasoning effort','思考强度'),profile.effort??'',value=>{if(value)profile.effort=value;else delete profile.effort;onChange()},[['',L('Inherit / provider default','继承 / 服务默认')],['none',L('Off (requires model support)','关闭（需模型支持）')],['minimal','Minimal'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','XHigh']])
 panel.append(effort)
 for(const key of ['prompt','parameters']){
  const label=el('label','',key==='prompt'?L('This Agent’s instructions','此 Agent 的独立指令'):L('Provider parameters (JSON)','厂商参数（JSON）')),input=el('textarea'),error=el('p','hint');input.id=id+'-'+key;label.htmlFor=input.id
  input.value=key==='prompt'?(profile.prompt??''):JSON.stringify(profile.parameters??{},null,2)
  input.oninput=()=>{const path='agent-input.'+id+'.'+key;try{
   const value=key==='prompt'?input.value:JSON.parse(input.value||'{}')
   if(key==='parameters'&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error(L('Enter a JSON object','请输入 JSON 对象'))
   profile[key]=value;S.errors.delete(path);onChange();error.textContent='';input.removeAttribute('aria-invalid')
  }catch(e){S.errors.set(path,[String(e),String(e)]);error.textContent=String(e);input.setAttribute('aria-invalid','true');updateBar()}}
  panel.append(label,input,error)
 }
 for(const key of ['maxOutputTokens','maxSteps','maxToolCalls','timeoutMs'])panel.append(controlField(id+'-'+key,({maxOutputTokens:L('Output token limit','输出 Token 上限'),maxSteps:L('Model step limit','模型步骤上限'),maxToolCalls:L('Tool call limit','工具调用上限'),timeoutMs:L('Turn timeout (ms)','单轮超时（毫秒）')})[key],profile[key]??'',value=>{if(value.trim())profile[key]=Number(value);else delete profile[key];onChange()}))
 return detail(L('Independent parameters and instructions','独立参数与指令'),panel)
}
const connectionEditor={kind:'api',id:'',json:'',notice:'',login:null,account:'personal',authorization:false}
function syncSubscriptionEditor(){
 try{const sub=JSON.parse(connectionEditor.json).subscription;if(!sub)return
  if(connectionEditor.account!==sub.account)connectionEditor.login=null
  connectionEditor.account=sub.account??'personal';connectionEditor.authorization=sub.backgroundAuthorized===true
  const account=document.getElementById('subscription-account'),consent=document.getElementById('subscription-authorization')
  if(account)account.value=connectionEditor.account;if(consent)consent.checked=connectionEditor.authorization
 }catch{}
}
function patchSubscriptionEditor(patch){
 try{const d=JSON.parse(connectionEditor.json);if(!d.subscription)throw Error('Missing subscription configuration');Object.assign(d.subscription,patch);connectionEditor.json=JSON.stringify(d,null,2);const editor=document.getElementById('connection-json');if(editor)editor.value=connectionEditor.json;syncSubscriptionEditor()}
 catch{connectionEditor.notice=L('Fix the connection JSON before changing account options.','请先修正连接 JSON，再修改账号选项。');render()}
}
function connectionTemplate(kind){
 if(kind==='cli')return {kind:'codex',label:'Codex CLI',command:'codex',args:[],env:{},defaults:{}}
 if(kind==='subscription'){const source=S.base.config.sources.find(s=>s.kind==='local');return {kind:'openai-responses',label:'ChatGPT subscription',baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-sol',subscription:{provider:'chatgpt',account:connectionEditor.account,owner:{source:source?.id??'',actor:source?.allowedActors?.[0]??''},backgroundAuthorized:connectionEditor.authorization}}}
 return {kind:'openai-responses',label:'API service',baseUrl:'https://api.openai.com/v1',model:'',apiKeyEnv:'OPENAI_API_KEY'}
}
function agentConnectionEditor(){
 if(!connectionEditor.json)connectionEditor.json=JSON.stringify(connectionTemplate(connectionEditor.kind),null,2)
 syncSubscriptionEditor()
 const form=el('div','settings-stack')
 form.append(controlField('connection-kind',L('Connection method','接入方式'),connectionEditor.kind,value=>{connectionEditor.kind=value;connectionEditor.json=JSON.stringify(connectionTemplate(value),null,2);connectionEditor.notice='';render()},[['api',L('API service','API 服务')],['subscription',L('Subscription sign-in','订阅账号登录')],['cli',L('CLI backend','CLI 后端')]]))
 form.append(controlField('connection-id',L('Connection name (a-z, 0-9, -)','连接名称（a-z、0-9、-）'),connectionEditor.id,value=>connectionEditor.id=value))
 if(connectionEditor.kind==='subscription'){
  form.append(controlField('subscription-account',L('Saved account name','保存的账号名称'),connectionEditor.account,value=>patchSubscriptionEditor({account:value})))
  const consent=el('input');consent.id='subscription-authorization';consent.type='checkbox';consent.checked=connectionEditor.authorization;consent.onchange=()=>patchSubscriptionEditor({backgroundAuthorized:consent.checked})
  form.append(add(el('label'),consent,document.createTextNode(L('Allow AgentHub background tasks to use this account’s plan','允许 AgentHub 后台任务使用此账号的订阅额度'))))
  form.append(opButton('Continue with ChatGPT',async()=>{await entryRun('subscription-login',async()=>{connectionEditor.login=await api('/subscription/login',{account:connectionEditor.account});render()})},'button'))
  if(connectionEditor.login){const link=el('a','button',L('Open official sign-in','打开官方登录'));link.href=connectionEditor.login.url;link.target='_blank';link.rel='noopener noreferrer';form.append(link,opButton(L('Check sign-in','检查登录'),async()=>{await entryRun('subscription-status',async()=>{const result=await api('/subscription/status',{attempt:connectionEditor.login.attempt});connectionEditor.notice=result.status+(result.error?' · '+result.error:'');render()})},'button'))}
  form.append(opButton(L('Sign out','退出此账号'),async()=>{await entryRun('subscription-logout',async()=>{const result=await api('/subscription/logout',{account:connectionEditor.account});connectionEditor.notice=result.revoked?L('Signed out and revoked','已退出并撤销授权'):L('Signed out locally; remote revocation unconfirmed','已在本地退出；远端撤销未确认');render()})},'button'))
 }
 const label=el('label','',L('Connection configuration (JSON)','连接配置（JSON）')),input=el('textarea');input.id='connection-json';label.htmlFor=input.id;input.value=connectionEditor.json;input.rows=14;input.oninput=()=>{connectionEditor.json=input.value;syncSubscriptionEditor()}
 form.append(label,input,el('p','hint',connectionEditor.kind==='cli'?L('Codex app-server adapter. Authentication and quota follow this CLI profile. Additional adapters use reviewed execution plugin packages and a controlled restart.','Codex app-server 适配器。认证与额度沿用此 CLI 配置；其他 CLI 适配器通过审核后的执行插件包接入，需受控重启。'):L('Credentials use local environment references or official sign-in. Saved configuration does not prove a successful model call.','凭据使用本地环境变量引用或官方登录。配置保存不代表模型调用已验证。')))
 form.append(opButton(L('Save connection','保存连接'),async()=>{await entryRun('connection-save',async()=>{
  if(!/^[a-z][a-z0-9_-]{0,63}$/.test(connectionEditor.id))throw Error('Invalid connection name')
  const d=JSON.parse(connectionEditor.json)
  if(connectionEditor.kind==='cli'&&!['codex','plugin'].includes(d.kind)||connectionEditor.kind==='subscription'&&!d.subscription||connectionEditor.kind==='api'&&(['codex','plugin'].includes(d.kind)||d.subscription))throw Error('Connection method and configuration differ')
  const result=await api('/settings',{revision:S.base.revision,patch:{backends:{...S.base.config.backends,[connectionEditor.id]:d}}})
  connectionEditor.notice=L('Saved; configure Router / Workers to use it.','已保存；可在 Router / Workers 中选择。')
  resetDraft(result);S.snap=await snapshot();await readEntries();render()
 })},'button primary'),el('p','hint',connectionEditor.notice))
 return form
}
