import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {release} from 'node:os'
import {probeSandbox} from '../src/sandbox.ts'
if(process.platform!=='linux'||process.getuid?.()===0)throw Error('Linux acceptance requires a non-root Linux user')
const probe=await probeSandbox('bubblewrap','/missing/codex')
const typecheck=spawnSync('npm',['run','typecheck'],{encoding:'utf8'});process.stderr.write(typecheck.stdout+typecheck.stderr)
const test=spawnSync('./node_modules/.bin/vitest',['run','--reporter=json','--outputFile=/tmp/agenthub-vitest.json'],{encoding:'utf8',maxBuffer:8_000_000});process.stderr.write(test.stdout+test.stderr)
const raw=JSON.parse(readFileSync('/tmp/agenthub-vitest.json','utf8'))
for(const file of raw.testResults)for(const a of file.assertionResults)if(a.status==='failed')process.stderr.write(a.fullName+'\n'+a.failureMessages.join('\n')+'\n')
const assertions=raw.testResults.flatMap((file:any)=>file.assertionResults.map((a:any)=>({file:file.name.replace(/^.*\/tests\//,'tests/'),name:a.fullName,status:a.status})))
const mandatory=assertions.filter((a:any)=>['tests/sandbox.spec.ts','tests/work.spec.ts'].includes(a.file)||a.file==='tests/backend-api.spec.ts'&&a.name.includes('real managed shell'))
const passed=typecheck.status===0&&test.status===0&&raw.numFailedTests===0&&raw.numPendingTests===0&&mandatory.length>=22&&mandatory.every((a:any)=>a.status==='passed')
const report={at:new Date().toISOString(),version:JSON.parse(readFileSync('package.json','utf8')).version,platform:process.platform,architecture:process.arch,kernel:release(),node:process.version,uid:process.getuid!(),bubblewrap:spawnSync('bwrap',['--version'],{encoding:'utf8'}).stdout.trim(),probe,typecheckPassed:typecheck.status===0,tests:raw.numTotalTests,passedTests:raw.numPassedTests,failedTests:raw.numFailedTests,pendingTests:raw.numPendingTests,mandatorySandboxCases:mandatory.length,passed,assertions}
console.log('AGENTHUB_LINUX_REPORT '+JSON.stringify(report));process.exitCode=passed?0:1
