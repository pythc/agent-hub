import {expect,it} from 'vitest'
import {scopeCommandSchema} from '../src/router-scope.ts'
import {checkBudget,scopeBudget} from '../src/context-budget.ts'
const command=(contextBytes?:number)=>({action:'scope.put',operationId:'budget',expectedRevision:0,scope:{id:'team',tenantId:'owner',name:'Team',managers:['manager'],workerIds:[],sourceIds:['local'],backendIds:['codex'],...(contextBytes===undefined?{}:{contextBytes})}})
it('accepts the authorized ten-megabyte scope budget while preserving explicit older budgets',()=>{
 for(const bytes of [undefined,10000000,256000]){const c=scopeCommandSchema.parse(command(bytes));if(c.action!=='scope.put')throw Error('Unexpected command');expect(c.scope.contextBytes).toBe(bytes??10000000)}
 expect(()=>scopeCommandSchema.parse(command(10000001))).toThrow()
 expect(scopeBudget(10000000)).toEqual({maxBytes:10000000,outputReserveBytes:8192,toolReserveBytes:4096})
 expect(()=>checkBudget({text:'x'.repeat(10000000)},scopeBudget(10000000),'native-protocol','before_tool',undefined,true)).toThrow('Context budget exceeded')
})
