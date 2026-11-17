# O10: read-only execution blockers

This increment adds a versioned `blocker` to the existing execution-trace task
projection and uses the existing task recovery actions. It is not a new retry
scheduler or a generic provider error protocol.

- Fixed enums describe owner role, resource category, resolution, retry policy,
  and last-effect state. No raw provider message, account name, token, path, or
  unverified account link is copied into the blocker.
- Unknown effects dominate other errors. They require reconciliation and never
  offer replay through trace recovery.
- Explicit exhausted/insufficient quotas differ from rate limits, even when the
  provider also returns 429. Authentication and configuration need repair.
- A rate-limit blocker exposes a timestamp only from an existing future pending
  execute job. Missing metadata is unknown, not an invented Retry-After. The
  existing runtime remains responsible for scheduling and attempt bounds.
- The trace view does not automatically retry. Resume is withheld for scheduled rate limits and unknown effects. Historical
  repair errors require explicit per-request repair confirmation, allowing a
  bounded manual continuation without clearing evidence or pretending to verify
  credentials. Without a recorded future schedule, a rate limit requests manual
  review instead of claiming that an automatic retry will occur. The POST recovery path reconstructs current
  state, checks revision/digest and current authority before any existing action.
- Frontend guidance uses the existing native trace styling. It directs operators
  to the task's existing account, never guesses an account or silently switches.

Scope: task run failures and effect uncertainty represented by execution trace.
Legacy provider strings are classified conservatively by known markers; this is
not full coverage of every provider vocabulary. Goal scheduler behavior and
connector automatic retry behavior are unchanged. The object does not authorize
anything. No new database schema or background job is introduced.

Validation: focused blocker/trace tests, including stale and forged resume
requests, read-only scheduled metadata, unknown effects, and redacted output.
Independent review found and fixed stale-error recovery deadlocks and false
scheduling guidance. Type checks and chat build run locally; exact-head remote CI/container are merge
gates. Browser visual/keyboard, real provider/account reconnection, real IM and
paid calls are not performed. Fixtures do not establish external acceptance.
