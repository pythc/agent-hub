import {z} from 'zod'

/** AgentHub policies deliberately retain candidate-first automatic learning. */
export const memoryPolicySchema=z.object({
 enabled:z.boolean().default(true),
 writeMode:z.enum(['explicit_only','auto']).default('explicit_only'),
 extractBackend:z.string().min(1).optional(),extractModel:z.string().min(1).optional(),
 delayMs:z.number().int().min(0).max(3600000).default(90000),
 minIntervalMs:z.number().int().min(0).max(86400000).default(300000),
 maxItems:z.number().int().min(1).max(2000).default(200),
 interestThreshold:z.number().int().min(2).max(20).default(3),
 maxCallsPerDay:z.number().int().min(1).max(1000).default(100),
 retrievalConditioning:z.boolean().default(true),
 embedding:z.object({url:z.url().refine(s=>['http:','https:'].includes(new URL(s).protocol),'HTTP endpoint required'),model:z.string().min(1),apiKeyEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional()}).strict().optional(),
 reranker:z.object({url:z.url().refine(s=>['http:','https:'].includes(new URL(s).protocol),'HTTP endpoint required'),model:z.string().min(1),apiKeyEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),minScore:z.number().min(0).max(1).default(.5),candidateLimit:z.number().int().min(2).max(40).default(20)}).strict().optional(),
}).strict()
export type MemoryPolicy=z.infer<typeof memoryPolicySchema>
export const memoryKinds=['profile','preference','fact','task','interest'] as const
export const normalizeMemory=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'')
export function memoryTokens(s:string){
 const out=new Set(s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[])
 for(const match of s.matchAll(/[\p{Script=Han}]+/gu)){const chars=[...match[0]];for(let i=0;i<chars.length-1;i++)out.add(chars.slice(i,i+2).join(''))}
 return out
}
export function lexicalScore(query:string,text:string){
 const q=memoryTokens(query),t=memoryTokens(text);if(!q.size)return 0
 const matches=[...q].filter(x=>t.has(x)||text.toLowerCase().includes(x)).length
 return matches/q.size+(normalizeMemory(text).includes(normalizeMemory(query))?1:0)
}
export function cosine(a:number[],b:number[]){if(a.length!==b.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]!*b[i]!;aa+=a[i]!**2;bb+=b[i]!**2}return aa&&bb?dot/Math.sqrt(aa*bb):0}
export function assertNoMemorySecret(text:string){
 if(/(?:bearer\s+[\w.-]{12,}|\b(?:sk|ghp|github_pat)[-_][\w-]{12,}|(?:api[_ -]?key|password|passwd|secret|token|密码|密钥)\s*[:=：]\s*\S+)/i.test(text))throw Error('sensitive_content')
}
export function safeMemoryText(s:string){
 const text=s.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
 // Do not retain or repeatedly send pasted credentials as personal background.
 assertNoMemorySecret(text)
 if(!text||[...text].length>300)throw Error('invalid_memory_content')
 return text
}
