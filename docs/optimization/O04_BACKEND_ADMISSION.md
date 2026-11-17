# O04: backend capability admission and resource ceilings

Backend selection remains explicit. Existing sessions retain the original backend and identity; failures do not select a cheaper model, another identity or a replacement session. Managed plugins still require all five of managed/tools/resume/history/contextBudget. Missing capabilities are shown separately from authentication. A backend without resume is labelled new-task-only, not a continuation.

An operator can set optional `backends.<id>.limits`:

```json
{"timeoutMs": 60000, "maxSteps": 8, "maxToolCalls": 16, "maxOutputTokens": 2048}
```

These are **per activation** resource ceilings, not dollar budgets, provider billing estimates, task-wide lifetime limits or authorization grants. API adapters enforce step/tool counts in their existing host loop and send the capped output-token request. A token request is not a guarantee of provider billing/behaviour. All backends support a host cancellation deadline. Native and packaged backends reject API-only ceilings rather than pretending to enforce them. Cancellation is not proof that a remote side effect did not happen; existing unknown-effect fences remain authoritative.

Defaults remain overridable preferences when no ceiling exists. With a ceiling, omitted options inherit the lesser of the default resource value and ceiling. Explicit requested/default options above a ceiling are rejected before execution; identity and model are not changed. Worker assignment validates the current limits before creating a task, and the registry repeats checks for each activation, including bound sessions. In-flight requests keep their admitted snapshot; edits govern later activations and do not retroactively cancel them.

The connection library and Worker catalog show missing managed requirements, continuation mode and safe resource limits. No endpoints, credential names or prices are added to the Worker catalog. Unsupported native/plugin limits produce a blocked explanation. Read-only inspection does not authorize execution.

## Verification and limits

The new loopback HTTP tests exercise actual API transport, output-request and step ceilings, changed policy on a bound session, timeout and pre-cancellation; Worker tests verify over-budget assignment creates no task or model call. Existing ACP protocol fixtures cover cancellation, permissions, timeout, public output, history, malformed output and unknown outcomes. These are local deterministic fixtures, not real ACP/provider accounts or paid inference. Browser visual/keyboard acceptance was not performed. Accurate final test counts, baseline environment failures and remote CI belong in the delivery record.
