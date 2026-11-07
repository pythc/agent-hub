import {readFileSync} from 'node:fs'
const root=new URL('../../dist/chat/',import.meta.url)
export function chatPage(){return readFileSync(new URL('index.html',root),'utf8')}
export function chatAsset(name:string){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))return
  try{return readFileSync(new URL(name,root))}catch{return}
}
