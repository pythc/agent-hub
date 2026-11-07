import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { z } from 'zod'
import {builtins} from './prompts.ts'
import {backendsSchema,executionSchema,validateBackendSelection} from './backend-config.ts'
import {sourcePluginsSchema,sourceCapabilitiesSchema,toolConnectionsSchema} from './connector-config.ts'
import {browserConfigSchema} from './browser-contract.ts'

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  kind: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  allowedActors: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  capabilities:sourceCapabilitiesSchema,
  options:z.record(z.string(),z.unknown()).prefault({}),
  observed:z.boolean().optional(),
  allowedBots: z.array(z.string()).default([]),
  admission: z.record(z.string(),z.object({
    listedUnaddressed: z.enum(['inferred','ignore']).default('inferred'),
    unlistedAddressed: z.enum(['explicit','inferred','ignore']).default('ignore'),
    unlistedUnaddressed: z.enum(['inferred','ignore']).default('ignore'),
  }).strict()).prefault({}),
  memberSync:z.object({scope:z.string().optional(),enabled:z.boolean().default(false)}).strict().optional(),
  listenScopes: z.array(z.string()).optional(),
  pollSeconds: z.number().min(1).default(60),
  github: z.object({ command: z.string().default('/agent'), receiveAll: z.boolean().default(false), gh: z.string().default('gh'),transport:z.enum(['http','gh']).default('http'),tokenEnv:z.string().optional() }).strict().optional(),
  feishu: z.object({ cli: z.string().optional(), appIdEnv: z.string().optional(), appSecretEnv: z.string().optional(), verificationTokenEnv: z.string().optional(), chats: z.array(z.string()).min(1), mentionId: z.string().optional(), liveEvents:z.boolean().default(false),otherChats:z.enum(['ignore','mentions']).default('ignore'),directMessages:z.boolean().default(false), command:z.string().default('/agent') }).strict().optional(),
  wecom:z.object({
    botIdEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),secretEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    wsUrl:z.string().url().default('wss://openws.work.weixin.qq.com').refine(s=>{const u=new URL(s);return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='wss:'||u.protocol==='ws:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))},'Use WSS or loopback WS with no URL credentials'),
    chats:z.array(z.string().min(1).max(200)).default([]),directMessages:z.boolean().default(true),
    otherChats:z.enum(['ignore','mentions']).default('ignore'),
    downloadHosts:z.array(z.string().regex(/^[a-z0-9.-]+$/)).default(['weixin.qq.com','qpic.cn']),
  }).strict().optional(),
  cwd: z.string(),
  workspace:z.object({mode:z.enum(['source','directory','git-worktree']).default('git-worktree'),prepare:z.object({command:z.string().min(1),args:z.array(z.string()).default([])}).strict().optional()}).strict().optional(),
  sandbox: z.enum(['read-only', 'workspace-write']).default('read-only'),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  replyUrl: z.string().url().optional(),
  tokenEnv: z.string().optional(),
}).strict().superRefine((s,ctx)=>{
  if(s.kind==='local'&&!s.allowedActors.length)ctx.addIssue({code:'custom',message:'Local source requires an operator identity'})
  if(s.kind==='github'&&!s.repository)ctx.addIssue({code:'custom',message:'GitHub source requires repository'})
  if(s.kind==='feishu'&&(!s.feishu||(!s.feishu.cli&&(!s.feishu.appIdEnv||!s.feishu.appSecretEnv))))ctx.addIssue({code:'custom',message:'Feishu source requires CLI or app credential environment names'})
  if(s.kind==='wecom'&&!s.wecom)ctx.addIssue({code:'custom',message:'WeCom source requires smart-bot configuration'})
})
export const configSchema = z.object({
  stateDir: z.string().default('.superagent'),
  port: z.number().int().min(0).max(65535).default(4319),
  codex: z.string().default('codex'),
  backends:backendsSchema,
  execution:executionSchema,
  sourcePlugins:sourcePluginsSchema,
  toolConnections:toolConnectionsSchema,
  browser:browserConfigSchema,
  model: z.string().optional(),
  models:z.object({router:z.string().optional(),worker:z.string().optional(),subagent:z.string().optional()}).strict().prefault({}),
  effort: z.enum(['low', 'medium', 'high', 'xhigh']).default('high'),
  concurrency: z.number().int().min(1).max(10).default(2),
  turnTimeoutMs: z.number().int().min(1000).default(600_000),
  work:z.object({sandboxDriver:z.enum(['codex','seatbelt','bubblewrap','disabled']).default('codex'),backgroundTimeoutMs:z.number().int().min(100).default(1800000),maxAgents:z.number().int().min(1).max(32).default(8),maxDepth:z.number().int().min(1).max(8).default(3),maxOutputBytes:z.number().int().min(1024).max(16000000).default(1000000),autoRecover:z.boolean().default(true),network:z.boolean().default(true)}).strict().prefault({}),
  delivery:z.object({workerPublish:z.boolean().default(false),authorization:z.enum(['per-head','policy']).default('per-head'),maxDraftLines:z.number().int().min(1).default(100000),commitName:z.string().min(1).default('Super-agent'),commitEmail:z.string().email().default('superagent@localhost.invalid'),automatedReviewers:z.array(z.string()).default([]),maxReviewRounds:z.number().int().min(1).max(10).default(3),autoMerge:z.boolean().default(false),mergeGh:z.string().optional(),requiredReviewers:z.array(z.string()).default([]),maxChangedLines:z.number().int().min(1).default(200),requireChecks:z.boolean().default(true),method:z.enum(['squash','merge','rebase']).default('squash')}).strict().prefault({}),
  watchdog: z.object({ staleMs: z.number().min(1000).default(600000), intervalMs: z.number().min(1000).default(30000) }).strict().prefault({}),
  prompts: z.object({ shared:z.string().default(''), router:z.string().default(''), worker:z.string().default(''), delivery:z.string().default(''),
    team:z.object({communication:z.string().default(''),scope:z.string().default(''),delivery:z.string().default('')}).strict().prefault({}),
    skills:z.record(z.string().regex(/^[a-z][a-z0-9-]*$/),z.string()).prefault({}),
    overrides:z.record(z.string().refine(id=>id in builtins,'Unknown prompt part'),z.object({text:z.string(),base:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).prefault({}),
  }).strict().prefault({}).superRefine((value,ctx)=>{
    if(Object.keys(value.skills).some(k=>['superagent','superagent-worker','github','feishu','dsh-superagent-github','dsh-superagent-feishu'].includes(k)))ctx.addIssue({code:'custom',message:'Reserved built-in skill name'})
    if(JSON.stringify(value).length>64000)ctx.addIssue({code:'custom',message:'Prompt configuration exceeds 64000 characters'})
    for(const [part,required] of [['environment',['{variables}']],['runtime/environment',['{variables}']],['policy',['{version}','{mode}','{rules}']],['runtime/policy',['{version}','{mode}','{rules}']],['runtime/policy/none',['{version}','{mode}']]] as const){
      const text=value.overrides[part]?.text
      if(text!==undefined&&required.some(key=>!text.includes(key)))ctx.addIssue({code:'custom',path:['overrides',part],message:'Required template placeholders missing'})
    }
  }),
  acceptMode: z.enum(['off', 'observe', 'auto']).default('observe'),
  rules: z.array(z.object({ id: z.string().min(1).max(80), instruction: z.string().min(1).max(8000) }).strict()).default([]).superRefine((rules,ctx)=>{if(new Set(rules.map(r=>r.id)).size!==rules.length)ctx.addIssue({code:'custom',message:'Duplicate rule id'})}),
  sources: z.array(sourceSchema).min(1),
}).strict()
export type Config = z.infer<typeof configSchema>
export type SourceConfig = Config['sources'][number]
export function loadConfig(path: string): Config {
  const base = dirname(resolve(path))
  const config = configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  validateBackendSelection(config)
  config.stateDir = resolve(base, config.stateDir)
  for(const plugin of config.sourcePlugins)plugin.module=resolve(base,plugin.module)
  for(const connection of Object.values(config.toolConnections))if(connection.transport.kind==='stdio'&&connection.transport.cwd)connection.transport.cwd=resolve(base,connection.transport.cwd)
  const ids = new Set<string>()
  for (const source of config.sources) {
    if (ids.has(source.id)) throw new Error('Duplicate source id: ' + source.id)
    ids.add(source.id)
    source.cwd = resolve(base, source.cwd)
    if (source.kind === 'github' && !source.repository) throw new Error('GitHub source requires repository')
  }
  return config
}
