# Recovery diagnostic handoff package (O11/O12 partial)

From an authorized task's execution-trace details, explicitly select **Export
recovery diagnostic package**. The download is `recovery-diagnostic.json`. It is a
small diagnostic snapshot for offline troubleshooting, **not a backup, restore
file, permission grant, signed attestation, or executable recovery instruction**.
No external service is contacted and exporting does not resume or replay work.

The export POST uses the existing workspace-bound operator endpoint and current
task read authority. It checks the task observation and settings revision again;
refresh the details if either changed. Workspace/task changes, an updated
observation and closing the page invalidate an in-flight download. A failed
request can be explicitly retried. No export runs automatically.

## Included and excluded

The independent strict schema contains application/format version, a fresh random
task alias, coarse execution state, unknown-effect flag, original-session
inspectability, the existing recovery manifest's next safe action, and up to
three unique checkpoint kinds (tool, acceptance, delivery) with transition or
baseline origin. Unknown effects always require reconciliation. Checkpoints mean
retained local observations, not complete history or confirmed remote outcomes.

It excludes task/user/model text, actual task/worker/source IDs, paths, session
references, configuration, credentials, raw tool results/arguments, original
observation hashes, audit sequence numbers, commit IDs and timestamps. Aliases
change on every export. Even these coarse states may be private; downloading does
not automatically share them with another person or service.

## Offline verification

From the application checkout with dependencies already installed:

```
npm run verify-recovery-package -- /path/to/recovery-diagnostic.json
```

The standalone entry `src/recovery-package-cli.ts` does not import or start
Runtime, load application configuration or the environment-file setting, read
host state, install dependencies, or contact services. It reads one regular file
through a single descriptor with a 16 KiB bound, rejects final-component symlinks,
non-regular files, invalid UTF-8, malformed data and concurrent metadata changes.
Parents of the selected path are not claimed to be symlink-free. Errors are fixed
messages and do not echo file contents or paths.

The pure verifier checks the strict schema, conservative consistency rules and a
SHA-256 over canonical payload JSON (recursive sorted object keys, preserved
array order). Successful output lists fixed missing-evidence categories and
manual verification steps. A matching digest proves only internal integrity:
anyone can create a different payload and recompute its digest. It does **not**
prove authenticity, freshness, remote success, or permission to act. Current
host authority and external outcomes must be checked independently. Neither
verification nor export imports the file into host state.

The existing private `backup`, `verify-backup`, and offline `restore` commands
are unchanged and retain their separate full-state/credential semantics. This
feature does not complete cross-environment reconstruction or O12 as a whole.

Local automated tests cover redaction canaries, fresh random aliases, stale or
revoked task authority, HTTP operator/origin gates, selector rejection, malformed
and oversized files, non-regular input, standalone operation with an invalid
AGENTHUB_ENV_FILE, and UI interrupted/repeated flows. Real browser click-through
and real external-platform recovery have not been performed for this increment.
