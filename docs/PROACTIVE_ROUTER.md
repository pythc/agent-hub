# Proactive Router behavior

Roppo's host Router assesses unmentioned messages inside the same persistent conversation that coordinates Workers. This follows the public [DeepSeek SuperAgent prototype](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4), particularly its admission prompt, candidate cards, read-on-demand assessment and task-owned follow-ups. It does not claim parity with DeepSeek's unpublished internal service.

## From discussion to work

1. The source adapter receives a message. Source permissions, observed/listened scope and admission policy determine whether it can enter the Router. A bot may require platform permission to receive messages that do not mention it; Roppo cannot infer messages the platform never delivers.
2. Up to 20 pending messages from the same discussion, source actor, human/bot class and policy snapshot form one durable candidate batch. Identity separation preserves per-account subscription authorization. Other participants remain visible as discussion evidence.
3. The persistent Router sees short cards. Clearly irrelevant conversation goes straight to `orchestrator_route` and stays silent. Otherwise `orchestrator_eval` provides a bounded window, and `orchestrator_eval_read` reads full messages, source pages, repository evidence or actual images as needed. There is no temporary assessor Session in host mode.
4. `orchestrator_eval_decide` records every enabled rule's result and a structured intent judgment. Acceptance requires implementation intent, a specified target or existing standard, no outstanding design decision, and explicit intent evidence. A matching keyword or rule alone cannot start work.
5. Only an accepted `auto` decision enables Worker management and public replies. The Router delegates within the admitted scope, receives Worker evidence and remains the sole public speaker.

The latest message need not contain the entire request. One person can identify a bug, another propose a settled correction, and another confirm it. Conversely, preferences, hypothetical changes and unresolved design discussions stay quiet: the proactive Router does not automatically ask whether it should take over.

| Mode | Unmentioned candidates | New proactive Worker work | Proactive reply / ACK |
| --- | --- | --- | --- |
| `off` | Not assessed | No | No |
| `observe` | Assessed and recorded | No | No |
| `auto` | Assessed | Only after a valid decision | Only after acceptance |

Explicit authorized requests remain independent of proactive rules. Modes do not revoke explicit tasks or their in-scope follow-ups. A saved Router session by itself grants no authority over new conversation.

## Existing work and recovery

Unmentioned human follow-ups on a task-owned discussion are relayed once to the existing Worker under its original mandate, using an internal Router channel. The external conversation is never added as a Worker reply channel. Up to 20 follow-ups are grouped into a turn in the same persistent Router, with tools limited to reading those messages and honoring explicit human stop requests. Ordinary follow-ups remain silent; this stop classification does consume model tokens. An out-of-scope follow-up returns to admission once all its currently valid task owners have handed it back. A stopped or revoked owner cannot hold that input indefinitely. A bot cannot reopen completed work, and a person-stopped task stays stopped.

Only the same source actor's tasks receive this automatic relay. This is an intentional Roppo identity boundary, narrower than unrestricted group-thread fan-out. Cross-participant requests can still use surrounding discussion and shared task summaries to avoid duplicate work. A task owned by another participant has `canAttach=false`; seeing its summary grants no permission to inspect or mutate it.

Admission batches and decisions are persisted. New arrivals during an active Router turn wait in the durable inbox and are batched on its next activation; they do not open a concurrent writer or create a separate evaluator. Cancellation of a batch member fences that batch and its owned tasks. A changed policy invalidates pending assessment and queues fresh assessment. Missing evidence or a failed assessment is recorded as unavailable, never disguised as a semantic ignore; a failed required read remains fenced after restart until a successful retry.

## Context and cost

- Candidate previews: primary message up to 4,000 characters; other cards up to 160 each.
- Assessment window: first five recorded discussion messages and up to five on each side of the primary message. Nearest neighbors use up to 1,200 characters, other snippets up to 400. The primary message is not repeated in the window. Up to 50 message references and eight related task summaries are shown.
- Evidence text is paged, with a maximum of 8,000 characters per read. Source reads are cached within the assessment activation and rechecked against current permissions. Repository reads stay inside the configured source directory/repository and exclude host state outside the personal project workspace, hidden/private paths and symlink escapes. GitHub pages stay anchored to the current issue/PR number; Feishu page cursors retain their original trigger anchor.
- Managed API Router conversations shorten tool text exceeding 8,192 characters to a 4,096-character head and 1,024-character tail. Whole older turns move out of the wire request when the projected history exceeds the smaller of 128,000 bytes or half `maxContextBytes`. `backend_recall` retrieves original turns and tool results, including images. Stored history and effect receipts are unchanged; pre-upgrade messages remain readable. If an explicit tool allowlist excludes recall, this projection is disabled rather than dropping unrecoverable context.
- Native Codex conversations retain their native context management. API windowing is an explicit archive-and-recall strategy, not an implementation claim about DeepSeek's internal memory algorithm.

Idle host ticks and empty inboxes do not call a model. Reading cards, deciding, fetching evidence, Worker execution and later Router replies do consume tokens. Batching reduces repeated activations; a persistent session enables history reuse but does not make its context free. Provider cache rules, traffic, history length, screenshots and Worker follow-ups determine the actual bill. No fixed savings percentage is promised.

## Compatibility and validation

The 15 vendored domain-core files remain unchanged at the pinned upstream revision. Host mode replaces the old `router-admit` temporary-session path without changing source settings. Existing queued admission jobs and accepted task records remain readable; admission revisions prevent old jobs from claiming newer reconsiderations. Accepted batches retain an ordinary Router continuation job until coordination finishes, so a crash or older host cannot silently lose the gap between admission and delegation. The legacy `assessment` mode retains its separate evaluator architecture for compatibility, while enforcing the same intent guard for inferred acceptance.

Explicit Router tool allowlists must include the new admission/follow-up tools to use these features; they are not silently widened. Before downgrading, drain or cancel pending `router-followup` jobs: older binaries do not implement that new control-turn type. Back up state first; readable additive records do not imply that old binaries can execute new features.

Regression coverage lives in `tests/router-candidates.spec.ts`, `tests/api-context.spec.ts`, `tests/backend-api.spec.ts` and the existing runtime/chat suites. HTTP fixture tests exercise actual Responses, Chat Completions and Anthropic protocol loops through assessment, Worker delegation and Router result delivery. These checks do not establish a particular live model's judgment quality, a connected group's delivery permissions or production token costs.
