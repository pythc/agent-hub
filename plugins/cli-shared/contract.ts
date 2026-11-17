import type {ModelRequest} from '../backend-sdk.ts'
export interface CliConfig {
 command:string;args?:string[];cliVersion:string;model?:string;authDirectory?:string
 baseUrl?:string;provider?:string;authMode?:'credentials'|'anonymous'
}
export interface NativeEvent {session?:string;model?:string;text?:string;final?:string;done?:boolean;error?:string;tool?:string}
export interface LaunchContext {
 config:CliConfig;root:string;cwd:string;nativeId?:string;newId:string
 request:ModelRequest;mcp:{url:string;token:string};prompt:string
}
export interface CliDriver {
 id:string;version:string;credentialEnvs:string[]
 upstream(config:CliConfig,model?:string):string
 credentialKeys?(config:CliConfig):string[]
 anonymous?(config:CliConfig):boolean
 prepare(context:LaunchContext):{args:string[];env:Record<string,string>;stdin:string}
 event(value:any):NativeEvent
 toolName(native:string):string|undefined
 discoverSession?(root:string):string|undefined
 auth?(directory:string,config:CliConfig):{identity:string;files:{source:string;target:string}[]}|undefined
}
