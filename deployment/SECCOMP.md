# Container sandbox policy

Based on the Moby default seccomp allowlist at 4b8214fc4971e06172938a1f1554ccff6647ee80 (Apache-2.0), SHA-256 6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6.

Source: https://github.com/moby/profiles/blob/4b8214fc4971e06172938a1f1554ccff6647ee80/seccomp/default.json

The only added unconditional syscall permissions are: clone, unshare, setns, mount, umount2, pivot_root, chroot. These support nested user/mount/PID namespaces for Bubblewrap and Chromium. Other upstream denials remain. Compose also removes Docker masked/read-only proc paths with `systempaths=unconfined`, because an inner proc mount otherwise fails. This is an explicit per-container policy change, not the default Docker profile. It grants no host capabilities, Docker socket or privileged mode. Host AppArmor/user-namespace policy can still reject startup; the real sandbox probe must pass.
