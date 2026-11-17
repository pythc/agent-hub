# O44: task follow-up permission explanations

The authenticated operator task drawer now includes a read-only explanation of the original task input and current task follow-up permission intersection. It reports fixed, translated reasons and the smallest relevant owner/action to review: connection events, listening scope, sender membership/admission, entry binding, changed input, retained authority, task access, request sharing, requester/manager identity, or the Worker management switch.

The projection reuses RouterIngress's production authority and gate, RouterScopes's current trigger restrictions, task-channel checks and task mutation identity checks, and retained-context validation. Scheduled/delegated producers use their existing authority path rather than being mistaken for new external senders. The trigger restriction extraction preserves the same production errors and conditions.

The result is an observation, never a grant, token, command or cached authorization. No actor, account, hidden resource name, raw configuration or exception text is emitted. Private/unknown audiences and cleaned inputs are omitted. It cannot repair routes, alter settings, submit requests or authorize effects. Actions continue through their existing permission/version checks. A successful observation does not certify future inputs, tools, browser access, files, native approval or effect completion. Those remain separate execution gates. The interface offers a native disclosure, no action buttons, and introduces no animation.

The existing authenticated GET task endpoint transports the projection; no unauthenticated diagnostic or separate authorization API was added. Drawer refresh/navigation uses the existing proof and stale-response fence. Arbitrary explanation fields and foreign task IDs are rejected by the renderer.

## Validation and boundaries

- Local HTTP/SQLite tests cover unauthenticated 401, authenticated reads, cross-origin 403, missing-task 404, member revocation on a subsequent read, and no database or model-call effects.
- Production WorkerManager tests reject a follow-up after revocation and reject forged explanation/grant fields. Separate tests distinguish listening scope, membership, request sharing and management identity. Missing routes are not created by observation.
- Existing Router ingress and scope migration regressions run with the new tests. The read-only renderer is tested without network or action hooks, including strict DTO checks and production asset registration.
- No real provider, external message, paid call or browser visual/keyboard acceptance is claimed. Browser interaction was not run; the native disclosure uses existing styling and introduces no motion.
- Full-suite results are compared with exact development base `39160e72bfc4d4a8554d182eaae7ef665444eed6`; environment failures remain separately disclosed. Remote delivery/CI is a subsequent gate.

Final local checks: 100 focused tests and independent review passed; typechecks and build passed. Full implementation: 2504 passed / 75 failed / 4 skipped / 2 EPIPE; exact baseline: 2488 passed / the same 75 failing tests / 4 skipped / 1 EPIPE. Separate reruns of the affected plugin/webhook files on both trees each produced the same 13 environment failures and 18 passes, with no EPIPE. Original full-run errors are retained; this is not an all-green full-suite claim.
