# First plugin release and live acceptance — 2026-11-09

The public catalog and four release archives are available on GitHub. Agent board was installed from that catalog on the existing Roppo host, upgraded, rolled back, upgraded again, and checked after a supervised process restart. This run used the production `PluginGitHub` client and real release assets; it did not replace GitHub responses with fixtures.

## Published packages

| Plugin | Version | Release | GitHub asset ID |
| --- | --- | --- | --- |
| Agent board | 0.1.0 | [Baseline](https://github.com/pythc/agent-hub/releases/tag/plugin-agent-board-v0.1.0) | 726081592 |
| Agent board | 0.1.1 | [Current](https://github.com/pythc/agent-hub/releases/tag/plugin-agent-board-v0.1.1) | 726086124 |
| Slack | 1.0.0 | [Release](https://github.com/pythc/agent-hub/releases/tag/plugin-agenthub-slack-v1.0.0) | 726085488 |
| Linear | 1.0.0 | [Release](https://github.com/pythc/agent-hub/releases/tag/plugin-agenthub-linear-v1.0.0) | 726085854 |

Agent board 0.1.1 adds full date/time-zone tooltips and machine-readable timestamps, so entries from different days with the same displayed time can be distinguished. Invalid timestamps have an explicit fallback. The baseline is a separately built, published 0.1.0 package, not a renamed copy of 0.1.1.

The initial packages were published with the authenticated GitHub CLI. Each asset's uploaded state, size and SHA-256 were verified before the catalog was committed. A separate unauthenticated run of the application's GitHub client resolved the catalog and downloaded all four archives, checking their size and checksum again. The catalog pins package versions, source commits, asset IDs, archive checksums and manifest digests.

## Live install, update and rollback

The existing supervised host ran source commit [`2a27f03`](https://github.com/pythc/agent-hub/commit/2a27f03ba3c2e365aaf4cf0a6b7ef586a3b6f2d6), which includes the marketplace and the concurrent mainline Wiki removal. The other deployment thread had already activated this revision during publication; the acceptance continued on that instance rather than replacing it with an earlier build. All 573 tracked files matched the checkout, the process's physical working directory matched the release, and all served chat JavaScript/CSS assets matched their files on disk.

The real host's authenticated operator API completed these operations:

| Step | Active version | Settings revision | Result |
| --- | --- | --- | --- |
| Fresh install from GitHub | 0.1.0 | 5 | Passed |
| Download and apply update | 0.1.1 | 6 | Passed |
| Restore retained version | 0.1.0 | 7 | Passed |
| Download and apply current version | 0.1.1 | 8 | Passed |
| Restart supervised host | 0.1.1 | 8 | Passed; 0.1.0 retained |

Every operation checked the active manifest/version/digest, the served view bundle, and the live board projection: six existing tasks and four Workers. Superseded bundle digests returned HTTP 404. All four workspace-view operations used the same host process; no connector or model process restart was needed to apply the view changes.

Restart verification compared the installed/retained versions, operation ledger, settings revision, account and credential files, task history, jobs and deliveries. The first shutdown check expected the PID lock file to disappear; `launchctl bootout` left a stale lock after all original processes had exited. After verifying the recorded PID was absent, the normal Runtime startup recovered that lock without manual lock deletion. The final health, bundle, runtime projection and persistence checks passed, and the original unpaused state was restored. This is an observed recovery path, not a claim of an entirely clean shutdown.

## Configuration and data preservation

- The startup configuration, local account and access-token files retained their hashes. Existing settings fields also matched the pre-upgrade backup; new default fields were additive. Plugin operations changed only the managed view configuration and its revision.
- All 94 tracked pre-install records, 72 jobs and 31 delivery records remained unchanged throughout the view lifecycle and restart checks. These include task/run/model-session and other existing conversation/ownership/memory records present in the baseline.
- SQLite integrity checks passed. A private database/config/account backup was taken before installation; the deployment's earlier full state backup remains available locally.
- No database rewind was used for plugin rollback. No external message or model request was generated for this acceptance.
- The separate Wiki removal has its own authorized migration and evidence in [Wiki removal](WIKI_REMOVAL_2026-11-09.md). The preservation assertions here do not claim that retired Wiki content was retained in the live knowledge library.

## Automated verification and limits

[Mainline CI](https://github.com/pythc/agent-hub/actions/runs/42557053468) passed type checks, production build, whitespace checks and **75 test files / 1,100 tests** on Ubuntu with Node 22.19 and Node 24, and macOS with Node 24. The timestamp regression covers cross-day timestamps, both supported languages and invalid input. The integrated Linux check also corrected a test fixture's sandbox driver from `bwrap` to the supported `bubblewrap` configuration value.

The earlier [browser acceptance](PLUGIN-MARKETPLACE-ACCEPTANCE.md) covers themes, navigation, installation controls and rendered plugin behavior using an isolated GitHub transport fixture. This release acceptance adds real public GitHub downloads and the existing host's authenticated API lifecycle. It does not claim a new interactive login to the production account.

Slack and Linear packages were built, published and downloaded successfully; their connector regressions passed in CI. This run did not connect real Slack/Linear accounts or send messages. Private-repository credentials and abrupt machine power loss remain outside this live acceptance. The manually triggered GitHub Actions publishing workflow is authored but was not used for these initial releases.

Raw acceptance records and backups remain local because they include deployment state. No credentials, account files or runtime database are published with this report. See the [marketplace guide](PLUGIN-MARKETPLACE.md) for installation and release instructions.
