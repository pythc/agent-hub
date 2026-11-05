export const dashboard = String.raw`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AgentHub</title>
<style>
body{font:16px system-ui;background:#f6f7f4;color:#27322c;max-width:1100px;margin:36px auto;padding:0 24px}h1{font-size:28px}h2{font-size:20px}h3{font-size:17px}
fieldset{border:1px solid #dce2dd;margin:12px 0;min-width:0}label{display:block;margin:8px 0}input,textarea,button,select{max-width:100%;box-sizing:border-box;font:inherit;border:1px solid #c6cec8;border-radius:6px;padding:9px;background:#fff}button{cursor:pointer}button:hover{background:#edf3ef}
textarea{display:block;width:95%;min-height:100px;margin:12px 0}article{background:white;border:1px solid #dce2dd;border-radius:10px;padding:18px;margin:15px 0}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}p{white-space:pre-wrap}small,.muted{color:#647269}#error{color:#a52727}
pre{white-space:pre-wrap;word-break:break-word;font-size:13px;background:#f5f7f5;padding:12px;border-radius:6px}a{color:#216d4b}.tag{font-size:13px;color:#647269}
</style><header><h1>AgentHub</h1><p class="muted">从原对话继续协作，在需要你决定或结果可用时回到这里。</p><a href="/configure">Configuration / 配置</a></header>
<input id="token" type="password" placeholder="本机 access-token 文件中的令牌"><button id="connect">连接</button><span id="health"></span>
<section id="controls" hidden><nav id="tabs"></nav><input id="search" placeholder="搜索请求、讨论、结果或记录 ID"><button id="refresh">刷新</button>
<article><nav><input id="source" value="local" aria-label="来源"><input id="thread" value="conversation" aria-label="讨论标识"></nav>
<textarea id="message" placeholder="希望 Agent 做什么"></textarea><nav><button id="send">发送</button><button id="pause">暂停新工作</button><button id="resume">继续处理</button></nav></article></section>
<p id="error"></p><main id="work"></main>
<script>
let token='',view='overview',state,settings,models,prompts;
const el=id=>document.getElementById(id),root=el('work');
async function api(path,body){const response=await fetch(path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error||response.status);return value}
async function guard(fn){try{el('error').textContent='';await fn()}catch(e){el('error').textContent=e.message}}
function text(tag,value){const node=document.createElement(tag);node.textContent=value;return node}
function button(label,action){const b=text('button',label);b.onclick=()=>guard(action);return b}
function json(value){return text('pre',JSON.stringify(value,null,2))}
function matches(item){return !el('search').value||JSON.stringify(item).toLowerCase().includes(el('search').value.toLowerCase())}
function detail(label,value){const d=document.createElement('details');d.append(text('summary',label),json(value));return d}
async function refresh(){state=await api('/status');el('controls').hidden=false;el('health').textContent=state.paused?' · 新工作已暂停':'';render()}
function render(){
 root.replaceChildren();const tabs=el('tabs');tabs.replaceChildren();
 for(const [key,label] of [['overview','需要关注'],['sources','来源'],['threads','讨论与事件'],['decisions','判断'],['execution','执行记录'],['eval','Eval'],['resources','资源'],['models','模型'],['prompts','提示词'],['settings','设置与历史']])tabs.append(button(label,async()=>{view=key;if(view==='settings')settings=await api('/settings');if(view==='models')models=await api('/read',{resource:'models'});if(view==='prompts')prompts=await api('/prompts');render()}));
 if(view==='settings'){renderSettings();return}
 if(view==='resources'){renderResources();return}
 if(view==='models'){root.append(text('h2','执行后端与模型目录'),text('p','客户端只是入口；实际执行由所选后端承担。已有会话固定原后端。API 后端的配置模型清单不代表已验证远端认证。'),json(models));return}
 if(view==='prompts'){root.append(text('h2','提示词部分与使用版本'),button('预览 Worker 提示词',async()=>{root.append(json(await api('/prompt-preview',{role:'worker'})))}));for(const part of prompts.parts)if(matches(part))root.append(detail(part.id+(part.defaultChanged?' · 默认内容已升级':''),part));root.append(detail('实际使用版本',prompts.history));return}
 if(view==='eval'){root.append(text('h2','评估队列'));for(const thread of state.threads.filter(t=>(t.evaluating||t.pending.length)&&matches(t)))root.append(detail(thread.key,thread));for(const d of state.decisions.filter(matches))root.append(detail(d.kind+' · '+d.threadKey,d));return}
 if(view==='sources'){
  root.append(text('p','办公接入：连接机器人后先发一条测试消息，再核对下面的用户 ID。允许成员后，请重新发送任务；忽略的旧消息不会自动执行。'),button('检查环境与身份',async()=>{root.append(json(await api('/setup-check',{})))}))
  for(const s of state.sources.filter(matches)){const a=document.createElement('article');a.append(text('h2',s.source),text('p',s.status==='ok'?'最近轮询成功':s.error||'尚未核实'),detail('来源状态',s))
   for(const live of (state.liveSources||[]).filter(x=>x.source===s.source))a.append(detail('机器人连接状态',live))
   if((state.sourceCapabilities||[]).some(c=>c.source===s.source&&c.memberDirectory))a.append(button('预览成员同步',async()=>{const preview=await api('/members-preview',{source:s.source});a.append(json(preview),button('应用此成员列表',async()=>{await api('/members-apply',{id:preview.id});await refresh()}))}));root.append(a)
  }
  for(const sender of (state.observedSenders||[]).filter(s=>!s.allowed&&matches(s))){const a=document.createElement('article');a.append(text('h3','待确认成员 · '+sender.source),text('p','用户 ID：'+sender.actor),text('p','来源会话：'+sender.chat),button('允许此成员交代任务',async()=>{
   const current=(await api('/settings')).current
   const sources=current.config.sources.map(s=>s.id===sender.source?{...s,allowedActors:[...new Set([...s.allowedActors,sender.actor])]}:s)
   await api('/settings',{revision:current.revision,patch:{sources}});await refresh()
  }));root.append(a)}
  if(!(state.observedSenders||[]).some(s=>!s.allowed))root.append(text('p','当前没有待确认成员。'));return
 }
 if(view==='threads'){for(const t of state.threads.filter(t=>matches(t)||state.events.some(e=>e.threads.some(r=>r.source+':'+r.id===t.key)&&matches(e)))){const a=document.createElement('article');a.append(text('h2',t.key),detail('订阅与判断状态',t));for(const e of state.events.filter(e=>e.threads.some(r=>r.source+':'+r.id===t.key)))a.append(detail(e.text.slice(0,80),e));a.append(button('取消此讨论的订阅',async()=>{await api('/domain',{action:'unsubscribe',id:t.key});await refresh()}));root.append(a)}if(!root.children.length)root.append(text('p','没有匹配的讨论或事件。'));return}
 if(view==='decisions'){for(const d of state.decisions.filter(matches)){const a=document.createElement('article');a.append(text('h2',d.kind+' · '+d.threadKey),json(d),button('重新评估原事件',async()=>{await api('/domain',{action:'reevaluate',id:d.triggerIds[0]});await refresh()}));root.append(a)}return}
 for(const approval of state.approvals.filter(a=>a.status==='pending'&&matches(a))){const a=document.createElement('article');a.append(text('h2','需要你的批准'),json(approval.native));if(approval.native.method==='item/tool/requestUserInput'){const fields=[];for(const q of approval.native.params.questions||[]){const label=text('label',q.question||q.header||q.id),input=document.createElement('input'),list=document.createElement('datalist');input.type=q.isSecret?'password':'text';input.id='answer-'+fields.length;label.htmlFor=input.id;list.id=input.id+'-options';input.setAttribute('list',list.id);for(const option of q.options||[]){const o=document.createElement('option');o.value=option.label;list.append(o)}a.append(label,input,list);fields.push({id:q.id,input})}a.append(button('提交回答',async()=>{const answer={};for(const f of fields){if(!f.input.value.trim())throw Error('请填写每个问题');answer[f.id]={answers:[f.input.value]}}await api('/approval',{id:approval.id,answer});await refresh()}))}else for(const [value,label] of [['decline','拒绝'],['accept','批准本次']])a.append(button(label,async()=>{await api('/approval',{id:approval.id,answer:value});await refresh()}));root.append(a)}
 const ranked=[...state.tickets].sort((a,b)=>(b.stage.stage==='person')-(a.stage.stage==='person'));
 for(const t of ranked.filter(matches)){
  if(view==='overview'&&t.stage.stage==='ended'&&!t.run?.result)continue;
  const a=document.createElement('article');a.append(text('h2',t.title),text('small',t.stage.stage+(t.stage.action?' · '+t.stage.action:'')),text('p',(t.run?.waitingForWriter?'等待桌面释放此聊天。请在操作员聊天执行交还步骤，随后重试。':'')||t.attention?.question||t.run?.result||t.assignments.at(-1)?.report?.summary||t.mandate.scope));
  const nav=document.createElement('nav');
  const native=t.run?.backendKind?t.run.backendKind==='codex':t.run?.threadId?true:state.execution?.backends.find(b=>b.id===state.execution.roles.worker)?.nativeTakeover;
  for(const [action,label] of [['stop','停止'],...(native?[['takeover','接管'],['return','交还']]:[]),['retry','核对后重试']])nav.append(button(label,async()=>{await api('/action',{action,id:t.id});await refresh()}));
  if(t.run?.threadId&&(!t.run.backendKind||t.run.backendKind==='codex')){const link=text('a','打开原生 Codex 会话');link.href='codex://threads/'+encodeURIComponent(t.run.threadId);nav.append(link)}
  a.append(nav,detail('授权、输入与执行历史',t));for(const job of (state.work||[]).filter(w=>w.ticketId===t.id))a.append(detail(job.kind+' · '+job.state+' · '+job.id,job));for(const grant of (state.mergeGrants||[]).filter(g=>g.ticketId===t.id))a.append(detail('合并授权 · '+grant.head,grant),button('撤销合并授权',async()=>{await api('/merge-revoke',{source:grant.source,number:grant.number});await refresh()}));root.append(a);
 }
 for(const m of state.deliveries.filter(m=>(m.status==='uncertain'||m.status==='pending')&&matches(m))){const a=document.createElement('article');a.append(text('h3','待交付或需核对'),text('p',m.error||m.text),button('核对后重试交付',async()=>{await api('/retry-delivery',{id:m.id});await refresh()}));root.append(a)}
 if(!root.children.length)root.append(text('p','当前没有需要处理的记录。'));
}
function editable(config){const result={};for(const key of ['execution','model','models','effort','concurrency','acceptMode','rules','prompts','sources','watchdog','work','delivery'])if(key in config)result[key]=config[key];return result}
function renderResources(){
 const a=document.createElement('article'),input=document.createElement('input'),scope=document.createElement('select'),output=document.createElement('div');
 input.id='resource-path';input.value='catalog';input.setAttribute('aria-label','资源路径');scope.id='resource-scope';scope.append(new Option('操作员全局资源',''));for(const t of state.tickets)scope.append(new Option(t.title,t.id));
 let cursor,offset=0;
 async function read(next=false){if(!next){cursor=undefined;offset=0;output.replaceChildren()}const value=await api('/read',{resource:input.value,...(scope.value?{ticketId:scope.value}:{}),offset,...(cursor?{cursor}:{})});cursor=value.cursor;offset=value.nextOffset;if(value.kind==='image'){const image=document.createElement('img');image.alt='资源图片';image.style.maxWidth='100%';image.src='data:'+value.mimeType+';base64,'+value.data;output.append(image)}else output.append(json(value));more.hidden=offset===null||offset===undefined}
 const more=button('下一页',()=>read(true));more.hidden=true;a.append(text('h2','资源浏览器'),scope,input,button('读取资源',()=>read()),more,output);root.append(a);
}
function field(label,value,onChange){
 const wrap=document.createElement('fieldset');wrap.append(text('legend',label));
 if(Array.isArray(value)){
  if(value.every(v=>typeof v==='string')){const input=document.createElement('textarea');input.value=value.join('\n');input.setAttribute('aria-label',label);input.oninput=()=>onChange(input.value.split('\n').map(x=>x.trim()).filter(Boolean));wrap.append(input)}
  else{const list=document.createElement('div');function rows(){list.replaceChildren();value.forEach((v,i)=>{const row=field(label+' '+(i+1),v,x=>{value[i]=x;onChange(value)});row.append(button('移除此项',async()=>{value.splice(i,1);onChange(value);rows()}));list.append(row)})}rows();wrap.append(list,button('添加一项',async()=>{value.push(label==='rules'?{id:'new-rule',instruction:''}:{});onChange(value);rows()}))}
 }else if(value&&typeof value==='object'){
  if(['skills','overrides','admission'].includes(label)){const input=document.createElement('textarea');input.value=JSON.stringify(value,null,2);input.setAttribute('aria-label',label);input.onchange=()=>guard(async()=>onChange(JSON.parse(input.value)));wrap.append(input)}
  else for(const [key,v] of Object.entries(value))wrap.append(field(key,v,x=>{value[key]=x;onChange(value)}));
 }else{
  const input=document.createElement(typeof value==='string'&&value.length>120?'textarea':'input');input.setAttribute('aria-label',label);if(typeof value==='boolean'){input.type='checkbox';input.checked=value;input.onchange=()=>onChange(input.checked)}else{input.type=typeof value==='number'?'number':'text';input.value=value??'';input.oninput=()=>onChange(typeof value==='number'?Number(input.value):input.value)}wrap.append(input);
 }
 return wrap;
}
function renderSettings(){
 const a=document.createElement('article'),draft=editable(structuredClone(settings.current.config));draft.models={router:'',worker:'',subagent:'',...draft.models};a.append(text('h2','配置版本 '+settings.current.revision),text('p','按组编辑并保存。来源部署字段更改需要受控重启。自动合并需要独立合并身份；可选逐提交授权或显式团队策略，且必须通过审批与 CI 检查。'));
 for(const [key,label] of [['acceptMode','主动工作模式'],['rules','准入规则'],['sources','来源与允许列表'],['prompts','团队提示词'],['execution','执行后端与角色分配'],['model','Codex 默认模型（旧配置兼容）'],['models','各角色模型覆盖'],['effort','Codex 推理强度'],['concurrency','执行槽位'],['work','后台作业'],['delivery','交付与合并'],['watchdog','监控']])if(key in draft){const d=document.createElement('details');d.append(text('summary',label));if(key==='execution'){
  const names=[...new Set(['codex',...Object.keys(settings.current.config.backends||{})])];draft.execution.roles=draft.execution.roles||{};
  for(const [role,title] of [['default','默认后端'],['router','路由后端'],['worker','主执行后端'],['subagent','子代理后端']]){const wrap=text('label',title),select=document.createElement('select');select.setAttribute('aria-label',title);if(role!=='default')select.append(new Option('沿用默认后端',''));for(const name of names)select.append(new Option(name,name));select.value=role==='default'?draft.execution.backend:draft.execution.roles[role]||'';select.onchange=()=>{if(role==='default')draft.execution.backend=select.value;else if(select.value)draft.execution.roles[role]=select.value;else delete draft.execution.roles[role]};wrap.append(select);d.append(wrap)}
  d.append(text('p','已有会话固定原后端；新配置用于新会话。新增后端地址及凭据环境变量名需在配置文件中设置后受控重启。'));
 }else d.append(field(key,draft[key],value=>draft[key]=value));a.append(d)}
 a.append(button('保存分组设置',async()=>{await api('/settings',{revision:settings.current.revision,patch:draft});settings=await api('/settings');await refresh()}));
 const advanced=document.createElement('details'),input=document.createElement('textarea');input.style.minHeight='300px';input.value=JSON.stringify(draft,null,2);advanced.append(text('summary','高级 JSON 编辑'),input,button('保存此版本',async()=>{await api('/settings',{revision:settings.current.revision,patch:JSON.parse(input.value)});settings=await api('/settings');await refresh()}));a.append(advanced);
 for(const item of settings.history)a.append(detail('版本 '+item.revision+' · '+item.at,item),button('恢复为版本 '+item.revision,async()=>{await api('/settings',{revision:settings.current.revision,patch:editable(item.config)});settings=await api('/settings');await refresh()}));root.append(a);
}
el('connect').onclick=()=>guard(async()=>{token=el('token').value;await refresh()});el('refresh').onclick=()=>guard(refresh);el('search').oninput=()=>{if(state)render()};
el('send').onclick=()=>guard(async()=>{await api('/send',{source:el('source').value,event:{id:crypto.randomUUID(),thread:el('thread').value,text:el('message').value,addressed:true}});el('message').value='';await refresh()});
for(const action of ['pause','resume'])el(action).onclick=()=>guard(async()=>{await api('/action',{action});await refresh()});
const requestedTicket=new URLSearchParams(location.search).get('ticket');if(requestedTicket&&requestedTicket.length<=200)el('search').value=requestedTicket;
void guard(async()=>{if((await api('/session')).operator){el('token').hidden=true;el('connect').hidden=true;await refresh()}});
</script></html>`
