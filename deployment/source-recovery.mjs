#!/usr/bin/env node
// Source-only, read-only recovery inventory. Never loads host config or starts Runtime.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,readlinkSync,openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const oid = {test: value => typeof value==='string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)};
const limits=['Digest is integrity, not authenticity.','Remote observation is not retention or restore authorization.','No state, credentials, worktrees or external artifacts are backed up.'];
const excluded = ['private-state','credentials','browser-profiles','uncommitted-files','task-worktrees','external-artifacts'];
function git(cwd,args) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  return execFileSync('git', ['--no-optional-locks','--no-replace-objects','--work-tree='+cwd,'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false','-c','core.ignoreStat=false',...args], {
    cwd, encoding:'utf8', maxBuffer:16*1024*1024, timeout:30000,
    env:{...env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_LAZY_FETCH:'1'}, stdio:['ignore','pipe','pipe']
  });
}
function identity(cwd) {
  const dotgit=lstatSync(resolve(cwd,'.git'));
  if(!dotgit.isDirectory()&&!dotgit.isFile()) throw Error('Expected checkout root');
  let partial='';
  try {partial=git(cwd,['config','--get-regexp','^(extensions\\.partialclone|remote\\..*\\.promisor)$']);} catch(error) {if(error.status!==1) throw error;}
  if(partial) throw Error('Partial clones cannot provide offline source verification');
  const commit=git(cwd,['rev-parse','--verify','HEAD^{commit}']).trim();
  const tree=git(cwd,['rev-parse','--verify','HEAD^{tree}']).trim();
  if(!oid.test(commit)||!oid.test(tree)) throw Error('Invalid Git object identity');
  const lock=git(cwd,['show','HEAD:package-lock.json']);
  const pkg=JSON.parse(git(cwd,['show','HEAD:package.json']));
  if(typeof pkg.engines?.node!=='string'||typeof pkg.name!=='string') throw Error('Missing package identity');
  return {commit,tree,lockSha256:sha256(lock),packageName:pkg.name,node:pkg.engines.node};
}
function validRef(ref) {
  return typeof ref==='string' && /^refs\/heads\/[A-Za-z0-9_./-]+$/.test(ref)
    && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('/') && !ref.endsWith('.') && !ref.endsWith('.lock');
}
function safeUrl(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.hostname) throw Error('Use a credential-free HTTPS origin');
  return url.href;
}
/** Only a tip readback is claimed, never remote retention or a complete installation backup. */
export function captureSourceRecovery(cwd,remoteRef) {
  const source=identity(cwd);
  let localChanges=false;
  try {verifyCheckout(cwd);} catch {localChanges=true;}
  let backup={status:'not_checked'};
  if(remoteRef!==undefined) {
    if(!validRef(remoteRef)) throw Error('Expected a fully qualified branch ref');
    const url=safeUrl(git(cwd,['config','--get','remote.origin.url']).trim());
    let rewrites='';
    try {rewrites=git(cwd,['config','--get-regexp','^url\\..*\\.insteadof$']);} catch(error) {if(error.status!==1) throw error;}
    if(rewrites) throw Error('URL rewrites prevent explicit destination verification');
    // Use the validated literal URL, not an alias whose configuration can change.
    const lines=git(cwd,['-c','protocol.allow=never','-c','protocol.https.allow=always','-c','http.sslVerify=true','-c','http.followRedirects=false','-c',`http.${url}.sslVerify=true`,'-c',`http.${url}.followRedirects=false`,'ls-remote','--exit-code','--refs','--',url,remoteRef]).trim().split('\n');
    const matched=lines.map(line=>line.split('\t')).filter(row=>row[1]===remoteRef);
    if(matched.length!==1||!oid.test(matched[0][0])) throw Error('Remote branch could not be verified');
    backup={status:matched[0][0]===source.commit?'remote_tip_verified':'local_only',url,ref:remoteRef,observedCommit:matched[0][0],observedAt:new Date().toISOString()};
  }
  return {format:1,kind:'source-recovery',source,backup,localChanges,excluded,
    limits,build:{artifact:'dist/chat',status:'rebuild_required',commands:['npm ci','npm run typecheck','npm run build:chat','npm test']}};
}

function exactKeys(value,keys) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join('|')===[...keys].sort().join('|');
}
export function validateManifest(m) {
  const fail=()=>{throw Error('Invalid source recovery inventory');};
  if(!exactKeys(m,['format','kind','source','backup','localChanges','excluded','limits','build'])||m.format!==1||m.kind!=='source-recovery'||typeof m.localChanges!=='boolean') fail();
  if(!exactKeys(m.source,['commit','tree','lockSha256','packageName','node'])||!oid.test(m.source.commit)||!oid.test(m.source.tree)||!/^[0-9a-f]{64}$/.test(m.source.lockSha256)||typeof m.source.packageName!=='string'||m.source.packageName.length>214||typeof m.source.node!=='string'||m.source.node.length>128) fail();
  if(JSON.stringify(m.excluded)!==JSON.stringify(excluded)||JSON.stringify(m.limits)!==JSON.stringify(limits)||JSON.stringify(m.build)!==JSON.stringify({artifact:'dist/chat',status:'rebuild_required',commands:['npm ci','npm run typecheck','npm run build:chat','npm test']})) fail();
  if(m.backup?.status==='not_checked') {if(!exactKeys(m.backup,['status'])) fail();}
  else {
    if(!exactKeys(m.backup,['status','url','ref','observedCommit','observedAt'])||!['local_only','remote_tip_verified'].includes(m.backup.status)||!validRef(m.backup.ref)||!oid.test(m.backup.observedCommit)||typeof m.backup.observedAt!=='string'||!Number.isFinite(Date.parse(m.backup.observedAt))) fail();
    safeUrl(m.backup.url);
    if((m.backup.status==='remote_tip_verified')!==(m.backup.observedCommit===m.source.commit)) fail();
  }
}

/** Check a fresh checkout against a previously trusted inventory, without network or installs. */


function verifyCheckout(cwd) {
  // Never run status/diff: they may execute repository clean/process filters.
  if(git(cwd,['ls-files','-v']).split('\n').some(line=>/^[a-zS] /.test(line))) throw Error('Checkout has hidden index flags');
  if(git(cwd,['ls-files','--others','--exclude-standard','-z']).length) throw Error('Untracked source changes');
  const head=git(cwd,['ls-tree','-rz','--full-tree','HEAD']).split('\0').filter(Boolean).map(item=>{
    const tab=item.indexOf('\t'),[mode,,hash]=item.slice(0,tab).split(' ');
    return `${mode} ${hash} 0\t${item.slice(tab+1)}`;
  }).sort();
  const index=git(cwd,['ls-files','--stage','-z']).split('\0').filter(Boolean).sort();
  if(JSON.stringify(head)!==JSON.stringify(index)) throw Error('Index source mismatch');
  verifyWorkingBytes(cwd);
}

function verifyWorkingBytes(cwd) {
  const algorithm=git(cwd,['rev-parse','--show-object-format']).trim();
  if(!['sha1','sha256'].includes(algorithm)) throw Error('Unsupported Git object format');
  for(const item of git(cwd,['ls-tree','-rz','--full-tree','HEAD']).split('\0').filter(Boolean)) {
    const tab=item.indexOf('\t'),header=item.slice(0,tab).split(' '),parts=item.slice(tab+1).split('/');
    if(tab<0||header[1]!=='blob'||!['100644','100755','120000'].includes(header[0])||parts.some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git')) throw Error('Unsupported source entry');
    let parent=cwd;
    for(const part of parts.slice(0,-1)) {parent=resolve(parent,part);if(!lstatSync(parent).isDirectory()) throw Error('Unsafe source directory');}
    const file=resolve(parent,parts.at(-1)),stat=lstatSync(file),hash=createHash(algorithm);
    if(header[0]==='120000') {
      if(!stat.isSymbolicLink()) throw Error('Source link mismatch');
      const bytes=Buffer.from(readlinkSync(file));hash.update(`blob ${bytes.length}\0`).update(bytes);
    } else {
      if(!stat.isFile()) throw Error('Source file mismatch');
      const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {
        const before=fstatSync(fd);hash.update(`blob ${before.size}\0`);
        const buffer=Buffer.alloc(65536);let count,total=0;
        while((count=readSync(fd,buffer,0,buffer.length,null))>0){total+=count;hash.update(buffer.subarray(0,count));}
        const after=fstatSync(fd);
        if(total!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs) throw Error('Source changed during verification');
        if(process.platform!=='win32'&&((before.mode&0o111)!==0)!==(header[0]==='100755')) throw Error('Source mode mismatch');
      } finally {closeSync(fd);}
    }
    if(hash.digest('hex')!==header[2]) throw Error('Working source digest mismatch');
  }
}

export function verifySourceRecovery(cwd,manifest) {
  validateManifest(manifest);
  const keys=['commit','tree','lockSha256','packageName','node'];
  const source=identity(cwd);
  if(keys.some(key=>typeof manifest.source[key]!=='string'||manifest.source[key]!==source[key])) throw Error('Source identity mismatch');
  verifyCheckout(cwd);
  return {verified:true,...source,scope:'source-only',dependencies:'not_checked',runtime:'not_started'};
}
function readInventory(path) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd);if(!before.isFile()||before.size>32768) throw Error('Invalid inventory file');
    const bytes=Buffer.alloc(32769);let total=0,count;
    while(total<bytes.length&&(count=readSync(fd,bytes,total,bytes.length-total,null))>0) total+=count;
    const after=fstatSync(fd);
    if(total>32768||total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs) throw Error('Inventory changed');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total)));
  } finally {closeSync(fd);}
}
export function main(args) {
  const [command,cwd,...rest]=args;
  if(!cwd||!['capture','verify'].includes(command)||rest.length>1||(command==='verify'&&rest.length!==1)) throw Error('Usage: node deployment/source-recovery.mjs capture CHECKOUT [refs/heads/BRANCH] | verify CHECKOUT INVENTORY');
  const root=realpathSync(cwd);
  const result=command==='capture'?captureSourceRecovery(root,rest[0]):verifySourceRecovery(root,readInventory(rest[0]));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch { process.stderr.write('Source recovery check failed; verify the checkout, inventory and requested remote ref.\n'); process.exitCode=1; }
}
