// Standalone offline entry: no Runtime, config, dotenv, connector or plugin imports.
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs'
import {RECOVERY_PACKAGE_MAX_BYTES} from './recovery-package-contract.ts'
import {verifyRecoveryPackage} from './recovery-package.ts'

export function readRecoveryPackageFile(path:string){
 let fd:number|undefined
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
  const before=fstatSync(fd)
  if(!before.isFile()||before.size>RECOVERY_PACKAGE_MAX_BYTES)throw Error()
  const bytes=Buffer.alloc(RECOVERY_PACKAGE_MAX_BYTES+1);let total=0
  while(total<bytes.length){const n=readSync(fd,bytes,total,bytes.length-total,null);if(!n)break;total+=n}
  const after=fstatSync(fd)
  if(total>RECOVERY_PACKAGE_MAX_BYTES||total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error()
  return verifyRecoveryPackage(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total)))
 }catch{throw Error('Invalid or unreadable recovery diagnostic package')}
 finally{if(fd!==undefined)closeSync(fd)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)throw Error('Usage: verify-recovery-package <file>');console.log(JSON.stringify(readRecoveryPackageFile(process.argv[2]!),null,2))}
 catch{console.error('Invalid or unreadable recovery diagnostic package; use verify-recovery-package <file>');process.exitCode=1}
}
