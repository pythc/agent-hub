# Entry-first setup and daily use

Status: UI implementation complete and frozen for host integration, 2026-11-05. Frontend owns src/ui and docs/ui. Host owns entry-setup APIs, persistence, secrets and external verification. Restart the display instance on 4335 to load the final bundled UI assets; this UI task did not restart it.

## Product and roles

AgentHub is a resident assistant reached from the software a person already uses. The website serves deployment management and work that needs human attention. Preserve the existing restrained green, white, system-font design.

The initial screen offers two explicit actions.

- **Use an existing assistant** shows published entry points, where to find the assistant, and instructions for sending work and receiving the result in the originating software. Ordinary users never need the operator token, model keys or host configuration file.
- **Deploy or manage an assistant** authenticates the operator, identifies the host and existing settings, then opens a daily overview of attention items and entry health. Add an entry from Feishu, WeCom, Codex, Cursor, VS Code, WorkBuddy, GitHub or generic MCP.

Choose one entry to configure at a time; a host can have multiple entries. The default endpoint of setup is a traceable request and reply in that entry. Browser chat is an optional diagnostic under management. Advanced settings remain accessible.

## Layout and flow

1. A compact header with language and role switch. Returning operators see their overview after reconnecting; the role preference contains no credentials.
2. Management overview shows actionable attention first, followed by existing entry status, and an Add entry action. An empty installation goes directly to the catalogue with a clear explanation.
3. Catalogue uses grouped text rows for team chat, coding tools and other integrations, followed by a selected-entry detail view. Every supported platform is discoverable without interpreting protocols.
4. Selected entry shows real preflight checks, missing requirements and the smallest next action. Reuse existing service credentials and AI connections. Ask for a model only if the host says none is usable.
5. Review the affected host, target entry and changes; explicitly apply. Show a distinct saved state. Then show the software-specific instruction/test text and observed receipt stages (request received, assistant finished, reply delivered). Only host evidence of an in-entry round trip can mark verified.
6. WeCom missing creation permission is a blocked prerequisite with an administrator action. It is never counted as connected or verified.
7. Local versus remote deployment is explicit. File paths and client installation commands belong to a named host/device. Remote users receive client-safe instructions; operator credentials are not copied into user-facing snippets.

Each page has a single main action. Technical IDs, protocol settings and diagnostics are disclosed on demand. Native labeled controls and disclosure elements, existing reduced-motion handling, single-column mobile flow.

## Acceptance

- Ordinary user reaches platform usage instructions without operator credentials.
- Operator selects and configures every advertised entry through truthful prerequisites; unsupported/blocked paths remain explicit.
- Existing models/credentials are reused by the host; only missing values are requested.
- Save, readiness and end-to-end verified states remain distinct.
- English and Chinese, narrow viewport, keyboard focus, loading, missing permission, API failure, conflicts and saved-state reload.
- Browser checks through cua_repl. Local isolated fixtures are labeled; host/external integration verification is reported separately.

## Implemented host contract

The host confirmed GET /entry-guide and POST /entry-guide {invite} for ordinary users, GET /entry-setup for operators, and POST /entry-setup/probe, /plan, /apply, /install, /verification, /allow and /share. Client config is read from GET /entry-setup/client-config?entryId=..., and verification progress from GET /entry-setup/verification/:id.

POST /pair {code} exchanges a short-lived one-time fragment for a same-origin HttpOnly operator cookie. GET /session identifies a returning operator. The UI removes pair/invite fragments immediately, uses cookie-aware same-origin calls, and retains manual file/token pairing as a fallback.

Entry records have category office/client/source, source lists and truthful client installation capabilities. The AI backend is reused. Feishu probe supplies selectable visible groups. Creating verification only supplies a phrase; the person sends it in the selected software. Observed received/authorized/executed/replied stages control the verified state. Permission approval is offered only for an actor identified by the host response.

Client installation always identifies the host device. Manual config is a separate option for another device. Invite recipients receive usage information, with no management controls or host paths.

## Integration findings from browser checks

- 2026-11-05: On isolated host 4341, installing Cursor in clientHome succeeds and GET /entry-setup reports configured. POST /entry-setup/share accepts Cursor. POST /entry-guide then returns status not-configured because invitation() derives status only from office/source entries. Please derive the published client status from persisted installation/inspection as well. The UI currently preserves the returned status.
- Backend checks and labels are consumed from the confirmed endpoints. Feishu credentials are passed to probe only when the operator supplies both values; a reused login is checked first.
- Fixed and browser-verified: same-document pair/invite links are consumed by a hashchange handler; fragments are removed immediately.

## Host names and client instances

Client installation and verification use the host-provided client.serverName. The UI displays that name for selecting the correct MCP server when a user has multiple AgentHub deployments. Verification instruction text is supplied by the host and copied exactly, including a configured command prefix. The UI does not synthesize a web request to stand in for client evidence.

- Generic/manual MCP must expose verification after showing manual configuration even when installation cannot be auto-detected. The frontend now does so, retaining pending stages until real client evidence. The host should also recognize verified manual clients in its entry status; inspectClient(generic).installed is always false, so using it as the only configured predicate would keep a proven client in not-configured.

## Sharing update

The primary share artifact is the host-provided bilingual plain-text usage instructions, with a Copy usage instructions button. Operators can post those instructions in the existing team conversation. A local invite URL is secondary, inside Preview the guide on this computer, with its same-machine/tunnel limitation. Ordinary users begin in the existing software; the website is optional for reading a provided guide.


## Final UI validation

The frontend was reviewed against the confirmed API. TypeScript typecheck, browser-script syntax checks, the 19 targeted configuration/onboarding tests, and scoped git diff whitespace checks passed. The Impeccable detector returned no findings for the initial entry implementation and styles; the final model form was checked through source review and browser execution.

Browser checks used cua_repl only, on isolated paused hosts 4341 and 4342. They used temporary clientHome/state directories, never a real user client profile or real platform credentials. The 4342 source-save check used deliberately synthetic WeCom values in configuration-preview mode. These checks prove the UI and host integration below, not external delivery.

- English and Chinese role selection, ordinary-user instructions, operator pairing, fragment removal, same-document links and cookie-session reload.
- Actual temporary Cursor configuration install, saved/pending status, restart/refresh/trust guidance, and exact host-provided connection name.
- Generic manual configuration exposes verification even without automatic installation detection. Beginning verification leaves all four stages pending until host evidence arrives.
- Generate/copy bilingual usage instructions; the same-computer guide URL remains secondary.
- Invalid invitation stays editable with its input preserved, aria-invalid, and focus on the error message.
- Missing WeCom administrator permission, preview/source plan review and apply, Chinese draft preservation across language changes, and distinct saved-versus-verified feedback.
- Advanced execution, sources, policy, background work, delivery, prompts and history remain reachable; returning to the new overview works.
- Desktop 1440px and narrow 390px/320px layouts; no horizontal overflow in the checked English/Chinese states. Temporary viewport overrides were reset after capture.

First deployment now points to `./start.sh setup` from the AgentHub checkout and the terminal's one-time link. Existing deployments are reused. A host-reported missing AI connection automatically opens the AI-service disclosure with an inline form for a saved connection, local Codex sign-in, or an API provider; the flow no longer relies on the advanced settings page to add a connection. Existing usable connections remain reused.

### Evidence and remaining host work

Screenshots in [previews/entry-setup-20261105](previews/entry-setup-20261105/) are isolated UI fixtures, not screenshots of a verified production deployment. They include desktop/mobile role selection, overview and software catalogue.

Two host status findings remain at the time of UI freeze: invitation() derives client availability only from office/source entries, and generic client configured state relies on inspectClient().installed. The UI preserves the backend result instead of manufacturing a success state. See the integration findings above. External native-client trust, permissions and real request/reply verification belong to the host integration owner.

No commits or pushes were made by this UI task. No changes were made to real platform data. Hosts 4319, 4326 and 4335 were not restarted by this task.


## Final inline AI-connection completion

The selected-entry page now supports saved connections, existing local Codex sign-in, OpenAI, Anthropic and custom API services directly. Provider defaults and human-readable saved labels reuse the existing UI catalogue. Only custom services ask for a base URL and protocol. API credentials stay in memory until submitted to the current host and are cleared from the form after save; technical errors redact the entered secret.

The UI uses POST /entry-setup/model/plan {revision,connection}, /model/check {id}, and /model/apply {id}. A successful check is required before live apply; isolated preview may save only after the host explicitly returns preview:true with no required checks. Advanced unsaved edits block applying a model change. Saving rereads the settings revision, invalidates old entry plans, preserves entry drafts, and selects the resulting saved connection. It does not create a browser-chat source.

Final browser evidence: missing Codex opens the form automatically and failed installation/login checks expose no save action; a custom URL with query parameters is rejected; input values survive English/Chinese switching; preview API plan/check/apply succeeds without contacting the synthetic example.invalid endpoint. The existing WeCom source remains present after model save and reload; the saved model has a readable label and is reused by default behind a collapsed disclosure. Final browser consoles were free of errors. The new form has no horizontal overflow at 390px. Typecheck, all browser-script syntax checks and the 19 targeted tests passed after adding this flow.

## Host integration resolution

After the UI freeze, the integration owner fixed both recorded host findings: client invitations query actual client configuration/verification, and successful generic/project-scope MCP verification can establish a configured state. Targeted host tests cover both cases. Real office/client acceptance and the first-run command are recorded in [0.10.0 acceptance](../ACCEPTANCE_0.10.md).

The final integration also localizes generated verification phrases through `instructions.en/zh`, preserving the legacy `instruction` field. The UI selects the corresponding text and sends its language when starting a verification. This is an API/i18n correction, with no layout redesign.
