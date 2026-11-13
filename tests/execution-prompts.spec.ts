import {expect,it} from 'vitest'
import {configSchema} from '../src/config.ts'
import {composeExecutionPrompt,previewInstructions} from '../src/execution-prompts.ts'
import {appendAgentPrompt,managedBase} from '../src/managed-instructions.ts'
import {promptStatus} from '../src/prompts.ts'

const config=()=>configSchema.parse({execution:{router:{mode:'host',prompt:'Router profile'},workers:[{id:'one',backend:'codex',prompt:'Worker one profile'},{id:'two',backend:'codex',prompt:'Worker two profile'}]},backends:{codex:{kind:'codex',defaults:{prompt:'Backend default'}},helper:{kind:'codex',defaults:{prompt:'Independent helper profile'}}},sources:[{id:'local',kind:'local',cwd:'.',sandbox:'workspace-write',allowedActors:['operator'],workspace:{mode:'directory',project:{testCommand:'npm test'}}}]})

it('previews project runtime sections and selected Worker without restricting collaboration',()=>{
 const c=config(),p=previewInstructions(c,{role:'worker',workerId:'two'})
 expect(p.mode).toBe('project')
 expect(p.sections.map(s=>s.id)).toEqual(['role','runtime/worker/delegated','runtime/worker/project','project-context','runtime/worker/tools','runtime/personalization','runtime/worker/goal','agent-profile'])
 expect(p.text).toContain('Worker two profile')
 expect(p.text).not.toContain('Worker one profile')
 expect(p.text).toContain('npm test')
 expect(p.text).toContain('superagent_spawn')
 expect(p.text).not.toContain('never push or merge from shell')
 expect(p.text).not.toContain('hands control to a person and stops subagents')
 expect(p.baseInstructions).toBe(managedBase)
 expect(c.execution.workers).toHaveLength(2)
 const r=previewInstructions(c,{role:'router'})
 expect(r.sections.map(s=>s.id)).toEqual(['role','runtime/coordinator/project','runtime/coordinator/context','runtime/personalization','agent-profile'])
 expect(r.text).toContain('one Worker')
 expect(r.text).toContain('Router profile')
})

it.each(['standalone','delegated','goal','subagent'] as const)('isolates the %s completion contract',mode=>{
 const p=previewInstructions(config(),{role:'worker',mode})
 const ids=p.sections.map(s=>s.id)
 expect(ids).not.toContain('runtime/worker/project')
 if(mode==='subagent')expect(ids).toEqual(['role','runtime/subagent','agent-profile'])
 else expect(ids.at(-2)).toBe('runtime/worker/'+({standalone:'standalone',delegated:'continuation',goal:'goal'}[mode]))
})

it('resolves helper backend and options with the same inheritance rules as execution',()=>{
 const c=config()
 expect(previewInstructions(c,{role:'worker',mode:'subagent',workerId:'two'}).text).toContain('Worker two profile')
 c.execution.roles.subagent='helper'
 const p=previewInstructions(c,{role:'worker',mode:'subagent',workerId:'two'})
 expect(p.backendId).toBe('helper')
 expect(p.text).toContain('Independent helper profile')
 expect(p.text).not.toContain('Worker two profile')
 delete c.execution.workers![1]!.prompt
 expect(previewInstructions(c,{role:'worker',workerId:'two'}).text).toContain('Backend default')
})

it('preserves customized runtime instructions and reports changed defaults after upgrade',()=>{
 const c=config()
 c.prompts.overrides['runtime/worker/goal']={text:'Team acceptance instructions',base:'a'.repeat(64)}
 const p=previewInstructions(c,{role:'worker',mode:'goal'})
 expect(p.sections.find(s=>s.id==='runtime/worker/goal')).toMatchObject({source:'override:runtime/worker/goal',text:'Team acceptance instructions'})
 expect(promptStatus(c).find(s=>s.id==='runtime/worker/goal')?.defaultChanged).toBe(true)
})

it('uses the execution adapter suffix for per-Agent instructions',()=>{
 const c=config(),input={role:'worker' as const,environment:{cwd:'.'},managedGoal:true,delegated:true}
 const base=composeExecutionPrompt(c,input)
 expect(composeExecutionPrompt(c,{...input,agentPrompt:'specific'}).text).toBe(appendAgentPrompt(base.text,'specific'))
 expect(()=>previewInstructions(c,{role:'worker',workerId:'missing'})).toThrow('Unknown preview Worker')
 expect(()=>previewInstructions(c,{role:'router',mode:'subagent'})).toThrow('belongs to a Worker')
})
