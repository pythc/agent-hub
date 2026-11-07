# Roppo

<!-- impeccable:product-schema 1 -->

## Platform
web

## Current scope

The current product supports one local personal account per deployment. Organization identity and tenant permissions remain future work. The following describes the broader product direction, not a claim of implemented multi-tenant access.

## Users
Individuals and organizations are equally important. Users switch workspaces; each workspace has a Router coordinating its Workers, connections and tasks. The owner configures agents without needing to understand provider request JSON; advanced users can inspect and edit supported parameters.

## Product Purpose
A personal or organizational multi-agent manager. Users communicate with Router; Workers execute delegated work and return results. The workspace makes configuration and actual execution understandable.

## Positioning
The underlying task and continuation semantics derive from DeepSeek SuperAgent. This is an implementation lineage, not a verified claim of superiority or an exclusive differentiator against every other agent product.

## Operating Context
Built-in conversations, connected software and CLI sessions are conversation entry points. The same workspace also manages the deployment. API, official subscription and CLI connections are distinct creation paths. Frontend and backend share one host and one authenticated workspace.

## Capabilities and Constraints
Keep the existing TypeScript host, vanilla JavaScript UI, same-origin session authentication, revisioned saves, task evidence and runtime-driven Calls motion. Extend the current configuration surface with an agent graph and adjacent inspector. Unsupported backend capabilities must be explicitly unavailable, never simulated as saved or active. Personal and organizational workspace switching requires backend-enforced scope; a label change does not create isolation.

## Brand Commitments
Roppo; concise bilingual controls. Use a pure white default theme and a switchable dark theme, preserving the existing shell and configuration composition. Avoid explanatory heading subtitles and decorative dashboard metrics.

## Evidence on Hand
The existing host and tests; docs/ui/PRODUCT.md for legacy entry behavior; docs/CONTROL_CENTER_2026-11-05.md for the previous configuration baseline. New backend fields are integration contracts until verified against a backend implementing them.

## Product Principles
- One user-facing manager, clearly identified execution agents.
- Common settings first, advanced controls in context.
- Configuration, execution and evidence are distinct states.
- Workspace boundaries are enforced by the server.
- Motion explains a selection or a real execution event.
