# Shared integration contract (recovered from retained tool records)

Source baseline remains cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7. The unavailable previous filesystem was not recovered. Four module agents restore their complete files from original tool-write records; all current tests must run again. Existing remote handoff history is retained.

The coordinator owns server.ts, main.tsx, navigation.tsx, configuration.tsx, control-center.js/connection-studio.js, shared acceptance fixtures/tests, package manifests, README translations and progress. Each module agent owns its service, React module/styles, focused tests and module docs. Do not edit another agent's files.

All services receive a Runtime getter to survive controlled rebuild. Feature APIs stay behind operator authentication and same-origin checks. Mutations use operatorBody to recheck authorization after reading bounded JSON. Secrets/raw provider responses/stderr never become errors or diagnostic UI. Backend protocol probes check revision before and after the bounded operation; cached UI evidence must match revision AND workspace.

Existing WorkerManager, SourceRegistry/onboarding, Execution Backend admission and Runtime/Engine control remain authoritative. Template requirements grant no authority; created Workers are paused with no tools/MCP. New connections start disabled. Standard ACP v1 does not prove all managed/tools/resume/history/contextBudget guarantees and is ineligible for managed Workers. Unknown external effects require reconciliation rather than replay. Trace events project existing audit/records/jobs/outbox, not another state source.

Routes: #worker-templates, #connectors, #execution-trace, using existing navigation, semantic controls, theme variables, focus and reduced-motion. The configuration adapter must not mount over these workspaces. ACP stays in existing backend configuration, not a separate execution path.

Cloud-local deterministic acceptance only: no user Mac, main merge, public deployment, paid service or real external message. Octop baseline bf134dbd379036ce7545c7df1a1da7e381ece9ff is documentation/behavior reference only; no code/prompts/tests/translations copied. Record original design and SDK/license choices. Commit modules early and publish each through the connected GitHub API before final integration to reduce loss risk.
