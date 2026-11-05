# Configuration and independent Workers — 2026-11-05

The previous interface exposed supported software and one shared model editor without clear creation actions. It also displayed a concurrency number while all Workers used one role configuration. This change adds real connection instances, named model services and an independently configured Worker pool.

| Request | Implemented behavior | Evidence |
| --- | --- | --- |
| Create software connections | Existing instances first; New connection adds another named office/repository instance. Feishu can reuse or replace the bot identity. Personal MCP clients retain their actual installed bridge profile. | Browser created a synthetic named WeCom instance through review/apply and displayed awaiting verification. Host tests isolate verification by source. |
| Create model services | Named services coexist; check and create are explicit actions. Adding a service preserves Router/Worker selections and deployed sources. OpenAI exposes Responses and Chat Completions; custom endpoints also support Anthropic Messages. | Browser check/save against loopback HTTP; isolated DOM checks created all three protocol variants. |
| Router and Workers | Software → Router → queue → Worker pool. Router has its own service/model; 1–10 Workers each have their own service/model. | Browser saved ten profiles, reloaded, observed the tenth model, then saved two. Runtime tests actually fill pools of 1, 2 and 10. |
| Understand prompts | Shared, Router, Worker and reply-format editors; empty means built-ins, text supplements system instructions; actual composed instructions can be previewed. | Browser saved Worker additions and inspected the composed preview. |
| Understand the former console | Tasks shows pending decisions, running work and recent results. Details show the real request, result, model, approvals and applicable stop/retry actions. | Real-host task page and recorded source replies inspected. |
| Remove filler | No heading subtitles, repeated attention heading, generic footer or unused host summary column. | DOM assertions and real browser observations. |
| Low-friction refresh | Connection-file/token fallback exchanges for the existing same-origin HttpOnly management session. Permanent tokens are not retained in browser storage. | Browser reloaded after file login and remained authenticated. |

## Runtime behavior

- New tasks rotate over available Worker profiles; this is capacity dispatch, not semantic model specialization.
- Managed background jobs retain their slot. Excess new requests queue. One additional prototype lane is reserved for a human follow-up to an existing conversation; it is not an eleventh configured Worker.
- Reducing the pool does not cancel current work. Subsequent dispatch respects the new capacity.
- An existing conversation keeps its original backend and model even after its profile is reassigned. Managed subagents inherit the parent backend/model unless the subagent role explicitly overrides them.
- Legacy configuration derives profiles from the previous concurrency and Worker role/model. Settings still use revision checks; drafts survive unrelated model-service additions without silently overwriting conflicting execution changes.
- New office instances start with explicit sender admission. Saving credentials or a source does not mark the platform as verified.

## Acceptance boundaries

- TypeScript and **346 tests** passed on macOS. This includes all 113 upstream core tests; the 15 vendored core source files are unchanged.
- Linux ARM64 Docker/Bubblewrap completed **346 tests, zero failures/skips**, as UID 1000. This is a Linux VM/container result, not bare metal, AMD64 or production systemd acceptance. [Linux report](acceptance/linux-control-center-2026-11-05.json).
- A real Codex desktop chat used the installed MCP bridge, executed on `worker-1` with native Codex `gpt-6.1-terra`, retrieved **Connection verified.**, and satisfied received/authorized/executed/replied observations. Nine earlier native session identities were retained. [Native report](acceptance/control-center-native-2026-11-05.json).
- Real browser forms used the actual same-origin settings and managed deployment APIs. Synthetic model/office tests ran on a separate host with a loopback provider and an inert office adapter. They did not contact commercial APIs or enterprise WeCom. [Browser report](acceptance/control-center-browser-2026-11-05.json), [DOM/API report](acceptance/control-center-dom-2026-11-05.json).
- Execution was inspected at a 729px viewport; connection creation/listing was inspected at 1440px. A narrow connection-list overflow was fixed, but its final 729px retest and a 390px mobile pass remain **not completed** because browser automation repeatedly timed out. Full visual acceptance is therefore partial.
- Previously verified Feishu, Codex, Cursor, VS Code, WorkBuddy and GitHub entries were retained. This turn did not repeat all their external tests. Real WeCom remains pending enterprise bot-creation permissions; live commercial API model credentials remain unavailable.

## Upgrade and rollback

The local host was checked idle with no unreconciled runs or unsent deliveries, backed up through SQLite's backup API, verified and restarted gracefully. Other historical hosts and client profiles were left in place. Private state, credentials and backups remain outside Git.

Database schema remains **5**, but the new optional `execution.workers` field is incompatible with the strict parser in the previous build at `911cff112b4384239f8d0424a0fa539bdfad2dbb`. An isolated rehearsal opened that archived source, upgraded, saved ten Workers, observed old-runtime rejection of the new configuration, restored the verified pre-change backup, reopened the old runtime and upgraded again with the native identity retained. [Rollback report](acceptance/control-center-upgrade-2026-11-05.json).

Rollback requires matching source and the pre-change backup; swapping only the executable is insufficient after saving explicit Worker profiles. Database restore does not undo workspace files, messages, client settings, pushes or merges.
