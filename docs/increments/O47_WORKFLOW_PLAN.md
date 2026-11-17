# O47: read-only workflow-status plans

This increment supports one concrete operation: changing one configured workflow issue's state through `superagent_workflow`. It is not a generic MCP/browser/send preview and does not infer targets or costs for unsupported operations.

1. `list` returns the currently authorized configured target keys.
2. `plan` accepts `sourceId`, `target`, and `stateId`. It uses the same active-root-task, entry, source, manifest, and ingress checks as `inspect`/`propose`, including revalidation after the provider read. It reads the adapter's workflow state but creates no proposal, approval, outbox message, or remote mutation. The regular WorkerTools audit records the invocation; the plan path skips live-input delivery/prompt refresh and refuses unreconciled memory state rather than repairing it. Thus the request itself is database read-only, not a claim that the surrounding tool audit writes nothing.
3. The result contains `readOnly: true`, `authorizesExecution: false`, `affectedCount: 1`, the concrete state view and next choice, and `actionDigest`. The count means one issue state change, not an estimate of downstream automations or notifications.
4. Pass this value as `planDigest` in `propose`, with the existing idempotent `requestId`. The host reads again and rejects changed target/binding, account, issue, revision, displayed state/name or choice set before writing a proposal. Re-plan and inspect the new scope; do not automatically treat a mismatch as approval.
5. A proposal still requires the existing separate operator/conversation decision. Approval rechecks current authority and the planned fingerprint before calling the existing version-checked adapter. A digest is only a consistency check, not a signature, capability, permission or approval token.

The digest includes a versioned operation kind, task ID, target binding/owner revisions, complete read model and selected state. State-list order alone is canonicalized. Existing callers that do not supply `planDigest` retain the previous proposal/approval behavior; this optional protocol does not claim that legacy callers have previewed anything. A reused request ID cannot be rebound to another supplied plan.

Unknown targets and adapters without the required state-read/write contract remain unavailable; unsupported action kinds fail input validation rather than receiving a fabricated impact plan. No automatic backend, identity or account substitution is added. The adapter read is assumed to honor its existing read-only contract; this host change cannot prove arbitrary plugin implementations have no side effects.

## Validation boundaries

Local tests exercise a real Runtime/active assignment with a local deterministic adapter, local database snapshots, no model calls, no real external writes, target/version drift, revoked authority, concurrent read invalidation, approval and readback, forged digests, and legacy behavior. This is not evidence of real IM/provider delivery or browser interaction. No UI is changed, so visual/narrow-screen/keyboard/reduced-motion checks are not claimed. Generic provider preview support, provider-side downstream effects and public deployment remain outside this increment.
