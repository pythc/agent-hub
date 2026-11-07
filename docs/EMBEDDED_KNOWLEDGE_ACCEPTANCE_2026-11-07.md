# 内嵌知识与 Router 长程目标验收

2026-11-07。本次在本地后端工作树完成实现、审查与验收。没有启动或替换生产服务，没有部署、推送、合并或发送飞书消息。正式工作树未提交；下述 Git 快照只存在于独立的审查副本。

## 交付

- 内嵌选定的 WeKnora 算法和设计：明确记忆指令、标题分段、片段及检索分数处理、Wiki 链接。保留固定上游源码、SHA256 和完整许可证。
- AgentHub 自有 SQLite 知识库：文本/Markdown 文档、Wiki、版本及回滚、关键词检索、引用、权限隔离及源删除失效。
- Router 原生线程兼容时复用；持久日志保留用户原文、要求、决策和回复来源。必要时从有效日志重建；不可恢复或上下文预算不足会显式保留缺口或停止。
- 长程目标持久保存验收标准、计划、下一步、任务和唤醒条件。Worker 结束后继续核验目标；未完成、等待、暂停与完成分开表示。
- Router 和 Worker 工具、鉴权 API/MCP，以及普通状态查询中的目标摘要。Worker 知识工具仅允许读取。

详细契约见 [实现说明](EMBEDDED_KNOWLEDGE_AND_CONTINUITY_2026-11-07.md)，同类项目分析见 [LobeHub 对照](LOBEHUB_COMPARISON_2026-11-07.md)。

## 验证结果

| 验证 | 结果与证据 |
| --- | --- |
| 类型检查及完整回归 | `npm run check` 通过；40 个测试文件、632 项测试。日志：验收目录中的 `check-final.log` |
| 新增生命周期测试 | 17 项，涵盖重启、线程重建、用户原文保留、目标唤醒和核验、来源撤销、Wiki 历史引用、权限转交、自动输入不能修改别的目标、Worker 只读及私聊入口保护 |
| 原生模型验收 | `examples/router-continuity-smoke.ts`；Terra Router medium、Sol Worker high，最终代码上 11/11 检查通过，零 Router 错误 |
| 验收过程 | 保存明确记忆及禁止部署要求 → 建目标并等待 → 关闭/重启 Runtime → 复用原线程 → 唤醒原目标 → 唯一 Worker 读取内嵌文档并计算 17+25 → Router 检查当前报告并完成目标 → 后续对话检索记忆及结果，没有新增任务 |
| 最终代码对应 | `native-2/evidence.json` 记录的 7 个关键源文件 SHA256 与交付工作树逐一相同；完整文件清单见 `delivery-manifest.json` |
| 改动隔离 | 与开始时冻结的 290 文件基线比较；仅本次列出的 9 个已有文件发生改变，其余基线文件保持相同，15 个 dsh-core 文件未改动 |
| 空白检查 | 正式工作树 `git diff --check` 通过。独立审查副本全增量检查仅报告原样保留的上游 LICENSE 第 1、3、5 行尾空格；排除该原样许可证后通过，未为消除空白改写许可证 |

原生验收使用隔离的本地 state、工作目录和本地消息入口，不代表生产服务或外部连接器验收。使用受控的算术任务证明实际工具调用、恢复与核验链路，不代表任意长期任务的成功率。

## 代码审查与安全扫描

使用 practical-code-review 和 Codex Security 的 diff 工作流；先审查再运行测试，修复后复审。扫描报告由 Security 工具生成并封存。

| 范围 | 扫描 ID | 结论 |
| --- | --- | --- |
| 冻结基线 `e7974a3` → 初始实现 `bf1b078` | `4b95a475-ea83-44b6-90f7-8be9cff00bee` | 发现并本地复现 5 个低严重性问题：派生目标/日志未充分保留来源、Wiki 链接/历史引用依赖遗漏、取消已转交任务时缺少当前所有权检查 |
| 初始实现 → 修复快照 `207ab22` | `e35fb8e6-93cc-4311-bff5-4e539bef1828` | 上述问题已修复并增加回归；所审增量未发现新的可报告问题 |
| 修复快照 → 最终代码 `6e8d0db` | `f6aff74d-84b7-429a-b4dd-d584889fa58d` | 补上非人类输入只能修改自身目标的检查，并验证真实定时触发器不能改动另一目标；所审增量未发现新的可报告问题 |

三个不可变范围组成这次变更的审查链，均已完成。结论仅限本次增量和相关调用路径，不能称全仓库或生产安全认证。Daybreak 账号状态为 `not_granted`，受保护结果可能无法在产品中显示；本地封存报告可读取，不影响本次本地扫描执行。

最终审查快照：`6e8d0db9b943101997d176733b1682597c019fcb`。独立审查仓库位于验收目录的 `review/`，不是正式工作树的提交。

## 明确边界

当前是文本/Markdown、SQLite FTS5 关键词检索及基础 Wiki 能力。没有接入 PDF/Office 解析、OCR、embedding、向量检索、rerank、自动 Wiki 生成或独立 Wiki 编辑器 UI，也没有复制整个 WeKnora Go 服务。

目标默认最多 200 次自主 Router turn，连续 3 次失败进入 `held` 并保留未完成状态；预算可由用户调整。服务停止期间不执行，重启后恢复。验收结构要求当前任务证据，证据内容是否满足标准仍需要 Router 判断，不承诺外部条件不满足时目标也一定成功。

全部证据目录：`/Users/alex/Documents/ChatGPT/竞赛/validation/router-continuity-weknora-20261107`。

Security 报告目录：

- `/Users/alex/.codex/state/plugins/codex-security/scans/review/bf1b0786956d0a7c34315146ae2641406323bda4_20261107T024015Z_n9_v64mr`
- `/Users/alex/.codex/state/plugins/codex-security/scans/review/207ab2278aac5844f17a4357e870eecdbda1c402_20261107T025736Z_w7enut3l`
- `/Users/alex/.codex/state/plugins/codex-security/scans/review/6e8d0db9b943101997d176733b1682597c019fcb_20261107T030439Z_qcd_i4of`
