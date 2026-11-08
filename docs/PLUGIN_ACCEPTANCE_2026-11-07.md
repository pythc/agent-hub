# 插件生态第一阶段验收（2026-11-07）

结论（2026-11-08 补验）：本地插件化重构、真实模型长任务、飞书与 Slack 真实 I/O、升级与回滚验证通过。Slack 使用新安装的独立机器人完成 Socket Mode 入站、插件读写、完整进程重启、停机消息补读与去重。模型长任务、平台 I/O、升级回滚分别有证据，不等同于一个贯穿真实 Slack 的模型长任务或生产部署。未切换生产宿主，源码与验收说明在独立插件分支交付。

工作树：`work/agenthub-plugin-ecosystem-20261107`，分支 `codex/plugin-ecosystem-20261107`，基线 `6d060f770f785788e3639933551455314f859079`。开发、配置、限制及升级方法见 [PLUGINS.md](PLUGINS.md)。

## 实现与边界

- 飞书实现提取到参考插件，原 import 路径保留兼容导出；既有 CLI/live 模式继续走旧接口。v2 飞书包采用应用机器人、明确群范围与 REST 轮询。
- Slack 参考插件包含身份、成员、历史/线程读取、回复、Socket Mode 生命周期事件和分页恢复；附应用 manifest 模板。
- v2 包由 manifest 和自包含 bundle 组成，摘要固定安装；每个连接独立沙箱进程，凭据环境变量显式选择，元数据与分页读取按 source/scope 过滤。
- Worker 的插件工具继续走已有授权与资源读取；Router 保有任务、验收、回复和长期目标的控制权。未修改 DeepSeek vendor core、GoalContract、RouterGoals 或 GoalVerification 源码。
- `checkpoint-source` 的 kind 通过包配置装载，无需在核心添加对应 kind 分支。它实际承载本次模型长任务，而非仅检查插件注册表。
- 本轮提供开发者本地包/SDK/CLI，不包含公共市场、签名发行、通用图形插件商店、自动热升级或跨 stateVersion 自动迁移。

## 验证结果

| 项目 | 结果 | 证据范围 |
|---|---|---|
| TypeScript | 通过 | `npm run typecheck` |
| 全量回归 | 46 个文件、704 项全部通过 | `npm test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000` |
| 新插件无核心 kind 改动 | 通过 | 外部 checkpoint 包与真实模型任务 |
| OS 沙箱与凭据隔离 | 通过 | 当前 macOS Seatbelt；未推广为其他 OS 的实测结果 |
| 协议顺序 | 通过 | 真实子进程；持久化前不返回结果/平台确认；旧 snapshot、延迟记录查询不覆盖较新的实时写入 |
| 历史容量和恢复 | 通过 | 13.5 MB 历史有界读取、6000 条积压、固定时间窗口跨轮/重启续页 |
| 撤权与生命周期 | 通过 | 查询期间撤回成员 scope；编辑/删除先到的迟到消息被拦截；缓存工具结果重验权限 |
| 飞书真实 I/O | 通过 | 用户授权的“学情报告页面优化”“搞大事情”；机器人发送、独立平台回读、插件进程重启与重复检查 |
| Slack 本地协议 | 通过 | 实际 loopback HTTP + WebSocket，包括 apps.connections.open 的真实 request 路径 |
| Slack 真实平台 | 通过 | 2026-11-08 经用户授权创建并安装 AgentHub Validation；只加入 myzone 的 #随机。独立沙箱插件通过真实 Socket Mode 接收消息并回复；完整进程退出后发送线程消息，新进程在重开 Socket 前通过 REST 补读，原事件/游标/回执保留，重复轮询无重复事件、原回复未重发；另一路 Slack 连接器回读确认 |
| 生产部署 | 未执行 | 现有宿主配置与生产进程未切换 |

全量日志：`/tmp/agenthub-plugin-full-tests-complete.log`；类型检查：`/tmp/agenthub-plugin-typecheck-final.log`。`git diff --check` 通过。

2026-11-08 提交前复核：Node 24.15.0 下类型检查通过，包含 Linear 的全量回归为 47 文件、715 项全部通过；日志为 `/tmp/agenthub-plugin-push-typecheck-20261108.log` 和 `/tmp/agenthub-plugin-push-tests-20261108.log`。平台凭据及本机运行状态不包含在源码提交中。此次复核未重新发送真实平台测试消息。

## 真实长任务与升级回滚

真实 Router 使用 gpt-6.1-terra，两个真实 Worker 使用 gpt-6.1-sol。输入为 30 行 CSV，12 个唯一 ID，四个依赖阶段：清洗、分类合计、重复审计、最终报告。第一阶段受控地产生错误金额且声称正确，独立验收拒绝后在同一任务自动返工。第一次宿主重启发生于该失败检查点，第二次发生于最终验收之前。

最终保持 1 个目标、4 个任务、1 次受控返工；所有目标级条件通过，6 条本地插件回执均 sent，无 Router 错误。原始目标、授权、验收条款未被替换。验收脚本记录的核心实现哈希与最终文件一致。

随后在独立保存的真实未完成检查点尝试升级，激活被拒绝，持久状态和锁清理验证通过。对完成且排空后的同一实际任务状态升级 1.0.0 → 1.1.0，再回滚至 1.0.0，安装 revision 为 1 → 2 → 3。目标、任务、授权、验收证据、模型状态及回执的受保护记录校验值完全一致，没有重新运行模型任务。回滚只切换插件代码，不恢复旧任务数据库。

升级要求整宿主排空。这是本轮明确的保守策略，不是长任务运行中任意热替换插件的保证。主机正常重启则可以保留同一摘要继续未完成任务。

## Review 与修复

原始源码快照的独立 review 确认并复现三个安全边界问题：成员查询撤权竞态、累计历史超过快照上限造成连接不可用、Slack 撤回消息首次迟到仍形成指令。修复前对应回归 3 项失败，修复后通过。

2026-11-08 Slack 续验：新增 `examples/plugin-live-slack.ts` 两进程验收脚本。首轮实际收到并持久化 Socket 事件，但 Slack 连接器附加“发送工具”标识，导致脚本全文相等匹配未命中。调整为精确标记或带该固定归属后缀的标记，仍按完整平台原文回读核验；同时拒绝复用已启动的在线验收目录，并检查离线消息属于原订阅线程。该修复仅涉及验收脚本，未改变插件与核心协议。

随后使用全新目录完成真实验收：在线标记 `1794124926.821189`，机器人回复 `1794124928.561759`；进程于 08:02:11 UTC 退出后，08:02:17 UTC 发送离线线程标记 `1794124937.640219`，新进程补读并回复 `1794124951.671369`。两进程均以 0 退出，10 项实测检查全部通过，独立 Slack 连接器确认线程内恰好两条机器人回复。[实际验收线程](https://myzone-va02666.slack.com/archives/C0C8DBLRRK2/p1794124926821189)。

本轮修改后类型检查与 Slack/插件协议 2 文件 14 项测试通过，`git diff --check` 通过。自 review 检查了明确发送授权、频道/工作区限制、完整原文读取、发送前持久化回执、失败后禁止盲目重发、进程退出后才发离线标记，以及原游标/订阅恢复。缺少 live-send opt-in 时在外部副作用前拒绝执行。既有真实任务证据记录的 9 个实现文件哈希复核一致。Bot 与 App 凭据只保存在仓库外的本机私有配置文件，权限 `0600`。

同时修复了 Socket Mode 多段接口名误拦截、result 批次未等待持久化确认、批次/历史分页积压、实时写入被旧快照/查询覆盖、升级丢失 readPaths、线程查询忽略 scope、legacy SDK 来源过滤/乱序 IDs 漏页，以及只读插件工具失败被误记为不确定写操作。成员预览固定请求开始前的配置 revision，失败激活与配置更新保持事务一致。

安全扫描 `13066db5-159a-4120-8819-fb0de3838483` 已封存并读回：27 个初始变更源码/配置文件、3 个 medium finding。报告绑定修复前摘要 `4508036e2d21efaa726c303fc87fdb3a47e6b811e012096a942fa0ef2c1fce13`，工具明确提示工作树后续已变化；不能把这个历史扫描当作修复后无问题证明。修复后的复核、704 项回归和上述真实流程是另外的验证证据。扫描 token 统计不可用，未估算。

平台 API 权限、限流、事件保留与游标有效期仍是外部约束。REST 轮询不能证明没有遗漏平台未保留的生命周期事件；不确定的外部发送仍需对账，不能因为重启或回滚就自动重复。

## 本机证据

以下目录不随仓库提交，记录只用于本次验收，不含凭据值：

- [真实模型最终验收](../../../validation/plugin-ecosystem-20261107/native-goal-final/evidence.json)
- [实际任务升级回滚](../../../validation/plugin-ecosystem-20261107/native-goal-final/lifecycle-evidence.json)
- [飞书真实 I/O](../../../validation/plugin-ecosystem-20261107/feishu-live-final/evidence.json)
- [Slack 真实 I/O 与重启恢复](../../../validation/plugin-ecosystem-20261107/slack-live-20261108-final/evidence.json)
- [Slack 应用、权限和唯一频道成员关系](../../../validation/plugin-ecosystem-20261107/slack-live-20261108-final/setup-evidence.json)
- 原扫描报告：`/Users/alex/.codex/state/plugins/codex-security/scans/agenthub-plugin-ecosystem-20261107/6d060f770f785788e3639933551455314f859079_20261107T142538Z_7fpsiwri/report.md`
