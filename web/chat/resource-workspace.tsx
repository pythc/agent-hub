import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Folder, Globe, Users, Plus, X, Maximize2, Minimize2, Search, ArrowUpRight } from 'lucide-react';
import { closeResource, openResource, resourceUrl, type ResourceState, type ResourceKind } from './resource-state.ts';
import './resource-workspace.css';
type Props = {
  state: ResourceState; onChange: (state: ResourceState) => void;
  onOpen: (kind: ResourceKind, url?: string) => void;
  onClose: () => void; expanded: boolean; onExpand: () => void;
  L: (en:string,zh:string)=>string; children: ReactNode;
};
export function ResourceWorkspace({state,onChange,onOpen,onClose,expanded,onExpand,L,children}:Props) {
  const [query,setQuery]=useState('');
  const tabsRef=useRef<HTMLDivElement>(null);
  const active=state.tabs.find(t=>t.id===state.active)!;
  const entries=[
    {kind:'browser' as const,Icon:Globe,label:L('Browser','浏览器')},
    {kind:'files' as const,Icon:Folder,label:L('Files','文件')},
    {kind:'activity' as const,Icon:Users,label:L('Team activity','团队动态')},
  ];
  const meta=(kind:ResourceKind)=>entries.find(e=>e.kind===kind)??{kind:'new',Icon:Plus,label:L('New tab','新标签页')};
  useEffect(()=>{document.getElementById('resource-tab-'+state.active)?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});},[state.active]);
  const select=(id:string)=> {
    const t=state.tabs.find(t=>t.id===id);
    if(t) onChange({...openResource(state,t.kind),active:id});
  };
  const focus=(id:string)=>requestAnimationFrame(()=>document.getElementById('resource-tab-'+id)?.focus());
  const close=(id:string)=>{const next=closeResource(state,id);onChange(next);focus(next.active);};
  const url=resourceUrl(query);
  const shown=entries.filter(e=>!query || url || (e.label+' '+e.kind).toLowerCase().includes(query.toLowerCase()));
  return <aside id="session-panel" className={'session-panel resource-workspace'+(expanded?' expanded':'')} aria-label={L('Session panel','会话面板')}>
    <header className="resource-tabbar">
      <div className="resource-tabs" role="tablist" ref={tabsRef} aria-label={L('Workspace tabs','工作标签页')}
        onKeyDown={event=>{
          if((event.target as HTMLElement).getAttribute('role')!=='tab')return;
          const index=state.tabs.findIndex(t=>t.id===state.active);let next:number|undefined;
          if(event.key==='ArrowRight')next=(index+1)%state.tabs.length;
          if(event.key==='ArrowLeft')next=(index+state.tabs.length-1)%state.tabs.length;
          if(event.key==='Home')next=0;if(event.key==='End')next=state.tabs.length-1;
          if(event.key==='Delete'){event.preventDefault();close(state.active);return;}
          if(next!==undefined){event.preventDefault();const id=state.tabs[next]!.id;select(id);focus(id);}
        }}>
        {state.tabs.map(t=>{const {Icon,label}=meta(t.kind);return <div className={'resource-tab'+(t.id===state.active?' active':'')} key={t.id}>
          <button role="tab" id={'resource-tab-'+t.id} aria-selected={t.id===state.active} aria-controls={'resource-content-'+t.id} tabIndex={t.id===state.active?0:-1} onClick={()=>select(t.id)} title={label}>
            <Icon size={15}/><span>{label}</span>
          </button>
          <button className="resource-tab-close" tabIndex={t.id===state.active?0:-1} aria-label={L('Close ','关闭')+label+L(' view','视图')} onClick={()=>close(t.id)}><X size={13}/></button>
        </div>;})}
      </div>
      <button className="icon-button resource-add" onClick={()=>{onOpen('new');setQuery('');}} aria-label={L('New workspace tab','新建工作标签页')} title={L('New tab','新标签页')}><Plus size={17}/></button>
      <div className="resource-window-actions">
        <button className="icon-button" onClick={onExpand} aria-label={expanded?L('Collapse panel','缩小面板'):L('Expand panel','展开面板')} title={expanded?L('Collapse panel','缩小面板'):L('Expand panel','展开面板')}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>
        <button className="icon-button" onClick={onClose} aria-label={L('Close panel','收起面板')} title={L('Close panel','收起面板')}><X size={17}/></button>
      </div>
    </header>
    <div className="session-panel-content" role="tabpanel" id={'resource-content-'+active.id} aria-labelledby={'resource-tab-'+active.id}>
      {active.kind==='new'?<div className="resource-start">
        <form className="resource-search" onSubmit={e=>{e.preventDefault();if(url){onOpen('browser',url);setQuery('');}else if(shown.length===1)onOpen(shown[0]!.kind);}}>
          <Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} aria-label={L('Search tools or enter a website','搜索工具或输入网址')} placeholder={L('Search tools or enter a website','搜索工具或输入网址')}/>
          {url?<button type="submit" className="icon-button" aria-label={L('Open website','打开网站')}><ArrowUpRight size={16}/></button>:null}
        </form>
        <div className="resource-start-scroll">
          <section className="resource-tools"><h2>{L('Tools','工具')}</h2><div className="resource-tool-grid">
            {shown.map(({kind,Icon,label})=><button key={kind} onClick={()=>onOpen(kind)}><Icon size={18}/><span>{label}</span><ArrowUpRight size={14}/></button>)}
          </div>{!shown.length?<p className="resource-no-results">{L('No matching tools','没有匹配的工具')}</p>:null}</section>
          {state.recent.length&&!query?<section className="resource-recent"><h2>{L('Recent','最近')}</h2>
            {state.recent.map(r=>{const {Icon,label}=meta(r.kind);return <button key={r.kind} onClick={()=>onOpen(r.kind)}><span className="resource-recent-icon"><Icon size={18}/></span><span>{label}</span><time dateTime={new Date(r.at).toISOString()}>{new Intl.DateTimeFormat(L('en','zh-CN'),{hour:'2-digit',minute:'2-digit'}).format(r.at)}</time></button>;})}
          </section>:null}
        </div>
      </div>:children}
    </div>
  </aside>;
}
