# 当前云端进度 — 2026-11-16

本节是最新检查点；下方旧日期/旧提交记录是历史证据，不覆盖本节。所有 O01–O49 与总 Issue #11 仍开放；局部通过不等于整项完成。

| 工作线 | 最新代码 / 远端备份 | 已核验 | 正在做 / 未完成 |
| --- | --- | --- | --- |
| 集成 PR #65 | 本地 `589539c31fc93380dc01862331e119fa430509cb`；远端 `c7b34f6c8ab5a8962fd350876daa4717baf97f03` | 普通 CI **43927410104 三 job success**；容器 **43927409932 success**；本地 check **1906 passed / 75 failed / 4 skipped**，与同环境 main 的 75 个失败身份完全一致，新增失败 0、EPIPE 0 | 后续变更须核自己的 head；真实 IM/ACP/付费调用未验收 |
| O07 / PR #61 | 远端 `fe6fc9185eefa7fd74225b811135ef9faf0130ed` | 普通 CI 43907679400、容器 43907679405 均通过；提交/测试/部署/未知外部效果分开 | 更大范围的恢复/证据闭环仍待做 |
| O05.1 / PR #62 | 远端 `ea44e376d12ed036fe995491a320d539f9f08252` | 实际 Runtime 排队、暂停、推进与结束；普通 CI 43908129839、容器 43908129811 均通过 | 公平性、配额和完整排队原因未完成 |
| O13/O14 / PR #63 | 远端 `b439aa5ba2c08e1f71db2d7ef1cfcbd1ec93f17f`；后续上下文绑定已入集成 | 实际插件本地 HEAD；身份/目录是模拟；飞书表单与禁用草稿实际保存；0 外发 | 真实认证、收发、频道权限保持未验证 |
| O17 / PR #64 → #65 | 分支远端 `9712ca6bb9b9567854c97509608a02ac75d9a6b7`；完整消费者已入集成 | 旧“页面不能接 transport”断言按现契约修复；#64 普通 CI 43919571674 三 job、容器 43919571721 均通过。集成实际单 Runtime 链接 failclosed、原请求刷新恢复、隔离未归属旧数据 | 可选多 workspace 仅浏览器代理模拟，当前服务器并未新增多租户能力 |
| O43.1 / PR #66 → #65 | 远端 `fb2098047d590ef3586563051f44242d5ec69839`，代码已集成 | 实际只读 GET、本地合成 UsageLedger、手动刷新、未知值/失败保留、窄屏/键盘/减少动画 | 父线程发现中文偏技术且灰字多；正在精简，旧截图不算新文案通过；无价格/新预算/容量承诺 |
| O18.1 / PR #67 | 本地 `e8f4423c2d8a96af6f4698791943e7881ce3203a`；远端 `bd6842441f291ea9e491520e73f8069d80d2c409` | 只读凭据存在性 DTO，22 新测试、独立邻接 90/90 与 host types | 无 UI、无认证验证、无新 vault；旧错误边界待另审 |
| O09.1 / PR #68 | 本地 `517d960472971d20ba4da8018dfb484bb3bf9cc0`；远端 `65b28b797e195e1333adb01307fef962f8d4672f` | 只读注意事项后端初稿，独立审查发现真实嵌套 authority 导致 route 懒写 | 正在修复并扩大实际 fixture；未独立复验、不进入 UI 验收、不标完成 |

## 本次实际浏览器验收（代码 589539c）

运行：`CHROMIUM_EXECUTABLE=<云端 chrome-headless-shell 路径> python3 tests/browser/run-<suite>.py <输出目录>`。每个 runner 在同一云执行会话启动实际本地 app、浏览器，结束后停止自己的 app；旧端口不是仍可访问的交付服务。

| 脚本 | 当前结果 | 实际截图 / 报告 |
| --- | --- | --- |
| run-capability-increments.py | 6 组通过，14 图，0 页面错误 | `.local/integration/review-four/browser-report.json` 与 `screenshots/` |
| run-connector-ux.py | 7 组通过，13 图，0 页面错误 | `.local/integration/review-connectors/browser-report.json` 与 `screenshots/` |
| run-scheduler-status.py | 4 组通过，10 图，0 页面错误 | `.local/integration/review-scheduler/browser-report.json` 与 `screenshots/` |
| run-workspace-capabilities.py | 6 组通过，7 图，0 页面错误 | `.local/integration/review-workspace/workspace-browser-report.json` 与 `screenshots/` |
| run-resource-usage.py | 7 组通过，9 图，0 页面错误，0 模型调用 | `.local/integration/review-resource/browser-report.json` 与 `screenshots/`；文案另待重验 |

共 53 张实际页面截图。真实 local Runtime 与浏览器代理/合成数据/模拟身份证据在各报告中明确区分。页面无报错不能替代文案、权限或业务结果验收。完整 check 日志 `.local/integration/accepted-check.log`；机器可读基线比对 `.local/integration/accepted-failure-comparison.json`。32 项 CI 策略/固定诊断回归在集成版本通过。

## 最新独立审查发现与安全边界

- 导航切 workspace 后二级读取早于 busy 清理，使真实页面仍停留 home。`df51d2c` 改为完整 entryRun.finally 结束后才读二级资源；实际 workspace 与 resource 浏览器曾复现失败，修复后均重跑通过。
- HTTP unknown-effect 测试的 live fake Model 与人工持久 fixture 竞争；`589539c` 先暂停 Runtime，并断言模型 0 调用，保留原错误码/未知效果断言，独立复验通过。
- 新发现 Trace GET 和 TaskStatus 的只读验收会经 scheduled/goal authority 为缺失内层 anchor 懒写 router-route；独立真实 fixture 确认 records 33→34 / 37→38、模型/历史/投递均 0。正在设计默认不变、仅同步只读观察作用域的修复，不能把旧 53 图当作此问题通过。
- CI 专用窄 AppArmor 策略已按后续明确授权独立实施并真实验收；不改 docker-default，不用 privileged/unconfined，不影响生产/Mac。旧拒绝仅保留为历史，当前不再是 CI 阻塞。
- **仍阻塞：**把 repository 未知回执纳入恢复 POST 门槛/observed digest 的独立行动被自动审批拒绝且未执行，原因是改变 POST 恢复操作语义，超出当时仅追加只读投影的约束。精确范围授权仍待确认；没有重试、间接或委派绕过。
- 不合并 main、不公开部署、不使用用户 Mac、不真实发消息或付费调用。所有 Issues 保持 open。

---

# Four capability increments — implementation and acceptance evidence

Branch: `feat/worker-connector-acp-trace-20261116`.
Main baseline rechecked: `cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7`.
Current cloud checkout: `/workspace/scratch/f110c34c6b30/agent-hub-recovery`.
Frozen implementation tested: local `b749a62266b3ba31dbe9784877da5c7a77a54e04`.

## Current state

| Work line | State | Fresh evidence |
| --- | --- | --- |
| Worker templates | implemented, committed, remotely preserved, locally accepted | 11 new tests; existing Worker regressions included; reviewed install/create/export/reload browser flow; no grants, paused creation |
| Connector management | implemented, committed, remotely preserved, locally accepted | 22 new tests; existing Slack/registry regressions; real Feishu wizard through existing onboarding; disabled initial state, scoped diagnostics, restart/revocation fences |
| ACP outbound | implemented, committed, remotely preserved, locally accepted using synthetic peer | 21 new tests; actual immutable package + ProcessBackend + bubblewrap + fake ACP probe/run/same-session resume/permission denial; managed gate remains closed for standard ACP |
| Execution trace/recovery | implemented, committed, remotely preserved, locally accepted | 22 new tests; durable audit cursor/SQLite restart/visibility/recovery; actual scheduler result, failed refresh, unknown-effect fence and cancellation persistence in browser |
| Integration/acceptance | original local evidence recorded; container blocker subsequently resolved and staged current-head CI accepted below | 4 new HTTP tests including slow-body operator revocation; final host/frontend types/build pass; actual browser 6 workflow groups/14 screenshots/zero page errors; same-environment unchanged-main comparison |

## Fresh required checks

- Final implementation `npm run check`: typecheck and chat build pass; Vitest 1516 passed / 75 failed / 4 skipped, 100 files passed / 8 failed, one sandbox-process EPIPE.
- Separate unchanged-main checkout in this same new environment: 1436 passed / the exact same 75 cases failed / 4 skipped, 95 files passed / 8 failed, two sandbox-process errors.
- Exact failing-case set comparison is equal; no new failing cases. Network-isolated bubblewrap operations are refused by this kernel (`NETLINK_ROUTE socket: Operation not permitted`). Isolation/admission requirements were not weakened.
- All 80 newly added tests pass. Final actual-browser run passed after the last source fixes; `.local/recovery/browser-final/browser-report.json`, with 14 actual-page screenshots under its `screenshots/` directory.
- ACP fresh packaged smoke: `.local/acp-recovery-acceptance-20261116/evidence.json`; digest `0bc686e833fe99daa66f691eccd322c9a09506aaeeeb92bd56750b8f32f76d76`.
- Logs: `.local/recovery/final-check.log`, `baseline-check.log`, `failure-comparison.json`, `final-build.log`, `integration-tests-final.log`.

## Local review instance

Started using `node --import tsx examples/capability-increments-acceptance.ts .local/recovery/review-instance`.
Observed URL: `http://127.0.0.1:37169/configure#worker-templates` (within that cloud execution session's loopback namespace).
The ignored private `browser.json` contains a synthetic review login/session. Never publish it. Separate sandboxed commands and the cloud browser do not share this listener; use the same-session browser runner for automated acceptance. The runner stops its own acceptance process; the separately started review instance is retained while its cloud session lives.

## Recovery and publication record

The first cloud filesystem vanished. Its implementation commits were not available on disk or remote, but all four agents retained complete tool-write records. Source was restored from those records into a fresh checkout based on existing remote handoff `0f626fd51a26c30714b1ad0f31636c0785ca20b0`, rather than falsely claiming disk/commit recovery. The initial checkout was backed up to `.local/recovery/remote-handoff.bundle`. Old test results in RECOVERY_HANDOFF.md are historical only; the evidence above is newly executed.

Modules and integration were saved remotely as soon as committed through the connected GitHub Git-data API; CLI push has no installed credentials. Remote branch updates used expected-head leases and preserved prior history. Key local commits: `0f1d388` integration; `44c3ad3` ACP; `7837b45` templates; `5c6297d` connectors; `989a5ac` trace; `67dcf56` integrated fixtures; `c8e265d` revoked-operator apply fence; `64fa8a0` closed-runtime diagnostic fence; `b749a62` plugin-switch draft reset. The corresponding remote checkpoint history contains the complete source. Final publication must verify local/remote tree equality and remote HEAD; no main merge.

## Scope and remaining unverified items

No user Mac, public deployment, main merge, paid model call or real external message was used. IM diagnostics do not establish receiving/sending/target-channel rights. ACP handshakes report authentication unknown, and standard ACP is explicitly ineligible for managed Workers. Real Feishu/Slack/ACP services and credentialed inference remain unverified. Full-suite green status requires an environment supporting the existing network-isolated sandbox; the same 75 cases fail on unchanged main here.

Design, provenance, reproducible tests and migration/rollback: [DESIGN_AND_ACCEPTANCE.md](DESIGN_AND_ACCEPTANCE.md). Machine-readable summary: [ACCEPTANCE.json](ACCEPTANCE.json). Earlier interruption details remain in [RECOVERY_HANDOFF.md](RECOVERY_HANDOFF.md) for historical recovery context.


## CI follow-up and optimization backlog — 2026-11-16

- Unified backlog: [`../optimization/MASTER_TODO.md`](../optimization/MASTER_TODO.md), all 49 suggestions plus the four feature mappings, dependencies and eleven end-to-end acceptance scenarios. Nothing unaccepted is marked complete. Published remotely at `7da952133cf91a70d31c49b6c6a105ab0fbc53eb`.
- Local `bec3d19636cdb76a8b60f80490c6d3c5e9c7699c` initially added bounded/redacted pre-cleanup container diagnostics; independent review found heuristic redaction insufficient, so follow-up replaced raw logs with fixed probe classifications and typed allow-listed state metadata only. Local `57b29ce95c153ab1f0b4de8b94afc301eca5634a` fixes a real cursor-test race and adds a fixed no-op sandbox probe. Corresponding source remote head: `ca6cbcfe699d3d0ec28116da039e5bebef6b752d`.
- At that source head, regular CI run [43876934064](https://github.com/pythc/agent-hub/actions/runs/43876934064) **passed all three jobs**: Ubuntu 22.04/Node 22.19, Ubuntu 22.04/Node 24, GitHub-hosted macOS/Node 24. No user Mac was used. Four focused HTTP tests also passed locally; log `.local/ci-fix/cursor-regression.log`.
- Container acceptance run [43876933980](https://github.com/pythc/agent-hub/actions/runs/43876933980), job `133332311390`, **failed** before listening: bubblewrap reports `Failed to make / slave: Permission denied`. This is an independent Docker/AppArmor startup failure, distinct from the cloud kernel's 75 baseline cases. A production-layout bootstrap mirror passed local init/runtime/HTTP health without bypassing production CI checks; it is not container acceptance.
- A fixed-name opt-in AppArmor policy was proposed, independently reviewed at the design level, and **rejected by automatic approval review before any file was created**. Broad mount/unmount/pivot_root permissions would apply to all container processes. No policy was written, loaded, or installed, and the rejection has not been bypassed. Exact permission scope and required negative tests are recorded in [CONTAINER_CI_BLOCKER.md](CONTAINER_CI_BLOCKER.md). Explicit approval for that security-boundary change is pending; container CI stays blocked.
- Backups: `.local/ci-fix/pre-fix.bundle`, `.local/ci-fix/pre-fix.diff`; feature changes were preserved remotely before the policy proposal. Real IM/ACP authentication, external sends, paid inference, public deployment and main merge remain unperformed.

- Post-CI-fix actual-browser rerun at local `d302e4b6dd3803a16adc4743683e11a2a14b0a56` (remote tree-identical `7c117d3390bd05d34debf494b374af18fb32a8e4`) passed all 6 workflow groups with 14 screenshots and zero page errors. Command: `python3 tests/browser/run-capability-increments.py .local/ci-fix/browser-after-ci-race`. Evidence: `.local/ci-fix/browser-after-ci-race/browser-report.json`, actual pages in `screenshots/`; mobile reduced-motion connector and desktop unknown-effect trace images were also visually inspected. This uses an actual local app and browser with deterministic synthetic services; real IM and real credentialed ACP remain unverified. The runner stopped its own app after checks.

- Independent review found partial-redaction risks in the new diagnostic app/health log printing. Follow-up removes raw app/health/error strings entirely from the new diagnostics and records only a fixed probe classification, exit status and typed allow-listed state metadata. Two synthetic diagnostic-path regressions passed, including quoted secrets, raw health logs and exception contents; Python compilation and diff checks passed. An independent reviewer reran both tests and confirmed the raw-output removal and corrected rollback procedure. No AppArmor change is included.

- Remote diagnostic hardening checkpoint `1880962553105a3eab4633033c88254e34e738ee` was read back successfully. Its container run [43880391480](https://github.com/pythc/agent-hub/actions/runs/43880391480), job `133344411701`, passed both new diagnostic regressions and image build, then failed the real acceptance probe with the fixed classification `root_mount_propagation_permission_denied`. The new output contains only typed state metadata. AppArmor implementation remains uncreated/pending explicit approval. The matching regular CI run [43880391485](https://github.com/pythc/agent-hub/actions/runs/43880391485) was still running when recorded; prior three-job green evidence remains tied to `ca6cbcfe…`, not inherited across head SHAs.

- Optimization master backlog independently checked against all 1,467 original-plan lines: all 49 numbered titles and priorities preserved. Review issues about dependency cycles and real-IM global gating were corrected and independently rechecked; conditional event references were clarified to match the unfrozen shared-contract proposal. `docs/optimization/SHARED_CONTRACT_PROPOSAL.md` preserves the next C1–C9 slices and semantic migration risks; it implements no feature, and no Oxx item has been marked complete.


## O07 independent next stage

O07 / Issue #18 proceeds on `feat/optimization-status-20261116`, draft PR #61, without pausing all work for CI. See [`../optimization/STATUS_STAGE.md`](../optimization/STATUS_STAGE.md) for exact module/review/browser evidence and the separately blocked recovery POST change. No Oxx issue has been closed. Container policy work is isolated in `agent-hub-ci` and limited to the newly user-approved CI-only profile; no production security setting has changed.


## Latest cloud acceptance / parallel work

- O07 source/UI frozen local5356135 / remote99c4ecbe: full check1587pass/75fail/4skip; all75 exact same failure identities as unchanged main. New readable UI actual browser6groups/10screens/0errors; four-capability regression6groups/14screens/0errors. Tests/screens and independent93focused review are documented in STATUS_STAGE/STATUS_ACCEPTANCE. No real IM/ACP claim.
- Container CI original blocker resolved at remotead34ddc0, run43892304831/job133386478516. Explicit10 retained-boundary booleans and all13 original acceptance groups pass. Ordinary CI queued at check time. CI-only changes are now integrated in the O07 checkout and will be published as one checkpoint for a fresh combined-head run. No production security settings changed.
- O05 backend remote8a26ea17 independently reviewed;42author/19independent tests pass. Simple existing-team-page frontend is in progress in agent-hub-scheduler. Issue16 open.
- Rejected repository-unknown POST recovery guard remains unimplemented and pending explicit scope approval; no retry/bypass. All Issues remain open; latest user simple/readable/no-small-print requirement applies to ongoing UI work.


## Latest independently verified checkpoint — 2026-11-16

- O07 draft PR #61 exact head `88a7c20fe408ed0b28cc7a819858b95754eef8e8`: mergeable; ordinary CI43894922630 all three jobs and actual container acceptance43894922522/job133395751094 pass. Runtime/UI remains the independently reviewed and actually clicked5356135 snapshot. See STATUS_ACCEPTANCE/STATUS_STAGE; CI source evidence is tied to this exact head, not an inherited claim. No Issue closure.
- O05.1 draft PR #62 head `d1685363102f69d0a296e360c81d4ea477a002ff`: reviewed aggregate observation backend plus readable team panel; root actual Runtime running/queued/pause/advance/finish browser passed, 10 screenshots/no page errors. Full local check1623pass/75fail/4skip; exact75 failure names match unchanged main, one baseline sandbox-process EPIPE. CI-policy Python32/32. This exact head now passes ordinary CI43899511531 (three jobs) and container43899511380. WholeO05 remains open.
- IM readability and durable local fixture saved at remote `681064b4c823d4c8db2f7ece8e5d0f26ccb9848c`; plugin-local HEAD/identity/member simulations and actual disabled Feishu setup browser pass (11 screenshots, no page errors), zero sends/events/model calls. Root independently clicked and viewed light/mobile Chinese pages; draft/onboarding backend work is ongoing, so its final frozen-head rerun is pending. Real platform authentication, messages and channel rights remain unverified. O13/O14 open.
- O17 C1 transport bridge backed up at remote `2cfeea10dd3ae264d84ba208c013464c34fa0a9a` (native2483280). Existing four-capability actual-page regression passes6groups/14screens/no page errors. Independent C1 review is running; consumers and namespaced template recovery ledger have not migrated. No actual multi-workspace server or real dual-account verification is claimed.
- Separately rejected repository-unknown POST recovery fence remains unexecuted, awaiting explicit scope approval; no retry, workaround or delegated bypass. Real IM/ACP and paid provider acceptance remain unperformed. All49 Issues and master #11 remain open.
