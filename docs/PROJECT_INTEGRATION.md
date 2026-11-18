# Project isolation, shared files, and integrated evidence

Code projects reuse the existing per-ticket Git repositories, immutable bundle exchange, fixed source base, and unique final integration node. The original source repository is not the integration workspace. Ordinary non-project `workspace.mode: source` remains an intentionally shared directory; this feature does not claim to isolate every task.

## Responsibility, not permission

New projects freeze a host-generated ownership snapshot containing the integration node and Worker, policy digest, explicit `sharedFiles`, and default lockfile basenames. Lockfiles are protected case-insensitively at every directory depth in the actual Git tree, without following symbolic-link targets. Other shared schemas must be declared by exact repository-relative file path. Absolute paths, parent traversal, Git control directories, ambiguous components, and directory declarations are rejected. Declared paths must not traverse a symlink, submodule or file ancestor. Case/Unicode-normalization aliases are rejected rather than silently treated as missing. Protected entries must be regular Git files, not symlinks, submodules or directories. An integration owner can repair a non-regular default lockfile into a regular file or delete it; it cannot pass unchanged. No claim is made to discover all schema files automatically.

Only the integration node may contribute changes to these shared files. Upstream Workers should describe required schema/lock changes and leave them to the integration step. This is a delivery gate, not an expanded filesystem permission: independent task workspaces may contain rejected edits, but those commits cannot become accepted dependencies or final deliverables. Existing sandbox, O02 assignment/lease, tool and network limits still apply to the integration Worker.

The host compares Git objects and modes, including deletions and type changes. Divergent parent versions require the integration owner even when Git could merge them automatically. Inherited identical parent objects are not attributed to the current contributor. Replanning cannot silently replace the frozen integration owner or policy; start a new authorized project instead. Old projects without either ownership field remain explicitly legacy; incomplete new snapshots fail closed.

## Optional staged checks

A source's existing `workspace.project.testCommand` remains the comprehensive test command. It does not by itself prove build, startup and business acceptance. To record distinct phases, configure all of `stages`:

```json
{
  "testCommand": "npm test",
  "sharedFiles": ["src/contracts/schema.ts"],
  "stages": {
    "buildCommand": "npm run build",
    "startCheck": {
      "command": "exec node test/readiness-server.js",
      "url": "http://127.0.0.1:8123/ready",
      "timeoutMs": 10000
    },
    "businessCommand": "npm run test:business"
  }
}
```

The startup command must execute a foreground service, not daemonize. The supervised wrapper generates a fresh instance token and supplies it only through `AGENT_HUB_START_CHECK_TOKEN`. The loopback HTTP endpoint must respond with status 200 and exactly that token, with no additional newline. The token is not sent in the URL or request. Existing endpoints, redirects, oversized responses, failed readiness, and unconfirmed shutdown do not pass. The probe runs inside the existing sandbox/network namespace; this does not grant additional network access.

Checks run in a fresh checkout of one integration SHA: build, startup/readiness and shutdown, business, then the original comprehensive test. The startup service is stopped before the business command. A business check that needs a server must manage its own bounded foreground instance. Records bind each phase to the same commit and frozen policy, with command, time, exit status, bounded output and readiness evidence. The host checks HEAD and tracked bytes around the commands. Missing, failed, cancelled or stale phases cannot become complete staged acceptance.

The project review shows explicit responsibility and phase evidence. The task trace exposes only bounded status/counts and commit references, not workspace paths or command output. Neither view starts checks or adds authority. Human review, where configured by the existing project workflow, still applies.

DB schema 20 prevents older releases from bypassing the new project responsibility semantics. Backup restore refuses responsibility/evidence rollback or resurrection. Real sandbox CI and test-only functional launchers are separate evidence: the latter exercise actual Git and HTTP processes but do not establish sandbox isolation. Manual UI interaction, paid providers and real IM delivery are outside this increment's verification claims.
