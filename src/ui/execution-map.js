// The original Tool Access Map composition, driven by recorded host calls.
function executionModeTabs(){
 const tabs=affectSegmented({id:'execution-mode-tab',label:L('Execution view','执行视图'),value:executionView.mode,options:[{value:'calls',label:L('Live activity','运行记录'),controls:'execution-mode-panel'},{value:'configuration',label:L('Configure team','配置团队')+(changed().some(key=>['execution','models','concurrency'].includes(key))?' •':''),controls:'execution-mode-panel'}],onChange:value=>opNavigate('execution','',{view:value})})
 tabs.classList.add('execution-mode-tabs');return tabs
}
function executionActors(){
 const architecture=operator.work?.architecture,services=controlConnections(),label=id=>services.find(s=>s.id===id)?.label||(id==='codex'?'Codex':L('Model service','模型服务'))
 return [{kind:'router',id:'router',name:'Router',backend:label(architecture?.router.backend),model:architecture?.router.model},...(architecture?.workers||[]).map((worker,index)=>({kind:'worker',id:worker.id,name:worker.label||'Worker '+(index+1),backend:label(worker.backend),model:worker.model}))]
}
const executionActorValue=actor=>actor.kind+':'+actor.id
function executionCurrentActor(){const actors=executionActors();return actors.find(actor=>actor.kind===executionView.selected?.kind&&(actor.kind==='router'||actor.id===executionView.selected.id))||actors[0]}
function executionCallsPage(page){
 page.classList.add('execution-calls-page')
 page.append(opHeading(L('Agent team','Agent 团队')),executionModeTabs())
 const panel=el('section','execution-call-overview');panel.id='execution-mode-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','execution-mode-tab-calls')
 const actor=executionCurrentActor();executionView.selected={kind:actor.kind,id:actor.id}
 panel.append(el('div','execution-map-topline'))
 const tabs=affectSegmented({id:'execution-actor-tab',label:L('Select Router or Worker','选择 Router 或 Worker'),value:executionActorValue(actor),options:executionActors().map(a=>({value:executionActorValue(a),label:a.name,controls:'execution-map-body'})),onChange:value=>{const selected=executionActors().find(a=>executionActorValue(a)===value);if(selected)executionPickActor(selected)}});tabs.id='execution-actor-tabs';tabs.classList.add('execution-actor-tabs');tabs.dataset.actors=JSON.stringify(executionActors().map(executionActorValue));panel.append(tabs,el('div','execution-map-body'));panel.querySelector('.execution-map-body').id='execution-map-body'
 page.append(el('p','execution-live-status'),panel)
 const dialog=executionInstructions();if(dialog)page.append(dialog);const calls=executionCallDialog();if(calls)page.append(calls)
 queueMicrotask(()=>executionMount(page));return [page]
}
function executionPickActor(actor,focus=false){
 executionView.selected={kind:actor.kind,id:actor.id};executionView.root?.querySelector('#execution-actor-tabs')?.selectValue(executionActorValue(actor));executionMountCallMap()
 if(focus)executionView.root?.querySelector('#execution-map-center-history')?.focus({preventScroll:true})
}
function executionMapNode({key,kind,id,name,model,action,glyph}){
 const node=el('button','execution-map-node tam-node');node.type='button';node.id='execution-map-node-'+key;node.dataset.mapKey=key;node.dataset.mapKind=kind;node.dataset.mapId=id
 let mark=glyph?icon(glyph):kind==='app'?opMark(id):icon(kind==='tool'?'prompts':'cpu')
 if(kind==='app'&&executionAssets[id]){mark=opMark(id,'small')}
 add(node,add(el('span','execution-map-node-title'),mark,el('strong','',name)),model?el('span','execution-map-node-model',model):null,el('span','execution-map-node-state'))
 node.onclick=action||(()=>executionOpenCalls(kind,id,node.id));return node
}
function executionMapBody(){
 const actor=executionCurrentActor(),map=el('div','execution-call-map tam-surface');map.setAttribute('role','group');map.setAttribute('aria-label',actor.name+' '+L('connections','关联调用'));map.dataset.actor=executionActorValue(actor)
 const wires=document.createElementNS('http://www.w3.org/2000/svg','svg')
 wires.classList.add('execution-wires')
 map.append(wires)
 const left=el('div','execution-map-side execution-map-left'),right=el('div','execution-map-side execution-map-right'),actors=executionActors()
 if(actor.kind==='router'){
  const entries=entryState.data?.entries?.filter(entry=>entry.category==='client'?entry.client?.installed||entry.status==='verified':entry.sources?.some(source=>source.enabled))||[]
  for(const entry of entries)left.append(executionMapNode({key:'app-'+entry.id,kind:'app',id:entry.id,name:entryName(entry)}))
  if(!entries.length)left.append(affectButton(L('New connection','新建接入'),()=>opNavigate('catalogue'),{glyph:'plus'}))
  for(const name of executionRouterTools())left.append(executionMapNode({key:'tool-'+name,kind:'tool',id:name,name:L(...(executionToolLabels[name]||[name,name]))}))
  for(const worker of actors.filter(a=>a.kind==='worker'))right.append(executionMapNode({key:'worker-'+worker.id,kind:'worker',id:worker.id,name:worker.name,model:worker.model,action:()=>executionPickActor(worker,true)}))
  const queue=el('div','execution-map-queue tam-node',L('Queue','队列'));queue.dataset.mapKey='queue';map.append(queue)
 }else{
  const names=operator.work?.architecture?.tools||[],router=actors[0]
  left.append(executionMapNode({key:'caller-router',kind:'router',id:'router',name:'Router',model:router.model,action:()=>executionPickActor(router,true),glyph:'activity'}))
  names.forEach((name,index)=>{(index<Math.floor(names.length/2)?left:right).append(executionMapNode({key:'tool-'+name,kind:'tool',id:name,name:L(...(executionToolLabels[name]||[name,name]))}))})
 }
 const center=el('section','execution-map-center tam-node');center.dataset.mapKey='center'
 const title=el('h2','',actor.name),state=el('span','execution-map-center-state'),model=el('p','execution-map-model'),task=el('p','execution-map-task'),stats=el('button','execution-map-history');stats.type='button';stats.id='execution-map-center-history';stats.onclick=()=>executionOpenCalls(actor.kind,actor.id,stats.id)
 const configure=affectButton(L('Configure','配置'),()=>opNavigate('execution','',{view:'configuration'}),{variant:'ghost'});configure.classList.add('execution-map-configure')
 center.append(add(el('div','execution-map-center-content'),add(el('div','execution-map-center-heading'),icon(actor.kind==='router'?'activity':'cpu'),title,state),model,task,stats,add(el('div','execution-map-center-actions'),configure,executionEditInstructions(actor.kind))))
 map.style.setProperty('--map-rows',String(Math.max(left.children.length,right.children.length)));map.style.minHeight=Math.max(390,Math.max(left.children.length,right.children.length)*82+24)+'px';map.append(left,center,right);return map
}
function executionMountCallMap(){
 const root=executionView.root;if(!root?.isConnected)return
 executionView.motion?.destroy()
 const body=root.querySelector('.execution-map-body');body.setAttribute('role','tabpanel');body.setAttribute('aria-labelledby','execution-actor-tab-'+executionActorValue(executionCurrentActor()));body.replaceChildren(executionMapBody())
 const map=root.querySelector('.execution-call-map'),nodes=new Map([...map.querySelectorAll('[data-map-key]')].map(node=>[node.dataset.mapKey,node]))
 executionView.motion=AgentHubMotion.createFlowMotion({root:map,svg:map.querySelector('.execution-wires'),nodes})
 executionPaintCallMap();executionView.motion.reveal(map.querySelector('.execution-map-center-content'))
}
function executionPaintCallMap(){
 const root=executionView.root,map=root?.querySelector('.execution-call-map');if(!map)return
 map.dataset.stale=String(executionView.stale)
 if(root.querySelector('#execution-actor-tabs').dataset.actors!==JSON.stringify(executionActors().map(executionActorValue))){render();return}
 const actor=executionCurrentActor();if(map.dataset.actor!==executionActorValue(actor)){executionMountCallMap();return}
 const calls=executionCalls(),records=calls.filter(call=>executionMatches(call,actor.kind,actor.id)),running=records.filter(call=>call.state==='running').length,active=records.find(call=>call.kind===actor.kind&&call.state==='running'),service=active?.backend||actor.backend,model=active?.model||actor.model
 root.querySelector('.execution-map-topline').textContent=running+' '+L('running','执行中')+' · '+records.length+' '+L('recorded','次记录')
 root.querySelector('.execution-map-model').textContent=(active?.model?L('Actual model','实际模型'):L('Configured model','配置模型'))+' · '+service+(model?' / '+model:'')
 root.querySelector('.execution-map-center-state').textContent=running?executionState('running'):L('Idle','空闲');root.querySelector('.execution-map-center-state').dataset.state=running?'running':'idle'
 const task=actor.kind==='worker'?operator.work?.architecture?.workers?.find(w=>w.id===actor.id)?.active?.[0]?.title:'';root.querySelector('.execution-map-task').textContent=task||'';root.querySelector('.execution-map-task').hidden=!task
 root.querySelector('.execution-map-history').textContent=L(records.length+' recorded '+(records.length===1?'call':'calls'),records.length+' 次调用记录')
 const status=root.querySelector('.execution-live-status');status.textContent=executionView.stale?L('Connection lost. Showing the last known state; reconnecting…','连接中断，显示最后已知状态，正在重连…'):'';status.hidden=!executionView.stale
 const edges=[]
 for(const node of map.querySelectorAll('.execution-map-node')){
  const related=calls.filter(call=>executionMatches(call,node.dataset.mapKind,node.dataset.mapId)),state=executionSummary(related);node.dataset.state=state
  node.querySelector('.execution-map-node-state').textContent=related.length?(node.dataset.mapKind==='tool'?executionCallState({...related[0],state}):executionState(state))+' · '+related.length:L('No recorded calls','尚无调用记录')
  if(actor.kind==='router'&&node.dataset.mapKind==='worker')edges.push({id:node.dataset.mapKey,from:'queue',to:node.dataset.mapKey,state:executionMotionState(related.filter(c=>c.kind!=='tool'))})
  else if(node.dataset.mapKind==='router'&&actor.kind==='worker')edges.push({id:node.dataset.mapKey,from:node.dataset.mapKey,to:'center',state:executionMotionState(records.filter(c=>c.kind==='worker'))})
  else if(node.dataset.mapKind==='app')edges.push({id:node.dataset.mapKey,from:node.dataset.mapKey,to:'center',state:executionMotionState(related.filter(c=>c.kind==='router'))})
  else edges.push({id:node.dataset.mapKey,from:'center',to:node.dataset.mapKey,state:executionMotionState(related)})
 }
 if(actor.kind==='router')edges.push({id:'router-queue',from:'center',to:'queue',state:executionMotionState(calls.filter(c=>c.kind==='router'))})
 executionView.motion.setEdges(edges)
}
