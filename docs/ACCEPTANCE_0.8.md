# 0.8.0 configuration acceptance

Completed on 2026-11-05 (Asia/Shanghai). The user-designated “前端专家” chat implemented the interface; the owning chat connected it to the host and independently tested the real configuration flows. No production host was upgraded.

| Area | Observed result |
|---|---|
| Route and API | `/configure` serves the page; authenticated `/configuration` exposes current settings, history and editable/restart boundaries |
| Automated checks | TypeScript and 297 tests passed on macOS and Linux ARM64; Linux had no skipped cases |
| Authentication | Incorrect token rejected; reloading the page requires a token again; token storage is limited to page memory |
| Language | English default; switching to Chinese retains the draft and updates labels, page language and dates |
| Save | A browser edit reached the real Runtime and persisted as a new revision |
| Conflict | A second session changed the same field; HTTP 409 retained the local draft, and conflict resolution preserved an independent prompt edit |
| Validation | Invalid numbers/JSON block saving; a server-side email validation failure focuses the error alert |
| Prompts | Preview uses the actual composed prompt and current draft |
| History | Loading revision 0 and saving created revision 4; revisions 0–3 remained available |
| Restart | The preview process restarted and retained revision 4 and its restored settings |
| Responsive UI | Owning chat inspected eight desktop sections and English/Chinese execution forms at 390px without horizontal overflow; the frontend chat separately reported all eight sections in both languages at 390px |
| WeCom status copy | Frontend chat reported 14 browser assertions covering seven connector states in both languages; controlled state data, no real WeCom connection |
| Compatibility | Actual 0.7.0 Runtime reopened settings saved by 0.8.0, retaining revision, native identity and schema 4 |

Evidence: [configuration observations](acceptance/configuration-2026-11-05.json), [Linux per-test results](acceptance/linux-2026-11-05.json), [0.7.0 compatibility](acceptance/configuration-compatibility-2026-11-05.json).

## Integration and limitations

The page uses existing Node HTTP, same-origin APIs, inline HTML/CSS/JavaScript and system fonts. No browser framework, third-party asset host or new dependency was added. The source entry and its four CSS/JavaScript assets must ship together; the host reads them at process startup. The original operations console remains at `/` and is primarily Chinese. The new bilingual surface is the configuration console.

The preview uses its own state directory, inert office connectors and loopback model placeholders. Operational POST requests are rejected; configuration saves use the real settings database. Source connection and backend deployment fields remain read-only because they require a controlled restart. Saved configuration, host health and platform authentication are separate states.

Real model authentication, real office message delivery, production rollout, exhaustive accessibility and measured performance were not tested by this UI change. Earlier external acceptance limits remain in [0.7.0 acceptance](ACCEPTANCE_0.7.md).

Database schema remains 4. The compatibility exercise covers the unchanged configuration format and retained native identity, not undoing external actions or task files. Keep normal configuration and state backups before upgrading a real instance.
