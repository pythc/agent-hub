// Live call metadata drives the Tool Access Map motion; this file never executes tools.
const executionToolLabels={superagent_read:['Read resources','读取资源'],superagent_shell:['Shell','命令执行'],superagent_job:['Background jobs','后台任务'],superagent_spawn:['Subagents','子智能体'],superagent_ack:['Acknowledge','确认收到'],superagent_progress:['Progress','进展记录'],superagent_publish:['Publish draft','发布草稿'],superagent_review:['Code review','代码评审'],superagent_follow:['Follow context','跟进上下文']}
const executionCalls=()=>operator.work?.architecture?.activity||[]
const executionState=state=>({running:L('Running','执行中'),completed:L('Completed','已完成'),failed:L('Failed','失败'),interrupted:L('Interrupted','已中断')})[state]||L('No calls','尚无调用')
const executionCallState=call=>call.kind==='tool'&&call.state==='completed'?L('Returned','已返回'):executionState(call.state)
function executionMatches(call,kind,id){
 if(kind==='app')return call.entryId===id
 if(kind==='router')return call.kind==='router'||call.kind==='tool'&&executionCalls().some(parent=>parent.id===call.parentId&&parent.kind==='router')
 if(kind==='worker')return call.workerId===id&&call.kind!=='router'
 return call.kind==='tool'&&call.name===id&&executionMatches(call,executionView.selected.kind,executionView.selected.id)
}
function executionHistoryButton(kind,id){
 const button=affectButton('',()=>executionOpenCalls(kind,id,button.id),{variant:'ghost'});button.id='execution-history-'+kind+'-'+(id||'router');button.classList.add('execution-call-count');button.dataset.callKind=kind;button.dataset.callKey=id||'';return button
}
function executionNodeHeading(label,kind,id,index){
 const heading=el(kind==='router'?'h2':'h3'),button=el('button','execution-node-select',label);button.type='button';button.dataset.selectKind=kind;button.dataset.selectKey=id||''
 button.setAttribute('aria-label',L('Show '+label+' tools','查看 '+label+' 的工具'));button.onclick=()=>{executionView.selected={kind,id};executionSelectTools(true)};heading.append(button)
 return add(el('div','execution-worker-heading'),heading,executionHistoryButton(kind,id))
}
function executionTools(){
 const section=el('section','execution-tools');section.setAttribute('aria-label',L('Tool calls','工具调用'));return section
}
function executionSelectTools(navigate=false){
 const root=executionView.root;if(!root?.isConnected)return
 const tools=root.querySelector('.execution-tools'),selected=executionView.selected,label=selected.kind==='router'?'Router':'Worker '+(executionDraft().workers.findIndex(w=>w.id===selected.id)+1)
 const names=selected.kind==='router'?['superagent_read']:(operator.work?.architecture?.tools||[])
 const owner=el('button','execution-tools-owner',label);owner.type='button';owner.setAttribute('aria-label',L('Back to '+label,'返回 '+label));owner.onclick=()=>{const node=[...root.querySelectorAll('[data-select-kind]')].find(n=>n.dataset.selectKind===selected.kind&&(selected.kind==='router'||n.dataset.selectKey===selected.id));node?.focus({preventScroll:true});node?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'})}
 tools.replaceChildren(add(el('div','execution-tools-heading'),el('h2','',L('Tools','工具')),owner))
 for(const name of names){
  const button=el('button','execution-tool tam-node');button.type='button';button.dataset.tool=name;button.id='execution-tool-'+name
  button.append(el('span','execution-tool-name',L(...(executionToolLabels[name]||[name,name]))),el('span','execution-tool-state'));button.onclick=()=>executionOpenCalls('tool',name,button.id);tools.append(button)
 }
 if(!names.length)tools.append(el('p','control-hint',L('No tool catalogue available.','尚未取得工具目录。')))
 for(const node of root.querySelectorAll('[data-select-kind]'))node.setAttribute('aria-pressed',String(node.dataset.selectKind===selected.kind&&(selected.kind==='router'||node.dataset.selectKey===selected.id)))
 executionPaint();executionView.motion?.reveal(tools)
 if(navigate&&tools.getBoundingClientRect().top>=root.querySelector('.execution-workers').getBoundingClientRect().bottom){owner.focus({preventScroll:true});tools.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'})}
}
function executionSummary(calls){return calls.some(c=>c.state==='running')?'running':calls.reduce((latest,call)=>!latest||(call.endedAt??call.startedAt)>(latest.endedAt??latest.startedAt)?call:latest,null)?.state||'idle'}
function executionMotionState(calls){const state=executionSummary(calls);return executionView.stale&&state==='running'?'unknown':({completed:'done',interrupted:'cancelled'})[state]||state}
function executionPaint(){
 const root=executionView.root;if(!root?.isConnected)return
 if(root.querySelector('.execution-call-overview')){executionPaintCallMap();executionUpdateCallDialog();return}
 const calls=executionCalls(),status=root.querySelector('.execution-live-status');status.textContent=executionView.stale?L('Connection lost. Showing the last known state; reconnecting…','连接中断，显示最后已知状态，正在重连…'):'';status.hidden=!executionView.stale;status.setAttribute('role','status')
 for(const button of root.querySelectorAll('[data-call-kind]')){
  const records=calls.filter(c=>executionMatches(c,button.dataset.callKind,button.dataset.callKey)),running=records.filter(c=>c.state==='running').length
  button.hidden=!records.length;button.querySelector('.ui-button__label').textContent=running?executionState('running')+' '+running:L(records.length+' '+(records.length===1?'call':'calls'),records.length+' 次调用');button.dataset.state=executionSummary(records)
 }
 for(const node of root.querySelectorAll('.execution-router,.execution-worker')){
  const kind=node.classList.contains('execution-router')?'router':'worker',records=calls.filter(c=>executionMatches(c,kind,node.dataset.workerId));node.dataset.state=executionSummary(records);node.dataset.selected=String(executionView.selected.kind===kind&&(kind==='router'||executionView.selected.id===node.dataset.workerId))
  if(kind==='worker'){
   const active=operator.work?.architecture?.workers?.find(w=>w.id===node.dataset.workerId)?.active||[],text=active.map(task=>task.title).join(' · '),previous=node.querySelector('.execution-worker-task')
   if(text){if(previous)previous.textContent=text;else node.append(el('p','execution-worker-task',text))}else previous?.remove()
  }
 }
 for(const button of root.querySelectorAll('.execution-tool')){
  const records=calls.filter(c=>executionMatches(c,'tool',button.dataset.tool)),state=executionSummary(records);button.dataset.state=state
  button.querySelector('.execution-tool-state').textContent=records.length?(state==='completed'?L('Returned','已返回'):executionState(state))+' · '+records.length:L('Not used yet','尚未调用')
 }
 const graph=root.querySelector('.execution-graph'),nodes=new Map([['router',root.querySelector('.execution-router')],['queue',root.querySelector('.execution-queue')]])
 for(const source of graph.querySelectorAll('.execution-source'))nodes.set('app:'+source.dataset.entryId,source)
 for(const worker of graph.querySelectorAll('.execution-worker'))nodes.set('worker:'+worker.dataset.workerId,worker)
 for(const tool of graph.querySelectorAll('.execution-tool'))nodes.set('tool:'+tool.dataset.tool,tool)
 const vertical=graph.querySelector('.execution-queue').getBoundingClientRect().top>=graph.querySelector('.execution-router').getBoundingClientRect().bottom,edges=[]
 for(const source of graph.querySelectorAll('.execution-source'))edges.push({id:'app:'+source.dataset.entryId,from:'app:'+source.dataset.entryId,to:'router',state:executionMotionState(calls.filter(c=>c.kind==='router'&&c.entryId===source.dataset.entryId)),axis:vertical?'y':'x'})
 edges.push({id:'router-queue',from:'router',to:'queue',state:executionMotionState(calls.filter(c=>c.kind==='router')),axis:vertical?'y':'x'})
 for(const worker of graph.querySelectorAll('.execution-worker'))edges.push({id:'queue:'+worker.dataset.workerId,from:'queue',to:'worker:'+worker.dataset.workerId,state:executionMotionState(calls.filter(c=>c.kind!=='tool'&&c.workerId===worker.dataset.workerId)),axis:vertical?'y':'x'})
 const tools=graph.querySelector('.execution-tools'),pool=graph.querySelector('.execution-workers'),side=tools.getBoundingClientRect().left>=pool.getBoundingClientRect().right
 if(side)for(const tool of graph.querySelectorAll('.execution-tool'))edges.push({id:'tool:'+tool.dataset.tool,from:executionView.selected.kind==='router'?'router':'worker:'+executionView.selected.id,to:'tool:'+tool.dataset.tool,state:executionMotionState(calls.filter(c=>executionMatches(c,'tool',tool.dataset.tool)))})
 executionView.motion?.setNodes(nodes);executionView.motion?.setEdges(edges);executionUpdateCallDialog()
}
// The shared left bus keeps narrow-layout paths outside Worker cards.
function executionRoute(edge,rects,bounds){
 const root=executionView.root,pool=root.querySelector('.execution-workers').getBoundingClientRect(),sources=root.querySelector('.execution-sources').getBoundingClientRect(),a=rects.get(edge.from),b=rects.get(edge.to)
 if(!a||!b)return
 const p=r=>({left:r.left-bounds.left,right:r.right-bounds.left,top:r.top-bounds.top,bottom:r.bottom-bounds.top,x:(r.left+r.right)/2-bounds.left,y:(r.top+r.bottom)/2-bounds.top}),from=p(a),to=p(b),queue=p(rects.get('queue')),router=p(rects.get('router')),vertical=queue.top>=router.bottom
 if(edge.id.startsWith('queue:')){
  const bus=pool.left-bounds.left-18
  return executionPath(vertical?[[queue.x,queue.bottom],[queue.x,pool.top-bounds.top-20],[bus,pool.top-bounds.top-20],[bus,to.y],[to.left,to.y]]:[[from.right,from.y],[bus,from.y],[bus,to.y],[to.left,to.y]])
 }
 if(edge.id.startsWith('app:')&&vertical)return AgentHubMotion.roundedConnector({x:(sources.left+sources.right)/2-bounds.left,y:sources.bottom-bounds.top},{x:to.x,y:to.top},{axis:'y'})
 if(edge.id.startsWith('app:'))return AgentHubMotion.roundedConnector({x:from.right,y:from.y},{x:to.left,y:to.y})
 if(edge.id==='router-queue')return AgentHubMotion.roundedConnector(vertical?{x:from.x,y:from.bottom}:{x:from.right,y:from.y},vertical?{x:to.x,y:to.top}:{x:to.left,y:to.y},{axis:vertical?'y':'x'})
 if(edge.id.startsWith('tool:')&&b.left<pool.right)return ''
 if(edge.id.startsWith('tool:')&&edge.from==='router'){
  const bus=pool.left-bounds.left-18,right=to.left-18,top=-20
  return executionPath([[from.right,from.y],[bus,from.y],[bus,top],[right,top],[right,to.y],[to.left,to.y]])
 }
}
function executionPath(raw){
 const points=[];for(const point of raw){const prev=points.at(-1);if(prev&&Math.hypot(point[0]-prev[0],point[1]-prev[1])<.5)continue;while(points.length>1){const a=points.at(-2),b=points.at(-1);if(Math.abs((b[0]-a[0])*(point[1]-b[1])-(b[1]-a[1])*(point[0]-b[0]))>.1)break;points.pop()}points.push(point)}
 let path='M '+points[0].join(' ');for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],before=Math.hypot(b[0]-a[0],b[1]-a[1]),after=Math.hypot(c[0]-b[0],c[1]-b[1]),r=Math.min(9,before/2,after/2);path+=' L '+[b[0]+(a[0]-b[0])*r/before,b[1]+(a[1]-b[1])*r/before].join(' ')+' Q '+b.join(' ')+' '+[b[0]+(c[0]-b[0])*r/after,b[1]+(c[1]-b[1])*r/after].join(' ')}
 return path+' L '+points.at(-1).join(' ')
}
function executionUnmount(){
 executionView.motion?.destroy()
 executionView.motion=null
 executionView.root=null
}
function executionMount(root){
 if(!root.isConnected)return
 executionUnmount();executionView.root=root
 if(root.querySelector('.execution-call-overview'))executionMountCallMap()
 else{executionView.motion=AgentHubMotion.createFlowMotion({root:root.querySelector('.execution-graph'),svg:root.querySelector('.execution-wires'),pathForEdge:executionRoute});executionSelectTools()}
 const instructions=root.querySelector('#execution-instructions');if(instructions&&!instructions.open)instructions.showModal()
 const calls=root.querySelector('#execution-call-dialog');if(calls&&!calls.open){calls.showModal();executionView.motion.details(calls);calls.querySelector('.execution-detail-close').focus()}
}
function executionOpenCalls(kind,id,focus){executionView.inspect={kind,id,focus};executionView.callId=null;executionView.dialogVersion++;render()}
function executionCloseCalls(){
 const version=++executionView.dialogVersion,dialog=document.getElementById('execution-call-dialog'),focus=executionView.inspect?.focus
 const close=()=>{if(version!==executionView.dialogVersion)return;executionView.inspect=null;dialog?.close();render();queueMicrotask(()=>document.getElementById(focus)?.focus({preventScroll:true}))}
 const animation=dialog&&executionView.motion?.details(dialog,{enter:false});if(animation)void animation.finished.then(close,()=>{if(matchMedia('(prefers-reduced-motion:reduce)').matches)close()});else close()
}
function executionCallDialog(){
 if(!executionView.inspect)return null
 const dialog=el('dialog','execution-call-dialog tam-detail');dialog.id='execution-call-dialog';dialog.setAttribute('aria-labelledby','execution-call-title')
 const close=affectButton(L('Close','关闭'),executionCloseCalls,{variant:'ghost'});close.classList.add('execution-detail-close')
 const title=el('h2','',L('Calls','调用记录'));title.id='execution-call-title'
 dialog.append(add(el('div','execution-dialog-heading'),title,close),el('div','execution-call-body'));dialog.oncancel=e=>{e.preventDefault();executionCloseCalls()};return dialog
}
function executionDuration(call){return call.endedAt==null?executionState(call.state):Math.max(0,call.endedAt-call.startedAt).toLocaleString()+' ms'}
function executionUpdateCallDialog(){
 const dialog=executionView.root?.querySelector('#execution-call-dialog');if(!dialog)return
 const scope=executionView.inspect,records=executionCalls().filter(c=>executionMatches(c,scope.kind,scope.id)),body=dialog.querySelector('.execution-call-body')
 const signature=JSON.stringify([records,lang,executionView.callId]);if(body.dataset.signature===signature)return;body.dataset.signature=signature
 const focused=body.contains(document.activeElement)?document.activeElement?.dataset.callId:null
 const selected=records.find(c=>c.id===executionView.callId)||records[0];executionView.callId=selected?.id
 const list=el('div','execution-call-list');list.setAttribute('role','listbox');list.setAttribute('aria-label',L('Call history','调用历史'))
 for(const [index,call]of records.entries()){
  const button=el('button','execution-call-item');button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(call.id===selected.id));button.tabIndex=call.id===selected.id?0:-1;button.dataset.callId=call.id
  button.append(el('strong','',call.kind==='tool'?L(...(executionToolLabels[call.name]||[call.name,call.name])):call.kind==='router'?'Router':call.kind==='subagent'?L('Subagent','子智能体'):L('Worker','Worker')),el('span','',executionCallState(call)),el('time','',opTime(call.startedAt)))
  button.onclick=()=>{executionView.callId=call.id;executionUpdateCallDialog()};button.onkeydown=e=>{const next=e.key==='ArrowDown'?Math.min(index+1,records.length-1):e.key==='ArrowUp'?Math.max(index-1,0):e.key==='Home'?0:e.key==='End'?records.length-1:-1;if(next<0)return;e.preventDefault();executionView.callId=records[next].id;executionUpdateCallDialog();dialog.querySelector('[data-call-id="'+records[next].id+'"]').focus()};list.append(button)
 }
 if(!selected){body.replaceChildren(el('p','',L('No recorded calls yet.','尚无调用记录。')));return}
 const detail=el('div','execution-call-inspector'),name=selected.kind==='tool'?L(...(executionToolLabels[selected.name]||[selected.name,selected.name])):selected.kind==='router'?'Router':selected.kind==='subagent'?L('Subagent','子智能体'):'Worker'
 const metadata=el('dl');for(const [label,value]of [[L('State','状态'),executionCallState(selected)],[L('Duration','耗时'),executionDuration(selected)],[L('Software','软件入口'),entryName(selected.entryId)],[L('Actual service','实际服务'),selected.backend],[L('Actual model','实际模型'),selected.model]])if(value)metadata.append(el('dt','',label),el('dd','',value))
 detail.append(el('h3','',name),metadata)
 if(selected.kind==='tool')detail.append(el('p','control-hint',L('Arguments and output remain in the task resources.','参数和输出保留在任务资源中。')))
 if(selected.ticketId)detail.append(affectButton(L('Open task','查看任务'),()=>{executionView.inspect=null;void openOperatorTask(selected.ticketId)},{variant:'secondary'}))
 body.replaceChildren(list,detail)
 if(focused)body.querySelector('[data-call-id="'+focused+'"]')?.focus({preventScroll:true})
}
let executionPolling=false
setInterval(async()=>{
 if(executionPolling||document.hidden||!executionView.root?.isConnected||!S.authed||S.busy||entryState.busy||operator.drawer)return
 executionPolling=true;const root=executionView.root
 try{const snapshot=await api(operatorWorkPath());if(root!==executionView.root||!root.isConnected)return;operator.work=snapshot;executionView.stale=false;executionPaint()}
 catch(error){if(root!==executionView.root||!root.isConnected)return;if(error.status===401){entryError(error);render()}else{executionView.stale=true;executionPaint()}}
 finally{executionPolling=false}
},1000)
