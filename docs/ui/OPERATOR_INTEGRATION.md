# Operator frontend integration · 2026-11-05

The frontend expert's standalone AgentHub revision is now integrated into `/configure`. The supplied preview remains separate. Its task fixtures, personal name, connection counts and demonstration-only buttons were not copied into live state.

## Implemented

- The supplied navigation rail, work/attention hierarchy, compact searchable software catalogue, source-aware task drawer and responsive navigation are adapted to the existing vanilla DOM application. No framework or new runtime dependency was added. The expert's CSS is scoped to the operator surface so ordinary-user onboarding and advanced configuration retain their behavior.
- The workspace reads authenticated, bounded task projections from `GET /entry-workspace` and task details from `GET /entry-workspace/task/:id`. Counts, pending questions, progress and replies come from the host records. A pending assessment is presented as understanding the request. MCP results are only marked returned after the originating client has retrieved them.
- Entry pages retain real prerequisite checks, deployment plans, private credential persistence, revision checks, rollback, client installation and four-stage original-software verification. Successful entries can now explicitly start a fresh verification.
- The AI services page uses the existing Codex/saved/API connection forms, including OpenAI Responses, Chat Completions and Anthropic Messages. Check and save remain separate. Provider credentials stay in ephemeral form state and private managed host files.
- Task details show the original request, pending question, actual reply and original-source context. GitHub links are limited to the configured repository. Pending host approvals use the existing approval API; secret questions use password inputs. The full operational console reuses the operator cookie and filters the selected task, avoiding another token-copy step. Creating or approving a request is never simulated by a toast.
- English remains the default; Simplified Chinese is retained. Catalogue search/filter state survives in-page navigation. Mobile close, scrim and Escape restore focus; opening navigation makes the main area inert. Background work views refresh read-only every ten seconds while visible, without refreshing credential forms or an open task drawer.

## Verification and limits

The integration uses the existing 4335 setup host with a verified private backup. Historical hosts and existing client profiles are retained. Raw screenshots, messages, operator pairing links and state backups remain private under local output directories. Browser tests using an isolated 4344 host are clearly labeled and make no real provider or office calls.

Validation details are recorded in [the integration acceptance report](../UI_INTEGRATION_2026-11-05.md). Earlier platform acceptance remains in [0.10 acceptance](../ACCEPTANCE_0.10.md); those historical results do not mean every platform was independently retested for this visual change. Enterprise WeCom creation permission and real commercial API calls remain outside this round's completed scope.
