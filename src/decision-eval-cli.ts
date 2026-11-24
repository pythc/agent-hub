/** Local-only synthetic report. Intentionally independent of the running application. */
import {constants} from 'node:fs'
import {lstat,open} from 'node:fs/promises'
import {compareDecisionShadow} from './decision-eval.ts'

const maxBytes=256*1024
async function readSyntheticFile(path:string){
 // Reject special files before opening them. O_NONBLOCK also prevents a raced
 // replacement with a FIFO from blocking the process during the open.
 if(!(await lstat(path)).isFile())throw Error('decision_eval_input_not_file')
 const handle=await open(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW)
 try{
  if(!(await handle.stat()).isFile())throw Error('decision_eval_input_not_file')
  const bytes=Buffer.alloc(maxBytes+1)
  let count=0
  while(count<bytes.length){
   const part=await handle.read(bytes,count,bytes.length-count,count)
   if(part.bytesRead===0)break
   count+=part.bytesRead
  }
  if(count>maxBytes)throw Error('decision_eval_input_too_large')
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count))
  return JSON.parse(text) as unknown
 }finally{await handle.close()}
}

try{
 if(process.argv.length!==3)throw Error('decision_eval_expected_one_local_json_file')
 const report=compareDecisionShadow(await readSyntheticFile(process.argv[2]!))
 process.stdout.write(JSON.stringify(report,null,2)+'\n')
 if(!report.observationalInvariant)process.exitCode=1
}catch(error){
 // Do not print supplied bytes, parser context, file paths or arbitrary errors.
 const code=error instanceof Error&&/^decision_eval_[a-z_]+$/.test(error.message)?error.message:'decision_eval_read_or_json_error'
 process.stderr.write(code+'\n')
 process.exitCode=2
}
