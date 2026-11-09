import {randomUUID} from 'node:crypto'
import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {Script} from 'node:vm'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {configSchema,type Config} from './config.ts'
import {Store} from './store.ts'
import {readPluginPackage,installPluginPackage,type PluginManifest} from './plugin-package.ts'
import {readViewPackage,installViewPackage,type ViewManifest} from './workspace-view-package.ts'
import {PluginGitHub,githubLocation} from './plugin-github.ts'
import {extractPluginArchive} from './plugin-archive.ts'
import {compatible,compareVersion,latestCompatible,marketId,type CatalogPlugin,type InstalledPlugin,type MarketOperation,type MarketPlan,type MarketRelease} from './plugin-market-contract.ts'
import {marketState,objectDirectory,applyMarketConfig,recoverMarket,type ManagedMarketState,type MarketActivation} from './plugin-market-state.ts'

export class MarketError extends Error {constructor(readonly code:string,message:string,readonly status=409){super(message)}}
export const marketPlanInput=z.object({action:z.enum(['install','activate','enable','disable','rollback','uninstall','ignore']),pluginId:marketId,catalogId:z.string().max(80).optional(),version:z.string().max(100).optional(),revision:z.number().int().nonnegative()}).strict()
export function packagePermissions(manifest:ViewManifest|PluginManifest){
  if('category'in manifest)return [...manifest.capabilities].sort()
  return [...(manifest.network?['network']:[]),...manifest.methods.map(m=>'source.'+m),...Object.keys(manifest.credentials).map(k=>'credential.'+k),...manifest.tools.map(t=>'tool.'+t.name),...(['local','webhook','github','wecom','feishu'].includes(manifest.kind)?['adapter.replace:'+manifest.kind]:[])].sort()
}
export function marketBlockers(host:Runtime){
  const items:{kind:string;count:number}[]=[]
  const count=(kind:string,n:number)=>{if(n)items.push({kind,count:n})}
  count('tasks',host.store.tickets.open().length)
  count('goals',host.store.list<any>('router-goal').filter(g=>!['completed','cancelled'].includes(g.state)).length)
  count('deliveries',host.store.deliveries().filter(d=>['pending','sending','uncertain','held'].includes(d.status)).length)
  count('tool-receipts',host.store.list<any>('tool-receipt').filter(r=>['running','uncertain'].includes(r.state)).length)
  count('backend-effects',host.store.list<any>('backend-plugin-tool').filter(r=>r.state==='running').length)
  count('repository-publications',host.store.list<any>('pr-delivery').filter(r=>['pushing','creating','uncertain'].includes(r.phase)).length)
  count('repository-merges',host.store.list<any>('merge-attempt').filter(r=>['submitting','uncertain'].includes(r.phase)).length)
  count('repository-reviews',host.store.list<any>('review-action').filter(r=>r.phase==='pending').length)
  count('jobs',Number(host.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('pending','running')").get()!.n))
  return items
}
type Rebuild=(config:Config,activationId?:string)=>Promise<void>
export class PluginMarket {
  private busy=false
  constructor(private host:()=>Runtime,private github=new PluginGitHub()){}
  snapshot(){
    const host=this.host(),state=marketState(host.store)
    return {...state,installed:state.installed.map(p=>({...p,directory:undefined,connections:host.config.sources.filter(s=>s.kind===p.kind).map(s=>({id:s.id,label:s.label??s.id,enabled:s.enabled})),update:this.updateFor(state,p)})),operations:host.store.list<MarketOperation>('plugin-market-operation').sort((a,b)=>b.at-a.at).slice(0,30),blockers:marketBlockers(host)}
  }
  private updateFor(state:ManagedMarketState,item:InstalledPlugin){
    const plugin=state.catalogs.filter(c=>c.origin?.repositoryId===item.origin.repositoryId).flatMap(c=>c.plugins).find(p=>p.id===item.id)
    const release=plugin&&latestCompatible(plugin)
    return release&&compareVersion(release.version,item.selected.version)>0&&release.version!==item.ignoredVersion?release:undefined
  }
  private persist(state:ManagedMarketState){state.revision++;this.host().store.put('plugin-market','current',state)}
  async catalogs(input:{url?:string;tokenEnv?:string;remove?:string}){
    if(this.busy)throw new MarketError('market_busy','Another plugin operation is running')
    this.busy=true
    try{
      let state=marketState(this.host().store)
      if(input.remove){
        const source=state.catalogs.find(c=>c.id===input.remove)
        if(source&&state.installed.some(p=>p.origin.repositoryId===source.origin?.repositoryId))throw new MarketError('source_in_use','Uninstall this source’s plugins before removing it')
        state.catalogs=state.catalogs.filter(c=>c.id!==input.remove);this.persist(state);return this.snapshot()
      }
      if(input.url){
        githubLocation(input.url)
        if(state.catalogs.length>=16&&!state.catalogs.some(c=>c.url===input.url))throw Error('At most 16 plugin sources are supported')
        let source=state.catalogs.find(c=>c.url===input.url)
        if(!source){source={id:randomUUID(),url:input.url,plugins:[]};state.catalogs.push(source)}
        source.tokenEnv=input.tokenEnv||undefined
        this.persist(state)
      }
      const sources=state.catalogs.filter(c=>!input.url||c.url===input.url)
      for(const source of sources){
        source.attemptedAt=Date.now()
        try{
          const result=await this.github.catalog(source)
          // Published versions are immutable even when the catalog's branch moves.
          for(const plugin of result.plugins)for(const release of plugin.releases){
            const previous=source.plugins.find(p=>p.id===plugin.id)?.releases.find(r=>r.version===release.version)
            const installed=state.installed.find(p=>p.id===plugin.id&&p.origin.repositoryId===result.origin.repositoryId)
            const seen=previous??[installed?.selected,installed?.active,installed?.previous].find(r=>r?.version===release.version)
            if(seen&&(seen.digest!==release.digest||seen.sha256!==release.sha256))throw Error('A published version changed bytes; the cached catalog was retained')
          }
          Object.assign(source,result,{error:undefined})
        }catch(error){source.error=error instanceof Error?error.message:'Could not refresh this source'}
      }
      // Settings may change during the network fetch; the market is serialized independently.
      this.persist(state);return this.snapshot()
    }finally{this.busy=false}
  }
  plan(value:unknown){
    if(this.busy)throw new MarketError('market_busy','Another plugin operation is running')
    const input=marketPlanInput.parse(value),host=this.host(),state=marketState(host.store)
    for(const old of host.store.list<MarketPlan>('plugin-market-plan'))if(old.expiresAt<Date.now())host.store.db.prepare("DELETE FROM records WHERE kind='plugin-market-plan' AND id=?").run(old.id)
    if(host.store.list('plugin-market-plan').length>=100)throw new MarketError('too_many_plans','Close old install reviews or retry after they expire.',429)
    if(input.revision!==state.revision)throw new MarketError('market_conflict','Plugin state changed. Refresh before continuing.')
    const installed=state.installed.find(p=>p.id===input.pluginId)
    let plugin:CatalogPlugin|undefined,origin=installed?.origin,target:MarketRelease|undefined
    if(input.action==='install'){
      const source=state.catalogs.find(c=>c.id===input.catalogId);plugin=source?.plugins.find(p=>p.id===input.pluginId);origin=source?.origin
      if(!plugin||!origin)throw Error('Refresh the plugin source first')
      target=input.version?plugin.releases.find(r=>r.version===input.version):latestCompatible(plugin)
      if(!target||!compatible(target))throw Error('No compatible published version for this host')
      if(installed&&installed.origin.repositoryId!==origin.repositoryId)throw new MarketError('plugin_origin_conflict','This plugin ID is already installed from a different repository')
      if(installed&&installed.category!==plugin.category)throw Error('Plugin category changed; explicit migration required')
      if(installed&&compareVersion(target.version,installed.selected.version)<0)throw Error('Use Roll back to return to the retained compatible version')
      if(!installed&&host.config.viewPlugins.some(p=>p.id===input.pluginId))throw Error('This plugin is managed by the startup configuration')
    }else{
      if(!installed)throw Error('Plugin is not installed')
      target=input.action==='rollback'?installed.previous:installed.selected
      if(input.action==='rollback'&&(!target||!compatible(target)))throw Error('No compatible previous version is retained')
    }
    const connections=installed?.kind?host.config.sources.filter(s=>s.kind===installed.kind).map(s=>s.id):[]
    if(['disable','uninstall'].includes(input.action)&&connections.length)throw new MarketError('plugin_in_use','This connector still has configured connections: '+connections.join(', '))
    const restart=input.action!=='install'&&(installed?.category==='source')&&input.action!=='ignore'
    const plan:MarketPlan={id:randomUUID(),action:input.action,pluginId:input.pluginId,catalogId:input.catalogId,revision:state.revision,settingsRevision:host.settings.current().revision,expiresAt:Date.now()+600000,plugin,origin,target,permissionsAdded:(target?.permissions??[]).filter(p=>!installed?.active?.permissions.includes(p)),restart,connections}
    host.store.put('plugin-market-plan',plan.id,plan);return {...plan,blockers:restart?marketBlockers(host):[]}
  }
  private check(plan:MarketPlan){
    if(plan.expiresAt<Date.now())throw new MarketError('market_plan_expired','The install plan expired. Review the plugin again.')
    if(marketState(this.host().store).revision!==plan.revision||this.host().settings.current().revision!==plan.settingsRevision)throw new MarketError('market_conflict','Configuration changed. Review the operation again.')
  }
  async execute(planId:string,requestId:string,rebuild:Rebuild){
    const host=this.host(),replay=host.store.get<MarketOperation>('plugin-market-operation',requestId)
    if(replay){if(replay.planId!==planId)throw new MarketError('request_id_conflict','This request ID belongs to another operation');return replay}
    if(this.busy)throw new MarketError('market_busy','Another plugin operation is running')
    const plan=host.store.get<MarketPlan>('plugin-market-plan',planId);if(!plan)throw Error('Unknown plugin operation plan')
    this.check(plan);this.busy=true
    let op:MarketOperation={id:requestId,planId,pluginId:plan.pluginId,action:plan.action,state:plan.action==='install'?'downloading':'activating',at:Date.now()}
    const save=(state:MarketOperation['state'],error?:string)=>{op={...op,state,error};this.host().store.put('plugin-market-operation',requestId,op)}
    save(op.state)
    try{
      let state=marketState(host.store),item=state.installed.find(p=>p.id===plan.pluginId)
      if(plan.action==='install'){
        const target=plan.target!,plugin=plan.plugin!,source=state.catalogs.find(c=>c.id===plan.catalogId)!
        const bytes=await this.github.download(plan.origin!,target,source.tokenEnv);save('verifying');this.check(plan)
        const staging=join(host.config.stateDir,'plugins','staging');mkdirSync(staging,{recursive:true,mode:0o700})
        const temp=mkdtempSync(join(staging,'download-'))
        try{
          extractPluginArchive(bytes,temp)
          const pkg=plugin.category==='workspace-view'?readViewPackage(temp,target.digest):readPluginPackage(temp,target.digest)
          if('code'in pkg)new Script(pkg.code,{filename:'workspace-view.js'})
          if(pkg.manifest.id!==plugin.id||pkg.manifest.version!==target.version||JSON.stringify(packagePermissions(pkg.manifest))!==JSON.stringify([...target.permissions].sort()))throw Error('Downloaded plugin identity or permissions differ from the reviewed plan')
          if('kind'in pkg.manifest){
            for(const entry of host.config.sourcePlugins)if('directory'in entry&&!state.ownedDigests.includes(entry.digest)&&readPluginPackage(entry.directory,entry.digest).manifest.kind===pkg.manifest.kind)throw Error('This connector kind is managed by the startup configuration')
            if(item?.stateVersion&&item.stateVersion!==pkg.manifest.stateVersion)throw Error('Plugin state protocol changed; an explicit migration is required')
            if(item?.kind&&item.kind!==pkg.manifest.kind)throw Error('Plugin connector kind changed')
          }
          const installed=plugin.category==='workspace-view'?installViewPackage(temp,host.config.stateDir,target.digest):installPluginPackage(temp,host.config.stateDir,target.digest)
          if(!item){item={id:plugin.id,category:plugin.category,name:plugin.name,origin:plan.origin!,selected:target,enabled:false,directory:installed.directory};state.installed.push(item)}
          item.selected=target;item.directory=installed.directory;item.ignoredVersion=undefined
          if('kind'in pkg.manifest){item.kind=pkg.manifest.kind;item.stateVersion=pkg.manifest.stateVersion}
          state.ownedDigests=[...new Set([...state.ownedDigests,target.digest])]
          if(item.category==='workspace-view'){
            if(item.active?.digest!==target.digest)item.previous=item.active
            item.active=target;item.enabled=true
            this.commitView(state)
          }else this.persist(state)
        }finally{rmSync(temp,{recursive:true,force:true})}
        save(item!.category==='source'?'installed':'complete')
      }else{
        item=item!;this.check(plan)
        if(plan.action==='ignore'){
          const update=this.updateFor(state,item);if(!update)throw Error('There is no update to ignore')
          item.ignoredVersion=update.version;this.persist(state);save('complete');return op
        }
        if(['disable','uninstall'].includes(plan.action)&&host.config.sources.some(s=>s.kind===item!.kind))throw new MarketError('plugin_in_use','This connector has configured connections')
        if(plan.action==='uninstall')state.installed=state.installed.filter(p=>p.id!==item!.id)
        else if(plan.action==='disable')item.enabled=false
        else {const target=plan.action==='rollback'?item.previous!:item.selected;if(item.active?.digest!==target.digest)item.previous=item.active;item.active=target;item.selected=target;item.enabled=true}
        if(plan.restart){await this.activateSource(state,op,rebuild);save('complete')}
        else {this.commitView(state);save('complete')}
      }
      this.host().store.audit({type:'plugin.market.operation',id:op.id,pluginId:op.pluginId,action:op.action,state:op.state})
      return op
    }catch(error){
      const message=error instanceof Error?error.message:'Plugin operation failed'
      // Failed rebuilds may have left the old host closed; durable recovery remains available on boot.
      try{save('failed',message)}catch{const store=new Store(join(host.config.stateDir,'state.sqlite'));try{store.put('plugin-market-operation',op.id,{...op,state:'failed',error:message})}finally{store.close()}}
      throw error
    }finally{this.busy=false}
  }
  private commitView(state:ManagedMarketState){
    const host=this.host(),next=configSchema.parse(host.config);applyMarketConfig(next,state)
    host.store.atomic(()=>{
      this.persist(state)
      const previous=host.settings.current();host.store.put('settings-history',String(previous.revision),previous)
      host.store.put('settings','current',{revision:previous.revision+1,at:new Date().toISOString(),config:next})
    })
    // View refs are read at each bundle/data request; no running model or source is restarted.
    host.config.viewPlugins=next.viewPlugins
  }
  private async activateSource(state:ManagedMarketState,operation:MarketOperation,rebuild:Rebuild){
    const host=this.host(),blockers=marketBlockers(host)
    if(blockers.length)throw new MarketError('plugin_waiting_for_idle','Activation is waiting for: '+blockers.map(b=>b.kind+' ('+b.count+')').join(', '))
    const paused=await host.pauseForConfiguration(),previous=marketState(host.store),settings=host.settings.current()
    let committed=false
    try{
      if(marketBlockers(host).length)throw new MarketError('plugin_waiting_for_idle','New work arrived. Retry activation when the host is idle.')
      const next=configSchema.parse(host.config);applyMarketConfig(next,state)
      const journal:MarketActivation={id:operation.id,previous,settings,paused,installations:host.store.list('plugin-installation')}
      host.store.atomic(()=>{host.store.put('plugin-market-activation','current',journal);this.persist(state);host.store.put('settings','current',{revision:settings.revision+1,at:new Date().toISOString(),config:next})});committed=true
      await rebuild(next,operation.id)
      const current=this.host()
      current.store.atomic(()=>{current.store.db.prepare("DELETE FROM records WHERE kind='plugin-market-activation' AND id='current'").run();current.store.put('plugin-market-operation',operation.id,{...operation,state:'complete'})})
      current.pause(paused)
    }catch(error){
      if(committed){
        const store=new Store(join(host.config.stateDir,'state.sqlite'));try{recoverMarket(store)}finally{store.close()}
        try{await rebuild(configSchema.parse(settings.config));this.host().pause(paused)}catch{throw new MarketError('market_recovery_required','Previous plugin references were restored, but the host could not restart. Restart Roppo to recover.',503)}
      }else host.pause(paused)
      throw error
    }
  }
  manifest(id:string){const p=marketState(this.host().store).installed.find(p=>p.id===id&&p.category==='source'&&p.active&&p.enabled);if(!p)throw Error('Enable this connector first');return readPluginPackage(objectDirectory(this.host().config,p.active!.digest),p.active!.digest).manifest}
  async preview(catalogId:string,pluginId:string,index:number){
    const source=marketState(this.host().store).catalogs.find(c=>c.id===catalogId),path=source?.plugins.find(p=>p.id===pluginId)?.screenshots[index]
    if(!source?.origin||!path)throw Error('Preview unavailable')
    return this.github.preview(source.origin,path,source.tokenEnv)
  }
}
