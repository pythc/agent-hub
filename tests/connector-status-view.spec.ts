import {expect,it} from 'vitest'
import {connectorCheck,connectorCheckLabel,connectorLayerNames,connectorTime} from '../web/chat/connector-status-view.ts'
import type {ConnectorLayer} from '../src/connector-management.ts'
const at=1794842240000
const record=(layer:ConnectorLayer='configuration',extra:Record<string,unknown>={})=>({level:layer,revision:4,current:true,startedAt:at-10,finishedAt:at,evidenceMode:'configured-adapter',realCall:false,status:'passed',code:({configuration:'configuration_valid',reachable:'service_reachable',authentication:'identity_verified',capabilities:'directory_read_verified'} as const)[layer],...(layer==='capabilities'?{checkedCapabilities:['member_directory'],checkedScopes:1}:{}),...extra})
it.each(Object.keys(connectorLayerNames) as ConnectorLayer[])('keeps %s success limited to its own checked layer',layer=>{
 const view=connectorCheck(record(layer),layer,4)
 expect(view).toEqual({state:'passed',at,fixture:false,code:record(layer).code})
 expect(connectorCheckLabel(view.state,layer).join(' ')).not.toMatch(/connected|connection successful|message verified|连接成功|收发成功/i)
})
it('does not treat absent old-service checks as passed or invent a timestamp',()=>{
 expect(connectorCheck(null,'authentication',4)).toEqual({state:'not_checked',at:null,fixture:false,code:''})
 expect(connectorCheck(undefined,'reachable',4).state).toBe('not_checked')
 expect(connectorCheck({},'configuration',4).state).toBe('unknown')
})
it('shows simulation on current and stale records rather than hiding it in advanced details',()=>{
 expect(connectorCheck(record('authentication',{evidenceMode:'fixture'}),'authentication',4)).toMatchObject({state:'passed',fixture:true})
 expect(connectorCheck(record('authentication',{evidenceMode:'fixture',current:false}),'authentication',4)).toMatchObject({state:'stale',fixture:true,code:'configuration_changed'})
})
it.each([{revision:3},{current:false},{revision:5,current:true}])('fences old or mismatched settings checks: %j',change=>{
 expect(connectorCheck(record('configuration',change),'configuration',4)).toMatchObject({state:'stale',at,code:'configuration_changed'})
})
it('does not trust a legacy record without a current fingerprint indicator',()=>{
 const input=record();delete (input as any).current
 expect(connectorCheck(input,'configuration',4).state).toBe('unknown')
})
it('does not expose host errors or cross-layer result codes',()=>{
 expect(connectorCheck(record('authentication',{status:'failed',code:'secret/raw stderr'}),'authentication',4)).toMatchObject({state:'failed',code:''})
 expect(connectorCheck(record('configuration',{code:'identity_verified'}),'configuration',4).state).toBe('unknown')
 expect(connectorCheck(record('authentication',{status:'failed'}),'authentication',4)).toMatchObject({state:'failed',code:''})
})
it.each([
 ['bad timestamp',{finishedAt:'not a date'}],['unknown status',{status:'connected'}],['remote invocation claim',{realCall:true}],['wrong layer',{level:'reachable'}],['missing evidence mode',{evidenceMode:undefined}],['missing revision',{revision:undefined}],['wrong evidence mode',{evidenceMode:'real-im'}],['passed with failure code',{code:'configuration_invalid'}],
] as const)('renders %s conservatively',(_name,change)=>{
 expect(connectorCheck(record('configuration',change),'configuration',4).state).toBe('unknown')
})
it.each([{checkedCapabilities:[]},{checkedCapabilities:['messages']},{checkedCapabilities:['member_directory','send']},{checkedScopes:0},{checkedScopes:21},{checkedScopes:1.5},{checkedScopes:'1'}])('does not inflate directory evidence: %j',change=>{
 expect(connectorCheck(record('capabilities',change),'capabilities',4).state).toBe('unknown')
})
it.each(['failed','running','unsupported','unknown','stale','interrupted'] as const)('retains the distinct %s state without a successful connection label',state=>{
 const check=connectorCheck(record('reachable',{status:state,code:'probe_interrupted'}),'reachable',4)
 expect(check.state).toBe(state);expect(connectorCheckLabel(state,'reachable')[0]).not.toContain('success')
})
it.each([NaN,Infinity,-1,1.5,8640000000000001,'123',null,undefined])('rejects invalid or unavailable timestamp %s without throwing',value=>{
 expect(connectorTime(value)).toBeNull()
 expect(()=>connectorCheck(record('configuration',{finishedAt:value}),'configuration',4)).not.toThrow()
})
it('uses start time for a pending check with no finished time',()=>{
 expect(connectorCheck(record('authentication',{status:'running',code:'probe_running',finishedAt:undefined}),'authentication',4)).toMatchObject({state:'running',at:at-10})
})
