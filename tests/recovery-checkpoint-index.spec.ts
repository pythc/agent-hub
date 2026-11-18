import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {expect,it} from 'vitest'
import {Store} from '../src/store.ts'
import {checkpointQuery} from '../src/recovery-manifest.ts'

it('upgrades retained audit history and bounds missing-stage checkpoint lookups',()=>{
 const root=mkdtempSync(join(tmpdir(),'checkpoint-index-')),path=join(root,'state.db')
 let store:Store|undefined
 try{
  // Pre-index database, including malformed and unrelated legacy audit data.
  const old=new DatabaseSync(path)
  old.exec("CREATE TABLE audit(seq INTEGER PRIMARY KEY,at TEXT NOT NULL,body TEXT NOT NULL); PRAGMA user_version=6; BEGIN")
  const insert=old.prepare("INSERT INTO audit(at,body) VALUES('now',?)")
  for(let n=0;n<100000;n++)insert.run(JSON.stringify({type:'unrelated',ticketId:'other',n}))
  insert.run('not JSON');insert.run(JSON.stringify({type:'execution.trace',schema:2,ticketId:'target',stage:'tool'}))
  insert.run(JSON.stringify({type:'execution.trace',schema:1,ticketId:'target',stage:'tool',baseline:true}))
  const latest=Number(insert.run(JSON.stringify({type:'execution.trace',schema:1,ticketId:'target',stage:'tool'})).lastInsertRowid)
  // execution-call model transitions are stored under stage=tool for legacy
  // projection compatibility, but the trace presents them as run events.
  for(const callKind of ['worker','router','subagent'])insert.run(JSON.stringify({type:'execution.trace',schema:1,ticketId:'target',stage:'tool',callKind}))
  old.exec('COMMIT');old.close()
  store=new Store(path)
  const plan=store.db.prepare('EXPLAIN QUERY PLAN '+checkpointQuery).all('target','tool').map(r=>r.detail).join('\n')
  expect(plan).toContain('SEARCH audit USING INDEX audit_trace_checkpoint')
  expect(plan).not.toMatch(/SCAN audit|TEMP B-TREE/)
  const query=store.db.prepare(checkpointQuery)
  expect(query.get('target','tool')).toMatchObject({seq:latest,baseline:null})
  expect(query.get('target','delivery')).toBeUndefined()
  // Exercise a page of entirely absent stages; query plan, not wall-clock,
  // provides a deterministic complexity regression across CI platforms.
  for(let n=0;n<100;n++)for(const stage of ['tool','acceptance','delivery'])expect(query.get('missing-'+n,stage)).toBeUndefined()
  store.db.prepare('DELETE FROM audit WHERE seq=?').run(latest)
  expect(query.get('target','tool')).toMatchObject({baseline:1})
  store.db.close();store=new Store(path)
  expect(store.db.prepare(checkpointQuery).get('target','tool')).toMatchObject({baseline:1})
 }finally{store?.db.close();rmSync(root,{recursive:true,force:true})}
})
