"""Validate the explicit CI policy merge and actual container settings."""
import json
from pathlib import Path
from apparmor_control import CiPolicyError, PROFILE, ROOT


def security_options(options, actual=False):
    if not isinstance(options, list):
        raise CiPolicyError('ci_security_options_missing')
    parsed = {}
    for item in options:
        if not isinstance(item, str):
            raise CiPolicyError('ci_security_options_invalid')
        key, separator, value = item.partition('=')
        if not separator:
            key, separator, value = item.partition(':')
        if key in parsed:
            raise CiPolicyError('ci_duplicate_security_option')
        parsed[key] = value if separator else True
    required = {'apparmor', 'no-new-privileges', 'seccomp'} | (set() if actual else {'systempaths'})
    if set(parsed) != required:
        raise CiPolicyError('ci_unexpected_security_option')
    if parsed.get('apparmor') != PROFILE or parsed.get('no-new-privileges') not in (True, 'true') or (not actual and parsed.get('systempaths') != 'unconfined'):
        raise CiPolicyError('ci_retained_security_options_missing')
    seccomp = parsed.get('seccomp')
    if not isinstance(seccomp, str) or seccomp == 'unconfined':
        raise CiPolicyError('ci_seccomp_missing')
    expected_path = ROOT / 'deployment/seccomp-bubblewrap.json'
    if seccomp.startswith('{'):
        if json.loads(seccomp) != json.loads(expected_path.read_text()):
            raise CiPolicyError('ci_seccomp_changed')
    elif not actual and Path(seccomp).resolve() == expected_path.resolve():
        pass
    else:
        raise CiPolicyError('ci_seccomp_changed')


def merged_config(config):
    service = config.get('services', {}).get('roppo', {})
    if service.get('user') != '1000:1000' or service.get('read_only') is not True or service.get('privileged', False) or set(service.get('cap_drop', [])) != {'ALL'} or service.get('cap_add'):
        raise CiPolicyError('ci_container_boundary_changed')
    security_options(service.get('security_opt'))
    return True


def actual_config(info):
    host = info.get('HostConfig', {})
    if info.get('AppArmorProfile') != PROFILE or info.get('Config', {}).get('User') != '1000:1000' or host.get('ReadonlyRootfs') is not True or host.get('Privileged') or set(host.get('CapDrop', [])) != {'ALL'} or host.get('CapAdd'):
        raise CiPolicyError('ci_actual_container_boundary_changed')
    if host.get('MaskedPaths') != [] or host.get('ReadonlyPaths') != []:
        raise CiPolicyError('ci_actual_system_paths_changed')
    security_options(host.get('SecurityOpt'), actual=True)
    return True


def bwrap_classification(result):
    if result.returncode == 0:
        return 'passed'
    messages = (('Failed to make / slave', 'root_propagation_failed'),
                ('Failed to mount tmpfs', 'temporary_root_mount_failed'),
                ('setting up newroot bind', 'root_bind_failed'),
                ("Can't mount proc", 'proc_mount_failed'),
                ("Can't mount devpts", 'devpts_mount_failed'),
                ("Can't bind mount", 'bind_mount_failed'),
                ("Can't remount", 'remount_failed'),
                ('pivot_root', 'root_pivot_failed'),
                ('Failed to make old root rprivate', 'private_propagation_failed'),
                ('Creating new namespace failed', 'namespace_creation_failed'))
    return next((code for message, code in messages if message in result.stderr), 'unclassified_failure')


def bwrap_error(result):
    """Only a fixed errno-text enum; stage alone never establishes permission denial."""
    if result.returncode == 0:
        return 'none'
    errors = ((': Permission denied', 'permission_denied'),
              (': Operation not permitted', 'operation_not_permitted'),
              (': Invalid argument', 'invalid_argument'),
              (': No such file or directory', 'not_found'),
              (': Not found', 'not_found'))
    return next((code for suffix, code in errors if result.stderr.rstrip().endswith(suffix)), 'unknown')


def outer_controls(value):
    required = {'profileEnforcing', 'effectiveCapabilitiesZero', 'boundingCapabilitiesZero',
                'noNewPrivileges', 'seccompFiltering', 'rootTestIdentity', 'outerMountDenied',
                'protectedProcWriteDenied', 'protectedSysWriteDenied', 'rootFilesystemWriteDenied'}
    if not isinstance(value, dict) or set(value) != required or not all(item is True for item in value.values()):
        raise CiPolicyError('ci_retained_boundary_checks_failed')
    return True
