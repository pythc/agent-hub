import {describe,expect,it} from 'vitest';
import {companionStatus} from '../web/chat/companion-state.ts';
import type {ChatSessions} from '../src/chat.ts';
type Snapshot=ReturnType<ChatSessions['view']>;
const L=(_en:string,zh:string)=>zh;
const base=()=>({run:{id:'current',state:'running',createdAt:1},workers:[],calls:[],browsers:[]} as unknown as Snapshot);
const options={connected:true};
const call=(changes:Record<string,unknown>={})=>({id:'model',kind:'router',name:'router',conversationId:'chat',runId:'current',startedAt:10,state:'running',...changes}) as Snapshot['calls'][number];

describe('Chat companion reflects current execution',()=>{
 it('uses public model status only from the active run',()=>{
  const s=base();s.calls=[call({runId:'old',status:{phase:'reviewing',label:'旧任务',updatedAt:100}})];
  expect(companionStatus(s,L,options).label).toBe('正在思考');
  s.calls.push(call({status:{phase:'working',label:'正在修改输入栏',updatedAt:101}}));
  expect(companionStatus(s,L,options)).toMatchObject({phase:'working',label:'正在修改输入栏'});
 });
 it.each(['waiting','completed','cancelled','cancel_requested','failed'] as const)('lets lifecycle %s override a model label',state=>{
  const s=base();s.run!.state=state;s.calls=[call({status:{phase:'working',label:'正在工作',updatedAt:100}})];
  expect(companionStatus(s,L,options).phase).toBe(({waiting:'waiting',completed:'completed',cancelled:'stopped',cancel_requested:'stopped',failed:'failed'})[state]);
 });
 it('ignores completed activity and chooses a newer running operation',()=>{
  const s=base();s.calls=[call({status:{phase:'thinking',label:'正在思考',updatedAt:20}}),call({id:'tool',kind:'tool',name:'superagent_review',startedAt:30})];
  expect(companionStatus(s,L,options).phase).toBe('reviewing');
  s.calls=[call({state:'completed',status:{phase:'reviewing',label:'过时信息',updatedAt:100}})];
  expect(companionStatus(s,L,options).label).toBe('正在思考');
 });
 it('stops the working pose during browser handoff and reconnect',()=>{
  const s=base();s.browsers=[{runId:'current',control:'paused',ended:false}] as Snapshot['browsers'];
  expect(companionStatus(s,L,options).phase).toBe('waiting');
  expect(companionStatus(s,L,{connected:false}).phase).toBe('offline');
 });
 it('does not show another Worker activity in a selected Worker view',()=>{
  const s=base();s.workers=[{id:'a',tasks:[]},{id:'b',tasks:[]}] as unknown as Snapshot['workers'];
  s.calls=[call({workerId:'b',kind:'worker',status:{phase:'reviewing',label:'B 的任务',updatedAt:100}})];
  expect(companionStatus(s,L,{...options,participantId:'a'}).phase).toBe('idle');
  expect(companionStatus(s,L,{...options,participantId:'historic-router'}).label).toBe('历史协作记录');
 });
 it('keeps pending sends distinct from a previously completed run',()=>{
  const s=base();s.run!.state='completed';
  expect(companionStatus(s,L,{...options,sending:true}).phase).toBe('thinking');
  expect(companionStatus(null,L,options).phase).toBe('idle');
 });
});
