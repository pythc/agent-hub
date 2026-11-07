# Router 第一步补齐：普通 API、完整预算与历史正文删除

后续状态见 [生命周期与迁移收尾验收](ROUTER_LIFECYCLE_ACCEPTANCE_2026-11-07.md)。本文保留当时的 555 项回归和 45/25/6 证据口径，不覆盖历史结果。

2026-11-07（Asia/Shanghai）。代码位于 `work/agenthub-parity-fixes-20261106`，基础提交 `eb0dabb4e0f65f48b175189df46b65319cf01421`。本轮开始时的未提交工作已保留，新增变更以独立指纹核对。

**本轮点名的三项已实现并通过真实模型、真实飞书传输、回归和管理页验证；原设计全部 76 项仍不能声明验收完成。** 当前矩阵为 45 pass、25 not_run、6 not_applicable；历史通过项沿用原证据，不伪装成全部重新实测。正式部署没有迁移或重启。

## 交付与实测

| 项目 | 实现及结果 | 主要证据 |
| --- | --- | --- |
| 普通模型 API | 官方 DeepSeek Chat Completions；真实工具调用、思考内容连续传递、关闭思考、同线程接续和结构化输出均通过 | `deepseek-api/probe-result.json`、`probe-protocol.json` |
| Router / Worker | Codex Terra medium Router + 四个 Sol high Worker，分别实际返回 2/4/6/8；DeepSeek API 也完成四 Worker 联合流程 | `native-2/evidence.json`、`feishu-1/before-delete.json`、`feishu-api-2/before-delete.json` |
| 对话边界 | Worker 交付进入内部 Router 收件箱；只有 Router 向群回复。API 验收最终仍是原四个任务，没有重跑四项工作 | `feishu-api-2/arithmetic-thread.json`、`reconciliation.json` |
| 双群隔离与共享 | 第二群未共享时的完整模型协议无标记；明确发布指定事实后，Router 正确召回，任务总数仍为四个 | 两种后端的 `isolated-protocol.json`、`shared-thread.json`、`result.json` |
| 完整上下文预算 | API 统计完整实际请求，原生 CLI 统计暴露协议；超限不截断工具配对，不自动重放效果 | `native-budget-negative/negative-result.json`、API 探针及预算回归 |
| 统一正文清理 | 原生线程/API 历史、缓存、附件、受管记录/审计/出箱正文和 FTS；完成后继续调度、重启、原生不可读与状态文件字节回读均通过 | `final-cleanup-readback.log`、`feishu-api-2/restart-after-cleanup.json` |
| 回归 | TypeScript 通过；36 个测试文件、555 项测试通过 | `check.log` |
| 管理页 | 实际浏览器验证删除操作与清理进度、删除后旧查询正文消失、共享/撤回、模型设置、390px 布局、键盘焦点、无页面错误 | `browser/final-current3.log`、`browser/result.json`、截图 |

证据根目录：`/Users/alex/Documents/ChatGPT/竞赛/validation/router-scope-completion-20261106`。重跑脚本保存在 `scripts/`，使用隔离状态目录；脚本不是生产部署命令。历史首轮证据仍在 `router-scope-phase1-20261106`。

官方服务将请求的 `deepseek-v4-flash` 返回为 `deepseek-flash`；这里记录请求名与实际回执，不把已退役别名宣称为仍在运行的旧版本。[官方更新记录](https://api-docs.deepseek.com/updates/)。DeepSeek 需要在工具上下文中连续保留 `reasoning_content`；测试验证字段存在及原值传递，合法空字符串不冒充丢失推理。[思考模式契约](https://api-docs.deepseek.com/guides/thinking_mode/)。

API 联合验收的 Router 为 low，Worker 1–3 为 high，Worker 4 显式关闭思考，用以核对独立参数覆盖。Terra medium + 四 Sol high 通过 Codex 原生接入单独验收；不把不同供应商的模型名或强度等同。

## 飞书测试的准确边界

用户已授权自行发送。所有测试均以「周催办」机器人身份在「搞大事情」「学情报告页面优化」发送并回读，没有使用用户账号。

连接器正常过滤自身机器人消息以避免反馈循环。因此本轮自动输入是：真实机器人发消息 → 飞书原生回读 → 保留 `human:false` 的操作员重放 → 隔离验收宿主接纳 → 实际模型执行 → 真实平台回复及回读。证据明确标记 `operator_replay_preserving_bot_identity`，不能称为新增真实成员自动入站验收；首轮真实成员无需 @ 的证据保留在历史报告。

本轮共享的是操作员按当前用户授权发布的测试事实；没有冒充机器人自行授权，更没有重开已完成任务的真实人类消息。

## 预算与重建规则

`contextBytes` 是 UTF-8 序列化字节，包含系统说明、模型参数、schema、工具定义、历史和思考内容；它不是供应商 tokenizer 的 token 限额。API 在每次 HTTP 请求前、每个工具之前和最终结果边界检查。原生 CLI 根据其暴露的协议（包括原生说明/工具）检查启动、工具、回执、刷新/补充输入及完成边界；提供方不暴露的内部状态无法精确核算。

原生 CLI 实测首轮可观测协议约 14 万字节，原 64000 配额无法容纳，因此新范围默认改为 256000；已有显式配置保持不变。64KB 负例确实触发 `context_budget_exceeded`，在 Worker 委派产生任何任务之前阻断，没有为通过验收绕开预算。

超限保留完整调用/回执、未读输入及效果事实；大工具结果全文保留在宿主，通过完整的状态/字节数/散列引用进入模型。操作员可分页读取 `model-tool-receipt/<id>`。预算挂起的 Worker 支持显式 `rebuild`：保持原任务和后端身份，不自动调度，等待新授权跟进。权限收窄/失效后的通用重建未补齐，C03 保持 not_run。

## 删除与恢复规则

`clear` 只清空记忆；`source.delete` 删除单个来源及受影响历史；`history.delete` 删除该范围受管历史正文。动作先禁止使用及迟到写回，再排空关联模型/工具/进程，删除原生和 API 协议、附件与作业文件，清理记录/审计/出箱和分页缓存，重建 FTS，执行 SQLite checkpoint/VACUUM 和回读。任何失败继续 processing 并持久重试，不提前显示成功。

原生删除调用官方 `thread/delete`，并验证原线程不可读、已知 rollout 路径不存在。[Codex app-server 契约](https://learn.chatgpt.com/docs/app-server)。本轮最终回读：本地原生验收 6 个线程、原生负例 1 个、飞书原生 8 个、首轮 API 10 个、最终 API 12 个受管会话均有完成回执；这里是每套隔离实例的会话数，不是 Worker 数。API 删除只证明 AgentHub 本地存储清理，不证明服务商已删。

任务/交付最小信封、效果标识和状态仍保留，已发送/不确定的交付不重放；旧上下文不能凭旧触发器恢复任务。单一来源撤回时，仍有独立合法证据的事实保留，联合依赖失效。备份恢复前重放最新删除账本，后续发现的会话归属也写入外部账本。

外部群消息、服务商留存、用户工作目录和验收归档不纳入受管正文物理删除；备份原件按保留策略处理，本轮验证的是恢复屏障。自动保留周期治理未实现。换到不同 stateDir 时，旧附件绝对路径需要离线映射核对，不能假称自动可移植清理。

## 自行 review 发现与修复

1. **原生删除幂等回读**：删除成功后原生服务返回 `thread not loaded`，重复删除返回 `no rollout found`。旧判断会让已完成删除一直 processing。现在只接受已知不存在回执，其他错误仍挂起，并有真实重试和回归证据。
2. **删除破坏调度结构**：首轮 API 验收清理了 Thread 的必需空数组，下一次 tick 访问 `pending.length` 异常。修复为保留最小结构信封；补测删除 → 连续调度 → 重启 → 新授权输入，旧状态也可重新规范化。
3. **飞书分页缓存遗漏**：重启后的字节扫描发现 `feishu/<trigger>/message` 缓存仍含正文。修复为按资源语法和完整 ID 边界追踪依赖；补测旧“完成”回执的修复、迟到缓存及相似 ID 不误删。最终真实状态文件扫描无私有测试标记。
4. **管理页陈旧正文**：截图复核发现删除成功后原查询结果仍显示。删除成功即清空本页结果，查询版本屏障阻止迟到响应重新渲染；进度完成后状态文字同步更新。

验收脚本也修复了两个独立问题：不能以任意一条 ack + active=0 代替完整交付；需要同时等待预期汇总和外部出箱结算。API 第 2 轮曾因此提前关闭正在发送的回复。完整平台回读确认汇总尚未出现后，以原稳定投递 UUID 重试，并撤下未开始的重复汇总；原四项任务未重跑。相应失败与对账文件保留，没有把错误记录覆盖成成功。

直接 API 探针中含糊的“SECOND/OFF”指令也改成明确的字面输出及 schema 验收；保留早期失败，不把测试提示歧义归因于后端伪实现。最终同时验证思考开启、关闭和空 `reasoning_content` 的合法传递。

## DeepSeek 一致性与未关闭项

本轮未改动 vendored DeepSeek 核心；逐文件与开工基线比较，见 `implementation-fingerprint.json`。宿主扩展保持任务账本、授权及效果回执为真源；记忆不代替授权，Worker 只向 Router 报告，超限/删除不伪造完成、不重放已知效果。这说明扩展遵守既有行为契约，不声称论文原生提供了本轮记忆和清理能力。

`coverage.json` 保留逐项状态和证据来源。25 项 not_run 中既有未实现能力，也有尚未完成的组合验收：例如跨平台身份关联、平台编辑/退群自动传播、混合摘要依赖图、权限收窄后的通用重建，以及若干跨账号、在途撤回和迁移竞态。当前不满足“全部 76 项准出”；不能把 555 项回归等同为这些设计用例已通过。腾讯 Agent Memory / WeKnora 未启用，6 项提供方专项为 not_applicable。

正式部署保留原运行状态；本轮只在隔离实例运行、清理和重启。测试服务与浏览器预览在结束后关闭，最终状态另存 `final-status.json`。
