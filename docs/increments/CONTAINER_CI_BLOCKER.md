# Container CI blocker and proposed boundary decision

Status: **blocked on explicit security-boundary approval; no AppArmor implementation exists**. This document records evidence and a reviewable decision, not an installed policy or an executable workaround.

## Proven failure and separate checks

At remote source `ca6cbcfe699d3d0ec28116da039e5bebef6b752d`, regular CI run [43876934064](https://github.com/pythc/agent-hub/actions/runs/43876934064) passed all three platform/Node jobs. Container acceptance [43876933980](https://github.com/pythc/agent-hub/actions/runs/43876933980), job `133332311390`, failed during the existing real sandbox probe before the HTTP listener was ready. The fixed no-op bubblewrap diagnostic reported `bwrap: Failed to make / slave: Permission denied`.

The existing Compose service drops all capabilities, enables no-new-privileges, uses a read-only root, and has a nested-sandbox seccomp profile plus systempaths=unconfined. Docker's default AppArmor profile explicitly denies mount. The observed failure is consistent with that denial; the currently available cloud environment has no Docker client/daemon to reproduce the host audit record locally. Do not conflate this with its separately demonstrated unchanged-main network namespace failures.

## Concrete proposed scope — not yet authorized

The proposal is a separate fixed-name AppArmor profile, selected only through an explicit Compose opt-in. The default deployment and host docker-default profile would remain unchanged. An ephemeral GitHub Linux runner would load the named profile for acceptance; a real Linux host would require its administrator to review and load it deliberately. An existing same-name profile must not be silently replaced while other deployments use it.

Bubblewrap needs root propagation changes, temporary filesystem/proc/devpts mounts, bind/remount and pivot_root operations. A broad permission to mount, unmount and pivot_root applies to **every process under the container profile**, not merely bubblewrap or a nested user namespace. Even with the other kernel boundaries retained, this expands the container's LSM attack surface. No claim is made that a container-wide allow can distinguish only nested namespace operations. Prefer a narrower experimentally supported mount allow-list if host audit evidence proves it sufficient; do not guess flag matching semantics.

Retained controls must include zero effective and bounding capabilities, no-new-privileges, seccomp enforcement, read-only container root, the existing Moby proc/sys denies and network/signal/ptrace controls, and the existing application admission, private-state and cancellation boundaries. Do not use privileged or AppArmor-unconfined, remove no-new-privileges, or skip real sandbox acceptance.

## Review and acceptance required after an approved implementation

An independent reviewer must inspect the actual profile and merged Compose settings, especially scope of mount permissions and proc/sys denies. On the actual container CI runner verify the enforcing profile label, zero CapEff/CapBnd, NoNewPrivs=1 and Seccomp=2. A process in the outer container must fail to mount a fresh filesystem and fail protected proc/sys access and root filesystem writes. The existing real worker sandbox/private-state canary, Chromium startup, health, restart and end-to-end container acceptance must still pass. A green process exit alone is insufficient.

Cloud-local actual page acceptance must then rerun at the integrated source head, including feature interactions, narrow/dark views, keyboard and reduced motion. Real IM or credentialed/paid ACP tests remain separately unauthorized; no local synthetic result replaces them. Rollback means disable the opt-in and stop affected containers; removal/replacement of a host profile requires checking its consumers first.

## Automatic approval rejection

The policy creation command was rejected before execution with: “This adds a persistent AppArmor profile granting broad mount, unmount, and pivot_root permissions to all processes in the container profile; despite opt-in and retained controls, the user did not explicitly authorize this exact security-boundary change and its blast radius.”

The denied targets were the proposed `deployment/apparmor-bubblewrap`, Compose opt-in and associated CI loader. They do not exist in this change. The action has not been retried or routed through another agent/tool. General authorization to implement the optimization plan was reviewed and does not provide the exact boundary approval required by that rejection.

## Primary references and independent design review

- [Docker AppArmor documentation](https://docs.docker.com/engine/security/apparmor/).
- [Moby template pinned to f862455628f78f84c937e967e4a03902fb1dee11](https://github.com/moby/profiles/blob/f862455628f78f84c937e967e4a03902fb1dee11/apparmor/template.go). Reference only; no new policy is copied here.
- [AppArmor mount rule semantics](https://manpages.ubuntu.com/manpages/noble/man5/apparmor.d.5.html#mount-rules).
- [Bubblewrap v0.8.0](https://github.com/containers/bubblewrap/tree/v0.8.0), inspected mount/pivot sequence.

An independent ACP work-line reviewer confirmed the container-wide scope risk, recommended explicit opt-in and no silent host replacement, retained NNP/seccomp/proc/sys rules, and required actual positive and negative container tests. They reviewed a design only; concrete code review remains pending because the policy was not created.
