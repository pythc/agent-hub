// This program runs in the plugin process. It never opens the host database.
import {createInterface} from 'node:readline'
import {pathToFileURL} from 'node:url'

let source, rows = new Map(), operations = [], stopped = false, active = false
let sendSequence = 0
const acknowledgements = new Map(), queries = new Map(), recentWrites = new Map()
let querySequence=0
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const key = (kind, id) => JSON.stringify([kind, id])
const enqueue = operation => {
  operations.push(operation)
  if (!active) queueMicrotask(flushEvents)
}
function flushEvents(force = false) {
  if (active && !force || !operations.length) return
  let last
  while(operations.length){
    let count=0,bytes=0
    for(const op of operations){const size=Buffer.byteLength(JSON.stringify(op));if(size>8_000_000)throw Error('Plugin operation exceeds limit');if(count&&(bytes+size>1_000_000||count>=1000))break;bytes+=size;count++}
    const id=++sendSequence,batch=operations.splice(0,count)
    const promise=new Promise(resolve=>acknowledgements.set(id,{resolve}))
    acknowledgements.get(id).promise=promise
    for(const op of batch)if(op.type==='put')recentWrites.set(key(op.kind,op.id),{sequence:id,value:op.value})
    emit({type:'events',id,operations:batch});last=promise
  }
  return last
}
const store = {
  get:(kind,id)=>rows.get(key(kind,id)),
  list:kind=>[...rows].filter(([k])=>JSON.parse(k)[0]===kind).map(([,v])=>v),
  put:(kind,id,value)=>{ rows.set(key(kind,id),value); enqueue({type:'put',kind,id,value}) },
  threads:{list:()=>store.list('thread')},
  triggers:{get:id=>store.get('trigger',id)},
}
const context = {
  store,
  records:async(kind,query={})=>{
    await context.checkpoint()
    const id=++querySequence,promise=new Promise((resolve,reject)=>queries.set(id,{resolve,reject,kind,query}))
    emit({type:'records',id,kind,query});return promise
  },
  checkpoint:async()=>{await flushEvents(true);await Promise.all([...acknowledgements.values()].map(v=>v.promise))},
  receive:trigger=>enqueue({type:'receive',trigger}),
  change:event=>enqueue({type:'change',event}),
  bind:()=>{throw Error('Plugins cannot bind host tasks')},
  closed:()=>{throw Error('Plugins cannot close host tasks')},
}
// Keep stdout reserved for the protocol even when third-party code logs.
console.log=(...args)=>console.error(...args)
let serial = Promise.resolve()
const lines = createInterface({input:process.stdin})
lines.on('line',line=>{
  if(line.length>16_000_000)process.exit(2)
  let message
  try {message=JSON.parse(line)} catch {process.exit(2)}
  if(message.type==='records-result'){
    const pending=queries.get(message.id);if(!pending)process.exit(2)
    const items=new Map(message.result.items.map(row=>[row.id,row]))
    const writes=new Map(recentWrites)
    for(const op of operations)if(op.type==='put')writes.set(key(op.kind,op.id),{sequence:Infinity,value:op.value})
    for(const [k,write] of writes){
      const [kind,id]=JSON.parse(k)
      if(kind===pending.kind&&write.sequence>message.stateAck&&(items.has(id)||pending.query.ids?.includes(id)))items.set(id,{id,value:write.value})
    }
    const ordered=[...items.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))),limit=pending.query.limit??100
    pending.resolve({...message.result,items:ordered.slice(0,limit),...(ordered.length>limit?{next:ordered[limit-1].id}:{})});queries.delete(message.id);return
  }
  if(message.type==='ack') {acknowledgements.get(message.id)?.resolve(); acknowledgements.delete(message.id); return}
  serial=serial.then(async()=>{
    active=true
    try {
      if(message.type==='init') {
        const plugin=(await import(pathToFileURL(message.module).href)).default
        source=await plugin.create(message.config)
        emit({type:'result',id:message.id,result:true,operations:[]})
        return
      }
      if(stopped||!source)throw Error('Plugin is not running')
      // A method starts from authoritative host state; no local state is durable.
      if(message.config)Object.assign(source.config,message.config)
      rows=new Map(message.snapshot.map(row=>[key(row.kind,row.id),row.value]))
      for(const [k,write] of recentWrites){if(write.sequence>message.stateAck)rows.set(k,write.value);else recentWrites.delete(k)}
      for(const op of operations)if(op.type==='put')rows.set(key(op.kind,op.id),op.value)
      const method=message.method
      const args=message.args??[]
      if(typeof source[method]!=='function')throw Error('Declared method is missing')
      const result=method==='poll'||method==='start'?await source[method]?.(context):await source[method]?.(...args)
      if(method==='close')stopped=true
      await context.checkpoint()
      emit({type:'result',id:message.id,result,operations:[]})
    } catch(error) {
      await context.checkpoint()
      emit({type:'result',id:message.id,error:true,operations:[]})
    } finally {active=false;flushEvents()}
  }).catch(()=>process.exit(2))
})
lines.on('close',()=>{void serial.finally(()=>process.exit(0))})
