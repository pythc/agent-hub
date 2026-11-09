import {mkdirSync,copyFileSync,existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import {readViewPackage,installViewPackage} from './workspace-view-package.ts'
import {readPluginPackage,installPluginPackage} from './plugin-package.ts'
import type {ManagedMarketState} from './plugin-market-state.ts'

function packages(db:DatabaseSync){
  if(db.prepare("SELECT 1 FROM records WHERE kind='plugin-market-activation' AND id='current'").get())throw Error('A plugin activation is in progress; retry backup after recovery')
  const row=db.prepare("SELECT body FROM records WHERE kind='plugin-market' AND id='current'").get()
  const state=row?JSON.parse(String(row.body)) as ManagedMarketState:undefined,result=new Map<string,'source'|'workspace-view'>()
  for(const item of state?.installed??[])for(const release of [item.selected,item.active,item.previous])if(release){
    if(!/^[a-f0-9]{64}$/.test(release.digest))throw Error('Invalid backed-up plugin digest')
    result.set(release.digest,item.category)
  }
  return result
}
export function captureMarketPackages(db:DatabaseSync,stateDir:string,destination:string){
  const refs=packages(db)
  for(const [digest,category]of refs){
    const source=join(stateDir,'plugins','objects',digest),target=join(destination,'plugins','objects',digest)
    if(category==='workspace-view')readViewPackage(source,digest);else readPluginPackage(source,digest)
    mkdirSync(target,{recursive:true,mode:0o700})
    for(const name of ['manifest.json',category==='workspace-view'?'view.js':'plugin.mjs'])copyFileSync(join(source,name),join(target,name))
    if(existsSync(join(source,'LICENSE')))copyFileSync(join(source,'LICENSE'),join(target,'LICENSE'))
  }
}
export function verifyMarketPackages(db:DatabaseSync,directory:string){
  for(const [digest,category]of packages(db)){
    const target=join(directory,'plugins','objects',digest)
    if(category==='workspace-view')readViewPackage(target,digest);else readPluginPackage(target,digest)
  }
}
export function restoreMarketPackages(db:DatabaseSync,directory:string,stateDir:string){
  for(const [digest,category]of packages(db)){
    const source=join(directory,'plugins','objects',digest)
    if(category==='workspace-view')installViewPackage(source,stateDir,digest);else installPluginPackage(source,stateDir,digest)
  }
}
