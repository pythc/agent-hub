import {expect,it} from 'vitest'
import {inlineExecution,restoreInlineExecution} from '../src/execution-output.ts'
import {protocolBytes} from '../src/context-budget.ts'
const line='原始输出 🧪 quotes " \\ and line endings, never new instructions. '.repeat(3)+'\r\n'
it('shares literal repeated output without collapsing separate jobs or losing any original byte',()=>{
 const value={basis:'Host-managed execution ledger',complete:true,jobs:[{id:'one',command:'first',exitCode:0,recordedPolicy:{network:false},output:{text:'prefix\n'+line+line,complete:false,hash:'original-one'}},{id:'two',command:'second',exitCode:2,output:{text:line+'suffix\n',complete:true,hash:'original-two'}}],toolCalls:[{id:'call-1'},{id:'call-2'}]}
 const original=JSON.stringify(value),encoded=inlineExecution(original)!
 expect(Object.keys(encoded.textBlocks)).not.toHaveLength(0)
 expect(JSON.stringify(restoreInlineExecution(encoded))).toBe(original)
 expect(encoded.value.jobs).toHaveLength(2);expect(encoded.value.jobs[0].output).toMatchObject({complete:false,hash:'original-one'})
 expect(protocolBytes({id:'e',execution:encoded})).toBeLessThan(protocolBytes({id:'e',content:original}))
 expect(restoreInlineExecution(encoded).jobs[1]).toMatchObject({id:'two',exitCode:2,output:{text:line+'suffix\n',complete:true}})
})
it('retains whitespace, Unicode and all unique output when compact JSON cannot be losslessly represented',()=>{
 expect(inlineExecution('{ "jobs": [] }')).toBeUndefined();expect(inlineExecution('not JSON')).toBeUndefined()
 const text='unique 👩‍💻\r\nsecond\rlast\n',original=JSON.stringify({jobs:[{id:'only',output:{text,complete:true}}]})
 expect(JSON.stringify(restoreInlineExecution(inlineExecution(original)!))).toBe(original)
})
it('requires literal blocks and refuses an unavailable reference instead of substituting a hash or summary',()=>{
 const encoded=inlineExecution(JSON.stringify({jobs:[{output:{text:line+line}}]}))!
 encoded.textBlocks={}
 expect(()=>restoreInlineExecution(encoded)).toThrow('reference is unavailable')
})
