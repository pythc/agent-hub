import type {ViewHostMessage} from '../../src/workspace-view-contract.ts'
const destinations={tasks:'/configure#tasks/history',attention:'/configure#attention',team:'/configure#execution/configuration',models:'/configure#models',conversation:'/chat',browser:'/chat?browser=open'} as const
export function viewDestination(value:string){return Object.hasOwn(destinations,value)?destinations[value as keyof typeof destinations]:undefined}
/** Accept a small closed command set. No URLs, RPC methods, credentials or executable payloads. */
export function parseViewCommand(value:unknown):ViewHostMessage|undefined{
  if(!value||typeof value!=='object'||Array.isArray(value))return
  const v=value as Record<string,unknown>
  if(v.type==='refresh'&&Object.keys(v).length===1)return {type:'refresh'}
  if(v.type==='navigate'&&Object.keys(v).length===2&&typeof v.destination==='string'&&viewDestination(v.destination))return {type:'navigate',destination:v.destination as Extract<ViewHostMessage,{type:'navigate'}>['destination']}
  if(v.type!=='query'||Object.keys(v).length!==2||!v.query||typeof v.query!=='object'||Array.isArray(v.query))return
  const q=v.query as Record<string,unknown>
  if(Object.keys(q).some(k=>!['source','state','search','offset'].includes(k)))return
  if(q.source!==undefined&&(typeof q.source!=='string'||q.source.length>100||!q.source))return
  if(q.state!==undefined&&(typeof q.state!=='string'||!['queued','running','attention','ready','replied','closed'].includes(q.state)))return
  if(q.search!==undefined&&(typeof q.search!=='string'||q.search.length>100))return
  if(q.offset!==undefined&&(!Number.isInteger(q.offset)||Number(q.offset)<0||Number(q.offset)>1_000_000))return
  return {type:'query',query:q as Extract<ViewHostMessage,{type:'query'}>['query']}
}
export function viewDocument(code:string,nonce:string){
  if(!/^[a-zA-Z0-9-]+$/.test(nonce))throw Error('Invalid view nonce')
  // CSP is a network boundary. Opaque origin is the host/credential boundary. No same-origin sandbox permission.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"></head><body><div id="root"></div><script nonce="${nonce}">${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`
}
