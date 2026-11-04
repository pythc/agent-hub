import {homedir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,lstatSync,unlinkSync,chmodSync} from 'node:fs'
import {isDeepStrictEqual} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {parse,modify,applyEdits,type ParseError} from 'jsonc-parser'
export const clientIds=['generic','cursor','vscode','copilot','workbuddy','claude-code','claude-desktop','gemini','qwen','opencode','cline','roo','kiro','codex'] as const
export type ClientId=typeof clientIds[number]
export const clientInfo:Record<ClientId,{docs:string;file:string;root:string;project?:string}>={
 generic:{docs:'https://modelcontextprotocol.io/docs/develop/connect-local-servers',file:'mcp.json',root:'mcpServers'},
 cursor:{docs:'https://cursor.com/docs/mcp',file:'.cursor/mcp.json',root:'mcpServers',project:'.cursor/mcp.json'},
 vscode:{docs:'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',file:'Library/Application Support/Code/User/mcp.json',root:'servers',project:'.vscode/mcp.json'},
 copilot:{docs:'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',file:'.copilot/mcp-config.json',root:'mcpServers',project:'.mcp.json'},
 workbuddy:{docs:'https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector',file:'.workbuddy/mcp.json',root:'mcpServers'},
 'claude-code':{docs:'https://code.claude.com/docs/en/mcp',file:'.claude.json',root:'mcpServers',project:'.mcp.json'},
 'claude-desktop':{docs:'https://modelcontextprotocol.io/docs/develop/connect-local-servers',file:'Library/Application Support/Claude/claude_desktop_config.json',root:'mcpServers'},
 gemini:{docs:'https://geminicli.com/docs/tools/mcp-server/',file:'.gemini/settings.json',root:'mcpServers',project:'.gemini/settings.json'},
 qwen:{docs:'https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md',file:'.qwen/settings.json',root:'mcpServers',project:'.qwen/settings.json'},
 opencode:{docs:'https://opencode.ai/docs/mcp-servers/',file:'.config/opencode/opencode.json',root:'mcp',project:'opencode.json'},
 cline:{docs:'https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx',file:'.cline/data/settings/cline_mcp_settings.json',root:'mcpServers'},
 roo:{docs:'https://docs.roocode.com/features/mcp/using-mcp-in-roo',file:'Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json',root:'mcpServers',project:'.roo/mcp.json'},
 kiro:{docs:'https://kiro.dev/docs/mcp/configuration/',file:'.kiro/settings/mcp.json',root:'mcpServers',project:'.kiro/settings/mcp.json'},
 codex:{docs:'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',file:'.codex/config.toml',root:'mcp_servers'},
}
export interface ClientOptions {client:ClientId;url?:string;tokenFile?:string;root?:string;node?:string;name?:string;workspace?:string;home?:string}
export function clientConfig(o:ClientOptions){
 if(!clientIds.includes(o.client))throw Error('Unknown client')
 const root=resolve(o.root??fileURLToPath(new URL('..',import.meta.url))),url=new URL(o.url??'http://127.0.0.1:4319')
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Use a loopback host origin')
 const name=o.name??'agent-hub';if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name))throw Error('Invalid server name')
 const server={command:o.node??process.execPath,args:['--import',join(root,'node_modules/tsx/dist/loader.mjs'),join(root,'src/cli.ts'),'mcp',url.origin,resolve(o.tokenFile??join(root,'.superagent/access-token'))]}
 const info=clientInfo[o.client]
 const definition=o.client==='opencode'?{type:'local',command:[server.command,...server.args],enabled:true}:['vscode','claude-code','copilot','workbuddy'].includes(o.client)?{type:'stdio',...server}:server
 const config={[info.root]:{[name]:definition}}
 const text=o.client==='codex'?'[mcp_servers.'+name+']\ncommand = '+JSON.stringify(server.command)+'\nargs = '+JSON.stringify(server.args)+'\n':JSON.stringify(config,null,2)+'\n'
 return {config,text,server,definition,name,info}
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
function snapshot(path:string){
 let stat;try{stat=lstatSync(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {existed:false,text:'{}\n',mode:0o600};throw error}
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Client config must be a regular file; symlinks are not replaced')
 return {existed:true,text:readFileSync(path,'utf8'),mode:stat.mode&0o777}
}
/** Edit only the selected entry, preserve comments/other servers, and refuse unknown replacement. */
export function installClient(o:ClientOptions&{replace?:boolean;file?:string;backupDir?:string}){
 const c=clientConfig(o)
 if(o.client==='codex')throw Error('Use the generated TOML or the official Codex configuration API; this installer does not rewrite TOML')
 const path=resolve(o.file??(o.workspace?join(o.workspace,c.info.project??(()=>{throw Error('This client has no documented project scope')})()):join(o.home??homedir(),c.info.file)))
 const initial=snapshot(path),original=initial.text,errors:ParseError[]=[]
 const current=parse(original,errors,{allowTrailingComma:true})
 if(errors.length||!current||typeof current!=='object'||Array.isArray(current))throw Error('Existing client configuration is not a JSON/JSONC object')
 const group=current[c.info.root]
 if(group!==undefined&&(!group||typeof group!=='object'||Array.isArray(group)))throw Error('Existing server container is not an object')
 const existing=group?.[c.name]
 if(group&&Object.hasOwn(group,c.name)&&isDeepStrictEqual(existing,c.definition))return {path,changed:false,name:c.name}
 if(group&&Object.hasOwn(group,c.name)&&!o.replace)throw Error('Server name already exists. Inspect it and explicitly replace only this entry.')
 const next=applyEdits(original,modify(original,[c.info.root,c.name],c.definition,{formattingOptions:{insertSpaces:true,tabSize:2,eol:'\n'}}))
 const backupRoot=resolve(o.backupDir??join(fileURLToPath(new URL('..',import.meta.url)),'.local/client-backups'));mkdirSync(backupRoot,{recursive:true,mode:0o700})
 const id=randomUUID(),record={id,path,before:sha(original),after:sha(next),existed:initial.existed,mode:initial.mode,at:new Date().toISOString()}
 writeFileSync(join(backupRoot,id+'.before'),original,{mode:0o600,flag:'wx'})
 writeFileSync(join(backupRoot,id+'.json'),JSON.stringify(record),{mode:0o600,flag:'wx'})
 mkdirSync(dirname(path),{recursive:true});const temp=path+'.agenthub-'+id
 try{writeFileSync(temp,next,{mode:initial.mode,flag:'wx'});chmodSync(temp,initial.mode);const latest=snapshot(path);if(latest.existed!==initial.existed||sha(latest.text)!==record.before)throw Error('Configuration changed while preparing install');renameSync(temp,path)}finally{if(existsSync(temp))unlinkSync(temp)}
 return {path,changed:true,name:c.name,backupId:id,backupDir:backupRoot}
}
export function restoreClient(backupDir:string,id:string){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid backup id')
 const root=resolve(backupDir),record=JSON.parse(readFileSync(join(root,id+'.json'),'utf8')),before=readFileSync(join(root,id+'.before'),'utf8')
 const latest=snapshot(record.path)
 if(record.id!==id||sha(before)!==record.before||!latest.existed||sha(latest.text)!==record.after)throw Error('Client configuration changed; refusing to overwrite later edits')
 if(record.existed){const temp=record.path+'.restore-'+id;try{writeFileSync(temp,before,{mode:record.mode??0o600,flag:'wx'});chmodSync(temp,record.mode??0o600);renameSync(temp,record.path)}finally{if(existsSync(temp))unlinkSync(temp)}}else unlinkSync(record.path)
 return {restored:true,path:record.path}
}
