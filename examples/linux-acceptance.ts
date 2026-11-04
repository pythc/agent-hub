import {spawn,execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,createWriteStream} from 'node:fs'
import {resolve,join} from 'node:path'
const directory=resolve(process.argv[2]??'.local/linux-acceptance-'+Date.now()),image='agent-hub:linux-acceptance'
mkdirSync(directory,{recursive:true,mode:0o700})
async function run(args:string[],name:string){
 const log=createWriteStream(join(directory,name+'.log'),{mode:0o600});let stdout=''
 const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>8_000_000){child.kill('SIGTERM');return}log.write(b)});child.stderr.on('data',b=>log.write(b))
 const status=await new Promise<number>((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1))});await new Promise<void>(r=>log.end(r));return {status,stdout}
}
console.log('Building an isolated Linux acceptance image (no host state or credentials in its context).')
if((await run(['build','--progress','plain','-f','deployment/Dockerfile.linux-acceptance','-t',image,'.'],'build')).status!==0)throw Error('Linux acceptance image build failed; inspect '+join(directory,'build.log'))
const base=['run','--rm','--network','none','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges']
const code="import {probeSandbox} from './src/sandbox.ts';try{await probeSandbox('bubblewrap','/missing');console.log(JSON.stringify({usable:true}))}catch(e){console.log(JSON.stringify({usable:false,reason:String(e)}))}"
const defaultProbe=await run([...base,image,'node','--import','tsx','--input-type=module','-e',code],'default-policy-probe')
// These two overrides apply only to this credential-free, networkless test container.
// They let the inner unprivileged sandbox create user/PID namespaces and mount proc.
const policy=['--security-opt','seccomp=unconfined','--security-opt','systempaths=unconfined']
console.log('Running real Bubblewrap processes and the complete test suite as UID 1000.')
const execution=await run([...base,...policy,image,'node','--import','tsx','examples/linux-container-check.ts'],'acceptance')
const line=execution.stdout.split('\n').find(s=>s.startsWith('AGENTHUB_LINUX_REPORT '));if(!line)throw Error('No Linux report; inspect '+join(directory,'acceptance.log'))
const report={...JSON.parse(line.slice('AGENTHUB_LINUX_REPORT '.length)),environment:'Linux kernel in an isolated Docker container',controllerPlatform:process.platform,imageId:execFileSync('docker',['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).trim(),outerContainer:{user:1000,network:'none',capabilities:'all dropped',noNewPrivileges:true,privileged:false,hostMounts:false,securityOverrides:['seccomp=unconfined','systempaths=unconfined']},defaultContainerPolicy:JSON.parse(defaultProbe.stdout.trim())}
writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({report:join(directory,'report.json'),passed:report.passed,tests:report.tests,failed:report.failedTests,pending:report.pendingTests,uid:report.uid,kernel:report.kernel},null,2));process.exitCode=execution.status===0&&report.passed?0:1
