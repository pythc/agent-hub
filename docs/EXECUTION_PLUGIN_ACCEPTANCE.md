# Execution plugin review and acceptance — 2026-11-09

The SDK, sandboxed execution transport, Codex reference, deployment lifecycle and recovery guards are implemented. This is a developer package ecosystem, not a public marketplace. Existing `kind: codex` sessions retain their compatibility path.

Sanitized machine-readable results: [execution-plugins-2026-11-09.json](evidence/execution-plugins-2026-11-09.json). Raw histories, account hashes, credentials and test configs remain private and are not included in the repository.

| Check | Outcome | Evidence boundary |
| --- | --- | --- |
| TypeScript and chat build/type checks | Passed | Current implementation. |
| Full automated regression | Passed | 70 files, 1,046 tests; Node 24.15.0 on macOS. |
| Third-party provider with no core edits | Passed | Independently bundled test adapter; actual process/sandbox/IPC, synthetic model output. |
| Host SIGKILL | Passed | Native descendant is stopped; persisted session identity remains available for recovery. |
| Codex model invocation | Passed | Actual packaged Codex CLI, real response to “你好”. |
| Four-stage autonomous task | Passed | Eight plugin-backed model sessions, six independent verification rounds, one automatic repair, four releases after final acceptance; two process restarts. All 14 assertions passed, including stable orchestration source hashes. |
| Upgrade and rollback | Recovered | Original native IDs and both creation package digests preserved. Real model turns recovered the agreed strings after upgrade/rollback. Current DB retained, installation revision advanced to three. |
| Lifecycle history readback | Recovered, not a clean first pass | The final background lifecycle run completed its model turns, then the native history call failed with `process_failed`. Later read-only reconciliation verified both histories, answers, native IDs and package bindings. Root cause is unconfirmed. The earlier failed runs remain private evidence. |
| ZCode | Experimental / blocked | Actual version probe reports 0.17.1 inside the sandbox. Independent inference fails at model selection (`configuration_invalid`). Authentication, actual model/effort and managed execution are not verified. |
| Existing service deployment / Linux native execution | Not run | No production acceptance claim. |

The first exploratory goal run completed the task but failed its source-stability assertion because error codes were edited during execution. It is not used as the formal acceptance result. The formal run used a frozen workflow implementation and passed all assertions. Subsequent error-classification/setup-reporting fixes were checked with focused negative tests and a fresh full regression; they did not change the goal graph, acceptance checks or packaged Codex model implementation. The evidence file records both the live run's source hashes and the final runtime source digest.

## Self-review fixes

- Kept reviewed plugin deployment configuration from being overwritten by old dynamic Settings records at startup. Live model/display defaults still persist.
- Bound sessions to a native ID, package digest, workspace, configuration and authenticated account/workspace identity. Switching accounts or silently replacing sessions is rejected.
- Denied undeclared tools, invalid arguments and host-state writes. Limited environment forwarding to explicit references.
- Corrected nested-workspace/private-data sandbox permissions and Linux mount ordering. macOS TLS/DNS gets specific system service permissions, not arbitrary IPC access.
- Terminated the worker's owned process group when the host dies, and awaited child exit before normal scratch cleanup.
- Preserved uncertain tool receipts across crashes. Mapped uncertain, credential and permission errors into the existing recovery categories so Router replanning cannot bypass a receipt fence by creating another session.
- Required managed capabilities and an authenticated identity in setup checks; a successful CLI version probe is insufficient.
- Updated the Codex reference for the installed app-server's named permission-profile requirement and omitted empty output schemas. Preserved native context/session compatibility exports.
- Kept ZCode capabilities conservative. Its CLI settings are not inferred from Codex effort names, and native model-selection failures are not reported as successful access.

## Remaining limits

The Codex plugin reference currently requires a ChatGPT identity with workspace routing information; other credential kinds remain available through the pre-existing native/API backends. On macOS, automatic native parent-directory AGENTS loading cannot use its nested filesystem sandbox helper; the documented configuration explicitly disables that loader and requires repository guidance in the host context. See [deployment instructions](EXECUTION_PLUGINS.md).

The independent native history failure needs further investigation before claiming high-volume reliability. Linux has construction/contract tests here, not live-provider proof. External CLI distributions are outside the plugin package digest and must be pinned/tested separately. No automatic state migration, package garbage collection, publisher signature verification, hot installation or public registry is claimed.

## Follow-up GitHub lifecycle

The [2026-11-09 external CLI follow-up](EXTERNAL_CLI_ACCEPTANCE_2026-11-09.md)
passed the complete real GitHub task through packaged Codex execution, including
restart continuity and independent repair/verification. Earlier history-call
failures remain retained; this does not establish high-volume reliability or
resolve their unrecorded native cause.
