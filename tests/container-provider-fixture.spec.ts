import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {Ajv} from 'ajv'
import {expect,it} from 'vitest'
import {reportSchema} from '../src/schemas.ts'

it('emits a production-schema-valid ready report after the managed shell result',async()=>{
 let handler:any,response:any
 // Execute the actual deterministic fixture without opening a port or writing its log.
 const source=readFileSync(new URL('../examples/container-provider-fixture.mjs',import.meta.url),'utf8').replace(/^import .*$/gm,'')
 runInNewContext(source,{Buffer,createServer:(fn:any)=>{handler=fn;return {listen(){}}},appendFileSync(){},readFileSync(){throw Error('Unexpected router read')}})
 const body=JSON.stringify({model:'container-worker',messages:[{role:'tool',tool_call_id:'shell-read',content:'2\n'}]})
 await handler({async *[Symbol.asyncIterator](){yield Buffer.from(body)}},{writeHead(){},end(value:string){response=JSON.parse(value)}})
 const result=JSON.parse(response.choices[0].message.content),validate=new Ajv({strict:false}).compile(reportSchema)
 expect(validate(result),JSON.stringify(validate.errors)).toBe(true)
 expect(result).toMatchObject({state:'ready',reply:'2',question:null,askedBy:null,decision:null,handbacks:[]})
})
