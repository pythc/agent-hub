import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {BusinessDecisionView} from '../src/business-decisions.ts';
const {BusinessDecisions}=await import('../web/chat/'+'business-decisions.tsx');
import {decisionAttempt,decisionStatus,DecisionSubmission} from '../web/chat/decision-state.ts';
const make=(extra:Partial<BusinessDecisionView>={}):BusinessDecisionView=>({id:'question-1',ticketId:'ticket',question:'Which plan?',summary:'Choose delivery',version:'host-digest',createdAt:0,expiresAt:Date.now()+3600000,status:'pending',reason:null,target:{label:'Delivery',version:'proposal-v2',amount:{value:'20.00',currency:'USD'},recipient:{id:'recipient-1',label:'Alice'}},answer:null,...extra});
const render=(d:BusinessDecisionView,disabled=false)=>renderToStaticMarkup(React.createElement(BusinessDecisions,{conversationId:"one",items:[d],disabled,language:"zh-CN",request:vi.fn(),refresh:vi.fn()}));
describe('business question UI contract',()=>{
 it('shows the exact proposal, amount and recipient without presenting execution approval',()=>{
  const html=render(make());for(const text of ['Delivery','proposal-v2','20.00','USD','Alice','recipient-1','答复只记录业务选择，不授予执行权限。'])expect(html).toContain(text);
  expect(html).not.toContain('host-digest');expect(html).not.toContain('批准执行');
 });
 it('does not expose a host digest as a proposal version',()=>{const d=make();d.target.version=d.version;const html=render(d);expect(html).toContain('当前已保存方案');expect(html).not.toContain('host-digest')});
 it('escapes question, summary, recipient and answer text',()=>{
  const html=render(make({question:'<script>unsafe</script>',answer:{text:'<img src=x>',at:1}}));expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).toContain('&lt;img');
 });
 it('does not invent transcript messages or action controls for an answered question',()=>{
  const html=render(make({status:'answered',answer:{text:'Plan A',at:1}}));expect(html).toContain('Plan A');expect(html).not.toContain('<textarea');expect(html).not.toContain('提交答复');
 });
 it.each(['expired','stale'] as const)('requires renewal before answering %s',status=>{const html=render(make({status}));expect(html).toContain('更新问题');expect(html).not.toContain('<textarea');expect(html).not.toContain('提交答复')});
 it.each(['withdrawn','unavailable'] as const)('does not offer an answer or renewal for %s',status=>{const html=render(make({status}));expect(html).not.toContain('<button');expect(html).not.toContain('<textarea')});
 it('disables editing and submitting while conversation is busy, readonly or offline',()=>{const html=render(make(),true);expect(html).toMatch(/<textarea[^>]*disabled/);expect(html).toMatch(/<button[^>]*disabled/)});
 it('locally expires pending questions and treats invalid time as unavailable',()=>{const d=make({createdAt:1,expiresAt:10});expect(decisionStatus(d,9)).toBe('pending');expect(decisionStatus(d,10)).toBe('expired');expect(decisionStatus(d,0)).toBe('unavailable');expect(decisionStatus(d,NaN)).toBe('unavailable');expect(decisionStatus({...d,status:'answered'},11)).toBe('answered')});
 it('binds immutable retry body to question and host digest, not target label version',()=>{const d=make();const a=decisionAttempt(d,'answer',' A ');expect(a).toMatchObject({action:'answer',id:d.id,version:'host-digest',text:'A'});expect(a.requestId).toMatch(/^[0-9a-f-]{36}$/);expect(Object.isFrozen(a)).toBe(true);expect(a).not.toHaveProperty('clientMessageId')});
 it('never carries a previous answer into a renewal',()=>{expect(decisionAttempt(make(),'renew','old answer')).not.toHaveProperty('text')});
 it('rejects blank and oversized answers',()=>{expect(()=>decisionAttempt(make(),'answer',' ')).toThrow();expect(()=>decisionAttempt(make(),'answer','a'.repeat(10001))).toThrow()});
});

describe('submission ordering and retries',()=>{
 it('blocks double submission until the first completes',async()=>{
  const s=new DecisionSubmission();let finish!:()=>void;const request=vi.fn(()=>new Promise<void>(r=>finish=r));
  const first=s.run(make(),'answer','A',request);expect(await s.run(make(),'answer','B',request)).toBe('ignored');expect(request).toHaveBeenCalledTimes(1);finish();expect(await first).toBe('accepted');
 });
 it('retries the identical body after a lost receipt even if input changed',async()=>{
  const s=new DecisionSubmission(),request=vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValue({});
  await expect(s.run(make(),'answer','A',request)).rejects.toThrow('network');const original=s.pending;
  await s.run(make(),'answer','B',request);expect(request.mock.calls[1]![0]).toBe(original);expect(s.pending?.text).toBe('A');
 });
 it('never applies a pending attempt to a new question version',async()=>{
  const s=new DecisionSubmission(),request=vi.fn().mockRejectedValue(Error('network'));
  await expect(s.run(make(),'answer','A',request)).rejects.toThrow();await expect(s.run(make({version:'new'}),'answer','B',request)).rejects.toThrow('decision_context_changed');expect(request).toHaveBeenCalledTimes(1);
 });
 it('ignores late completion after disposal and never starts another send',async()=>{
  const s=new DecisionSubmission();let finish!:()=>void;const request=vi.fn(()=>new Promise<void>(r=>finish=r));const task=s.run(make(),'answer','A',request);s.dispose();finish();expect(await task).toBe('ignored');expect(await s.run(make(),'answer','A',request)).toBe('ignored');expect(request).toHaveBeenCalledTimes(1);
 });
});
