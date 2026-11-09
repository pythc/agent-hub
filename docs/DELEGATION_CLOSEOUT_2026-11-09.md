# 同机委派改造收尾

日期：2026-11-09。状态：本轮实现、集成及验证完成；尚未提交、合入 `main`、推送或部署。当前运行实例保持原 release。

## 最终范围

按最新决定，正式取消跨机器部署，以及当前 Worker 直接统筹另一实例 Workers 的 `delegated-coordinator`。本轮保留同一所有者、同机一跳 `managed-team`：A Router → B Router → B Workers → 实际产物 → A 节点与整体独立验收。已有 Linux 单实例支持保留。

控制面提供实例身份、显式配对和导出授权、团队连接、接单开关、任务状态、取消核对、实际产物证据、目标依赖图和独立验收详情。它还不是实例创建器或发布器；实例配置、目录和服务安装仍按现有运维方式准备。

本地 Worker 与子团队目标分开建模。独立验收与普通父级核对分开呈现；不通过人工 accept 绕过结构化目标验收。失败的远端合同进入待处理，不自动重复派单或扩大权限。

## 最终源码在哪里

| 项目 | 固定位置 / 状态 |
| --- | --- |
| 收尾工作树 | `work/roppo-delegation-closeout-20261109` |
| 分支 | `codex/roppo-delegation-closeout-20261109` |
| 集成基线 | `244dac0`，包含最新 Webhook 授权、续接、恢复改造 |
| 原两阶段工作树 | `work/roppo-delegation-20261109`，基线 `c9b6c6c`；45 个已验证文件哈希保持不变 |
| 原源码归档 | 原工作树 `.local/delegation-closeout-input/source.tar.gz`，SHA-256 `e932712afc58a7e889c2bc5767200ebce58a69c6958fab9033d74117f2b40854` |
| 最终交付清单 | 收尾工作树 `.local/closeout-source-manifest.json`、`.local/closeout-source.tar.gz` |
| 当前实际部署 | `c9b6c6cc5c244449c1c144880bcecfdbb6eda3f2`；没有开启本轮委派，详见 [部署现状](DEPLOYMENT_STATUS_2026-11-09.md) |

没有覆盖原工作树、运行 release、私有配置或业务工作目录。集成处理了 8 个重叠源码文件的冲突，保留 Webhook 与委派各自的路由、监听、工具和授权检查；DeepSeek vendor 核心没有改动。

## 收尾修正

1. **数据库版本重号。** Webhook 已使用 8、9，委派改为 10，远端目标图改为 11。Store、受管文件恢复与备份共用最高版本门禁；实际旧 `main 244dac0` Store 拒绝 10、11，新 Store 重开保留版本。禁止直接调低 `user_version` 绕过门禁。
2. **Webhook 激活与全局版本解耦。** 提升委派门禁前保留原 Webhook 协议激活状态；旧 v1 不因 DB 升到 10 自动取得 v2 能力。离线升级、首次激活和重启保留较高 DB 版本；Webhook 固定模板继续只允许本地 Worker 节点。
3. **父级权限收窄。** 旧合同超出当前来源 / 目标 / 导出授权的能力或限额时，停止续租并取消。每次等待网络响应后、提交或续租前，重新读取当前任务控制代次并校验权限；续租失败后的核对也遵守撤权后仅取消通道。
4. **过期与停止。** 已过期但尚未被后台 sweep 处理的租约，也不能被迟到续租复活。入站过期处理不再等待无关出站 RPC；取消屏障先持久化，再中断本地执行。
5. **证据和删除。** 父知识库文档标记为父实例来源；对端文件和执行记录保留对端来源。历史删除的 tombstone 不被迟到响应恢复；Webhook 观察器跳过已删除或没有目标引用的记录。
6. **页面刷新。** 部署页离开 / 后台隐藏后继续保留调度，返回后恢复拉取；保留草稿、键盘焦点和验收详情展开状态。

## 验证与审查

所有执行均在隔离状态与测试账号中进行；本轮没有调用新的真实模型任务，也没有操作运行实例的任务、开关或凭据。

| 验证 | 结果 | 私有证据 |
| --- | --- | --- |
| 集成完整检查 | 类型检查通过；87 文件、1317 项测试通过 | `.local/closeout-check.log` |
| 最后一个撤权核对分支修正 | 再次类型检查通过；委派 34 项回归通过，其中新增“lease 失败期间撤权只允许 cancel” | `.local/closeout-final-typecheck.log`、`.local/closeout-final-delegation.log` |
| 早期交叉回归 | 委派、目标、Webhook 三阶段共 5 文件 / 129 项通过 | `.local/closeout-focused-v2.log` |
| 两真实 OS 进程 | fixture；目标、节点和整体验收闭环通过，约 1.8 秒；不冒充真实模型 | `.local/closeout-process/result.json` |
| 旧程序门禁 | `main 244dac0` 的实际 Store 拒绝 DB 10、11；新 Store 保留版本 | `.local/rollback-proof/result.json` |
| 浏览器 | 中英 × 明暗 × 1440/390 共 8 组合通过；切页 / 隐藏恢复刷新、证据、取消核对、撤权和重载通过；窄屏截图已人工查看 | `.local/closeout-browser/result.json` |
| 改造前后复现 | 原冻结版允许过期续租、权限收窄后仍授权；修正版分别拒绝并持久取消，0 模型调用 | Security 受管 `artifacts/validation/old-result.json`、`fixed-result.json` |

完整检查记录发生在最后一个小分支修正前；该修正另以类型检查和完整委派专项回归覆盖，未将两次结果混称为同一份源码的全量跑分。浏览器仍记录基线 `/workspaces`、`/connection-capabilities` 的兼容性 404；没有新增失败请求或页面脚本异常，不声称所有网络日志为零。

按 `practical-code-review` 与 `security-diff-scan` 完成人工、独立复核和受管 Security 审查。Security scan `fc387e93-f027-4f8d-b4a2-8698fb3a3c45` 已完成并回读：覆盖原冻结差异的 34 个源码文件，确认 1 项中等风险的父级能力收窄检查缺失，修复前后复现已留存。过期续租作为确定的租约正确性问题修正；没有凭此虚构另一条安全权限提升。[Security 密封报告](/Users/alex/.codex/state/plugins/codex-security/scans/roppo-delegation-20261109/c9b6c6cc5c244449c1c144880bcecfdbb6eda3f2_20261109T120946Z_8xs3pw3j/report.md)对应原冻结快照；最终集成另有定向复核与上表验证，不冒充第二次全量 Security 扫描。

前一阶段真实模型证据仍保留在原工作树 `.local/delegation-goal-native-v2-20261109/result.json`：真实文件读取、节点程序检查与独立整体验收通过。它属于前阶段固定源码，不替代本次集成后的新真实模型验证。

## 保留的边界

当前传输仅本机回环，一跳；没有远端文件系统管理、跨机器协作、无限递归、跨组织或 HA。运行中的远端合同没有任务级暂停 / 恢复 / 追加输入；需要新信息时停止旧合同，再明确建立新合同。恢复原实例仍先隔离、撤销旧配对，并核对外部效果后重新配对。

产物和文本验收有明确数量 / 大小限制；对端签名证明实例身份，不证明模型汇报必然真实。本轮没有覆盖完整崩溃 / 时钟 / 高并发压力矩阵。出站核对仍可能受大量失联任务影响，不能把当前本机验证扩大为容量或高可用保证。

本轮交付至此收敛；当前部署方式、升级流程和备份边界见 [部署现状](DEPLOYMENT_STATUS_2026-11-09.md)；具体委派使用见 [操作说明](DELEGATION.md)。
