import {gzipSync,gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'

export const packageHash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const allowed=new Set(['manifest.json','view.js','plugin.mjs','LICENSE'])
/** A deliberately small USTAR contract. No links, directories, pax extensions or install scripts. */
export function extractPluginArchive(bytes:Uint8Array,destination:string){
  const tar=gunzipSync(bytes,{maxOutputLength:24_000_000}),files=new Map<string,Buffer>()
  let offset=0,ended=false
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512
    if(header.every(b=>b===0)){ended=true;if(!tar.subarray(offset).every(b=>b===0))throw Error('Unexpected trailing archive data');break}
    const field=(start:number,length:number)=>header.subarray(start,start+length).toString('utf8').replace(/\0.*$/s,'')
    const name=field(0,100),sizeField=field(124,12).trim(),checksumField=field(148,8).trim()
    if(!/^[0-7]+$/.test(sizeField)||!/^[0-7]+$/.test(checksumField))throw Error('Invalid archive header')
    const size=parseInt(sizeField,8),expected=parseInt(checksumField,8)
    let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:header[i]!
    if(sum!==expected||!['0',''].includes(field(156,1))||field(157,100)||field(345,155)||!allowed.has(name)||files.has(name))throw Error('Unsupported or unsafe package archive entry')
    if(size>16_000_000||offset+size>tar.length||name==='manifest.json'&&size>64_000)throw Error('Invalid package archive size')
    files.set(name,tar.subarray(offset,offset+size));offset+=Math.ceil(size/512)*512
  }
  if(!ended||!files.has('manifest.json')||files.has('view.js')===files.has('plugin.mjs'))throw Error('Incomplete plugin archive')
  mkdirSync(destination,{recursive:true,mode:0o700})
  for(const [name,data]of files)writeFileSync(join(destination,name),data,{flag:'wx',mode:0o600})
}
export function packPluginArchive(directory:string,entry:'view.js'|'plugin.mjs',license:string){
  const chunks:Buffer[]=[]
  for(const [name,data]of [['manifest.json',readFileSync(join(directory,'manifest.json'))],[entry,readFileSync(join(directory,entry))],['LICENSE',Buffer.from(license)]] as const){
    const h=Buffer.alloc(512);h.write(name);h.write('0000600\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write('0',156);h.write('ustar\0',257);h.write('00',263)
    h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148)
    chunks.push(h,data,Buffer.alloc((512-data.length%512)%512))
  }
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]))
}
