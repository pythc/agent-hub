import {expect,it} from 'vitest'
import {Ajv} from 'ajv'
import {report,reportSchema} from '../src/schemas.ts'
const previous={state:'ready',summary:'Finished',reply:'Local result',question:null,askedBy:null,handbacks:[]}
it('keeps legacy native reports parseable without optional business terms',()=>{
 expect(report.parse(previous)).toEqual(previous)
})
it('uses nullable required decision in the new strict-provider output contract',()=>{
 expect([...reportSchema.required].sort()).toEqual(Object.keys(reportSchema.properties).sort())
 const validate=new Ajv({strict:false}).compile(reportSchema)
 expect(validate({...previous,decision:null})).toBe(true)
 expect(validate({...previous,decision:{target:{label:'A local report',version:'v1'},amount:null,recipient:null,validForSeconds:86400}})).toBe(true)
 expect(validate({...previous,decision:{target:{label:'A local report',version:'v1'},amount:{value:'12.50',currency:'USD'},recipient:{id:'local-reviewer',label:'Reviewer'},validForSeconds:86400}})).toBe(true)
 expect(validate({...previous,decision:{target:{label:'A local report',version:'v1'},amount:{value:'12.50',currency:'USD'},recipient:null,validForSeconds:0}})).toBe(false)
})
