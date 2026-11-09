"""Exercise an isolated Compose project; never adopts a normal deployment."""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--project', default='roppo-acceptance-' + uuid.uuid4().hex[:10])
parser.add_argument('--image', default='roppo:local')
parser.add_argument('--port', type=int, default=14439)
parser.add_argument('--subnet')
parser.add_argument('--incompatible-image', help='Optional synthetic image with a lower maximum DB schema')
parser.add_argument('--keep', action='store_true')
args = parser.parse_args()
assert args.project.startswith(('roppo-acceptance-', 'roppo-container-check-'))
root = Path(__file__).resolve().parents[1]
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
os.umask(0o077)
env = dict(os.environ, COMPOSE_PROJECT_NAME=args.project, ROPPO_IMAGE=args.image, ROPPO_PORT=str(args.port), ROPPO_BUILD='local')
if args.subnet:
    env['ROPPO_SUBNET'] = args.subnet
base = 'http://127.0.0.1:' + str(args.port)
checks = {}
def run(argv, check=True, name=None, input=None, overrides=None):
    result = subprocess.run(argv, cwd=root, env={**env, **(overrides or {})}, text=True, capture_output=True, timeout=240, input=input)
    if name:
        (args.output / (name + '.log')).write_text(re.sub(r'#pair=[A-Za-z0-9_-]+', '#pair=REDACTED', result.stdout + result.stderr))
    if check and (result.returncode or 'unexpected EOF' in result.stderr):
        raise RuntimeError('Command failed: ' + ' '.join(argv[:4]) + '\n' + result.stderr[-1500:])
    return result

def compose(*argv, **kw):
    prefix = ['docker', 'compose']
    if args.subnet:
        prefix += ['-f', 'compose.yaml', '-f', 'deployment/compose.network.yaml']
    return run(prefix + list(argv), **kw)

def node(code, **kw):
    return compose('exec', '-T', 'roppo', 'node', '--input-type=module', '-e', code, **kw).stdout.strip()

def api(route, body=None, authorized=True, origin=None):
    headers = {'Content-Type': 'application/json'}
    if authorized:
        headers['Authorization'] = 'Bearer ' + token
    if origin:
        headers['Origin'] = origin
    request = urllib.request.Request(base + route, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

try:
    run(['./deployment/compose.sh', 'up'], name='up')
    cid = compose('ps', '-q', 'roppo').stdout.strip()
    info = json.loads(run(['docker', 'inspect', cid]).stdout)[0]
    assert info['Config']['User'] == '1000:1000' and info['HostConfig']['ReadonlyRootfs']
    assert not info['HostConfig']['Privileged'] and 'ALL' in info['HostConfig']['CapDrop']
    assert not any(m['Destination'] == '/var/run/docker.sock' for m in info['Mounts'])
    checks['nonRootReadOnlyNoHostSocket'] = True
    token = node("import fs from 'node:fs';process.stdout.write(fs.readFileSync('/data/state/access-token','utf8').trim())")
    assert api('/health', authorized=False)[1]['ok']
    assert api('/status', authorized=False)[0] == 401
    assert api('/operator-link', {}, origin='https://untrusted.invalid')[0] == 403
    assert api('/operator-link', {})[1]['url'].startswith(base + '/configure#pair=')
    checks['mappedPortAndAuthentication'] = True
    username, password = 'container-preview', 'Isolated-container-preview-2026!'
    created = api('/account/setup', {'username': username, 'displayName': 'Container preview', 'password': password, 'remember': True})[0]
    assert created == 201 or api('/account/login', {'username': username, 'password': password, 'remember': True})[0] == 200
    # Exact protocol fixture and file bytes stay within this test container.
    node("import fs from 'node:fs';fs.writeFileSync('/tmp/roppo-provider.mjs',fs.readFileSync(0,'utf8'))", input=(root / 'examples/container-provider-fixture.mjs').read_text())
    node("import fs from 'node:fs';fs.writeFileSync('/data/state/workspace/input.txt',Buffer.from([50,10]));fs.writeFileSync('/data/state/private-canary','PRIVATE_CONTAINER_SENTINEL')")
    compose('exec', '-d', '-T', 'roppo', 'node', '/tmp/roppo-provider.mjs')
    current = api('/settings')[1]['current']
    execution = {**current['config']['execution'], 'backend': 'fixture', 'router': {'mode': 'host', 'backend': 'fixture', 'model': 'container-router'}, 'workers': [{'id': 'one', 'backend': 'fixture', 'model': 'container-worker'}]}
    patch = {'backends': {'fixture': {'kind': 'openai-chat', 'baseUrl': 'http://127.0.0.1:15431/v1', 'model': 'container-worker'}}, 'execution': execution}
    status, saved = api('/settings', {'revision': current['revision'], 'patch': patch})
    assert status == 200, saved
    revision = saved.get('revision', saved.get('current', {}).get('revision'))
    assert revision is not None, saved
    node("import fs from 'node:fs';fs.writeFileSync('/tmp/roppo-fixture-revision'," + repr(str(revision)) + ")")
    case_id = 'container-' + uuid.uuid4().hex[:12]
    submitted_status, submitted = api('/request', {'requestId': case_id, 'discussion': case_id, 'text': 'Read the actual input.txt via the Worker managed shell and verify 2. Case: ' + case_id})
    assert submitted_status == 202, submitted
    trigger_id = submitted['triggerId']
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        state = api('/status')[1]
        delegated_triggers = {e['id'] for e in state['events'] if e.get('meta', {}).get('parentTrigger') == trigger_id}
        current_tickets = [t for t in state['tickets'] if {trigger_id, *delegated_triggers}.intersection([t['origin']['triggerId'], *t['origin'].get('triggerIds', [])])]
        if current_tickets and all(t.get('ended') for t in current_tickets) and not state['active'] and any(d['status'] == 'sent' and d['channel']['thread'] == case_id and 'CONTAINER_API_VERIFIED_2' in d['text'] for d in state['deliveries']):
            break
        time.sleep(.25)
    else:
        (args.output / 'failed-status.json').write_text(json.dumps(state, indent=2))
        raise RuntimeError('API-to-Worker shell workflow did not complete')
    records = json.loads(node("import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/data/state/state.sqlite',{readOnly:true});console.log(JSON.stringify(d.prepare(\"SELECT body FROM records WHERE kind='work'\").all().map(r=>JSON.parse(r.body))));d.close()"))
    current_ticket_ids = {t['id'] for t in current_tickets}
    shells = [r for r in records if r['ticketId'] in current_ticket_ids and r['kind'] == 'shell' and r['state'] == 'completed']
    assert len(shells) == 1 and shells[0].get('exitCode') == 0 and shells[0].get('command', '').startswith('cat input.txt; if test -r'), shells
    shell = shells[0]
    output = node("import fs from 'node:fs';process.stdout.write(JSON.stringify(fs.readFileSync('/data/state/jobs/" + shell['id'] + ".output','utf8')))")
    assert json.loads(output).strip() == '2', output
    checks['privateStateHiddenFromWorkerCommand'] = True
    checks['fixtureApiToRealWorkerSandbox'] = True
    doctor = compose('exec', '-T', 'roppo', 'node', '--import', 'tsx', 'src/container-cli.ts', 'doctor', name='doctor')
    capability = json.loads(doctor.stdout)
    assert capability['sandbox']['verified'] and capability['browser']['verified']
    checks['realBubblewrapAndChromium'] = True
    duplicate = run(['docker', 'run', '--rm', '--network', 'none', '--volumes-from', cid, '--user', '1000:1000', '--entrypoint', 'python3', args.image, '/opt/roppo/deployment/container-entrypoint.py', 'inspect'], check=False, name='duplicate-owner')
    assert duplicate.returncode and 'already owned' in duplicate.stderr
    checks['crossContainerVolumeLock'] = True
    before = node("import fs from 'node:fs';import {createHash} from 'node:crypto';console.log(createHash('sha256').update(fs.readFileSync('/data/state/personal-account.json')).digest('hex'))")
    ticket_ids = sorted(t['id'] for t in state['tickets'])
    run(['./deployment/compose.sh', 'backup'], name='backup')
    assert api('/health', authorized=False)[1]['ok']
    assert sorted(t['id'] for t in api('/status')[1]['tickets']) == ticket_ids
    assert before == node("import fs from 'node:fs';import {createHash} from 'node:crypto';console.log(createHash('sha256').update(fs.readFileSync('/data/state/personal-account.json')).digest('hex'))")
    checks['offlineBackupAndAccountPreservation'] = True
    compose('kill', '-s', 'SIGKILL', 'roppo', name='crash')
    compose('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120', 'roppo', name='recreate')
    assert sorted(t['id'] for t in api('/status')[1]['tickets']) == ticket_ids
    assert before == node("import fs from 'node:fs';import {createHash} from 'node:crypto';console.log(createHash('sha256').update(fs.readFileSync('/data/state/personal-account.json')).digest('hex'))")
    checks['crashRecreationWithoutPidLockCollision'] = True
    run(['./deployment/compose.sh', 'upgrade'], name='upgrade')
    assert not api('/status')[1]['paused']
    checks['idleUpgradeAndPauseRestoration'] = True
    steady_id = compose('ps', '-q', 'roppo').stdout.strip()
    steady_pid = run(['docker', 'inspect', '--format', '{{.State.Pid}}', steady_id]).stdout.strip()
    job_id = 'container-busy-' + uuid.uuid4().hex
    node("import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/data/state/state.sqlite');d.prepare(\"INSERT INTO jobs(id,kind,payload,next_at) VALUES(?,?,?,?)\").run(" + repr(job_id) + ",'container-acceptance','{}',Date.now()+86400000);d.close()")
    try:
        busy = run(['./deployment/compose.sh', 'upgrade'], check=False, name='busy-upgrade')
        assert busy.returncode and 'Unsettled work' in busy.stderr, busy.stderr
        assert api('/health', authorized=False)[1]['ok'] and not api('/status')[1]['paused']
        assert run(['docker', 'inspect', '--format', '{{.State.Pid}}', steady_id]).stdout.strip() == steady_pid
        assert node("import fs from 'node:fs';console.log(fs.existsSync('/data/state/container-maintenance.json'))") == 'false'
    finally:
        node("import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/data/state/state.sqlite');d.prepare('DELETE FROM jobs WHERE id=?').run(" + repr(job_id) + ");d.close()")
    checks['busyUpgradeRejectedBeforeStoppingHost'] = True
    if args.incompatible_image:
        rejected = run(['./deployment/compose.sh', 'upgrade'], overrides={'ROPPO_IMAGE': args.incompatible_image}, check=False, name='incompatible-upgrade')
        assert rejected.returncode and 'newer than this image' in rejected.stderr, rejected.stderr
        assert api('/health', authorized=False)[1]['ok'] and not api('/status')[1]['paused']
        assert run(['docker', 'inspect', '--format', '{{.State.Pid}}', steady_id]).stdout.strip() == steady_pid
        checks['incompatibleImageRejectedBeforeStoppingHost'] = True
    assert api('/action', {'action': 'pause'})[0] == 200
    run(['./deployment/compose.sh', 'upgrade'], name='originally-paused-upgrade')
    assert api('/status')[1]['paused']
    assert api('/action', {'action': 'resume'})[0] == 200
    checks['originalHumanPausePreservedAfterUpgrade'] = True
    interrupted_id = str(uuid.uuid4())
    assert api('/deployment/maintenance', {'action': 'prepare', 'operationId': interrupted_id, 'expectedRevision': api('/settings')[1]['current']['revision']})[0] == 200
    # Reproduce a persisted intermediate receipt, then restart the real host.
    node("import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';const id=" + repr(interrupted_id) + ";const d=new DatabaseSync('/data/state/state.sqlite');d.prepare(\"UPDATE records SET body=json_remove(json_set(body,'$.state','preparing'),'$.pauseSeq') WHERE kind='deployment-maintenance' AND id=?\").run(id);d.close();fs.writeFileSync('/data/state/container-maintenance.json',JSON.stringify({operationId:id}),{mode:0o600})")
    compose('restart', 'roppo', name='interrupted-prepare-restart')
    compose('start', '--wait', '--wait-timeout', '120', 'roppo', name='interrupted-prepare-health')
    run(['./deployment/compose.sh', 'abort'], name='interrupted-prepare-abort')
    assert not api('/status')[1]['paused']
    assert node("import fs from 'node:fs';console.log(fs.existsSync('/data/state/container-maintenance.json'))") == 'false'
    checks['interruptedPrepareReceiptRecoveredAfterRestart'] = True
    (args.output / 'browser.json').write_text(json.dumps({'base': base, 'username': username, 'password': password, 'project': args.project}))
    (args.output / 'result.json').write_text(json.dumps({'passed': True, 'mode': 'fixture-api-real-container', 'commercialModelCalls': 0, 'project': args.project, 'image': args.image, 'checks': checks, 'doctor': capability}, indent=2))
    print(json.dumps({'passed': True, 'checks': list(checks), 'evidence': str(args.output)}))
finally:
    if not args.keep:
        compose('down', '--volumes', check=False, name='cleanup')
