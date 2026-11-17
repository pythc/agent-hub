import type {ChatSessions} from '../../src/chat.ts';

type Snapshot=ReturnType<ChatSessions['view']>;
export type CompanionPhase='idle'|'thinking'|'working'|'reviewing'|'waiting'|'completed'|'failed'|'stopped'|'offline';
export interface CompanionStatus {phase:CompanionPhase;label:string;runId?:string}
type Localize=(en:string,zh:string)=>string;

export function companionStatus(snapshot:Snapshot|null, L:Localize, options:{participantId?:string;connected:boolean;sending?:boolean;loading?:boolean}):CompanionStatus{
 const result=(phase:CompanionPhase,label:string):CompanionStatus=>({phase,label,runId:snapshot?.run?.id});
 if(!options.connected)return result('offline',L('Reconnecting','正在重新连接'));
 if(options.loading)return result('idle',L('Loading conversation','正在加载会话'));
 if(options.sending)return result('thinking',L('Receiving your message','正在接收消息'));
 const run=snapshot?.run;
 if(!snapshot||!run)return result('idle',L('Ready when you are','随时待命'));
 const participant=options.participantId;
 const worker=participant?snapshot.workers.find(w=>w.id===participant):undefined;
 if(participant&&!worker)return result('idle',L('Conversation history','历史协作记录'));
 const tasks=snapshot.workers.filter(w=>!participant||w.id===participant).flatMap(w=>w.tasks);
 const activeTasks=new Set(tasks.filter(t=>t.state==='running'||t.state==='queued').map(t=>t.id));
 const waiting=tasks.some(t=>t.state==='waiting');
 const busy=snapshot.workers.filter(w=>(!participant||w.id===participant)&&w.tasks.some(t=>t.state==='running'));
 const active=activeTasks.size>0||waiting||!participant&&!!snapshot.reply;
 const calls=snapshot.calls.filter(c=>(c.runId===run.id||!!c.ticketId&&activeTasks.has(c.ticketId)||!participant&&c.runId===snapshot.reply?.runId)&&(!participant||c.workerId===participant)&&c.name!=='superagent_status');
 if(participant&&!worker?.tasks.length&&!calls.length)return result('idle',L('Ready when you are','随时待命'));
 if(!active){
   if(run.state==='cancel_requested')return result('stopped',L('Stopping this task','正在停止任务'));
   if(run.state==='cancelled')return result('stopped',L('Task stopped','任务已停止'));
   if(run.state==='failed')return result('failed',L('Task needs attention','任务需要处理'));
   if(run.state==='waiting')return result('waiting',L('Waiting for your input','等你补充信息'));
   if(run.state==='completed')return result('completed',L('Task complete','本次任务已完成'));
 }
 if(snapshot.browsers.some(b=>(b.runId===run.id||!!b.ticketId&&activeTasks.has(b.ticketId))&&!b.ended&&b.control==='paused'&&(!participant||b.workerId===participant)))
   return result('waiting',L('Waiting for your help','等你操作浏览器'));
 if(waiting&&!activeTasks.size&&(participant||!snapshot.reply))return result('waiting',L('Waiting for your input','等你补充信息'));
 if(worker){
   if(worker.tasks.some(t=>t.state==='waiting')&&!worker.tasks.some(t=>t.state==='running'))return result('waiting',L('Waiting for your input','等你补充信息'));
   if(worker.tasks.length&&!worker.tasks.some(t=>t.state==='running'||t.state==='queued'))return result('idle',L('Ready when you are','随时待命'));
 }
 const live=calls.filter(c=>c.state==='running');
 const reported=live.filter(c=>c.status).sort((a,b)=>b.status!.updatedAt-a.status!.updatedAt)[0]?.status;
 const tool=live.filter(c=>c.kind==='tool').at(-1);
 // A new observable operation supersedes an earlier model label.
 if(reported&&(!tool||reported.updatedAt>=tool.startedAt))return result(reported.phase,reported.label);
 if(tool){
   const action=tool.action??tool.name;
   if(/review|verify|test|check/.test(action))return result('reviewing',L('Checking the results','正在检查结果'));
   if(action.startsWith('browser:')||action==='superagent_browser')return result('working',L('Working in the browser','正在操作浏览器'));
   if(action==='superagent_read'||action==='router_read')return result('reviewing',L('Reading the materials','正在查阅资料'));
   if(action==='assign'||action==='superagent_spawn')return result('working',L('Coordinating the team','正在协调团队'));
   return result('working',L('Working on your task','正在处理任务'));
 }
 if(reported)return result(reported.phase,reported.label);
 if(busy.length>1)return result('working',L(busy.length+' agents are working',busy.length+' 位成员正在处理'));
 if(busy.length)return result('working',L('Working on your task','正在处理任务'));
 return result('thinking',run.state==='queued'?L('Preparing to start','正在准备任务'):L('Thinking through the task','正在思考'));
}
