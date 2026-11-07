# Agent memory validation — 2026-11-08

实现基于 `ff0abe894e85ad2b9d23f29b33e5f7131cde3341` 的独立分支 `codex/weknora-memory-20261108`。暂停的 Wiki 工作区未修改，未部署、合并或 push。本文件区分自动回归、真实模型、浏览器和生产验证。

| 检查 | 结果与证据 |
| --- | --- |
| 类型检查 | `npm run typecheck` 通过，包含宿主、示例和 Chat 前端。 |
| 全量自动测试 | `npm test -- --maxWorkers=4`：59 个文件、923 项通过。默认高并发运行曾触发 5 秒 CLI 时序超时；限制并发后原断言全部通过，未放宽测试条件。 |
| 记忆边界 | 覆盖候选不进上下文、待确认保留旧值、revision 冲突、精确来源引文、原契约不变、失败段保留、独立会话、别名抑制、人工保护、容量归档、节流、日预算、敏感文本和向量降级。 |
| 恢复与权限 | 覆盖运行 lease 恢复、clear 后迟到输出拒绝、权限与来源失效、合法 epoch 刷新、共享详情不泄露来源／旧版本、Worker 实际 broker、旧 SQLite 恢复后遗忘及向量／主题清理。 |
| 升级／回退 | 用基线旧 Store 实际打开 schema 7 副本，确认拒绝；对带已完成迁移回执的 schema 8 状态确认拒绝且 journal 未修改。构造失败可在同进程再次尝试，不残留锁。 |
| API / embedding 协议 | 三类 API 后端临时调用不保留输入、不增加历史召回工具。真实本地 HTTP 测试检查 embedding 环境变量凭据、请求格式、禁止重定向和流式响应大小上限。向量语义排序使用受控向量测试。 |
| 真实记忆模型 | 原生 Codex 模型完成 queue → crash → extract → update → verify。实际模型 turn 开始后 SIGKILL 独立测试进程组，重启恢复未完成观察，再确认记忆、替换偏好、新进程按新偏好输出、清空并重启保持清空。 |
| 真实长任务 | 见本地 evidence.json：旧解析器失败后 Router 依据证据拆分 `decode_v2`、`validate_duplicates` 并调整依赖，验证阶段重启后继续推进。最终通过状态由独立验收产生。 |
| 浏览器 | 真实隔离 HTTP/SQLite + Chromium，12 组流程检查通过；1440px 桌面、390px 手机、reduced motion、焦点恢复、安全文本渲染、无控制台错误。包括实际后端搜索、候选确认、编辑、来源／历史、归档恢复、拒绝、设置持久化、入口隔离、清空后重载。 |

两轮自查覆盖了新增源文件和直接调用链。初轮 Codex Security diff scan 对固定初稿记录两项中等风险：Router inspect 绕过新记忆开关／actor 过滤，及遗忘主题仍被发送给提取模型。两项均已修复并加回归；共享详情、归档后遗忘、别名重新出现、间接替换依赖和未来 schema 重放等组合问题也已修复。初轮扫描报告对应修复前快照，不应被当作修复后整树扫描结果。扫描 ID：`e4659095-c779-4edc-8a9a-324f0be539e4`。

本地验收产物位于工作区 `validation/` 下：

- `agenthub-memory-20261108-accepted/evidence.json`：最终记忆模型验证。
- `agenthub-memory-20261108-accepted/inflight.json`：被终止时的实际 turn 和运行 lease。
- `agenthub-memory-20261108-browser-final/evidence.json`、`desktop.png`、`mobile.png`：最终浏览器验证。
- `agenthub-memory-20261108-long-task/evidence.json`：真实多阶段重规划／重启验收。
- `agenthub-memory-20261108-final/`：自动检查日志、升级拒绝证据、源文件摘要和修复回读。

真实长任务从本轮 runtime 开始运行。期间的最后修复局限于记忆边界及未来 schema 迁移入口，未修改 Router goal、验证器、重规划器或 Worker 调度逻辑；对应改动另由最终全量回归、记忆模型和浏览器测试验证。任何时间点和版本边界都以 evidence 和源文件摘要为准。

尚未声称通过：现用业务实例的部署验收、真实外部 embedding 模型的语义质量、远程平台私有身份管理 UI、供应商历史副本删除，以及此前暂停的 Wiki 页面工作。默认自动提取仍为关闭，需要在学习设置中选择自动抽取。
