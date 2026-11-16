"""Explicit CI-only profile add; never replaces, persists or unloads a profile."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PROFILE = 'agenthub-bubblewrap-ci'
ROOT = Path(__file__).resolve().parents[2]
POLICY = Path(__file__).resolve().parent / PROFILE
OVERLAY = Path(__file__).resolve().parent / 'compose.apparmor.yaml'

class CiPolicyError(Exception):
    def __init__(self, code, loaded=False):
        super().__init__(code)
        self.loaded = loaded


def require_ci(environment):
    expected = {'GITHUB_ACTIONS':'true', 'RUNNER_ENVIRONMENT':'github-hosted',
                'RUNNER_OS':'Linux', 'GITHUB_REPOSITORY':'pythc/agent-hub',
                'GITHUB_WORKFLOW':'Container acceptance', 'GITHUB_JOB':'compose',
                'AGENTHUB_CI_APPARMOR':'1'}
    if any(environment.get(key) for key in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION', 'DOCKER_CUSTOM_HEADERS', 'DOCKER_AUTH_CONFIG')):
        raise CiPolicyError('docker_environment_override_forbidden')
    if any(environment.get(key) != value for key, value in expected.items()):
        raise CiPolicyError('outside_authorized_ci_scope')
    if not re.fullmatch(r'[1-9][0-9]{0,19}', environment.get('GITHUB_RUN_ID', '')) or not re.fullmatch(r'[1-9][0-9]{0,8}', environment.get('GITHUB_RUN_ATTEMPT', '')):
        raise CiPolicyError('ci_run_identity_missing')


def compose_environment(environment, project, subnet=None):
    require_ci(environment)
    if subnet or environment.get('ROPPO_SUBNET') or environment.get('COMPOSE_FILE') or environment.get('COMPOSE_PATH_SEPARATOR') not in (None, ':') or environment.get('COMPOSE_PROFILES'):
        raise CiPolicyError('conflicting_compose_configuration')
    expected_project = 'roppo-acceptance-ci-' + environment['GITHUB_RUN_ID'] + '-' + environment['GITHUB_RUN_ATTEMPT']
    if project != expected_project:
        raise CiPolicyError('ci_project_identity_mismatch')
    return {**environment, 'COMPOSE_FILE':str(ROOT / 'compose.yaml') + ':' + str(OVERLAY),
            'COMPOSE_PATH_SEPARATOR':':'}


def command(argv):
    try:
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=15, text=True)
        if result.returncode:
            raise CiPolicyError('ci_profile_command_failed')
        if len(result.stdout) > 1024 * 1024:
            raise CiPolicyError('ci_profile_metadata_oversized')
        return result.stdout
    except (OSError, subprocess.SubprocessError):
        raise CiPolicyError('ci_profile_command_unavailable') from None


def local_docker(environment=None, run=command):
    environment = os.environ if environment is None else environment
    require_ci(environment)
    if run(('docker', 'context', 'show')).strip() != 'default':
        raise CiPolicyError('docker_context_not_default')
    try:
        endpoint = json.loads(run(('docker', 'context', 'inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}')))
    except (ValueError, TypeError):
        raise CiPolicyError('docker_context_metadata_invalid') from None
    if endpoint != 'unix:///var/run/docker.sock':
        raise CiPolicyError('docker_endpoint_not_local_runner')
    return {'localDockerEndpointVerified':True}


def validate(environment=None, run=command):
    environment = os.environ if environment is None else environment
    require_ci(environment)
    if POLICY.is_symlink() or not POLICY.is_file():
        raise CiPolicyError('ci_profile_artifact_invalid')
    run(('sudo', '-n', 'apparmor_parser', '--skip-kernel-load', '--skip-read-cache', str(POLICY)))
    return {'syntaxValid':True, 'kernelLoad':False, 'profile':PROFILE}


def load(environment=None, run=command):
    environment = os.environ if environment is None else environment
    local_docker(environment, run)
    if POLICY.is_symlink() or not POLICY.is_file():
        raise CiPolicyError('ci_profile_artifact_invalid')
    if run(('cat', '/sys/module/apparmor/parameters/enabled')).strip() != 'Y':
        raise CiPolicyError('apparmor_not_enabled')
    profiles = run(('sudo', '-n', 'cat', '/sys/kernel/security/apparmor/profiles'))
    if re.search(r'^' + re.escape(PROFILE) + r'(?:\s|//|$)', profiles, re.MULTILINE):
        raise CiPolicyError('ci_profile_already_exists')
    # --add fails if another process wins the absence-check race. No --replace.
    try:
        run(('sudo', '-n', 'apparmor_parser', '--add', '--skip-read-cache', str(POLICY)))
        profiles = run(('sudo', '-n', 'cat', '/sys/kernel/security/apparmor/profiles'))
        if PROFILE + ' (enforce)' not in profiles.splitlines():
            raise CiPolicyError('ci_profile_enforcement_unconfirmed')
    except CiPolicyError as error:
        # Add may have executed even if its response/postcondition was lost.
        raise CiPolicyError(str(error), loaded='unknown') from None
    return {'schemaVersion':1, 'loaded':True, 'profile':PROFILE,
            'policySha256':hashlib.sha256(POLICY.read_bytes()).hexdigest(),
            'scope':'this_ephemeral_github_runner_only', 'localDockerEndpointVerified':True}


if __name__ == '__main__':
    try:
        if len(sys.argv) > 2 or len(sys.argv) == 2 and sys.argv[1] not in ('load', 'validate', 'verify-docker'):
            raise CiPolicyError('invalid_ci_policy_operation')
        result = local_docker() if len(sys.argv) == 2 and sys.argv[1] == 'verify-docker' else validate() if len(sys.argv) == 2 and sys.argv[1] == 'validate' else load()
        print(json.dumps(result, sort_keys=True))
    except CiPolicyError as error:
        print(json.dumps({'loaded':error.loaded, 'code':str(error)}), file=sys.stderr)
        sys.exit(1)
