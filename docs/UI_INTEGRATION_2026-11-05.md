# New operator frontend: integration acceptance

Date: 2026-11-05. Scope: integrate the frontend expert's supplied operator preview into the existing AgentHub host, preserving ordinary-user entry, general-purpose model/client adapters and deployed source configuration.

The real workspace contains actual host work and connection records. The independent preview's illustrative people, tasks, availability and counts are not live data. A role selector is not an authorization boundary; both new read APIs require operator credentials/session. Shared usage invitations cannot access them.

## Checks

- TypeScript and 337 tests pass on macOS, including four new projection/API checks: bounded output and source identity; actual MCP reply retrieval; clarification/uncertain delivery; exact GitHub source links and pending approvals; authentication, pagination validation and missing-task responses. Existing 113 upstream core tests remain included.
- Linux ARM64 in the isolated Docker/Bubblewrap environment passes 337 tests with no failures/skips. This is not bare metal, AMD64 or a production systemd deployment. [Machine-readable Linux report](acceptance/linux-operator-ui-2026-11-05.json).
- Browser checks cover desktop and narrow views, English/Chinese, search/empty results and retained filters, task drawer/context, keyboard/mobile dismissal, model-address validation and retained draft, preview model check/save, real client/source status, existing verification details and the advanced-settings entry. The final operational-console navigation, last screenshot capture and viewport reset were interrupted by repeated browser automation timeouts; these remain unconfirmed. The application service and read APIs continued responding normally. Fixture model saving is explicitly isolated and does not claim a commercial API call.
- The real Codex native-chat retest is recorded in the machine-readable [integration report](acceptance/operator-ui-2026-11-05.json). A configuration-page click only starts observation; the task must be sent from the original client and its actual result retrieved there.

## Preservation and limits

A consistent private SQLite/configuration/managed-credentials backup was verified before refreshing the idle setup host. No schema migration is introduced. Existing office sources, model selection, client profiles and original native session identities are retained; the older hosts are not restarted.

The original six entry acceptance records remain inspectable. This UI round does not establish fresh WeCom enterprise access, real commercial model-provider acceptance, new multi-tenant permissions or UI acceptance of uninstalled clients. The platform creation/trust/approval prerequisites still apply. The supplied design has been implemented and inspected; user visual sign-off is not inferred from browser checks.
