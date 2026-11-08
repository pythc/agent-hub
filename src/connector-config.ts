import {z} from 'zod'

const envName=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
export const sourcePluginsSchema=z.array(z.union([
  z.object({module:z.string().min(1)}).strict(),
  z.object({directory:z.string().min(1),digest:z.string().regex(/^[a-f0-9]{64}$/),replaceBuiltin:z.boolean().default(false),readPaths:z.array(z.string().min(1)).default([])}).strict(),
])).default([])
export const sourceCapabilitiesSchema=z.object({events:z.boolean().default(true),replies:z.boolean().default(true),resources:z.boolean().default(true)}).strict().prefault({})
export const toolConnectionsSchema=z.record(id,z.object({
  enabled:z.boolean().default(true),label:z.string().min(1).optional(),
  transport:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('plugin'),sourceId:id}).strict(),
    z.object({kind:z.literal('stdio'),command:z.string().min(1),args:z.array(z.string()).default([]),cwd:z.string().optional(),env:z.record(envName,envName).prefault({})}).strict(),
    z.object({kind:z.literal('http'),url:z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))},'Use HTTPS or loopback HTTP without credentials'),headerEnv:z.record(z.string().regex(/^[A-Za-z0-9-]+$/),envName).prefault({})}).strict(),
  ]),
  allowedTools:z.array(z.string().min(1)).min(1),
  timeoutMs:z.number().int().min(100).max(60000).default(30000),
}).strict()).prefault({})
export type ToolConnection=z.infer<typeof toolConnectionsSchema>[string]

/** Deployment changes need a controlled restart; dynamic admission settings do not. */
export function sourceDeployment(source:Record<string,unknown>){return Object.fromEntries(['id','kind','cwd','workspace','sandbox','repository','feishu','wecom','github','replyUrl','tokenEnv','options','capabilities','observed'].map(k=>[k,source[k]]))}
