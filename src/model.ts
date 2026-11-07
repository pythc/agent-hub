import type {ExecutionContext} from './execution-activity.ts'
import type {AgentOptions} from './backend-config.ts'
export interface NativeControl {
  /** onRead acknowledges a durable source input only once it enters model history. */
  steer(text:string,onRead?:()=>void):Promise<void>
  interrupt():Promise<void>
  refresh?(instructions:string):Promise<void>
}
/** A temporary provider/transport failure, distinct from cancellation or invalid output. */
export class TransientModelError extends Error {}
export interface NativeRequest { id:string; method:string; params:any }
export interface ToolSpec {type:'function';name:string;description:string;inputSchema:Record<string,unknown>}
export interface ToolContent {type:'inputText'|'inputImage';text?:string;imageUrl?:string}
/** Public assistant output only. Provider reasoning and tool arguments never enter this channel. */
export interface ModelOutput {id:string;type:'start'|'delta'|'end';text?:string;phase:'answer'|'commentary'}
export interface ModelRequest {
  options?:AgentOptions
  principal?:{source:string;actor:string}
  onConfiguration?:(value:{requested:AgentOptions;sent:Record<string,unknown>;confirmed?:Record<string,unknown>})=>void
  activity?:ExecutionContext
  cwd: string; instructions: string; input: string; schema: Record<string, unknown>
  role?: 'router'|'worker'|'subagent'; backendId?:string; onBackend?:(id:string)=>void
  model?:string;onModel?:(model:string)=>void
  title?: string; threadId?: string; ephemeral?: boolean; sandbox?: 'read-only' | 'workspace-write'
  signal?: AbortSignal
  operator?:boolean
  archiveOnComplete?:boolean
  tools?:ToolSpec[]
  onTool?:(name:string,args:unknown,callId:string)=>Promise<{contentItems:ToolContent[];success:boolean}>
  workerMcp?:{command:string;args:string[]}
  managed?:boolean
  /** Host-owned migration of legacy native context; never replaces the thread. */
  compactBeforeTurn?:boolean
  skipContextCompaction?:boolean
  onContextReady?:()=>void
  privateState?:string
  onCapabilities?:(value:{mcpServers:string[];disabledPlugins:string[];managed:boolean;backend?:BackendDescription})=>void
  onActive?: (control:NativeControl)=>void
  onHumanRequest?: (request:NativeRequest)=>Promise<unknown>
  onProgress?: (event:string)=>void
  onOutput?: (event:ModelOutput)=>void
  onThread?: (id: string) => void; onTurn?: (id: string) => void
}
export interface ModelResult { threadId: string; turnId: string; text: string }
export interface BackendDescription { id:string;kind:string;nativeTakeover:boolean;images:boolean;resume:boolean;tools:boolean;steering:boolean;promptRefresh:boolean;model?:string }
export interface Model { describe?(threadId?:string,role?:'router'|'worker'|'subagent'):BackendDescription; run(request: ModelRequest): Promise<ModelResult>; expose?(threadId:string,cwd:string):Promise<void>;history?(threadId:string,cwd:string):Promise<any>;catalog?(provider?:string):Promise<any> }
