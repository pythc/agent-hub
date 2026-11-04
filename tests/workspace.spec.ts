import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {prepareWorkspace} from '../src/workspace.ts'
const roots:string[]=[]
afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
it('prepares a writable non-Git task in a separate directory and retries a failed prepare',async()=>{
 const root=mkdtempSync(join(tmpdir(),'agent-workspace-'));roots.push(root)
 const script='const fs=require("node:fs");if(!fs.existsSync("attempt")){fs.writeFileSync("attempt","1");process.exit(2)}fs.writeFileSync("report.txt","prepared")'
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'docs',kind:'custom',allowedActors:['alice'],cwd:root,sandbox:'workspace-write',workspace:{mode:'directory',prepare:{command:process.execPath,args:['-e',script]}}}]})
 await expect(prepareWorkspace(config,config.sources[0]!,'one')).rejects.toThrow()
 const cwd=await prepareWorkspace(config,config.sources[0]!,'one')
 expect(cwd).not.toBe(root)
 expect(readFileSync(join(cwd,'report.txt'),'utf8')).toBe('prepared')
 expect(await prepareWorkspace(config,config.sources[0]!,'one')).toBe(cwd)
})
