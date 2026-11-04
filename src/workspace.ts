import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, realpathSync, mkdirSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SourceConfig, Config } from './config.ts'

/** Code writes use a separate checkout; non-repository analysis needs only its configured read-only directory. */
const exec=promisify(execFile)
export async function prepareWorkspace(config: Config, source: SourceConfig, ticketId: string,signal?:AbortSignal): Promise<string> {
  if (source.sandbox === 'read-only'||source.workspace?.mode==='source') return realpathSync(source.cwd)
  const suffix = createHash('sha256').update(ticketId).digest('hex').slice(0,20)
  const directory = join(config.stateDir, 'work', suffix)
  if(source.workspace?.mode==='directory'||!source.workspace&&source.kind!=='github'&&!source.repository){
    mkdirSync(directory,{recursive:true})
    const prepared=join(directory,'.superagent-prepared')
    if(!existsSync(prepared)){
      if(source.workspace?.prepare)await exec(source.workspace.prepare.command,source.workspace.prepare.args,{cwd:directory,signal,timeout:600000,env:{...process.env,SUPERAGENT_TICKET_ID:ticketId,SUPERAGENT_SOURCE_DIR:source.cwd}})
      writeFileSync(prepared,'prepared\n',{mode:0o600})
    }
    return directory
  }
  if (existsSync(directory)) return directory
  const root = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: source.cwd, encoding: 'utf8',signal,timeout:10000 })).stdout.trim()
  if (realpathSync(root) !== realpathSync(source.cwd)) throw new Error('Writable Git source cwd must be the repository root; use workspace.mode=directory for non-Git tasks')
  await exec('git', ['worktree', 'add', '-b', 'superagent/' + suffix, directory, 'HEAD'], { cwd: root,signal,timeout:60000 })
  return directory
}
