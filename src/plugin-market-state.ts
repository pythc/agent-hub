import {existsSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import type {Config} from './config.ts'
import type {Store} from './store.ts'
import {marketCatalogSchema,type MarketState} from './plugin-market-contract.ts'
import {readPluginPackage} from './plugin-package.ts'
import {readViewPackage} from './workspace-view-package.ts'

export interface ManagedMarketState extends MarketState {ownedDigests:string[]}
export interface MarketActivation {id:string;previous:ManagedMarketState;settings:any;installations:any[];paused:boolean}
export const emptyMarket=():ManagedMarketState=>({format:1,revision:0,catalogs:[{id:'roppo',url:'https://github.com/pythc/agent-hub/tree/main/plugins',plugins:marketCatalogSchema.parse(JSON.parse(readFileSync(new URL('../plugins/catalog.json',import.meta.url),'utf8'))).plugins.map(p=>({...p,releases:[]}))}],installed:[],ownedDigests:[]})
export const marketState=(store:Store)=>store.get<ManagedMarketState>('plugin-market','current')??emptyMarket()
export const objectDirectory=(config:Pick<Config,'stateDir'>,digest:string)=>join(config.stateDir,'plugins','objects',digest)
/** One DB transaction owns refs, operations and settings. A pending activation is never silently resumed on boot. */
export function recoverMarket(store:Store,activationId?:string){
  const journal=store.get<MarketActivation>('plugin-market-activation','current')
  if(journal&&journal.id!==activationId)store.atomic(()=>{
    store.put('plugin-market','current',journal.previous)
    store.put('settings','current',journal.settings)
    store.put('settings','paused',journal.paused)
    store.db.prepare("DELETE FROM records WHERE kind='plugin-installation'").run()
    for(const item of journal.installations)store.put('plugin-installation',item.sourceId,item)
    store.db.prepare("DELETE FROM records WHERE kind='plugin-market-activation' AND id='current'").run()
    const operation=store.get<any>('plugin-market-operation',journal.id)
    if(operation)store.put('plugin-market-operation',journal.id,{...operation,state:'interrupted',error:'Activation was interrupted. Previous plugin references were restored.'})
  })
  for(const op of store.list<any>('plugin-market-operation'))if(['downloading','verifying','activating'].includes(op.state)&&op.id!==activationId)store.put('plugin-market-operation',op.id,{...op,state:'interrupted',error:'The host stopped before this operation completed. Review and retry.'})
}
export function applyMarketConfig(config:Config,state:ManagedMarketState){
  if(state.format!==1)throw Error('Unsupported plugin marketplace state')
  const owned=new Set(state.ownedDigests)
  config.viewPlugins=config.viewPlugins.filter(p=>!owned.has(p.digest))
  config.sourcePlugins=config.sourcePlugins.filter(p=>!('digest'in p)||!owned.has(p.digest))
  for(const item of state.installed){
    if(!item.active||!item.enabled)continue
    const directory=objectDirectory(config,item.active.digest)
    if(item.category==='workspace-view'){
      const pkg=readViewPackage(directory,item.active.digest)
      if(pkg.manifest.id!==item.id||config.viewPlugins.some(p=>p.id===item.id))throw Error('Managed plugin conflicts with startup view: '+item.id)
      config.viewPlugins.push({id:item.id,directory,digest:pkg.digest,enabled:true})
    }else{
      const pkg=readPluginPackage(directory,item.active.digest)
      if(pkg.manifest.id!==item.id)throw Error('Managed source plugin id mismatch')
      for(const p of config.sourcePlugins)if('directory'in p&&readPluginPackage(p.directory,p.digest).manifest.kind===pkg.manifest.kind)throw Error('Managed plugin conflicts with startup source: '+item.id)
      config.sourcePlugins.push({directory,digest:pkg.digest,replaceBuiltin:item.active.permissions.includes('adapter.replace:'+pkg.manifest.kind),readPaths:[]})
    }
  }
}
export function loadMarketConfig(config:Config,activationId?:string){
  const file=join(config.stateDir,'state.sqlite');if(!existsSync(file))return
  const db=new DatabaseSync(file,{readOnly:true})
  try{
    if(!db.prepare("SELECT name FROM sqlite_master WHERE name='records'").get())return
    const read=(kind:string)=>{const row=db.prepare("SELECT body FROM records WHERE kind=? AND id='current'").get(kind);return row?JSON.parse(String(row.body)):undefined}
    const journal=read('plugin-market-activation') as MarketActivation|undefined
    const state=journal&&journal.id!==activationId?journal.previous:read('plugin-market')
    if(state)applyMarketConfig(config,state)
  }finally{db.close()}
}
