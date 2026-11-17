import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,ChevronRight,LoaderCircle,SlidersHorizontal} from 'lucide-react';
import type {Config} from '../../src/config.ts';
import type {AgentOptions,BackendDefinition} from '../../src/backend-config.ts';
import {mergeParameters} from '../../src/agent-options.ts';
import './router-model.css';

type Effort=NonNullable<AgentOptions['effort']>;
type Configuration={current:{revision:number;config:Config};agentCapabilities?:Record<string,{efforts?:Effort[]}>};
type Props={label:string;model?:string;busy:boolean;L:(en:string,zh:string)=>string;onSaved:()=>Promise<void>};
async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(path,{credentials:'same-origin',signal,...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw Error(data.code??'configuration_failed');return data;
}
export function RouterModelControl({label,model,busy,L,onSaved}:Props){
 const trigger=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[config,setConfig]=useState<Configuration|null>(null),[backend,setBackend]=useState(''),[effort,setEffort]=useState<Effort|''>(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const [position,setPosition]=useState({left:16,bottom:16});
 const load=async(signal?:AbortSignal)=>{
  setError('');const data=await request<Configuration>('/configuration',undefined,signal);setConfig(data);
  setBackend(data.current.config.execution.router?.backend??data.current.config.execution.roles.router??data.current.config.execution.backend);
  setEffort(data.current.config.execution.router?.effort??'');
 };
 useEffect(()=>{
  if(!open)return;
  const place=()=>{const rect=trigger.current!.getBoundingClientRect();setPosition({left:Math.max(12,Math.min(rect.left,innerWidth-344)),bottom:innerHeight-rect.top+8})};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  const controller=new AbortController();void load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return()=>{controller.abort();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
 },[open]);
 const current=config?.current.config;
 const definitions:Record<string,BackendDefinition|{kind:'codex';label?:string;model?:string}>=current?{codex:{kind:'codex' as const},...current.backends}:{};
 const definition=definitions[backend];
 const supportsEffort=definition?.kind!=='anthropic';
 const efforts=config?.agentCapabilities?.[backend]?.efforts??(definition?.kind==='codex'?['low','medium','high','xhigh'] as Effort[]:['low','medium','high'] as Effort[]);
 const save=async()=>{
  if(!current||!config||busy||saving)return;
  setSaving(true);setError('');
  const previous=current.execution.router??{},selected=previous.backend??current.execution.roles.router??current.execution.backend,changed=selected!==backend;
  const router={...previous,backend};
  if(changed){delete router.model;delete router.parameters}
  if(supportsEffort&&effort)router.effort=effort;else delete router.effort;
  if(!effort&&definition&&(definition.kind==='openai-chat'||definition.kind==='openai-responses')&&router.parameters){
   router.parameters=structuredClone(router.parameters);
   delete router.parameters.reasoning_effort;
   const reasoning=router.parameters.reasoning as {effort?:string}|undefined;
   if(reasoning){delete reasoning.effort;if(!Object.keys(reasoning).length)delete router.parameters.reasoning}
   if(!Object.keys(router.parameters).length)delete router.parameters;
  }
  // Match explicit provider reasoning settings when a generic override is selected.
  if(effort&&definition&&(definition.kind==='openai-chat'||definition.kind==='openai-responses')){
   const parameters=mergeParameters(mergeParameters(definition.parameters,definition.defaults?.parameters),router.parameters);
   if(definition.kind==='openai-chat'&&parameters.reasoning_effort!==undefined)router.parameters={...router.parameters,reasoning_effort:effort};
   if(definition.kind==='openai-responses'&&(parameters.reasoning as {effort?:string}|undefined)?.effort!==undefined)router.parameters={...router.parameters,reasoning:{...(parameters.reasoning as object),effort}};
  }
  try{
   await request('/settings',{revision:config.current.revision,patch:{execution:{...current.execution,router},...(changed?{models:Object.fromEntries(Object.entries(current.models).filter(([key])=>key!=='router'))}:{})}});
   await onSaved();popover.current?.hidePopover();trigger.current?.focus();
  }catch(e){setError((e as Error).message)}finally{setSaving(false)}
 };
 const labels:Record<string,string>={none:L('Off','关闭'),minimal:L('Minimal','最少'),low:L('Low','低'),medium:L('Medium','中'),high:L('High','高'),xhigh:L('Extra high','最高')};
 return <>
  <button ref={trigger} type="button" className="model-link" popoverTarget="router-model-picker" aria-haspopup="dialog" aria-expanded={open} title={L('Choose model and reasoning','选择模型和思考强度')}><span className="composer-agent-name">{label}</span><span className="model-separator">·</span><span className="model-name">{model||L('Choose model','选择模型')}</span><SlidersHorizontal size={14}/></button>
  {createPortal(<div ref={popover} id="router-model-picker" className="router-model-picker" popover="auto" role="dialog" aria-label={L('Router model','Router 模型')} onToggle={e=>{const shown=e.newState==='open';setOpen(shown);if(!shown)setConfig(null)}} style={position}>
   <div className="router-model-heading"><strong>{L('Router model','Router 模型')}</strong></div>
   {!config&&!error?<div className="router-model-loading" role="status"><LoaderCircle className="spin" size={16}/>{L('Loading connections…','正在读取连接…')}</div>:null}
   {config?<form onSubmit={e=>{e.preventDefault();e.stopPropagation();void save()}}>
    <fieldset disabled={saving||busy}>
     <label htmlFor="router-connection">{L('Model connection','模型连接')}</label>
     <select autoFocus id="router-connection" value={backend} onChange={e=>{setBackend(e.target.value);setEffort('')}}>{Object.entries(definitions).map(([id,d])=><option key={id} value={id}>{d.label??(id==='codex'?'Codex':id)}{'model' in d&&d.model?' · '+d.model:''}</option>)}</select>
     {supportsEffort?<><label htmlFor="router-effort">{L('Reasoning effort','思考强度')}</label><select id="router-effort" value={effort} onChange={e=>setEffort(e.target.value as Effort|'')}><option value="">{L('Model default','模型默认')}</option>{[...new Set([...efforts,...(effort?[effort]:[])])].map(value=><option key={value} value={value}>{labels[value]??value}</option>)}</select></>:<a className="router-thinking-link" href="/configure#execution/configuration">{L('Configure model thinking','配置模型思考参数')}<ChevronRight size={14}/></a>}
    </fieldset>
    {busy?<p className="router-model-notice">{L('Available when this run finishes.','本次任务结束后可切换。')}</p>:null}
    <div className="router-model-actions"><a href="/configure#models">{L('Manage connections','管理连接')}<ChevronRight size={14}/></a><button disabled={saving||busy} className="router-model-save" type="submit">{saving?<LoaderCircle size={14} className="spin"/>:<Check size={14}/>} {saving?L('Saving…','正在保存…'):L('Apply','应用')}</button></div>
   </form>:null}
   {error?<div className="router-model-error" role="alert"><p>{error==='settings_conflict'?L('Settings changed. Reload before saving.','配置已更新，请重新读取后保存。'):L('Could not update the model. Please retry.','未能更新模型，请重试。')}</p><button type="button" onClick={()=>void load().catch(e=>setError(e.message))}>{L('Reload settings','重新读取配置')}</button></div>:null}
  </div>,document.body)}
 </>;
}
