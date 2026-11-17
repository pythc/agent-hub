# Continuous Chat and Worker controls

Built-in Chat accepts new messages while the Router replies or Workers run. The composer only offers Send. Each message is saved immediately; Router turns execute in order in the same conversation. A Worker keeps its task and reports back through the Router when finished. A later conversational reply does not mark older background work complete or hide its active browser.

Queued user messages are excluded from earlier turns and their history checkpoints until processed. Restart recovery keeps message identities and avoids duplicate admission. Task projections follow current task routing, including a task moved to another discussion.

**Agent team → Configuration → Worker limit** controls the pool size. The default is 10, and operators can raise it. Lowering the limit prevents additional creation without removing existing Workers. **Concurrent subagents per task** is a separate setting. Selecting an existing Worker opens its model, effort and other supported options. Personal Chat can also configure shared profiles; external scopes retain their existing permissions. Existing task sessions and memory are preserved.

Real-model validation found that a larger team catalog could exceed the inline tool-result budget and refer the Router to an unavailable reader. Retained Router results now name `router_read`, which pages the complete result without repeating the original action. Receipt access remains restricted to the same authorized conversation and context. Chat uploads continue to use the same reader.

## Validation

- Integrated with the main-branch personality, memory-reset and Agent-deletion changes, retaining zero-Worker configurations, retired identities and shared-Worker controls.
- `npm run check`: TypeScript checks and Chat build passed; 109 test files passed, with 1,620 tests passed and one skipped. Coverage includes queued messages, restart recovery, task routing, shared permissions, configurable pool limits, retained results and three API formats. A final status review also covered an older task awaiting input after a later question is answered; all 13 companion-status tests passed after that fix.
- Microsoft Edge browser acceptance: click and Enter send while the Router is streaming; background Worker survives further messages; completion arrives automatically; draft text survives; no Stop button; limit 12, Worker 11 and existing Worker model/effort changes persist after reload. Desktop and 390-pixel mobile layouts were inspected; no page errors. Navigation-aborted event streams were expected. Composition-key handling used DOM events, not a native OS input-method session.
- Real DeepSeek API acceptance used an isolated Git repository reproducing an emoji-summary bug. The Router changed an existing shared Worker to DeepSeek with minimum effort, created an eleventh Worker, and assigned the fix to one Worker. Messages were accepted during both Router and Worker execution; the Router answered a separate question before the task ended and reported completion afterward. The Worker repaired the bug and all ten regression tests passed. This was an isolated reproduction, not a public-repository contribution or an external messaging-platform test.

## Deployment compatibility

There is no new database migration or history reset. Deploy after active work finishes, using maintenance mode and a state backup; compare settings, chat, memory, task records and pending deliveries before resuming. Earlier releases reject Worker counts or configured limits above 10. After raising those values, reduce them compatibly before rolling back code; do not restore an old database over newer conversation history.
