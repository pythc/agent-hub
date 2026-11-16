"""Synthetic CI policy contract checks. Never loads a host policy or invokes Docker."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'deployment/ci'))
import apparmor_control as control
import acceptance_contract as acceptance

ENV = {'GITHUB_ACTIONS':'true', 'RUNNER_ENVIRONMENT':'github-hosted', 'RUNNER_OS':'Linux',
       'GITHUB_REPOSITORY':'pythc/agent-hub', 'GITHUB_WORKFLOW':'Container acceptance',
       'GITHUB_JOB':'compose', 'AGENTHUB_CI_APPARMOR':'1', 'GITHUB_RUN_ID':'123', 'GITHUB_RUN_ATTEMPT':'1'}
def docker_metadata(argv):
    if argv == ('docker', 'context', 'show'): return 'default\n'
    if argv == ('docker', 'context', 'inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}'): return '"unix:///var/run/docker.sock"'
    return None

OPTIONS = ['no-new-privileges:true', 'seccomp=./deployment/seccomp-bubblewrap.json',
           'systempaths=unconfined', 'apparmor=' + control.PROFILE]

class CiAppArmorTest(unittest.TestCase):
    def test_scope_is_only_explicit_hosted_linux_repo_workflow_and_run(self):
        control.require_ci(ENV)
        for key in ENV:
            with self.subTest(key=key), self.assertRaises(control.CiPolicyError):
                control.require_ci({**ENV, key:'invalid'})
        with self.assertRaises(control.CiPolicyError):
            control.require_ci({**ENV, 'RUNNER_ENVIRONMENT':'self-hosted'})

    def test_fixed_compose_files_and_project_reject_conflicting_overlays(self):
        project = 'roppo-acceptance-ci-123-1'
        env = control.compose_environment(ENV, project)
        self.assertEqual(env['COMPOSE_FILE'], str(ROOT / 'compose.yaml') + ':' + str(ROOT / 'deployment/ci/compose.apparmor.yaml'))
        for patch in ({'ROPPO_SUBNET':'10.0.0.0/24'}, {'COMPOSE_FILE':'other'}, {'COMPOSE_PROFILES':'other'}, {'COMPOSE_PATH_SEPARATOR':';'}):
            with self.assertRaises(control.CiPolicyError):
                control.compose_environment({**ENV, **patch}, project)
        with self.assertRaises(control.CiPolicyError):
            control.compose_environment(ENV, 'another-project')
        with self.assertRaises(control.CiPolicyError):
            control.compose_environment(ENV, project, subnet='10.0.0.0/24')

    def test_add_only_loader_refuses_existing_names_and_never_replaces(self):
        calls = []
        def occupied(argv):
            calls.append(argv)
            if argv[0] == 'docker': return docker_metadata(argv)
            return 'Y' if argv[0] == 'cat' else control.PROFILE + ' (enforce)\n'
        with self.assertRaisesRegex(control.CiPolicyError, 'already_exists'):
            control.load(ENV, run=occupied)
        self.assertFalse(any('apparmor_parser' in argv for argv in calls))
        modes = iter(('docker-default (enforce)\n', control.PROFILE + ' (enforce)\n'))
        def fresh(argv):
            calls.append(argv)
            if argv[0] == 'docker': return docker_metadata(argv)
            if argv[0] == 'cat': return 'Y'
            if 'apparmor_parser' in argv:
                self.assertIn('--add', argv)
                self.assertNotIn('--replace', argv)
                return ''
            return next(modes)
        receipt = control.load(ENV, run=fresh)
        self.assertEqual(receipt['policySha256'], hashlib.sha256(control.POLICY.read_bytes()).hexdigest())
        self.assertTrue(receipt['loaded'])

    def test_absence_race_and_missing_enforcement_fail_closed(self):
        def racing(argv):
            if argv[0] == 'docker': return docker_metadata(argv)
            if argv[0] == 'cat': return 'Y'
            if 'apparmor_parser' in argv: raise control.CiPolicyError('ci_profile_command_failed')
            return ''
        with self.assertRaises(control.CiPolicyError):
            control.load(ENV, run=racing)
        def not_enforcing(argv):
            if argv[0] == 'docker': return docker_metadata(argv)
            if argv[0] == 'cat': return 'Y'
            return ''
        with self.assertRaisesRegex(control.CiPolicyError, 'enforcement_unconfirmed'):
            control.load(ENV, run=not_enforcing)

    def test_merged_and_actual_controls_preserve_all_existing_boundaries(self):
        config = {'services':{'roppo':{'user':'1000:1000', 'read_only':True, 'cap_drop':['ALL'], 'security_opt':OPTIONS}}}
        self.assertTrue(acceptance.merged_config(config))
        for key, value in (('read_only',False), ('cap_add',['SYS_ADMIN']), ('privileged',True)):
            changed = copy.deepcopy(config); changed['services']['roppo'][key] = value
            with self.assertRaises(control.CiPolicyError): acceptance.merged_config(changed)
        expected_seccomp = json.loads((ROOT / 'deployment/seccomp-bubblewrap.json').read_text())
        actual = {'AppArmorProfile':control.PROFILE, 'Config':{'User':'1000:1000'}, 'HostConfig':{'ReadonlyRootfs':True, 'Privileged':False, 'CapDrop':['ALL'], 'CapAdd':None, 'MaskedPaths':[], 'ReadonlyPaths':[], 'SecurityOpt':['no-new-privileges', 'apparmor=' + control.PROFILE, 'seccomp=' + json.dumps(expected_seccomp)]}}
        self.assertTrue(acceptance.actual_config(actual))
        changed = copy.deepcopy(actual); changed['HostConfig']['MaskedPaths'] = ['/proc/kcore']
        with self.assertRaises(control.CiPolicyError): acceptance.actual_config(changed)
        for opts in ([o for o in OPTIONS if not o.startswith('seccomp=')], [o for o in OPTIONS if not o.startswith('no-new-privileges')], [o.replace(control.PROFILE,'unconfined') for o in OPTIONS], [o if not o.startswith('seccomp=') else 'seccomp=unconfined' for o in OPTIONS]):
            with self.assertRaises(control.CiPolicyError): acceptance.security_options(opts)

    def test_policy_retains_upstream_denials_and_only_explicit_mount_operations(self):
        policy = control.POLICY.read_text()
        for rule in ('deny @{PROC}/sysrq-trigger rwklx,', 'deny @{PROC}/kcore rwklx,', 'deny /sys/kernel/security/** rwklx,', 'deny /sys/firmware/** rwklx,', 'deny network alg,', 'deny network vsock,'):
            self.assertIn(rule, policy)
        lines = [line.strip() for line in policy.splitlines() if line.strip() and not line.lstrip().startswith('#')]
        self.assertNotIn('mount,', lines)
        self.assertNotIn('pivot_root,', lines)
        self.assertEqual([line for line in lines if line.startswith('pivot_root')], ['pivot_root oldroot=/tmp/oldroot/ /tmp/,', 'pivot_root oldroot=/newroot/ /newroot/,'])
        for line in lines:
            if line.startswith('mount '):
                self.assertIn(' -> /', line)
                self.assertTrue(line.startswith(('mount fstype=tmpfs ', 'mount fstype=proc ', 'mount fstype=devpts ', 'mount options=')))
                self.assertNotIn('options in', line)

    def test_initial_root_bind_is_exact_recursive_self_bind(self):
        rules = [line.strip() for line in control.POLICY.read_text().splitlines()]
        exact = [line for line in rules if line.startswith('mount ') and '/tmp/newroot/ ->' in line]
        self.assertEqual(exact, ['mount options=(rw,rbind) /tmp/newroot/ -> /tmp/newroot/,'])
        self.assertNotIn('mount options=(rw,rbind) -> /tmp/,', rules)
        self.assertIn('mount options=(rw,rbind) /oldroot/ -> /newroot/,', rules)
        self.assertEqual([line for line in rules if line.startswith('remount ')], ['remount /newroot/,', 'remount /newroot/**,'])

    def test_bwrap_errno_is_independent_of_stage_and_never_echoes_secrets(self):
        import subprocess
        for text, expected in (('Permission denied', 'permission_denied'),
                               ('Operation not permitted', 'operation_not_permitted'),
                               ('Invalid argument', 'invalid_argument'),
                               ('No such file or directory', 'not_found'),
                               ('Not found', 'not_found'),
                               ('PRIVATE_UNRECOGNIZED', 'unknown')):
            result = subprocess.CompletedProcess([], 1, 'PRIVATE_STDOUT', 'PRIVATE setting up newroot bind: ' + text)
            self.assertEqual(acceptance.bwrap_classification(result), 'root_bind_failed')
            self.assertEqual(acceptance.bwrap_error(result), expected)
            self.assertNotIn('PRIVATE', acceptance.bwrap_error(result))
        result = subprocess.CompletedProcess([], 1, '', 'Failed to make / slave: Invalid argument')
        self.assertEqual(acceptance.bwrap_classification(result), 'root_propagation_failed')
        self.assertEqual(acceptance.bwrap_error(result), 'invalid_argument')
        self.assertEqual(acceptance.bwrap_error(subprocess.CompletedProcess([], 0, '', 'PRIVATE Permission denied')), 'none')
        self.assertEqual(acceptance.bwrap_error(subprocess.CompletedProcess([], 1, '', 'Permission denied: PRIVATE')), 'unknown')

    def test_outer_controls_require_every_expected_boolean_true(self):
        required = {'profileEnforcing', 'effectiveCapabilitiesZero', 'boundingCapabilitiesZero',
                    'noNewPrivileges', 'seccompFiltering', 'rootTestIdentity', 'outerMountDenied',
                    'protectedProcWriteDenied', 'protectedSysWriteDenied', 'rootFilesystemWriteDenied'}
        good = dict.fromkeys(required, True)
        self.assertTrue(acceptance.outer_controls(good))
        for bad in ({}, {'profileEnforcing':True}, {**good, 'extra':True}, {**good, 'outerMountDenied':'true'}, {**good, 'outerMountDenied':1}, {**good, 'outerMountDenied':False}):
            with self.assertRaises(control.CiPolicyError): acceptance.outer_controls(bad)
        with self.assertRaises(control.CiPolicyError): acceptance.security_options(OPTIONS + ['label=disable'])

    def test_remote_docker_overrides_and_current_context_are_rejected(self):
        for key in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION', 'DOCKER_CUSTOM_HEADERS', 'DOCKER_AUTH_CONFIG'):
            with self.subTest(key=key), self.assertRaises(control.CiPolicyError):
                control.compose_environment({**ENV, key:'unapproved'}, 'roppo-acceptance-ci-123-1')
        with self.assertRaisesRegex(control.CiPolicyError, 'not_default'):
            control.local_docker(ENV, run=lambda argv:'unapproved')
        with self.assertRaisesRegex(control.CiPolicyError, 'not_local_runner'):
            control.local_docker(ENV, run=lambda argv:'default' if argv[-1]=='show' else '"tcp://unapproved.invalid:2376"')
        self.assertEqual(control.local_docker(ENV, run=docker_metadata), {'localDockerEndpointVerified':True})

    def test_workflow_guards_endpoint_before_its_first_docker_operation(self):
        workflow = (ROOT / '.github/workflows/docker.yml').read_text()
        self.assertLess(workflow.index('apparmor_control.py verify-docker'), workflow.index('run: docker compose build'))

    def test_fixed_classification_cannot_echo_arbitrary_stderr(self):
        import subprocess
        value = subprocess.CompletedProcess([], 1, 'PRIVATE', 'PRIVATE pivot_root PRIVATE')
        self.assertEqual(acceptance.bwrap_classification(value), 'root_pivot_failed')
        self.assertNotIn('PRIVATE', acceptance.bwrap_classification(value))

if __name__ == '__main__':
    unittest.main()
