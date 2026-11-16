# Explicit GitHub-hosted CI AppArmor candidate

This candidate is scoped to the `Container acceptance` workflow's `compose` job in `pythc/agent-hub`, on an ephemeral GitHub-hosted Linux runner. It requires a valid run ID/attempt and `AGENTHUB_CI_APPARMOR=1`. `examples/container-acceptance.py --ci-apparmor` additionally requires the exact run-derived isolated project name. Docker host/context/config/TLS/auth overrides are rejected, and both loader and acceptance require the default context with endpoint exactly unix:///var/run/docker.sock before any candidate Docker operation. Arbitrary endpoint strings are never output. The environment guards prevent accidental use; they are not a replacement for host administrator authority.

The user explicitly agreed on 2026-11-16 to this distinct CI-only named candidate after disclosure that mount/pivot permissions affect every container process. That authorization excludes default-policy replacement, production and the user’s Mac. The earlier wider roppo proposal remains rejected and was never executed.

Production `compose.yaml` and `deployment/compose.sh` are unchanged. The acceptance process selects exactly the absolute base file plus `deployment/ci/compose.apparmor.yaml` in its own `COMPOSE_FILE`; conflicting Compose file/profile/subnet settings and `--keep` are rejected. A normal deployment never selects this overlay automatically.

## Evidence and inference

Stage-one CI evidence: source `7cdc12ba`, run [43883204232](https://github.com/pythc/agent-hub/actions/runs/43883204232), job `133354275484`, reported AppArmor enabled, docker-default enforcing and a fixed no-op root propagation permission denial. Kernel journal/dmesg were unavailable. **The responsible audit record has not been obtained.** This is consistent with the official docker-default mount denial, not audit-confirmed causality.

The candidate must be tested against an unchanged-default-policy no-op in the same ephemeral project/image, followed by the named-policy no-op. A candidate success plus default failure is a controlled compatibility observation, not proof of general security or of unrelated external service behavior. All original real Worker/private-state-canary, Chromium, health, restart and upgrade acceptance remains required. There is no skip or unrestricted fallback.

## Policy derivation and exact added scope

The static named profile retains the Moby default network, capabilities/files, umount, process signal/ptrace and proc/sys denials from [moby/profiles f862455628f78f84c937e967e4a03902fb1dee11](https://github.com/moby/profiles/blob/f862455628f78f84c937e967e4a03902fb1dee11/apparmor/template.go). It uses ABI 3.0 as that template does. Copyright/SPDX attribution is retained; the full Apache-2.0 license is [MOBY-PROFILES-LICENSE](../MOBY-PROFILES-LICENSE). No default host profile is edited.

Independent mount rules are based on the actual operations in [Bubblewrap v0.8.0 bubblewrap.c](https://github.com/containers/bubblewrap/blob/v0.8.0/bubblewrap.c#L2842) and [bind-mount.c](https://github.com/containers/bubblewrap/blob/v0.8.0/bind-mount.c#L355). No Bubblewrap source is copied. Compared with default mount denial, the candidate permits:

- root rslave propagation only at `/`, and rprivate only at `/oldroot/`;
- new tmpfs at `/tmp/` or `/newroot/**`; new proc/devpts only below `/newroot/`;
- exact bind/rbind option sets, with explicit silent variants, only below `/tmp/newroot/` or `/newroot/`;
- remount of existing mounts only below `/newroot/`;
- the two specific Bubblewrap pivots: `/tmp/` with old root `/tmp/oldroot/`, then `/newroot/` with the same old-root path.

There is no unconditional `mount,` or `pivot_root,`. `umount` is retained from the upstream default, not newly presented as a narrowed operation. AppArmor mount rules do not constrain permission to a particular executable or user namespace: these permissions apply to **all processes under the named CI container profile**. Path/type restrictions remain a candidate until the actual runner parser, no-op, Worker and Chromium checks pass. Do not generalize it into a production profile or widen rules to force a green result without review.

## Add-only load and retained boundaries

`apparmor_control.py validate` performs a no-kernel-load syntax check. `load` checks AppArmor enabled and confirms the exact fixed name is absent, then invokes `apparmor_parser --add`; it never uses replace/reload, never writes `/etc/apparmor.d`, and refuses any name collision. The postcondition requires the fixed name in enforce mode. A racing add fails closed. An add or postcondition timeout is reported as loaded unknown, not falsely as an unexecuted operation. The loaded kernel profile lasts only on the ephemeral runner; no production installer or profile cleanup/replacement command is provided.

The acceptance validates both the rendered Compose config and actual Docker inspect configuration. It preserves the existing seccomp profile by content, cap_drop ALL, no cap_add, no-new-privileges and read-only root. Docker handles systempaths client-side, so actual empty MaskedPaths/ReadonlyPaths are verified rather than expecting the removed security-option string. That existing systempaths setting is not newly expanded here.

A fixed root-identity child in the designated CI container then verifies the enforcing label, zero effective and bounding capability sets, NoNewPrivs=1, Seccomp=2, denied outer-namespace mount, denied proc/sys write opens and an EROFS root-filesystem write attempt. It never writes a sysctl value, reads credentials or emits proc contents. The root test process does not change the service's configured non-root user or grant capabilities. Fixed booleans/classifications are the only published evidence.

Rollback, if a container is retained during a failed experiment, requires stopping and recreating it under the original default settings while preserving its volume and checking the actual enforcing label. Restarting an existing container does not change its security options. The automated CI path rejects --keep and removes its project containers/volumes; the whole ephemeral runner is then discarded. Never unload or overwrite a profile used by another consumer.

## Verification scope

Run `python3 tests/ci-apparmor.py`, `python3 tests/ci-host-diagnostics.py` and `python3 tests/container-acceptance-diagnostics.py`. These are synthetic contract/privacy tests, not actual profile enforcement. Local syntax may be checked with an extracted parser plus --skip-kernel-load; no policy is loaded on the cloud development host. Actual loader/enforcement/positive-negative/container acceptance is exclusively the explicitly selected GitHub-hosted CI job. This change does not authorize or claim real IM, external Agent or paid inference tests.

Local parser validation: official Debian apparmor 4.1.0-1 amd64 package SHA-256 `a08bf026cde3895f76d27cb5f9ba3d31d0ecf8b5b00cab9b70edaa7473d4b0a1` was extracted under `.local` without installation/service activation; `apparmor_parser --skip-kernel-load --skip-read-cache --base <extracted>/etc/apparmor.d deployment/ci/agenthub-bubblewrap-ci` exited zero. This is syntax evidence only; Ubuntu runner enforcement and all container checks remain pending.
