/** Selected adaptations from Tencent/WeKnora, MIT. See LICENSE and upstream.json.
 * Modified for AgentHub: literal snippets (no untrusted regular expressions),
 * code-point offsets, and explicit truncation metadata. No WeKnora server runs.
 */
export function normalizeKeywordScores<T extends {score:number}>(items:T[]):T[]{
 if(!items.length)return items
 const scores=items.map(x=>x.score).sort((a,b)=>a-b)
 const low=scores.length>=10?scores[Math.floor(scores.length*.05)]!:scores[0]!
 const high=scores.length>=10?scores[Math.floor(scores.length*.95)]!:scores.at(-1)!
 return items.map(x=>({...x,score:high>low?(Math.min(high,Math.max(low,x.score))-low)/(high-low):1}))
}
export function extractSnippet(content:string,query:string){
 if(!query)return ''
 const chars=Array.from(content),needle=Array.from(query.toLowerCase()),lower=chars.map(c=>c.toLowerCase())
 let found=-1
 for(let i=0;i<=lower.length-needle.length;i++)if(needle.every((c,j)=>lower[i+j]===c)){found=i;break}
 if(found<0)return ''
 return '... '+chars.slice(Math.max(0,found-60),found).join('')+chars.slice(found,found+Math.min(needle.length,100)).join('')+(needle.length>100?'...':'')+chars.slice(found+needle.length,found+needle.length+60).join('').replace(/\s+/gu,' ')+' ...'
}
export type MemoryKind='profile'|'preference'|'fact'|'task'|'interest'
export function sanitizeMemoryContent(content:string){return Array.from(content.replace(/[\n\r\t]/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').replace(/\s+/gu,' ').trim()).slice(0,300).join('').trim()}
/** Adapted fixed-prefix explicit-memory path. Longer requests stay in the
 * journal and candidate workflow instead of silently activating a truncation. */
export function detectExplicitMemory(text:string){
 const prefixes=['记住：','记住:','记住，','记住,','记住 ','记住','请记住：','请记住:','请记住，','请记住,','请记住 ','请记住','帮我记住：','帮我记住:','帮我记住，','帮我记住,','帮我记住 ','帮我记住','remember that ','remember: ','remember, ','please remember that ','please remember: ','note that ','keep in mind that ']
 const input=text.trim(),prefix=prefixes.find(p=>input.toLowerCase().startsWith(p))
 if(!prefix)return
 const raw=input.slice(prefix.length).replace(/^[：:，,\s]+/u,'').trim()
 if(Array.from(raw).length>300)return
 const content=sanitizeMemoryContent(raw);return Array.from(content).length>=2?content:undefined
}
/** Informational memory only. Requirements are kept verbatim in the task journal. */
export function renderMemory(items:{id:string;kind:MemoryKind;content:string}[],budget=2400){
 const labels:Record<MemoryKind,string>={profile:'About the user',preference:'Preferences',fact:'Relevant facts',task:'Ongoing tasks',interest:'Long-term focus'}
 const lines:string[]=[],included:string[]=[];let used=0
 for(const kind of Object.keys(labels) as MemoryKind[]){
  const group=items.filter(x=>x.kind===kind&&x.content.trim());if(!group.length)continue
  const header=labels[kind]+':';if(used+header.length+1>budget)break
  lines.push(header);used+=header.length+1
  for(const item of group){const line='- '+sanitizeMemoryContent(item.content),size=Array.from(line).length+1;if(used+size>budget)continue;lines.push(line);used+=size;included.push(item.id)}
 }
 return {text:lines.join('\n'),included,truncated:included.length<items.length}
}
export interface TextChunk {seq:number;start:number;end:number;content:string;contextHeader:string}
/** Heading-aware adaptation of WeKnora's Chunk position/context invariant.
 * AgentHub's compact implementation uses line/paragraph boundaries; it does not
 * claim the full adaptive/token-aware strategy of the upstream chunker.
 */
export function splitDocument(text:string,size=1024,overlap=80):TextChunk[]{
 if(!Number.isInteger(size)||size<64||!Number.isInteger(overlap)||overlap<0||overlap>=size)throw Error('Invalid chunk sizes')
 const chars=Array.from(text),headers:{at:number;text:string}[]=[],stack:string[]=[]
 let offset=0,fence:string|undefined
 for(const line of text.split(/(?<=\n)/u)){
  const marker=/^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
  if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence=undefined}
  else if(!fence){const h=/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line.trimEnd());if(h){stack.length=h[1]!.length;stack[h[1]!.length-1]=h[1]+' '+h[2];headers.push({at:offset,text:stack.filter(Boolean).join('\n')})}}
  offset+=Array.from(line).length
 }
 const out:TextChunk[]=[]
 for(let start=0;start<chars.length;){
  let end=Math.min(chars.length,start+size)
  if(end<chars.length){for(let i=end;i>start+size/2;i--)if(chars[i-1]==='\n'){end=i;break}}
  out.push({seq:out.length,start,end,content:chars.slice(start,end).join(''),contextHeader:headers.filter(h=>h.at<=start).at(-1)?.text??''})
  if(end===chars.length)break
  start=Math.max(start+1,end-overlap)
 }
 return out
}
