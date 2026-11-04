import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,statSync,chmodSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {parse} from 'jsonc-parser'
import {clientConfig,clientIds,installClient,restoreClient} from '../src/clients.ts'
const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){const root=mkdtempSync(join(tmpdir(),'agenthub-clients-'));roots.push(root);return {root,file:join(root,'client.json'),backupDir:join(root,'backups'),client:'cursor' as const,tokenFile:join(root,'private-token'),node:process.execPath}}
it.each(clientIds)('generates the documented %s stdio schema with literal path arguments',client=>{
 const o=fixture(),c=clientConfig({...o,client,root:join(o.root,'中文 space'),tokenFile:join(o.root,'token with spaces')})
 const entry=(c.config as any)[c.info.root]['agent-hub']
 if(client==='opencode'){expect(entry.type).toBe('local');expect(entry.command).toEqual([c.server.command,...c.server.args]);expect(entry.enabled).toBe(true)}
 else {expect(entry.command).toBe(process.execPath);expect(entry.args).toEqual(c.server.args)}
 if(['vscode','copilot','claude-code','workbuddy'].includes(client))expect(entry.type).toBe('stdio')
 expect(c.server.args.at(-1)).toBe(join(o.root,'token with spaces'))
 expect(c.text).not.toContain('Bearer ')
 if(client==='codex')expect(c.text).toContain('[mcp_servers.agent-hub]')
 else expect(JSON.parse(c.text)).toEqual(c.config)
})
it('preserves JSONC comments, other servers and top-level settings, then restores exact bytes and mode',()=>{
 const o=fixture(),before='// retain this comment\n{"mcpServers":{"other":{"command":"other","env":{"EXAMPLE":"keep"}}},"theme":"dark",}\n'
 writeFileSync(o.file,before);chmodSync(o.file,0o666)
 const result=installClient(o)
 expect(result.changed).toBe(true);expect(readFileSync(o.file,'utf8')).toContain('// retain this comment')
 expect(parse(readFileSync(o.file,'utf8'))).toMatchObject({mcpServers:{other:{command:'other',env:{EXAMPLE:'keep'}}},theme:'dark'})
 expect(statSync(o.file).mode&0o777).toBe(0o666)
 expect(installClient(o).changed).toBe(false)
 expect(statSync(join(o.backupDir,result.backupId!+'.before')).mode&0o777).toBe(0o600)
 restoreClient(o.backupDir,result.backupId!)
 expect(readFileSync(o.file,'utf8')).toBe(before);expect(statSync(o.file).mode&0o777).toBe(0o666)
})
it('treats reordered JSON keys as an unchanged server',()=>{
 const o=fixture(),c=clientConfig(o);writeFileSync(o.file,JSON.stringify({mcpServers:{'agent-hub':{args:c.server.args,command:c.server.command}}}))
 expect(installClient(o).changed).toBe(false)
 expect(existsSync(o.backupDir)).toBe(false)
})
it('restores a newly created file by removing only that file',()=>{
 const o=fixture(),r=installClient(o);expect(existsSync(o.file)).toBe(true)
 restoreClient(o.backupDir,r.backupId!);expect(existsSync(o.file)).toBe(false)
})
it('refuses rollback after a user edit',()=>{
 const o=fixture(),r=installClient(o);writeFileSync(o.file,'{"userEdit":true}\n')
 expect(()=>restoreClient(o.backupDir,r.backupId!)).toThrow('changed')
 expect(readFileSync(o.file,'utf8')).toBe('{"userEdit":true}\n')
})
it.each([null,false,{command:'different'}])('requires explicit replacement even for an existing falsy entry %j',entry=>{
 const o=fixture(),before=JSON.stringify({mcpServers:{'agent-hub':entry}});writeFileSync(o.file,before)
 expect(()=>installClient(o)).toThrow('already exists');expect(readFileSync(o.file,'utf8')).toBe(before)
 expect(installClient({...o,replace:true}).changed).toBe(true)
})
it.each(['[1,2]','{"mcpServers":[]}','{bad json'])('rejects malformed configuration without changing it: %s',before=>{
 const o=fixture();writeFileSync(o.file,before);expect(()=>installClient(o)).toThrow();expect(readFileSync(o.file,'utf8')).toBe(before)
})
it('refuses to replace symlinks, including broken ones',()=>{
 const o=fixture(),target=join(o.root,'target');writeFileSync(target,'{}\n');symlinkSync(target,o.file)
 expect(()=>installClient(o)).toThrow('regular file');expect(readFileSync(target,'utf8')).toBe('{}\n')
 rmSync(target);expect(()=>installClient(o)).toThrow('regular file')
})
it.each(['https://example.com','http://localhost:4326/path','http://user:pass@localhost:4326','http://127.0.0.1:4326/?key=x'])('rejects non-loopback origins and embedded credentials: %s',url=>{
 expect(()=>clientConfig({...fixture(),url})).toThrow('loopback')
})
it('supports a distinct server name without overwriting other entries',()=>{
 const o=fixture();installClient({...o,name:'agent-hub-test'})
 expect(parse(readFileSync(o.file,'utf8')).mcpServers['agent-hub-test']).toBeDefined()
 expect(()=>clientConfig({...o,name:'invalid.name'})).toThrow('Invalid server name')
})
it('uses project scopes and refuses undocumented scopes or TOML rewriting',()=>{
 const o=fixture(),r=installClient({...o,file:undefined,workspace:o.root,client:'vscode'})
 expect(r.path).toBe(join(o.root,'.vscode/mcp.json'))
 expect(()=>installClient({...o,file:undefined,workspace:o.root,client:'workbuddy'})).toThrow('project scope')
 expect(()=>installClient({...o,client:'codex'})).toThrow('TOML');expect(existsSync(o.file)).toBe(false)
})
