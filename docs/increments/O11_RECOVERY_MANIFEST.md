# O11 recovery manifest: local read-only index

Execution trace task snapshots now include `recovery` schema 1. This is a
redacted, recomputed index of current state and retained local checkpoints,
not a backup, an executable restore package, or an authorization grant.

- `settingsRevision` and `observation` bind the snapshot to the existing recovery
  command fences. Consumers must refresh and pass the current fences to existing
  commands; possession of this manifest does not authorize a command.
- `session` says whether inspecting the original session is currently offered,
  not whether its remote history has actually been retrieved. It does not change
  the backend, account, thread, or task identity.
- `nextSafeAction` prioritizes reconciliation of unknown effects, including
  retained delivery/PR/review/merge records covered by the four-state projection.
  It never recommends automatic replay, task re-execution, or silent rebuilding.
- `checkpoints` point to the latest retained tool, acceptance, and delivery trace
  records for the ticket. Existing database triggers append those records in the
  authoritative write transaction. Baselines are explicitly distinguished from
  observed transitions. Cursors can be used with the existing trace API; they
  are not proof of external success or completeness. Old assignments are part
  of retained ticket history and are not labeled current-assignment evidence.
- No prompts, commands, raw provider errors, payloads, credentials, filesystem
  paths, raw session identifiers, or raw receipt identifiers are exported.

This slice does not add checkpoints around every external side effect, restore
across machines, infer missing history, reconstruct a model session, or unify
all recovery engines. It adds no writer or external call on GET. Existing
history cleanup and workspace access still govern visibility. Existing recovery
commands remain responsible for current identity, permissions and version checks.

Validation: trace projection/no-write and redaction tests, unknown retained
side effects, pending and sending delivery, and real Runtime restart. Browser
visual/keyboard, real IM/provider effects, and crash injection at every external
boundary have not been performed; this slice is not full O11 acceptance.
