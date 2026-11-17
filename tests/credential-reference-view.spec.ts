import {expect,it} from 'vitest'
import {readCredentialInformation,credentialInformationLabel} from '../web/chat/credential-reference-view.ts'
const row=(state='present',references:unknown[]=[{slot:0,purpose:'authentication',state:'present'}])=>({kind:'source',id:'team',state,references,verification:'not_checked'})
const snapshot=(connections:unknown[]=[row()])=>({schema:1,scope:'host',observedAt:1000,settingsRevision:7,connections})
it('rebuilds only display linkage and states, discarding all slot/field/provider material',()=>{
 const raw={...snapshot([{...row(),field:'SECRET_FIELD',environment:'SECRET_ENV',references:[{slot:0,purpose:'authentication',state:'present',header:'SECRET_HEADER',value:'SECRET_VALUE'}]}]),raw:'SECRET_RAW'}
 expect(readCredentialInformation(raw)).toEqual({observedAt:1000,settingsRevision:7,connections:[{kind:'source',id:'team',state:'present'}]})
 expect(JSON.stringify(readCredentialInformation(raw))).not.toMatch(/SECRET|slot|field|reference|header|value/)
})
it.each([null,undefined,{}, {...snapshot(),schema:2},{...snapshot(),scope:'workspace'},{...snapshot(),observedAt:Infinity},{...snapshot(),observedAt:8.64e15+1},{...snapshot(),observedAt:-1},{...snapshot(),settingsRevision:0.5},{...snapshot(),connections:{}},snapshot([row(),row()])])('rejects an unsupported or corrupt snapshot without echoing its content (%#)',value=>{
 expect(()=>readCredentialInformation(value)).toThrow(/^credential_information_unavailable$/)
})
it.each([
 {...row(),kind:'SECRET_KIND'},{...row(),kind:{toString:():string=> 'source'}},{...row(),id:'SECRET INVALID ID'},{...row(),state:'authenticated'},{...row(),verification:'verified'},
 row('present',[]),row('not_declared',[{slot:0,purpose:'authentication',state:'present'}]),row('present',[{slot:0,purpose:'authentication',state:'missing'}]),row('present',[{slot:0,purpose:'authentication',state:'unknown'}]),row('unknown',[{slot:0,purpose:'authentication',state:'missing'}]),
 row('present',[{slot:1,purpose:'authentication',state:'present'}]),row('present',[{slot:0,purpose:'SECRET',state:'present'}]),row('present',[{slot:0,purpose:'authentication',state:'SECRET'}]),row('present',[{slot:0,purpose:'authentication',state:'present'},{slot:0,purpose:'process_environment',state:'present'}]),
])('rejects invalid linkage, verification, slots and aggregate evidence (%#)',value=>{expect(()=>readCredentialInformation(snapshot([value]))).toThrow(/^credential_information_unavailable$/)})
it('retains explicit unknown/no-check states without inferring authentication or slot purposes',()=>{
 expect(readCredentialInformation(snapshot([row('unknown',[]),{...row('not_declared',[]),kind:'tool',id:'tools'},{...row('unknown',[{slot:0,purpose:'process_environment',state:'present'},{slot:1,purpose:'authentication',state:'unknown'}]),kind:'backend',id:'codex'}])).connections.map(r=>r.state)).toEqual(['unknown','not_declared','unknown'])
 expect(credentialInformationLabel('present')).toEqual(['Found in this environment','已在当前环境找到'])
 for(const state of ['present','missing','unknown','not_declared'] as const)expect(credentialInformationLabel(state).join(' ')).not.toMatch(/authenticated|verified|未声明|引用|已登录|凭据/)
})
it('accepts Date limits and distinct same-id kinds while returning detached facts',()=>{
 const value={...snapshot([row(),{...row(),kind:'tool'}]),observedAt:8.64e15,settingsRevision:0},result=readCredentialInformation(value)
 const original=value.connections[0] as ReturnType<typeof row>;original.state='missing';expect(result.connections[0]!.state).toBe('present');expect(result.connections).toHaveLength(2)
})
