# AgentHub 后端交接 — superagent后端

交接日期：2026-11-07。接收会话：`superagent后端`，Local，`01a1b3b8-669b-7de3-a41f-c19e172c4fdf`。交出会话：`查找 Super Agent (2)`，`01a1af59-58fe-7382-afc8-c44d12bb583d`。

## 1. 接手结论与正确工作目录

**后端第一批主动管理能力已实现、review 并完成隔离验收。当前交付在未提交的工作树中，不能只看 HEAD 或直接 cherry-pick。正式飞书宿主没有切换到本版本。** 本次仅交接上下文和成果，不启动新的开发、部署或群消息测试。

| 对象 | 位置 / 状态 |
|---|---|
| 后端实际工作树 | `/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106` |
| 后端分支 | `codex/deepseek-parity-fixes-20261106` |
| 当前 HEAD | `eb0dabb4e0f65f48b175189df46b65319cf01421`；多轮实现仍为 tracked 修改及 untracked 文件 |
| 原始 checkout | `/Users/alex/Documents/ChatGPT/竞赛/agent-hub`，`main`；不是本轮后端交付目录 |
| 并行前端工作树 | `/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-frontend-20261106`，`codex/agenthub-frontend-20261106`；独立开发中 |
| 正式飞书部署 | `/Users/alex/Documents/ChatGPT/竞赛/deployments/agenthub-feishu-router-20261106`；上一阶段为 schema 5、端口 4337。交接不把历史进程信息当成当前健康证明 |
| 本批验收目录 | `/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107` |
| 本批实现前副本 | `/tmp/agenthub-proactive-baseline-20261107`；279 个当时的受跟踪/非忽略文件。临时目录仅作辅助，不能当长期唯一备份 |

本次交接前重新核对了分支、HEAD、工作树列表、交付记录和源码哈希：`implementation-final-hashes.json` 中 16 个文件、最终真实模型证据中 7 个关键源码文件均无漂移。没有因交接重新执行模型调用、平台测试或服务操作。

工作树已有多轮用户成果。不要 reset、clean、stash 覆盖或将未提交文件当临时垃圾清理；需要合并时先检查完整当前增量和前端分支差异。`implementation-final.diff` 只表示本批主动管理增量，不能替代整个后端工作树的全部前置实现。

## 2. 用户定位与不可丢失的约定

Router 是个人、企业或组织的多 Agent 管理人，Worker 是执行者。用户与 Router 对话，Worker 结果由 Router 汇总；应用适配器负责传输和平台身份，管理逻辑保持通用。一个管理范围可以包含多个群，但同一 Router 不意味着群历史和记忆自动互通。

用户重视 DeepSeek 理念和真实实现的一致性，尤其反对伪实现。必须区分固定核心一致、宿主扩展、回归测试、真实模型、真实平台、生产上线；不要用大量单测替代未完成的产品验收。工作方式要求先 review 再测试，修复后自行 review 和回归，尤其严查升级/回滚、重启、重复执行与不确定效果。

三类后端接入是既有产品方向：普通模型 API、供应商正式允许的订阅接入、CLI 接入。Router/各 Worker 有独立后端、模型、提示词和模型选项；不把不同供应商的思考参数强行等同。原生验收组合为 Terra medium Router、4 个 Sol high Worker。

用户此前允许我们自行发送飞书测试消息，但随后明确要求暂缓尚未闭环的平台验收。本交接不恢复该验收，也不隐含授权切换正式服务。历史会话里出现过 API 密钥，本文件不复制；后续应使用本地配置/环境变量按正常凭据机制接入，不从交接或对话传播明文密钥。

## 3. 已有能力与本批交付

前置实现已包含多后端配置、CLI 前台 Router、通用 Source/工具适配、持久管理范围、跨群任务许可、记忆证据和共享版本、任务迁移、完整上下文预算、统一历史正文删除、来源身份/群生命周期、派生记忆和权限收窄后的重建。这些在当前工作树中，不能在接手时重做或误删。

本批新增/完成：

| 能力 | 实际行为 |
|---|---|
| 职责规则 | 按实际 Router 管理范围和入口配置、版本化，off/observe/auto；全局关闭/观察仍是推断执行上限，旧全局规则任意 ID 保持兼容 |
| 消息聚合 | 范围、入口、话题、actor、授权强度、规则版本分组；短窗口、最大等待、持久批次；研判期间新消息进入下一批 |
| 介入决策 | accept / attach / ignore / clarify / stop；记录理由与规则依据；闲聊、引用、已被认领工作应不介入，推断事件不能停止任务或越权澄清 |
| 原任务续接 | attach 直接绑定现有 Ticket 和 Worker，保留后端及原生线程；旧单条 admission 路径也修复，不能再经一次自由 Router 回合重建相似任务 |
| 介入节奏 | 默认 1.5 秒聚合、5 秒最大等待、60 秒主动介入间隔；明确请求不受主动介入间隔限制 |
| 定时任务 | 单次、固定间隔、每日/每周、IANA 时区、起止时间、运行回执、独立执行/已有任务跟进、通知条件、暂停/恢复/立即运行/停止本次 |
| 管理入口 | `/router-proactive` 页面、HTTP API、MCP 与模型 `router_manage` 工具；与原有「Router 与记忆」互通 |

关键约束：

- 批次全部输入持续参与授权检查；研判读过的所有任务都进入上下文版本依赖，不只验证最后一条消息或最后一个任务。
- 任务续接须通过现有请求/结果权限及发起人/管理者限制。语义相似不构成续接依据，职责也不赋予对任意成员任务的修改权。
- 转交任务不携带旧 Router 的职责。来源撤回、改绑、规则变更或任务内容变化会阻止旧决定继续执行，并保留失败原因。
- 定时器是宿主内部来源，输入 `human:false`，不伪造真人或平台原始事件证明；依赖保存的明确管理者授权和当前权限。
- 暂停计划与停止本次运行分开。已完成或人工停止任务不能被定时事件重开；创建/编辑计划不自动修改既有 Worker 后端或环境。
- 触发身份稳定，离线积压合并为最近一次。同计划不重叠，Router 失败但 Worker 或工具效果未收束时仍要避让；跟踪可从实际 assignment/task-routing 恢复。
- 执行结束与消息交付分别记录；静默在宿主外发层强制执行，“有发现才通知”由 Router 根据证据判断。
- 时间条件不由 Eval 自己创建；Ticket/Assignment/效果回执/outbox 仍是事实来源。

## 4. 后端阅读地图

以下文件均位于后端实际工作树：

| 文件 | 接手时重点 |
|---|---|
| [router-proactive.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/router-proactive.ts) | 职责、设置、批次、候选任务、调度授权、定时运行、停止、结算；`proactiveCommandSchema` 是控制契约 |
| [schedule-time.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/schedule-time.ts) | 日历/间隔计算，`timingSchema`，DST gap 跳过、fold 只执行第一次，积压合并 |
| [router-ingress.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/router-ingress.ts) | 源准入、书面职责、动态策略、批次延迟、输入依赖、可信定时授权与 Engine 桥接 |
| [runtime.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/runtime.ts) | Router/批次/定时跟进串行化、真实模型调用、完整预算、上下文屏障、工具入口、Worker 收件箱和外发 |
| [worker-manager.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/worker-manager.ts) | assign/send、配置、停止、重建、稳定 requestId 与实际效果回执 |
| [router-scope.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/router-scope.ts) | 范围/入口、任务归属、当前权限、跨群 context/request/result、转交与版本 |
| [router-memory.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/router-memory.ts) | 来源证据、记忆版本、分享、派生事实、检索与 ContextManifest |
| [context-budget.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/context-budget.ts) | 序列化完整协议字节预算；不是 tokenizer token 上限 |
| [history-cleanup.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/history-cleanup.ts) | 正文清理、来源依赖、迟到写回/备份恢复屏障；职责/节奏是控制配置，计划正文随关联历史清理 |
| [scope-migration.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/scope-migration.ts) | 显式迁移、暂停验证、回退边界；新增持久记录类型已加入识别表 |
| [server.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/server.ts)、[mcp.ts](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/mcp.ts) | 操作员 API、网页、MCP 工具注册，继续沿用现有认证机制 |
| [router-proactive.ts 管理页](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/src/ui/router-proactive.ts) | 可用的第一批管理页面，不代表与并行前端最终 UI 已完成整合 |

核心仍在 `src/vendor/dsh-core`，15 个文件与 `docs/upstream-core-sha256.json` 一致。外围后端还包括 `src/backends/`、`src/backend-config.ts`、`src/agent-options.ts`、`src/codex.ts`、`src/source-plugins.ts`、`src/tool-connections.ts`、`src/connectors/`。来源协议和模型后端不是同一层。

新增 records 类型：`router-duty`、`router-proactive-settings`、`router-schedule`、`router-schedule-run`、`router-batch`、`router-input-set`、`router-intervention-clock`、`proactive-receipt`。调度作业包括 `router-batch`、`router-scheduled-followup` 和普通 `router`；由现有 SQLite 事务、jobs 和恢复流程持久化。

## 5. 与前端衔接的契约

- `GET /router-proactive/state?scopeId=...`：设置、职责、计划、最近运行与决策。运行含执行状态、交付状态及是否仍有工作；不可只看 completed 宣称业务目标完成。
- `POST /router-proactive` / MCP `router_manage`：`list`、`settings.put`、`duty.put`、`schedule.put`、`schedule.pause`、`schedule.resume`、`schedule.run`、`run.cancel`。
- 写操作使用稳定 `operationId`、当前 `expectedRevision`、`scopeId`；冲突先刷新，不能无脑换 ID 重做效果。
- 职责 entryIds 可多选。创建计划需要有效明确的管理者输入 `triggerId`、prompt、mode、timing；continue 需 `ticketId`。模型工具只能引用本轮授权输入。
- timing 支持 once/interval/daily/weekly、timezone、带时区的 startAt/endAt、intervalSeconds、当地 time、weekdays（0 是周日）。不是完整 RRULE/cron。
- 页面通过已有操作员会话访问数据。模型列表只呈现当前入口，操作员视图排除私有入口正文；不能借历史私有消息身份操作。
- 管理范围、入口与记忆仍使用 `/router-scopes`、`/router-management/catalog`、`/router-memory`、`/router-cleanup` 等既有接口。

持久配置与前端草稿须区分。新的前端若替换页面，应继续调用这些实际接口，不用本地假状态或演示动画代替真实执行事件。并行前端工作树尚未合并到本后端工作树，交接不代表两边已完成联调。

## 6. 已验证证据与复验方法

最新机器汇总：[completion.json](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/completion.json)。**39 个文件、615 项测试通过，无跳过；类型检查和浏览器操作通过。** 本次交接只复核记录与哈希，没有把历史测试说成刚重新跑过。

```sh
cd '/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106'
node --version
npm run typecheck
npm test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000
```

项目要求 Node 22.19+，验收使用 Node 26；不同目录的 shell 可能解析到 Node 20，先核对实际版本。全量复跑曾遇到既有 CLI 冷启动超过短时间上限，失败日志保留。飞书诊断 fixture 改用真实 shell 子进程输出相同多行 JSON/退出码，七个监听结果断言未削弱；最终命令限并行并给予本机进程启动合理上限。

| 证据 | 说明 |
|---|---|
| [check-final-5.log](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/check-final-5.log) | 最终 615/615；包含 API、核心、连接器、备份/迁移、记忆和清理回归 |
| [browser-result.json](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/browser-result.json) | 保存节奏、职责、计划、暂停、恢复、立即运行及实际状态读回；桌面/390px、键盘、无控制台错误 |
| [native-final/evidence.json](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/native-final/evidence.json) | 最终源码真实 Terra medium + 四 Sol high；批次、任务、线程、调用、定时回执、交付、7 个源码哈希 |
| [native-history-verification.json](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/native-final/native-history-verification.json) | 4 个 Router + 4 个 Worker 持久原生线程的模型/思考强度；2 次 ephemeral 研判仅有调用与配置回执，按设计不落原生历史 |
| [implementation-final.diff](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/implementation-final.diff) | 相对于本批开始前副本的增量，不是相对于 HEAD 的全部后端实现 |
| [implementation-final-hashes.json](/Users/alex/Documents/ChatGPT/竞赛/validation/router-proactive-20261107/implementation-final-hashes.json) | 16 个本批实现、测试和验收脚本的冻结哈希；交接时全部匹配 |

真实模型验收使用脚本注入的本地操作员消息，**不是飞书真人消息验收**。两条输入聚合后产生四个原任务，实际返回 2/4/6/8；再次核算 2+2 时保留四个任务和四个 Worker 原生线程，仅 Worker 2 再次激活，总共五次 Worker 调用。定时输入为 `human:false`，独立运行并交付 `SCHEDULED 12`；Worker 出箱进入内部 Router inbox，对外消息全部由 Router 生成。

可复现入口为 `examples/router-proactive-smoke.ts` 和 `examples/router-proactive-preview.ts`。真实模型脚本要求新的空验收目录，并会消耗真实模型额度，交接不自动重跑。原生 CLI 二进制位置为 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`，也可由 `AGENTHUB_CODEX` 指定；验收目录由 `AGENTHUB_SMOKE_DIR` 指定。避免复用正式 stateDir、现有测试状态目录或生产端口。

## 7. 未完成项、历史结果与下一步

1. **正式部署未更新。** 当前完成的是工作树实现和隔离验收。正式服务升级需先核实进程/cwd/端口/配置/schema/活动任务和真实效果，再制定备份、迁移、灰度与回退方案。不能只替换源码，也不能把旧备份恢复当作外部效果回滚。
2. **R14 平台生命周期订阅验收仍暂缓。** 最新前置生命周期矩阵为 76 项中 69 pass、1 blocked（R14）、6 not_applicable；平台缺少相应群生命周期事件订阅，用户选择先忽略。不要把本批 615 个回归写成原设计 76 项全部已闭环，也不要为验收去移除真实群成员。
3. **普通 API 的真实调用属于之前阶段。** 官方 DeepSeek API 的思考开关、工具调用、续接等已有历史验收；本批只重新跑了共享宿主/API 回归，没有重新使用聊天中的密钥。查前置报告并保留时间边界。
4. **外部记忆组件未启用。** 腾讯 Agent Memory / WeKnora 是参考，不是当前已部署依赖；对应 6 项 provider 验收不适用。当前受管正文删除不证明供应商端或外部平台已删除。
5. **不是全部 dots。** 已有显式职责、批次、续接、介入和持久定时来源；开放式长期目标管理、跨任务依赖/催办/升级、完整注意力策略、云端离线执行和全量 cron/RRULE 不应标为完成。

建议后续顺序（建议，不是本次自动执行的新任务）：先与前端对齐现有控制契约和真实状态展示，再明确长期任务跟进的状态机、触发条件、权限、失效/取消和通知节奏；单独安排正式环境灰度。若用户恢复 R14，再处理飞书应用订阅与真实生命周期验收。

## 8. 推荐阅读顺序

1. [本批使用与契约](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/ROUTER_PROACTIVE_2026-11-07.md)、[review 记录](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/ROUTER_PROACTIVE_REVIEW_2026-11-07.md)、[验收记录](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/ROUTER_PROACTIVE_ACCEPTANCE_2026-11-07.md)。
2. [跨群 Router / 记忆设计](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/design/ROUTER_SCOPE_MEMORY_V1_2026-11-06.md)、[生命周期最终验收](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/ROUTER_LIFECYCLE_ACCEPTANCE_2026-11-07.md)。生命周期报告新于下面的 API/删除补齐报告，应避免把旧 not_run 列表当成当前全部遗留项。
3. [普通 API、完整预算与正文删除](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/ROUTER_SCOPE_MEMORY_COMPLETION_2026-11-07.md)、[每 Agent 配置](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/AGENT_CAPABILITIES_2026-11-06.md)、[通用接入](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/INTEGRATIONS.md)。
4. [PARITY](/Users/alex/Documents/ChatGPT/竞赛/work/agenthub-parity-fixes-20261106/docs/PARITY.md)、DeepSeek [理念](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md) / [领域模型](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)，Codex [Scheduled tasks](https://learn.chatgpt.com/docs/automations) / dots [Tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory)。核心固定基线与最新上游是否变化应分别判断。

接收会话先读本文并核对工作树及交付记录即可；后续按用户的新任务推进。送达回执另存到本批 validation 目录，不把“已发消息”当作“对方已完成后续开发”。
