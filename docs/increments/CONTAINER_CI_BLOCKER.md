# Container CI blocker and proposed boundary decision

Status: **candidate 2 passed actual sandbox setup and reached backup; the current blocker is an older runner Compose CLI rejecting `start --wait`**. The earlier wider roppo profile remains rejected and unimplemented. The new candidate has not been loaded on the development cloud host, production or the user’s Mac; no passing container result is claimed.

## Proven failure and separate checks

At remote source `ca6cbcfe699d3d0ec28116da039e5bebef6b752d`, regular CI run [43876934064](https://github.com/pythc/agent-hub/actions/runs/43876934064) passed all three platform/Node jobs. Container acceptance [43876933980](https://github.com/pythc/agent-hub/actions/runs/43876933980), job `133332311390`, failed during the existing real sandbox probe before the HTTP listener was ready. The fixed no-op bubblewrap diagnostic reported `bwrap: Failed to make / slave: Permission denied`.

The existing Compose service drops all capabilities, enables no-new-privileges, uses a read-only root, and has a nested-sandbox seccomp profile plus systempaths=unconfined. Docker's default AppArmor profile explicitly denies mount. The observed failure is consistent with that denial; the currently available cloud environment has no Docker client/daemon to reproduce the host audit record locally. Do not conflate this with its separately demonstrated unchanged-main network namespace failures.

## Earlier proposal and retained boundary requirements

The proposal is a separate fixed-name AppArmor profile, selected only through an explicit Compose opt-in. The default deployment and host docker-default profile would remain unchanged. An ephemeral GitHub Linux runner would load the named profile for acceptance; a real Linux host would require its administrator to review and load it deliberately. An existing same-name profile must not be silently replaced while other deployments use it.

Bubblewrap needs root propagation changes, temporary filesystem/proc/devpts mounts, bind/remount and pivot_root operations. A broad permission to mount, unmount and pivot_root applies to **every process under the container profile**, not merely bubblewrap or a nested user namespace. Even with the other kernel boundaries retained, this expands the container's LSM attack surface. No claim is made that a container-wide allow can distinguish only nested namespace operations. Prefer a narrower experimentally supported mount allow-list if host audit evidence proves it sufficient; do not guess flag matching semantics.

Retained controls must include zero effective and bounding capabilities, no-new-privileges, seccomp enforcement, read-only container root, the existing Moby proc/sys denies and network/signal/ptrace controls, and the existing application admission, private-state and cancellation boundaries. Do not use privileged or AppArmor-unconfined, remove no-new-privileges, or skip real sandbox acceptance.

## Review and acceptance required after an approved implementation

An independent reviewer must inspect the actual profile and merged Compose settings, especially scope of mount permissions and proc/sys denies. On the actual container CI runner verify the enforcing profile label, zero CapEff/CapBnd, NoNewPrivs=1 and Seccomp=2. A process in the outer container must fail to mount a fresh filesystem and fail protected proc/sys access and root filesystem writes. The existing real worker sandbox/private-state canary, Chromium startup, health, restart and end-to-end container acceptance must still pass. A green process exit alone is insufficient.

Cloud-local actual page acceptance must then rerun at the integrated source head, including feature interactions, narrow/dark views, keyboard and reduced motion. Real IM or credentialed/paid ACP tests remain separately unauthorized; no local synthetic result replaces them. Rollback requires stopping affected containers and recreating them under the default policy while preserving the application volume, then verifying the actual AppArmor label before accepting service health. Merely changing the opt-in environment variable, restarting, or using the current compose.sh up/start path retains an existing container’s security options and is insufficient. Removal/replacement of a host profile requires checking its consumers first.

## Automatic approval rejection

The policy creation command was rejected before execution with: “This adds a persistent AppArmor profile granting broad mount, unmount, and pivot_root permissions to all processes in the container profile; despite opt-in and retained controls, the user did not explicitly authorize this exact security-boundary change and its blast radius.”

The denied targets were the earlier `deployment/apparmor-bubblewrap`, production Compose opt-in and associated broad loader. They were not created or executed and were not retried through another tool or agent. General optimization authorization did not supply the exact boundary approval required for that wider action. A later explicit user decision authorized only the distinct CI candidate described below.

## Primary references and independent design review

- [Docker AppArmor documentation](https://docs.docker.com/engine/security/apparmor/).
- [Moby template pinned to f862455628f78f84c937e967e4a03902fb1dee11](https://github.com/moby/profiles/blob/f862455628f78f84c937e967e4a03902fb1dee11/apparmor/template.go). Reference only; no new policy is copied here.
- [AppArmor mount rule semantics](https://manpages.ubuntu.com/manpages/noble/man5/apparmor.d.5.html#mount-rules).
- [Bubblewrap v0.8.0](https://github.com/containers/bubblewrap/tree/v0.8.0), inspected mount/pivot sequence.

An independent ACP work-line reviewer confirmed the container-wide scope risk, recommended explicit opt-in and no silent host replacement, retained NNP/seccomp/proc/sys rules, and required actual positive and negative container tests. That earlier review covered design only. The new CI candidate is separately reviewed; actual enforcement and container acceptance remain pending.


## New explicit CI-only authorization and candidate

On 2026-11-16 the user explicitly agreed to first collect read-only diagnostics, then, if appropriate, test a separate explicitly selected `agenthub-bubblewrap-ci` profile only for the designated acceptance container on a GitHub ephemeral Linux runner. The disclosure included the effect on all container processes. This permission excludes modifying docker-default, using privileged/unconfined modes, weakening NNP/seccomp/cap-drop/read-only-root/proc/sys protection, overwriting an existing name, production and Mac changes.

Stage-one run [43883204232](https://github.com/pythc/agent-hub/actions/runs/43883204232), source `7cdc12ba`, job `133354275484`, reported AppArmor enabled and docker-default enforce mode. The fixed no-op retained root_mount_propagation_permission_denied. Kernel journal/dmesg remained unavailable, so **no kernel audit confirmation is claimed**. That limited evidence supports an explicitly controlled default-versus-candidate experiment; it is not conclusive audit attribution.

The candidate is under `deployment/ci/`, with [exact rules and source/license notes](../../deployment/ci/README.md). It limits filesystem types and setup paths/operations rather than granting naked mount/pivot permissions. Add-only load refuses a preexisting name, checks the local Docker default unix endpoint, and never modifies production compose.yaml/compose.sh. The opt-in exists only as acceptance `--ci-apparmor` with fixed Compose files and run-derived project identity. A pure endpoint guard precedes the workflow’s first Docker build; loader and acceptance recheck it.

Prepared validation includes source/parser and synthetic scope/privacy tests plus actual CI assertions for merged/actual retained controls, fixed-profile enforce mode, outer mount/proc/sys/root-write denial and a default-versus-candidate no-op. Original private-state canary, Chromium, health/restart/upgrade acceptance is retained. Local syntax and synthetic tests do not establish real enforcement; the first actual candidate result is recorded below and full container acceptance remains pending. No real IM, external ACP Agent or paid model validation is claimed.


## First actual candidate result and bounded follow-up

Source `59be30d5eacad399b04630f614e363137c133472`, run [43887447139](https://github.com/pythc/agent-hub/actions/runs/43887447139), job `133369335257`, passed the real Ubuntu parser and add-only enforce postcheck. Default-policy no-op failed at root propagation; the named candidate advanced to `root_bind_failed`. Application health, Worker/Chromium and negative retained-boundary acceptance did not run. The root-bind errno was not distinguished by that version's stage-only classifier. Kernel audit remained unavailable; neither causality nor a green container result is claimed.

The next candidate adds only exact root-directory operations: `/tmp/newroot/` recursive self-bind, `/oldroot/` recursive bind to `/newroot/`, and remount of `/newroot/` itself, following Bubblewrap v0.8.0 and official AppArmor directory/glob and bind-flag semantics. It also separates fixed error enums from operation stages. [Source links, exact rule and remaining uncertainty](../../deployment/ci/README.md#first-actual-runner-candidate-and-narrow-root-bind-correction) are recorded in the CI scope documentation. It does not broaden filesystem types or descendant targets, add no-slash variants, change production settings or weaken retained controls. Another actual runner experiment remains required.


## Candidate 2 and separate Compose CLI blocker

Source `5a25804d`, run [43889314957](https://github.com/pythc/agent-hub/actions/runs/43889314957), job `133375870294`, confirmed parser/load, default-policy no-op `root_propagation_failed` / `permission_denied`, and named-policy no-op `passed` / `none`. Kernel audit remained unavailable. The application reached backup, where the runner Compose CLI rejected `start --wait` in both normal and recovery paths. This does not justify any further profile expansion.

Remote source plus the backup traceback establishes by sequential control flow that the preceding strict ten-boolean outer controls, authenticated health, real Worker/private-state canary, Bubblewrap/Chromium doctor and volume-lock assertions passed. There is no uploaded artifact or separate security receipt from that run; do not claim direct retrieval of the ten booleans. The follow-up prints only their fixed-key validated dictionary for direct evidence. Backup/account preservation, crash restart and upgrade/recovery remain incomplete.

The proposed compatibility correction is CI-only selection of official Compose v5.7.1 with fixed asset SHA-256, strict official HTTPS origin/size/deadline checks, exclusive user-plugin installation and actual version/start-help verification before build. [Exact source, digest, scope and validation](../../deployment/ci/README.md#candidate-2-passed-sandbox-setup-compose-compatibility-is-next) are recorded separately. The production helper, profile and all existing health/backup/restart/upgrade assertions remain unchanged. Another actual container CI run remains required.


## Verified CI result — 2026-11-16

The original container startup/maintenance CI blocker is resolved at `ad34ddc0c1ee35e7f43d5c612555b213e42e447f`: [run 43892304831](https://github.com/pythc/agent-hub/actions/runs/43892304831), job `133386478516`, **success**. Named profile SHA-256 `1389c06695aa5169d5344e8dfb80361cff739b9ec6be0ef576cc2b6fa687b938`; exact local Docker endpoint and official Compose 5.7.1 selection were verified. Default no-op failed with permission_denied; candidate passed. Ten explicit true boundary booleans verify enforce label, effective/bounding capabilities zero, NNP, seccomp, root test identity, denied outer mount/proc/sys writes and EROFS root write. Thirteen original container groups, including real Worker canary/Chromium/backup/crash/upgrade/restart, passed. This is a specific source/run result; ordinary CI was queued when checked, and a newly combined O07 head requires its own checks. No broader production policy or missing kernel audit is claimed.
