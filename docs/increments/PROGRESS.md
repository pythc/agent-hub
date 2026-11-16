# Four capability increments — progress

Branch: feat/worker-connector-acp-trace-20261116
Baseline: latest main verified 2026-11-16, cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7.
Cloud checkout: /workspace/scratch/f110c34c6b30/agent-hub-increments.

- Integration: fresh isolated branch; CONTRIBUTING read. No AGENTS.md or .agents/skills in baseline. Dependencies installed; baseline checks running.
- Worker templates: in progress, worker_templates agent; strict versioned JSON recipe package through existing WorkerManager.
- Connectors: in progress, connectors agent; existing source plugin definitions and onboarding, layered diagnostics and IM guidance.
- ACP outbound: in progress, acp_outbound agent; execution plugin, fixed ACP v1 and unchanged managed admission.
- Trace/recovery: in progress, execution_trace agent; persistent audit projection of existing jobs/records/outbox.

Cloud-local deterministic acceptance only. No main merge, public deployment, paid calls or real external messages. Octop docs/behavior only, no copied code/prompts/tests or translation. Initial local progress commits: fcb44a0 and 107b21b. CLI push lacks credentials; connected GitHub API used for branch publication. Full integration updates follow.
