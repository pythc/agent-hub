export interface NativeControl { steer(text:string):Promise<void>; interrupt():Promise<void>;refresh?(instructions:string):Promise<void> }
export interface NativeRequest { id:string; method:string; params:any }
export interface ToolSpec {type:'function';name:string;description:string;inputSchema:Record<string,unknown>}
export interface ToolContent {type:'inputText'|'inputImage';text?:string;imageUrl?:string}
export interface ModelRequest {
  cwd: string; instructions: string; input: string; schema: Record<string, unknown>
  role?: 'router'|'worker'|'subagent'; onBackend?:(id:string)=>void
  model?:string;onModel?:(model:string)=>void
  title?: string; threadId?: string; ephemeral?: boolean; sandbox?: 'read-only' | 'workspace-write'
  signal?: AbortSignal
  operator?:boolean
  archiveOnComplete?:boolean
  tools?:ToolSpec[]
  onTool?:(name:string,args:unknown,callId:string)=>Promise<{contentItems:ToolContent[];success:boolean}>
  workerMcp?:{command:string;args:string[]}
  managed?:boolean
  privateState?:string
  onCapabilities?:(value:{mcpServers:string[];disabledPlugins:string[];managed:boolean;backend?:BackendDescription})=>void
  onActive?: (control:NativeControl)=>void
  onHumanRequest?: (request:NativeRequest)=>Promise<unknown>
  onProgress?: (event:string)=>void
  onThread?: (id: string) => void; onTurn?: (id: string) => void
}
export interface ModelResult { threadId: string; turnId: string; text: string }
export interface BackendDescription { id:string;kind:string;nativeTakeover:boolean;images:boolean;resume:boolean;tools:boolean;steering:boolean;promptRefresh:boolean;model?:string }
export interface Model { describe?(threadId?:string,role?:'router'|'worker'|'subagent'):BackendDescription; run(request: ModelRequest): Promise<ModelResult>; expose?(threadId:string,cwd:string):Promise<void>;history?(threadId:string,cwd:string):Promise<any>;catalog?(provider?:string):Promise<any> }
