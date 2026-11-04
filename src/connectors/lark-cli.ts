import {mkdtempSync,readFileSync,rmSync,statSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,relative} from 'node:path'
import { spawn } from 'node:child_process'
import type { FeishuRequest } from './feishu.ts'

export function larkRequest(binary:string):FeishuRequest {
  return async(method,path,body,signal)=>{
    signal?.throwIfAborted()
    const url=new URL(path,'https://local.invalid/')
    const params=url.searchParams
    let args:string[],downloadDirectory:string|undefined
    if(method==='GET'&&url.pathname==='/im/v1/messages'){
      args=params.get('container_id_type')==='thread'?['im','+threads-messages-list','--thread',params.get('container_id')!,'--order',params.get('sort_type')==='ByCreateTimeDesc'?'desc':'asc','--page-size',params.get('page_size')??'50','--no-reactions']:['im','+chat-messages-list','--chat-id',params.get('container_id')!,'--order',params.get('sort_type')==='ByCreateTimeDesc'?'desc':'asc','--page-size',params.get('page_size')??'50','--no-reactions']
      if(params.has('start_time'))args.push('--start',new Date(Number(params.get('start_time'))*1000).toISOString())
      if(params.has('end_time'))args.push('--end',new Date(Number(params.get('end_time'))*1000).toISOString())
      if(params.has('page_token'))args.push('--page-token',params.get('page_token')!)
    }else if(method==='GET'&&url.pathname.startsWith('/typed/threads/')){
      args=['im','+threads-messages-list','--thread',decodeURIComponent(url.pathname.split('/').at(-1)!),'--order','asc','--no-reactions','--page-size','50']
      if(params.has('page_token'))args.push('--page-token',params.get('page_token')!)
    }else if(method==='POST'&&url.pathname.endsWith('/reply')){
      const payload=body as any,messageId=url.pathname.split('/').at(-2)!
      args=['im','+messages-reply','--message-id',decodeURIComponent(messageId),'--text',JSON.parse(payload.content).text,'--reply-in-thread','--idempotency-key',payload.uuid]
    }else if(method==='GET'&&/^\/im\/v1\/messages\/om_[A-Za-z0-9_-]+\/resources\/[A-Za-z0-9_-]+$/.test(url.pathname)){
      downloadDirectory=mkdtempSync(join(tmpdir(),'superagent-resource-'))
      const parts=url.pathname.split('/')
      args=['im','+messages-resources-download','--message-id',parts[4]!,'--file-key',parts[6]!,'--type',params.get('type')??'image','--output','resource']
    }else if(method==='GET'&&/^\/im\/v1\/messages\/om_[A-Za-z0-9_-]+$/.test(url.pathname)){
      args=['api','GET','/open-apis'+url.pathname,'--params','{}']
    }else if(method==='GET'&&(/^\/im\/v1\/chats\/oc_[A-Za-z0-9_-]+\/members$/.test(url.pathname)||url.pathname==='/bot/v3/info')){
      args=['api','GET','/open-apis'+url.pathname,'--params',JSON.stringify(Object.fromEntries(params))]
    }else throw Error('Unsupported typed Lark request')
    args.push('--as','bot','--json')
    try{
    const result=await new Promise<any>((resolve,reject)=>{
      const child=spawn(binary,args,{cwd:downloadDirectory,signal,stdio:['ignore','pipe','pipe'],shell:false})
      let output=''
      const timer=setTimeout(()=>child.kill('SIGTERM'),20000)
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4_000_000)child.kill('SIGTERM')})
      child.stderr.resume()
      child.once('error',error=>{clearTimeout(timer);reject(error)})
      child.once('close',code=>{clearTimeout(timer);if(code!==0){reject(Error('Lark CLI failed ('+code+')'));return}try{const result=JSON.parse(output);if(!result.ok)throw Error(result.error?.message??'Lark request failed');resolve(result.data)}catch(error){reject(error)}})
    })
    if(downloadDirectory){
      const path=realpathSync(resolve(downloadDirectory,result.saved_path??'resource'))
      if(relative(downloadDirectory,path).startsWith('..')||statSync(path).size>8000000)throw Error('Invalid or oversized resource download')
      return {binary:readFileSync(path).toString('base64')}
    }
    return {...result,items:result.messages??result.items}
    }finally{if(downloadDirectory)rmSync(downloadDirectory,{recursive:true,force:true})}
  }
}
