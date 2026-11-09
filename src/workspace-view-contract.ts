/** Browser-safe contract. Metadata only: no credentials, prompts, tool arguments or native session history. */
export interface ViewCatalogItem {id:string;label:{en:string;'zh-CN':string};version:string|null;digest:string;available:boolean;capabilities:('workspace.runtime.read')[]}
export type TaskState='queued'|'running'|'attention'|'ready'|'replied'|'closed'
export interface ViewQuery {source?:string;state?:TaskState;search?:string;offset?:number}
export interface ViewTask {id:string;title:string;state:TaskState;sourceId:string;sourceLabel:string;updatedAt:string;summary:string;workerId?:string;replySent:boolean;replyRead:boolean;deliveryUncertain:boolean;approvals:number}
export interface ViewCall {id:string;kind:'router'|'worker'|'subagent'|'tool';name:string;state:'running'|'completed'|'failed'|'interrupted';workerId?:string;ticketId?:string;sourceId?:string;model?:string;startedAt:number;endedAt?:number}
export interface ViewAgent {id:string;label:string;model:string|null;backend:string;active:number;taskIds:string[];state:'enabled'|'paused'|'retiring'}
export interface ViewSnapshot {
  usage?:import('./usage-contract.ts').UsageSummary;
  at:number;paused:boolean;query:ViewQuery;
  sources:{id:string;label:string;kind:string;enabled:boolean;status:'ok'|'retrying'|'error'|'unknown';at:number|null}[];
  team:{router:ViewAgent;workers:ViewAgent[];totalWorkers:number};
  counts:Record<TaskState,number>;
  tasks:{items:ViewTask[];total:number;offset:number;limit:number;more:boolean};
  attention:{items:ViewTask[];total:number};
  browsers:{total:number;items:{id:string;workerId?:string;control:'worker'|'human'|'paused'|'handoff'|'ended'}[]};
  calls:{items:ViewCall[];totalRetained:number;limit:number};
  listening:{limit:number;admissions:{id:string;sourceId:string;at:string;state:string;basis:'explicit'|'inferred'|'none'}[];batches:{id:string;messages:number;phase:string}[]};
  decision:{mode:'off'|'shadow'|'advisory';scope:'workspace';retained:number;probesExcluded:number;inputTokens:number|null;outputTokens:number|null;inputReported:number;outputReported:number;records:{id:string;at:number;mode:string;model:string;status:string;latencyMs:number;actions:string[]}[]};
}
export type HostViewMessage={type:'environment';dark:boolean;language:'en'|'zh-CN'}|{type:'snapshot';data:ViewSnapshot}|{type:'connection';state:'loading'|'live'|'stale'|'hidden'}
export type ViewHostMessage={type:'refresh'}|{type:'query';query:ViewQuery}|{type:'navigate';destination:'tasks'|'attention'|'team'|'models'|'conversation'|'browser'}
