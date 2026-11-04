import {realpathSync} from 'node:fs'
import {resolve} from 'node:path'

/** Host credential paths only; never copy their contents into task metadata. */
export function hostPrivateFiles():string[]{
 const file=process.env.AGENTHUB_ENV_FILE
 if(!file)return []
 const path=resolve(file),paths=new Set([path])
 try{paths.add(realpathSync(path))}catch{}
 return [...paths]
}

export function isHostPrivateFile(path:string){return hostPrivateFiles().includes(path)}
