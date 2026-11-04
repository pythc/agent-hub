import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {GithubSource} from '../src/connectors/github.ts'
import {Store} from '../src/store.ts'
import {deliverDraft} from '../src/delivery.ts'
it('rejects a hidden alternate push URL before staging, committing or pushing anything',async()=>{
 const root=mkdtempSync(join(tmpdir(),'delivery-fence-')),bin=join(root,'bin'),log=join(root,'git-log'),path=process.env.PATH;mkdirSync(bin)
 writeFileSync(join(bin,'git'),'#!'+process.execPath+'\nconst fs=require("node:fs"),args=process.argv.slice(2);fs.appendFileSync('+JSON.stringify(log)+',JSON.stringify(args)+"\\n");if(args.includes("--push"))console.log("https://github.com/other/repo.git");else if(args.includes("get-url"))console.log("https://github.com/owner/repo.git");else process.exit(3)\n',{mode:0o700})
 process.env.PATH=bin+':'+path
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'github',kind:'github',repository:'owner/repo',cwd:root}]}),store=new Store(join(root,'state.sqlite')),source=new GithubSource(config.sources[0]!)
 store.tickets.save({id:'task',mandate:{actor:{source:'github'}}} as any);store.put('run','task',{ticketId:'task',assignmentId:'a',cwd:root,phase:'idle'})
 try{
  await expect(deliverDraft({store,sources:new Map([['github',source]])} as any,'task','github','Test','Test')).rejects.toThrow('Push destination')
  const calls=readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x));expect(calls).toHaveLength(2);expect(calls.every(a=>a.includes('get-url'))).toBe(true)
  expect(store.get<any>('run','task').phase).toBe('idle')
 }finally{process.env.PATH=path;store.close();rmSync(root,{recursive:true,force:true})}
})
