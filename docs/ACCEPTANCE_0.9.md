# 0.9.0 first-run acceptance

The previous default exposed internal configuration groups before a newcomer knew what to do. Version 0.9.0 makes the first-run path the default and retains the complete editor behind Advanced settings. The frontend chat implemented the guide; the owning chat implemented the deployment path and independently walked through a real Codex request.

| Area | Evidence |
|---|---|
| First-run UI | Four steps; Codex or API service; optional office connection later; suggested dedicated folder; real checks and save |
| Browser connection | Private connection file selected through the file picker; no copied token, URL token or browser credential storage |
| Real first value | Chinese guide → Codex installation/login check → configuration reload → natural-language request → visible real `gpt-6.1-terra` reply |
| Return visit | Restart/reconnect recovered the saved inbox and actual request/reply history |
| API execution | All three protocols checked and completed their first Runtime reply against local HTTP provider fixtures |
| Failures | Rejected credentials, invalid private folder, stale revision, unfinished work, failed restart, interrupted deployment and interrupted restore exercised |
| Lost apply receipt | Repeating an applied plan returns its durable receipt without adding a duplicate connection or revision |
| Backup | Managed connections and credentials included, checksummed and restored; pre-setup restore removes managed credentials; tampering rejected |
| Upgrade | Actual 0.8.0 → 0.9.0 → restore 0.8.0 → re-upgrade, with native identity retained and old program refusing schema 5 |
| Automated checks | TypeScript and 312 tests passed on macOS and Linux ARM64; Linux had no skipped cases |
| Narrow UI | Owning chat measured no overflow in both languages at CSS width 354px; frontend chat separately checked its guide and composer at narrow widths |

Reports: [walkthrough](acceptance/onboarding-2026-11-05.json), [real Codex](acceptance/onboarding-live-2026-11-05.json), [Linux cases](acceptance/linux-onboarding-2026-11-05.json), [upgrade/restore](acceptance/upgrade-onboarding-2026-11-05.json).

One macOS parallel run hit the existing Lark CLI fixture's unchanged five-second test timeout. Its focused rerun passed all 16 cases, followed by a complete passing 312-case run. No production connector timeout was changed to hide that result.

## Deployment and rollback boundaries

Schema 5 protects the new persisted managed connections from old programs that do not load those files. Restore a matching pre-upgrade backup and use the original startup configuration before returning to 0.8.0. The restore path preserves current state in a private backup first; managed files and database replacement share a recovery marker. This tests process interruption, not every power-loss or storage failure.

Managed API credentials are now part of the private configuration backup. Externally supplied environment credentials remain outside that managed set. File contents, attachments, messages and Git actions are not undone by configuration recovery.

The current display instance is an independent local host with read-only file access, the existing Codex login and no office integrations. Existing production hosts were not upgraded. Commercial API model services and new real Feishu/WeCom round trips remain unverified. This is a concrete first-run walkthrough, not an independent novice-user study or a claim that every usability problem is solved.
