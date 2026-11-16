# Agent Hub 优化总待办与阶段计划

此文件是用户已授权逐步推进的**待办、现状映射与验收计划**，不是实现完成清单，也不是运行时任务数据库、授权记录或效果账本。本次清单工作线仅阅读源码与原始规划，未实施新功能、改动运行状态或新跑产品验收。任何未通过当前版本独立评审及实际页面/功能验收的条目均未完成。

## 1. 来源、版本与读取完整性

- 原始资料：Library **《Agent Hub 优化计划》**，文件名 `Agent_Hub_优化计划.docx`，规划版本 **1.0 / 2026-11-16**。
- 精确 Library 身份：`libfile_fde3_f-35ddfc0f93648191a007b4723cc861a8_3d9eab077e348191a380daa6e490bcf2`；`file_id=file_00000000ea6081fd8c7036fbdb6b90d2`；**`version_id=0`**；64,735 bytes；29 页；1,467 行。
- 本工作线逐窗读取：**1–250、251–500、501–750、751–1000、1001–1250、1251–1467**。各窗版本均为 0、无 warning；末窗 `has_more=false`、`next_read=null`。不是仅据搜索摘要或前 1,000 行编写。
- 原文 main 固定基线：`cfa1c8e49c978e6b1f8b141764dae7d0bbce1ed7`；文中开发快照 `64fa8a00afc179741ee1bd14bc5720d798f0cf25`、`b749a62266b3ba31dbe9784877da5c7a77a54e04` 均不等于最新交付证明。
- 初次源码检视快照：分支 `feat/worker-connector-acp-trace-20261116`，`57b29ce95c153ab1f0b4de8b94afc301eca5634a`。本次独立评审修订据集成负责人回读更新 CI 边界：前次远端交接 `7c117d3390bd05d34debf494b374af18fb32a8e4`，本次回读 **`be584f1f9223429e25d2bc7e1c2df917ee770a40`**。已阅读 [容器阻塞记录](../increments/CONTAINER_CI_BLOCKER.md)；CI 运行绑定的源 SHA 与后续文档 head 分开，不跨 SHA 宣称全绿。
- Muse 仅作为规划所引分析文档的自述依据；Dots 仅参考可观察交互。此工作线没有据此宣称掌握其私有实现，也未复制 Octop 的代码、提示词、测试或翻译实现。

原文条号 **01–49**、标题、混合优先级在下文完整保留；`Oxx` 是本清单引用别名，数字与原文一致。四项已开发能力另用 `F01–F04` 映射，避免误计成 49 条之外的新功能建议。

## 2. 当前顺序、状态与不能越过的门禁

状态词：**实现待验收**＝分支已有增量和局部证据，但尚未满足本清单最终门禁；**基础待补**＝源码存在复用基础，不代表原文建议全覆盖；**待实施**＝建议进入队列，尚未实现；**授权阻塞**＝相关真实服务、设备或外部影响缺少具体授权/凭据。可同时存在多种状态。下面无任何功能项标为“全部完成”。

| 门禁 | 当前状态与最先动作 | 必须留下的退出证据 |
| --- | --- | --- |
| G00 · PR #10 CI | **普通 CI 三 job 已成功；container acceptance 仍 blocked，整体未绿**。[PR #10](https://github.com/pythc/agent-hub/pull/10) 的常规 [run 43876934064](https://github.com/pythc/agent-hub/actions/runs/43876934064) 在 `ca6cbcfe699d3d0ec28116da039e5bebef6b752d` 通过三平台/Node job；[容器 run 43876933980](https://github.com/pythc/agent-hub/actions/runs/43876933980) 在真实 bwrap probe 失败。交接 head `7c117d3390bd05d34debf494b374af18fb32a8e4`，修订期间曾回读 `be584f1f9223429e25d2bc7e1c2df917ee770a40`。详见 [CONTAINER_CI_BLOCKER.md](../increments/CONTAINER_CI_BLOCKER.md)：拟议 AppArmor 边界变更未获明确批准，命令被自动审批拒绝，**没有该实现**。 | 保留三 job 已通过的特定 SHA 证据，后续代码变更重跑对应检查；容器需在获准边界内修复并在实际 runner 完成正/负向验收，未获准不得实施/绕过。G00 阻最终整体交付与相关容器执行，不阻已授权、无此依赖的云本地设计/开发/局部验收；不得删断言、跳过 probe 或降低 sandbox 掩盖失败。 |
| G01 · 基线与共享契约 | **待最终冻结**。复用现有类型先映射，不因逻辑对象命名而全量改库。 | 固定 SHA；状态词典；异步事件信封；连接证据/产物最小契约；文件所有权、版本兼容和回滚步骤。 |
| G02 · 每项独立评审 | **持续要求**。实现者局部自测后由独立审查线读当前差异和实际产物。 | 指向具体代码、版本、权限与竞态的评审记录；问题修复与复验，不能只写“另一个模型同意”。 |
| G03 · 真实页面与功能 | **持续要求**。云本地实际启动，当前 head 做正常、失败、恢复、权限及主题/窄屏/键盘/reduced-motion 验收。 | 运行命令、本地地址、实际页面截图/回执和应用日志；图示/构思稿不能充当截图。模拟和真实服务证据分栏。 |
| G04 · 集成交付 | **整体仍受容器门禁阻塞**。普通 CI 三 job 成功单独保留；每个模块通过不能替代集成通过。 | 当前集成 SHA 的 typecheck、build、Vitest、要求的容器检查及 E01–E11 对应结果；artifact checksum、远端 head 回读、剩余限制。 |
| G05 · 权限与外部测试 | **部分授权阻塞**。继续云本地开发、模拟和可逆验证；真实 IM 收发、收费推理、实际外发/发布、跨机执行需具体目标/身份和相应授权。 | 精确账号、目标会话、操作和费用边界；真实 provider ID/readback。此前“不要用 Mac / 不部署公网 / 不付费或真实消息测试 / 不合并 main”限制不能由“合总待办”自动解除。 |

`.github/workflows/ci.yml` 与 `.github/workflows/docker.yml` 是 CI 入口。已有 `docs/increments/ACCEPTANCE.json` 和 `DESIGN_AND_ACCEPTANCE.md` 记录 `b749a622…` 的 80 项新增测试及模拟浏览器证据，也记录完整 suite 与同环境 main 的同组 sandbox 失败；这些是**特定旧 SHA/环境证据**，不是 PR 最新 head 已过 CI。`6efa7d5` 文档保存不等于已合并或已公开部署。

## 3. 四项开发与 49 条建议的合并映射

| 当前能力 | 已有源码/接口及证据入口 | 对应规划条号 | 剩余工作、状态与验收边界 |
| --- | --- | --- | --- |
| F01 · Worker 模板包 | `src/worker-templates.ts`、`web/chat/worker-templates.tsx`、`worker-template-requests.ts`；`/api/worker-templates/*`；`tests/worker-templates.spec.ts`；`docs/increments/WORKER_TEMPLATES.md`。 | O02、O06、O30、O38、O39、O48、O49 | **实现待当前集成验收**。JSON-only 版本/digest、安全预览/安装/导出/删除、paused 创建、空工具/MCP grant、原请求恢复已存在；须验证其与契约/技能/验收读模型一致，升级/删除不改既有 Worker。模板声明始终不等于授权。 |
| F02 · 插件化连接器管理/诊断 | `src/source-plugins.ts`、`src/connector-management.ts`、插件 manifest；`web/chat/connector-management.tsx`；`/api/connectors/*` 复用 onboarding；`tests/connector-management.spec.ts`；`docs/increments/CONNECTORS.md`。 | O13–O18、O38、O44、O48、O49 | **实现待验收 + 真实收发授权阻塞**。Feishu 为已有 bundled 能力；Slack 安装其插件后出现，不冒称全平台接通。已有配置/可达/认证/目录诊断分层和 revision/attempt fencing；`realCall.status='not_tested'`。真实接收、回复、账号/资源权限回执未完成。 |
| F03 · ACP 出站适配 | `plugins/backend-acp/*`、`src/backends/plugin-contract.ts`、`plugin-process.ts`、`registry.ts`；`tests/acp-outbound.spec.ts`、`examples/acp-outbound-acceptance.ts`；`docs/increments/ACP.md`。 | O04、O18、O39、O40、O41、O49 | **有限能力实现待集成验收**。出站 v1、stdio、固定协议、session/permission/cancel/unknown fencing；原生 Codex 保留。标准 ACP 没有证明 managed/tools/history/contextBudget，适配器明确 false，不能任受管 Worker；不得为闭环放松准入。真实 Agent/账号/收费推理另授权，不做入站 ACP。 |
| F04 · 执行轨迹/恢复 | `src/execution-trace.ts`、`web/chat/execution-trace.tsx`；`/api/execution-trace/*`；既有 jobs/audit/records/outbox；`tests/execution-trace.spec.ts`、`tests/capability-increments.spec.ts`；`docs/increments/TRACE.md`。 | O03、O07–O12、O34、O38–O43、O49 | **基础闭环实现待扩展**。稳定 audit seq/补读、安全投影、inspect/history/resume/cancel 与未知效果禁止重放已存在。`deployment='unverified'` 不是部署验证；长期业务问题、统一 effect/恢复包、实时证据失效传播等仍待补。日志存在不等于任务已恢复。 |

以下每行都是尚需退出证据的待办。映射表示找到可复用的源码对象，不代表已经完成建议。审查与页面标准须在实施时补成固定 SHA 的可执行回归和真实运行证据。

依赖列分为 **硬**（此最小实现/局部验收实际需要的输入或能力）、**共**（共同冻结的最小契约，不等对方整个功能完成）、**后**（后续消费者/增强，不阻当前最小切片）。M1–M10 的范围与拆环顺序见 11.1；共契约不等于生产者已可运行，涉及真实读写的下游合入前仍须验证对应生产切片。未标为硬的引用不得转成隐性全量前置。

## 4. O01–O06：任务协作和执行控制（原文第 3 部分，4–6 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O01 · 任务契约可视化和版本化 · P1** | `goal-contract.ts`、`router-goals.ts`、`goal-replanning.ts`、`router-continuity.ts` 已有契约/DAG/来源；**基础待补**统一目标、非目标、输入、交付、验收、预算/截止视图及 revision 影响传播。 | 硬：既有 Goal/continuity、G01；共：M1；后：O45 历史增强、子任务树。 | 审：旧 run/审批/验收按依赖失效、不可变目标不被暗改。页：执行中改为“只分析/不要实现”，保留新旧差异，未发生写入停止，迟到结果归档不覆盖新版本。 |
| **O02 · 分派前说明责任和交付接口 · P0 到 P1** | `worker-manager.ts`、`worker-templates.ts`、`goal-contract.ts`、`work.ts` 有派工/所有权；**实现待验收/待补** TaskAssignment 的契约版本、输入/输出、许可操作、预算和 workspaceLease 一致呈现。 | 硬：F01、既有派工/one-hop；共：M1/M3/M8、O06 文件域；后：O01/O39 完整界面。 | 审：模板/同用户身份都不扩权，派工先验依赖/能力。页：前后端两 Worker 看到同一接口版本；未授权文件/工具被宿主拒绝并有阻塞解释。 |
| **O03 · 异步消息收件箱和迟到结果治理 · P1** | `store.ts`、`router-followups.ts`、`router-continuity.ts`、trace 有事件和补读基础；**基础待补** typed result/progress/blocked 及统一 causality/attempt/contractRevision 去重。 | 硬：既有 inbox/事务与契约版本来源；共：M1/M9、F04；后：O01 完整树、O42 评估。 | 审：事件接收与验收分离，事务唯一键含对象/版本。页：同结果重复、乱序、重连补发 10 次只推进一次；取消后的 completed 只归档，不外发。 |
| **O04 · 以能力和成本约束选择执行后端 · P0** | `backends/plugin-contract.ts`、`plugin-process.ts`、`registry.ts`、F03 保留 managed 五项门槛；**实现待验收/待补**能力分层与分派时成本约束。 | 硬：backend contract/F03；共：M3 预算接口；后：O43 成本聚合，不阻能力准入。 | 审：缺 resume/history/contextBudget 不伪造，不能静默换模型/身份。页：同契约覆盖取消、权限、超时、输出、错误；标准 ACP 显示不可托管，缺 resume 显示新任务而非续接。 |
| **O05 · 可解释并发和交互资源保留 · P1** | `runtime.ts`、`worker-pool.ts`、`work.ts` 有并发及 interactiveReserve；**基础待补**项目/后端/浏览器/工作区配额、排队原因与公平性测量。 | 硬：既有队列/interactiveReserve；共：M3；后：O40/O43 全量租约/预算视图。 | 审：不再造竞争调度器，控制消息不被队列饿死。页：后台额度满时仍可问状态/取消；测量交互 SLA，持续高优任务下低优任务仍有进展。 |
| **O06 · 工作区隔离和集成负责人 · P0** | `workspace.ts`、`project-code.ts`、`worker-manager.ts`、贡献规范和四线文件域已有基础；**基础待验收**共享 schema/lockfile 冲突检测与集成责任证据。 | 硬：既有 workspace/worktree、固定集成版本；共：M1/M8、O02 责任域；后：O32/O39 产品化；G00 仅最终交付门禁。 | 审：集成负责人是责任角色而非权限升级；共享文件单一责任人。页/流程：两 Worker 隔离实现，集成后按同一 SHA 构建、启动与业务验收；共享 schema 冲突阻交付。 |

## 5. O07–O12：持续运行和安全恢复（原文第 4 部分，6–9 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O07 · 执行效果验收投递分别展示 · P1** | `store.ts` 的 Run/jobs/outbox、`goal-verification.ts`、trace 已分部分状态；**基础待补**统一四状态字典/兼容映射，不能让单一 success 覆盖 unknown。 | 硬：既有 Run/jobs/outbox/验收事实、F04；共：M2；后：O08 完整账本。 | 审：持久事实推导 execution/effect/acceptance/delivery。页：执行成功但送达失败显示待送达；服务超时且效果未知显示待核实，不给盲重试。 |
| **O08 · 外部副作用账本与核实重试 · P1** | `store.ts` outbox、`tool-connections.ts` Receipt、`browser-receipt`、`workflow-actions.ts` 分散幂等/uncertain 已有；**基础待补**统一效果收据、远端 ID/授权版本/查询能力。 | 硬：既有 receipts/outbox、适配器查询/幂等；共：M2；后：O07 完整 UI；真实写入另 G05。 | 审：本地事务外执行远端再写回；无全局 exactly-once 承诺。页/故障：远端成功与本地写回间断网；核实后只补收据，无法核实保持 blocker，不再执行第二次。真实写入受 G05。 |
| **O09 · 跨小时的用户决策等待 · P1** | `approvals.ts` 当前 **120 秒内存 Promise**，启动使 pending 过期；**待实施**持久业务 DecisionRequest，短期执行许可保持分离。 | 硬：M1 最小版本引用、现有身份/回复关联与持久 Work；共：M4；后：O10 完整阻塞 UI。 | 审：答案绑 requestId/身份/目标版本/金额/接收者/过期，不复用旧 token。页：等待两小时并重启后可关联答案；目标变化使旧答案失效，过期显示原因和新问题。 |
| **O10 · 阻塞状态成为可操作的对象 · P1** | trace 的 problem/next/actions、`goal-contract.ts` 错误分类已有；**基础待补**统一 Blocker(owner/resource/resolution/retryPolicy/lastEffectState)。 | 硬：现有错误/效果事实、M2；共：M4；后：O09 问题对象、O18 完整凭据产品化。 | 审：区分 authRequired、限流 retryAfter、终止额度与效果未知，不无限重试。页：过期只引导正确账号重连；429 依策略等待，额度终止停止；未知发送不显示直接重发。 |
| **O11 · 恢复包和检查点 · P1** | `store.ts`、`work.ts`、`router-continuity.ts`、F04 保守恢复已有；**基础待补** RecoveryManifest 与 nextSafeAction、关键效果前后检查点。 | 硬：M1 版本、M2 可核实收据及当前本地身份；共：M5/M8；后：O12 完整备份、O41a 视图；不依赖跨机。 | 审：先 reconcile 后 resume/rebuild，检查点不含凭据，任务重执行与会话恢复分开。页/故障：工具前、远端完成后、验收前、投递前杀进程；目标/权限变更均重验，未知效果不复播。 |
| **O12 · 环境备份和可重建交付 · P1** | `RECOVERY_HANDOFF.md`、当前远端分支/lockfile、模块文档已有本次灾后恢复材料；**基础待补**产品化 manifest/checksum、备份目标与恢复演练。 | 硬：已授权远端副本、commit/lockfile/可校验产物；共：M5/M8；后：O11 检查点、O32 统一成果页。 | 审：路径存在不等于备份，未提交项标仅本地；不打包 secret/浏览器资料。页/流程：空目录从远端代码/产物重建、重新装依赖和测试；丢失旧环境的测试不得复用。 |

## 6. O13–O18：插件体系和 IM 接入（原文第 5 部分，9–11 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O13 · 插件提供统一接入向导 · P0** | F02 的 SourceRegistry/manifest/setup/help、onboarding 已实现方向；**实现待验收/待补**插件式草稿和完整三步低摩擦流程。Feishu/已安装 Slack 才是实际支持。 | 硬：F02/插件 manifest/onboarding；共：M4 安全错误；后：O18 统一 handle，不阻双平台向导。 | 审：插件文档不是权限，新实例 disabled，字段切换不残留 secret。页：同宿主 UI 接两平台、不靠专属核心页；缺字段准确定位、旧 revision 结果不能用于新配置。第二平台需实际安装插件。 |
| **O14 · 把连接成功拆成可核验证据 · P0** | F02 已有配置/可达/认证/目录记录与时间/revision/attempt；`realCall` 明确未测；**待补端到端回执 + 授权阻塞**。 | 硬：O13 可用实例/目标选择、现有 outbox；共：M2；后：O08 全量账本；真实收发硬需 G05。 | 审：HEAD/401 只说明可达，目录成功不说明收发。页：错 token 显示可达但认证失败；唯一标记消息具 providerAccepted、远端 ID、observed/readback/回调后才标真实端到端通过。 |
| **O15 · 平台能力统一呈现但分别授权 · P0 到 P1** | source/reply 与 `tool-connections.ts` MCP 分工保留，F02 聚合只读目录；**基础待补** PlatformConnection 能力矩阵与范围交集解释。 | 硬：现有 source/reply/MCP catalog 稳定引用；共：M10；后：O44 explain 完整 UI。 | 审：接收、回复、历史、文件、工具逐项授权；账号授权不是全能力。页：关历史仍接收新消息，撤文件权限使旧任务下载也拒绝；派工前看到缺失能力。 |
| **O16 · 原会话回复和多渠道受众隔离 · P0** | `sources.ts`、`router-scope.ts`、`delivery.ts`、outbox 有 actor/scope/目的地绑定；**基础待验收/待补**统一 DestinationBinding 和跨渠道可共享摘要选择。 | 硬：既有身份/原消息 ID/scope/outbox；共：M10 受众边界；后：O14 真实回执；真平台另 G05。 | 审：模型不可任改目的地，群私聊检索和发送前都过滤。页：私聊背景不进入群进度；原线程删/撤权后阻塞而非改发别群。真实 IM 目标受 G05。 |
| **O17 · 多账号和多工作区不串线 · P1** | source ID、连接 ID、scope 与实例游标已有基础；**基础待补**账号/组织/身份核验、配额/健康隔离与 UI 目标选择。 | 硬：实例身份探测、目的地范围绑定；共：M10；后：O16 完整跨渠道 UI；真双账号另 G05。 | 审：不以最近可用账号兜底，切账号使旧证据/审批失效。页：两账号同名频道可区分；A 失效不使用 B 写入；串实例回调拒绝。真实双账号受 G05。 |
| **O18 · 错误恢复和凭据引用产品化 · P1** | `connector-management.ts` 脱敏诊断、环境引用、`browser-vault.ts` origin/凭据边界已有；**基础待补**按账号/来源/用途/有效期统一 handle 与跨适配器错误协议。 | 硬：既有 vault/环境引用与错误适配器；共：M4/M2；后：O10 完整 blocker 和跨账号 handle 视图。 | 审：错误含 retryAfter/terminal/authRequired/effectUnknown，重试不扩权。页/日志：过期、限流、超时、撤权分别提示正确操作；UI/日志/任务文本/模板导出均不含凭据。 |

## 7. O19–O24：主动服务和长期任务（原文第 6 部分，11–14 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O19 · 先判断值得通知再决定怎么说 · P1** | `router-proactive.ts` 已有 always/findings/silent 与持久投递；**基础待补**统一 NotificationCandidate、事实版本/稳定主题键、新鲜度与语义去重。 | 硬：当前任务/来源事实版本、现有 outbox；共：M1/M2；后：O01/O08 全量产品界面。 | 审：发送前重查目标、是否已处理和已通知事实版本。页：PR 已合并旧候选不再提醒；同事实换措辞不重复；新风险扩大可再提醒并解释增量。 |
| **O20 · 轻量承诺和复杂目标分层 · P1** | Work、`router-proactive.ts` 计划、Goal 已有；**基础待补** Reminder/Commitment/Goal 兼容读模型和无重复升级。 | 硬：既有 Work/计划/Goal 与来源；共：M1；后：O21 四层 UI、O45 完整历史。 | 审：共享 owner/scope/stopCondition；假设性闲聊仅候选不自动承诺。页：一次提醒最少字段；升级只有一个有效链，撤销使提醒与升级目标一起停止。 |
| **O21 · 计划触发执行投递四层可见 · P1** | `router-proactive.ts` ScheduledRun 已分执行/投递；`schedule-time.ts` 有 IANA/DST；**基础待补** due/queued/started 读模型和明确 misfire 策略。 | 硬：现有 ScheduledRun/schedule-time/outbox；共：M2/M3；后：O19 通知候选增强、O40 全量租约。 | 审：执行前重验计划 revision，补跑共用锁/幂等。页：DST 和停机积累十次触发遵守 skip/coalesce/有限补跑；暂停只停未来，取消单轮不删以后计划。 |
| **O22 · 事件订阅先试运行再启用 · P1** | `webhooks.ts`、`webhook-http.ts` 有 inbox、签名、去重、dry-run；**基础待验收/待补** disabled→dry_run→active 全流程及宿主副作用硬禁。 | 硬：现有 webhook inbox/签名/绑定、宿主副作用限制；共：M10；后：O44 解释界面。 | 审：不能仅提示词禁止执行，样本为不可信输入。页：重放不双触发，dry-run 命令型恶意文本不发消息/改资源；变更绑定后旧事件拒绝。 |
| **O23 · 轮询透明与回调丢失补偿 · P1** | proactive/webhook/连接健康有部分检查事实；**基础待补** lastAttempt/lastSuccess/coverage/nextEligible 与回调/核对同 completionEventId。 | 硬：可核对任务状态/连接健康与持久去重；共：M1/M2/M9；后：O19 完整候选界面。 | 审：核对只补状态和通知，不因缺回调重启任务；部分分页不算全量。页：丢回调后补一次通知；检查失败显示覆盖未知，回调恢复不双跑/双发。 |
| **O24 · 安静时间和任务生命周期 · P1** | 现有计划暂停与条件偏好可复用；**待补**渠道/主题/重要级/时区 quiet hours、snooze、digest、到期/预算和清理视图。 | 硬：通知候选最小生产切片、现有计划暂停；共：M1/M3；后：O27 偏好界面、O43 聚合费用。 | 审：一次忽略不是永久拒绝，但明确结束不复活。页：静默期普通消息进摘要；仅授权紧急规则例外；结束监控后候选和队列都不外发。 |

## 8. O25–O31：记忆和可复用方法（原文第 7 部分，14–16 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O25 · 记忆分层和来源可解释 · P1** | `router-memory.ts`、`agent-memory.ts`、`memory-policy.ts`、`web/chat/memory.tsx` 有来源/版本/scope/推断；**基础待补**偏好/事实/项目决定/方法读模型及解释。 | 硬：既有记忆来源/版本/权限；共：M6；后：O45 决定历史链接。 | 审：来源不可见则派生摘要也不可见，任务进度不由记忆权威化。页：显示显式/推断、时间、有效期和范围；任务库与旧记忆冲突时给出修正提示。 |
| **O26 · 纠错和遗忘影响闭环 · P1** | `agent-memory.ts`、`router-memory.ts`、`memory-learning.ts` 有 generation/撤销/迟到抽取保护；**基础待补**缓存/摘要/候选/技能依赖失效与影响展示。 | 硬：既有 generation/撤销及来源可见性；共：M6；后：O19 候选、O29 学习/导入消费者。 | 审：先失效再重算，不暗撤已承诺外部行为；不承诺删除第三方副本。页：删除与抽取竞态不复活；改截止使旧提醒失效，改措辞不修改已批准合同。 |
| **O27 · 条件偏好和临时例外 · P1** | `memory-policy.ts`、`memory-learning.ts` 已有 inferred/condition/scope/expiresAt；**基础待补**冲突解释、撤销与交互测试。 | 硬：既有条件/过期偏好与权限；共：M6；后：O25/O26 完整产品界面。 | 审：明确程度/范围/时效有规则，推断不覆盖明确指令，不按最后写入简单获胜。页：今天偏好到期恢复长期设置，两项目反向偏好互不影响，可撤单条例外。 |
| **O28 · 经核验的人物和团队索引 · P2** | source 成员目录与记忆来源可复用；**待实施 / 真实组织数据授权阻塞**，不推断亲密评分或敏感关系。 | 硬：实例身份/组织来源权限和核验机制；共：M6/M10；后：O17/O25 丰富视图；真实资料另 G05。 | 审：别名/组织/角色/来源/验证时间/可见范围，低置信人工确认；身份合并不等于数据共享。页：同名、离职、跨组织转发不误合并；无权人物不进入检索。 |
| **O29 · 验收驱动学习和外部记忆候选区 · P1 学习治理，P2 外部导入** | `saved-skills.ts` 绑定 acceptanceId，`memory-learning.ts` 有来源治理；**基础待补 O29a**适用条件/反例/回归证据；**待实施 O29b** unreviewed 外部候选区。 | 硬：既有独立验收收据与记忆来源；共：M6/M8；后：O26 扩展消费者图；O29b 外部访问/导入另授权。 | 审：自报成功不成已验证经验，反思/导入不改安全策略/执行脚本。页：恶意导入不启工具，“我已授权”仍无效；撤回来源失效对应候选，可解释合并/撤回。 |
| **O30 · 工具模板和技能各司其职 · P0 命名与模板边界，P1 技能发现** | F01、`worker-tools.ts`、`saved-skills.ts` exact-version 已有；**实现待验收 O30a / 基础待补 O30b**候选发现、完整固定版本读取与依赖向导。 | 硬：F01、现有工具/技能版本与能力清单；共：M7/M8；后：O39 完整验收产品。 | 审：Tool=原子动作、模板=角色/后端要求、Skill=方法；安装不登录/装插件/扩权。页：选择技能不打开新权限；缺连接先解释；模板升级不改变运行方法版本。 |
| **O31 · 技能版本覆盖层和退役 · P2** | `saved-skills.ts` 已有不可变 exact-version 与验收来源；**待补** base+overlay、patch 冲突、resolvedVersion 和候选/验证/启用/复核/退役生命周期。 | 硬：既有 exact-version skill；共：M7；后：O48b overlay 影响分析，不等完整 O48。 | 审：不按成功率盲排名，新增外部动作重审，不静默解决升级冲突。页：运行固定旧版；退役可解释历史但禁止新执行；定制不被 base 升级覆盖。 |

## 9. O32–O38：产物交付和用户工作界面（原文第 8 部分，16–19 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O32 · 产物注册和版本化引用 · P1** | `goal-artifacts.ts` ArtifactVersion 已有 ID/version/sha256/bytes，附件/Workspace Views 可复用；**基础待补**统一类型、visibility/retention/发布状态及成果页。 | 硬：现有文件/任务 ID、对象权限；共：M8；后：O39 验收回填、O33 发布。 | 审：猜到 ID 不获访问，固定版本引用独立于卡片/名称。页：删除进度卡不删文件，改名不断引用，旧版可打开，越权下载被拒绝。 |
| **O33 · 生成验收和对外发布分离 · P1** | outbox、`goal-verification.ts`、目标投递已有；**基础待补**草稿/已验收/可交付/已发布/撤回和版本化发布收据。 | 硬：M8 最小不可变产物/权限、现有 outbox/范围；共：M2/M10；后：O32 成果页；真实外发另 G05。 | 审：绑定 artifactVersion/destination/audience/权限版本；尊重既有自动交付授权，不强加无必要点击。页：预览无公开链接，发送失败非已送达；同版重试不重复发布，外发版本可追溯。 |
| **O34 · 临时进度卡和持久成果页 · P1** | `execution-activity.ts`、F04 有持久状态、commit/test/deploy 分开；**基础待补** ProgressSnapshot 差异汇报、observedAt、成果页当前证据链接。 | 硬：现有持久活动/证据读取、F04；共：M9/M8；后：O42 完整时间线/评估。 | 审：无虚构百分比，不混用写完/push/部署/验收。页：仅代码完成不显示验收通过；新 SHA 对应新测试/部署，无变化不重复长汇报，旧证据显示最后确认时间。 |
| **O35 · 围绕具体版本继续讨论 · P1** | 附件、chat/context 与 knowledge revision 可复用；**基础待补** artifactId/version/selection/sourceSnapshot 的结构化讨论入口。 | 硬：M8 可访问固定产物版本、会话绑定和当前权限；共：M10；后：O32 统一成果页、O44 explain。 | 审：正文不扩大权限，读取旧快照仍重验当前权限；讨论不等于批准发布。页：两版本并行评论不串写；撤权后旧快照不可读；修改生成新版本且不自动外发。 |
| **O36 · 删除撤回和保留期解释 · P2** | 记忆/history 清理与产物 bytes 清理有局部基础；**待补**卡片/单版/全部/链接/恢复期影响预览。 | 硬：产物版本/引用及实际发布记录；共：M8；后：O33 更丰富发布 UI、存储生命周期扩展。 | 审：删除与外链撤回分开，保留/缓存/第三方副本限制真实说明。页：删单版不坏其他版本，关链接按承诺失效，恢复不扩权，危险操作按既有规则确认。 |
| **O37 · 可关闭的工作收件箱 · P2** | Work/Goal/计划/产物存在；**待实施**从 DecisionRequest、NotificationCandidate 等投影，禁止先做空壳/新任务权威。 | 硬：实际持久问题/候选/任务/产物生产切片；共：M1/M8；后：O24 丰富主题偏好；不得先造空面板。 | 审：阅读仅已读，接受才转任务；关面板不取消既有委托。页：聊天/收件箱状态一致，延后只在新时点/事实提醒，忽略建议不被反复复活。 |
| **O38 · 一致的界面风格和有意义动效 · P0 到 P1** | 现有 theme/typography/navigation 和四项 CSS 复用；**实现待当前版本验收 / 持续要求**。 | 硬：既有设计 token、可用状态 API 与 G03；共：M9 稳定 ID；后：各新功能逐步接入。 | 审：动效仅表达真实分派、阻塞、验收、产物切换；不掩失败/移焦。页：light/dark/narrow、键盘/读屏、reduced-motion；断线/刷新不重播成功，关闭动画状态仍全可辨。 |

## 10. O39–O49：验收治理和扩展边界（原文第 9 部分，19–23 页）

| 条号、原文标题、优先级 | 已有映射与差距 / 当前状态 | 依赖类型：硬 / 共 / 后 | 独立审查与实际页面/功能验收 |
| --- | --- | --- | --- |
| **O39 · 独立验收和局部返工 · P0** | `goal-verification.ts` VerificationRound/checks/snapshot、`goal-replanning.ts` 局部预算已有；**基础待补**契约/输入/产物摘要/集成 SHA 与 UI 证据统一。 | 硬：既有契约/验收器和 M8 可读不可变证据；共：M1/M8、O06 集成责任；后：O32 完整注册 UI、O49 扩展。 | 审：程序校验优先，语义独立评审不能替代真实验证；上游变化使下游 stale。页：模块变更使旧综合验收过期，接口冲突仅返工关联节点，每个通过项可复现/查证。 |
| **O40 · 资源租约和明确的取消语义 · P1** | `browser-manager.ts`、`work.ts`、workspace、task ownership 有串行/接管/取消；**基础待补**统一 ResourceKey/lease/fencing 及用户状态。 | 硬：现有 owner/lease/取消控制；共：M3/M2；后：O05/O43 配额/预算产品化。 | 审：租约不等于远端幂等，取消不自动撤回效果；读取可独立并行。页：旧 lease 不能覆新提交，取消/完成竞态确定；请求取消/已停/部分生效分开，接管后恢复先重读。 |
| **O41 · 环境注册和显式迁移 · P1 当前环境能力视图；P2 跨机器执行单独决策** | 部署/工作区/sandbox/浏览器身份有局部配置；**待补 O41a**当前环境绑定/探测/可选性；**授权阻塞 O41b**跨机。 | O41a 硬：既有当前云环境/工作区探测；共：M5/M3；后：O11/O12 丰富恢复；O41b 另硬需设备/传输/撤销设计与授权。 | 审：已有同机委派不代表跨机；已取消 delegated-coordinator 不默认恢复。页：缺登录态不能选发布环境，断开不切权限更大机器；明确迁移方案摘要不一致即停止。未经具体批准不碰 Mac/其他设备。 |
| **O42 · 可解释时间线和质量评估 · P1** | F04 已从 audit 持久投影 seq/cursor/安全状态与证据；**实现待验收/待补**契约 revision、visibility、故障样本与质量分层统计。 | 硬：F04 事件/游标、现有权限过滤；共：M9/M1；后：O34 卡片/质量指标、O44 explain。 | 审：只公开可见事实与收据，屏蔽 raw prompt/tool output/秘密/隐藏推理。页：刷新/断线不漏不重，越权日志不可见；每个完成声明有当前证据，故障样本可在测试环境复现。 |
| **O43 · 成本预算和资源消耗可解释 · P1** | `context-budget.ts`、`usage-ledger.ts`、work/Goal 预算与计量已有；**基础待补**跨任务/模型/工具/轮询聚合、预留/硬限制/估计来源。 | 硬：既有 usage/context/work 计量与硬限制；共：M3/M1；后：O05 队列产品化，不阻初始聚合。 | 审：无价格不得伪造精确费用，不换后端绕硬限制。页：轮询到上限无新调用，在途完成有收据；不足时可缩范围保留产物，预算前后可解释。收费验证受 G05。 |
| **O44 · 权限交集和最小修复解释 · P1** | `router-scope.ts`、工具/浏览器/source 校验已有执行权威；**基础待补**脱敏 explain 接口与分层最小修复。 | 硬：当前宿主权限评估器与实例身份；共：M10；后：O15/O17 能力矩阵和账号 UI。 | 审：解释不是授权且不泄露不可见资源名，动作时重新求交集。页：缺 scope/成员准入指向不同修复；说明后立刻撤权仍拒绝，伪造 explain 结果不能通行。 |
| **O45 · 需求决定和承诺的可见历史 · P1** | `router-continuity.ts` 已有 requirement/decision/commitment、supersedes/sourceIds 与显式人类来源检查；**基础待补**统一当前结论/历史/影响界面。 | 硬：既有 continuity/sourceIds/身份；共：M1；后：O01 统一契约界面，不阻当前历史读模型。 | 审：“可以考虑”不变批准，不从摘要倒推授权。页：矛盾决定展示取代关系和原话，旧摘要不能覆盖后来明确指令；提议/确认/实际执行分别标注。 |
| **O46 · 辅助模型路由的影子评估 · P2** | `decision.ts`、`decision-config.ts` 已有 Jev/API/本地辅助及 off/shadow/advisory；**基础待补**脱敏评估集与策略版本对照。 | 硬：现有 off/shadow/advisory 与脱敏评估集；共：M3/M9；后：O42/O43 丰富统计；收费另授权。 | 审：权限/副作用仍宿主约束，shadow 不悄悄升自主。页/实验：同回归集比 off/shadow 的误分、延迟、返工/成本；复杂任务误分不外发，关闭立即回稳定路径。收费实验受 G05。 |
| **O47 · 动作预演和范围差异检查 · P1** | webhook dry-run、工具 schema 与现有授权可复用；**待补**可选 planOperation、目标集合/actionDigest 与执行前版本复验。 | 硬：稳定只读接口、当前权限/版本与效果收据最小能力；共：M2/M10；后：O08/O44 完整产品。 | 审：预演和执行同目标解析，读取亦需权限，不能可靠预演明确 unsupported。页：预演零消息/写入；实际目标数量/版本变更超范围即重新确认，不伪造精确影响清单。 |
| **O48 · 插件和技能升级影响分析 · P1 到 P2** | 插件 digest 固定、`plugin-market.ts` 生命周期与 exact-version skills 已有；**基础待补 O48a**能力/证据定向失效，**后续 O48b**技能 overlay 影响图。 | O48a 硬：已固定插件/技能版本及配置证据；共：M7；O48b 硬：overlay 最小格式/解析器；后：O31 完整生命周期。 | 审：新增权限不继承旧 grant，运行固定旧版或明确停止迁移，兼容声明不替代真实验证。页：新增发送不自动启用；目录 schema 变更仅相关证据失效，旧任务可追溯旧版本。 |
| **O49 · 可重复的故障注入验收集 · P0 测试骨架，P1 扩展覆盖** | 既有 Vitest、四项新增测试、HTTP/浏览器/ACP fixture 与 CI 已有；**基础待补/当前 G00 阻塞**统一时钟/效果与 UI 三方断言、关键竞态每次 CI。 | 硬：既有测试/CI/固定集成版本；共：M1/M2/M3/M9 按切片接入；后：O08 等真实生产者扩展；真实平台另 G05。 | 审：远端成功丢响应、重复/旧事件、撤权、lease 过期、杀进程、环境丢失均有可控注入；清理仅本次资源。页/CI：同 SHA DB事实/远端效果/显示一致，关键失败阻合并；模拟不能充当真实 IM 收发回执。 |

## 11. 阶段与最小依赖顺序

沿用原文阶段意图，不把阶段退出项当成所有后续开发的全局串行锁。**G00 仍优先处理；容器边界审批和 B-IM 的授权阻塞各有独立范围。** 无具体容器执行/真实 IM 依赖的云本地代码、独立评审与局部验收可继续；不能据此绕过最终集成交付门禁。估时在最小接口冻结、基线测量后确定，不虚构工期或百分比。

### 11.1 依赖分类与循环拆解

“硬”指某一实际必要的生产切片或既有可用能力；“共”先联合评审小契约；“后”是消费者/增强。**M1–M10 是待冻结的最小契约及可先行切片，不是已经实现的新服务/数据库表。** 优先复用既有类型/API；涉及读写的生产切片实际测试后，消费者才能据其完成验收。文档签字不能替代运行证明。

| 共设计组 | 最小共同契约 | 可先行切片与明确顺序 | 非硬前置 / 后续集成 |
| --- | --- | --- | --- |
| **M1：O01 ↔ O45** | task/goal revision、来源/身份、supersedes、有效状态。 | O01.1 从现有 Goal 读单任务版本；O45.1 从 continuity 读当前决定/原话，可并行后接修订影响。 | 契约视图不等完整历史 UI；历史读模型不等契约树/编辑器。 |
| **M2：O07 ↔ O08** | 四状态、receipt ID/目标/授权版本/幂等键、confirmed/failed/unknown。 | O07.1 先投影现有 Run/outbox/tool receipts；O08.1 为一个已有适配器规范化收据/只读核实，再定向替换该投影来源。 | 四状态页不等全工具账本；账本不等完整 UI；真实消息核实另 B-IM。 |
| **M3：O05 ↔ O40/O43** | resourceKey、owner/epoch、现有队列/lease 引用、预算类别/硬上限、used/reserved 与控制状态。 | O05.1 先只读测队列/交互保留；O43.1 聚合现有 usage/context 限制；O40.1 测已有 lease 取消/完成 fencing。三片共享字段，可并行后集成。 | 初始统计不等新配额算法；取消不等成本页；配额变更另评审且保留原执行权威。 |
| **M4：O10 ↔ O18，O09 后接** | 脱敏 code/retryAfter/terminal/authRequired/effectUnknown、可选 decisionRequestRef。 | O18.1 先适配现有安全错误/credential 引用；O10.1 读 envelope 显示最小 blocker。O09 落地后再接问题引用。 | 错误适配不等完整 blocker；blocker 不等统一 vault/账号页；持久问题不等阻塞界面。 |
| **M5：O11 ↔ O12/O41a** | 当前本地环境/工作区引用、observedAt、commit/lock/产物摘要、确认收据/nextSafeAction。 | O12.1 先核远端副本并列缺口；O41a.1 只读探测当前云环境；O11.1 消费两类最小引用及 M2 事实做恢复包，再做 O12.2 空目录演练。 | 备份不等恢复器；环境可见性不等迁移；恢复不等完整环境注册或跨机 O41b。 |
| **M6：O26 ↔ O29** | source/fact revision、generation、派生物引用与失效原因。 | O26.1 先覆盖已有主记录/索引/摘要失效；O29a.1 在现有 acceptance 来源上新增候选依赖，注册候选后再纳入失效传播。 | 遗忘不等学习/外部导入；学习不等所有消费者图；O29b 可后接且不扩权。 |
| **M7：O31 ↔ O48** | exact/base/resolved version、digest、状态、能力差异、可选 overlay 格式。 | O48a.1 先处理既有插件/配置证据失效；O31.1 在既有 skill-version 做最小退役/版本固定；overlay 格式/解析器评审实测后做 O48b。 | 插件影响不等 overlay；退役不等全依赖图；O48b 只硬需最小 overlay 能力，不等完整 O31。 |
| **M8：O32 ↔ O39，O02/O06 共用** | ResultEnvelope 的 task/contract/input 引用、artifact ID/version/checksum、可选 acceptanceRef、集成 SHA。 | O32.1 先注册可访问的不可变草稿；O39.1 读真实 bytes/checksum 验收后回填。O06.1 worktree/文件域可先行，O02.1 共用最小交付接口。 | 注册不等验收通过；验收不等成果页/发布；文件域隔离不等产物产品化。 |
| **M9：O34 ↔ O42** | seq/event ID、revision、observedAt、visibility、evidenceRefs、安全状态。 | O42.1 复用 F04 audit/cursor 做安全补读；O34.1 消费同一最小快照显示变化/阻塞；再扩展证据失效/质量统计。 | 时间线不等卡片；卡片不等评估平台/完整成果页；无部署证据仍 unverified。 |
| **M10：O15 ↔ O44，O16/O17 共用** | 实例/账号/能力/范围引用、宿主 allow/deny、脱敏拒绝层。 | O15.1 聚合既有 source/reply/MCP；O44.1 解释当前权限结果；目的地/账号复用现有绑定，两片可并行。 | 矩阵不是授权器，explain 不签 grant；页面不互等，运行时仍重验交集。 |

其他回指同样降为共设计/后续：O04 能力准入不等 O43 成本产品；O13 向导不等 O18 全量凭据产品；O21 计划四层不等 O19 完整候选；O25 来源展示不等 O45 历史；O49 骨架从现有 fixtures 开始，不等 O08 等未来全量实现。新增消费者时增对应集成回归，不一次阻塞全部切片。

### 11.2 阶段门禁及可并行推进

| 阶段 | 应推进的条目与可并行范围 | 退出条件 / 尚需授权 |
| --- | --- | --- |
| S0 · CI 取证与最小接口 | 优先 G00；G01、O49a 骨架、O06.1 文件域与 M1–M10 可在现有权限内准备。 | 普通 CI 三 job 的成功证据单列；容器仍 B-CI，待边界批准/实际验收。最小接口和安全云本地工作不等待未获准边界修改，不宣称整体交付。 |
| **S1-L · 四项代码与云本地验收** | F01–F04；O02a/O04/O06/O13/O15a/O18 最小错误、O30a/O38a/O39/O49a；M2/M8/M9；O14/O16 先做不外发的本地协议/权限验证。 | 同 SHA 集成及本地实际页面、失败/恢复、主题/窄屏/键盘/减少动画和所需局部检查通过，可分别记“代码/本地验收通过”。不等于 S1 总完成，也不等于 container/真实 IM 通过。 |
| **S1-E · 真实 IM 与完整退出项** | O14/O16、E02、E08 真实平台部分；容器另 B-CI。 | **E02 保持 B-IM blocked**，具体账号/目标/外发授权和真实回执满足才退出。不以 mock 代替；不锁住独立 S2 云本地实现。S1 总完成需 S1-L 与适用真实服务/容器退出项全满足。 |
| S2 · 状态/决策/恢复闭环 | 按 11.3 先版本/四状态/效果/错误最小片，再持久问题/恢复，再增强调度/租约/预算与证据。 | 每片独立评审/实际页面/故障验收；隔夜问题不丢、unknown 不重做、旧版本/取消不复活、空目录可重建、满载纠正可用。**准入取决于已验证的具体最小能力，不依赖 S1-E/E02 或 O41b 完成**；整体门禁不因此关闭。 |
| S3 · 主动性与记忆一致性 | O19 最小候选先于通知消费者；O25/O26/O27、O29a/O30b/O48a 按 M6/M7 接入。 | 所需版本/效果/权限生产切片实际可用；已处理 PR、旧截止、撤销/关闭不误通知，丢回调只补一次。无需等 S2 所有界面增强。 |
| S4 · 产物与成果工作流 | O32.1/M8 可更早先行；本阶段补 O33/O34/O35，再 O36/O37、O31/O29b/O28/O46/O48b；O47 按可靠适配器分批接。 | 固定引用/权限、发布回执、技能升级/退役均独立验收，开关/迁移/回滚齐备。真实发布/资料导入按自己的 blocker，不阻无关本地片。 |
| S5 · 设备扩展独立决策 | O41b；恢复 delegated-coordinator/跨机多跳另起设计评审。 | 具体设备/动作授权前 blocked，明确收益/费用/身份/传输/撤销/网络，不默认用 Mac、共享登录态或无限递归。 |

### 11.3 S2 的实际先行顺序

1. **S2.0：最小引用与现有事实**。按需冻结 M1/M2/M4/M5/M8/M9/M10。O01.1/O45.1、O12.1/O41a.1、O32.1 可先做只读/草稿生产切片，不等完整产品化。
2. **S2.1：投影与生产对接**。O07.1 读已有事实；O08.1 选一已有适配器规范化收据/只读核实；O18.1/O10.1 对接安全错误/最小 blocker；O03.1 在已有 inbox 增版本/attempt 去重。局部实测后集成，不互等全量 UI。
3. **S2.2：持久业务问题**。O09 消费已有身份/回复关联、S2.0 契约版本和所需 inbox 最小能力，补存储/重启/过期/版本复验。O10 随后显示问题引用；不等全部 blocker/凭据界面，**不延长执行授权 TTL 来代替**。
4. **S2.3：恢复与重建**。O11.1 消费实测收据、当前本地身份、产物摘要和待决策引用，先 reconcile 再 resume/rebuild；O12.2 从远端清单空目录重建重测。O41a 只当前云环境可见，不引入跨机/多跳。
5. **S2.4：资源/质量增强**。O05.1/O40.1/O43.1 按 M3 在现有队列/lease/usage 上并行接入，先测再改配额；O39/O34/O42 按 M8/M9 加证据失效/差异快照；O15b/O17/O18 独立增强，真实账号保持相应 blocker。

这是切片依赖，不是 O 条目全量串行链。无真实发信/容器执行依赖的切片，即使 E02/B-CI blocked 也可独立完成代码/本地验收；按切片记录，不提前勾整个 O 条目/阶段。未获准容器边界修改仍禁止，云本地权限也不变成发布或 main 合并许可。

实施按运行时、连接器、前端、测试验收分包；共享类型/迁移/lockfile 单一负责人写入。局部验证后独立审查集成产物，主对话保持响应。本修订没有新建代理、AppArmor 策略或其他功能实现。

## 12. 每个条目的共同完成定义

一条建议只有下列项目全部满足，才能由“待办”改为“完成”；现有映射或计划本身不满足任何实现门禁。

- [ ] 明确所解决的用户场景、现有复用点、必要新增语义、范围和不可做事项；混合优先级子项分别记状态。
- [ ] 服务端 expectedRevision、身份/受众/任务权限、幂等与 unknown fencing；异步消息有稳定 eventId、source、发生/观察时间及业务对象引用。taskId、runId、assignment/attempt 引用仅在相应对象实际存在时携带；契约摘要、goalRevision、planRevision、ownerEpoch、dataRevision、binding/settingsRevision 分别保留真实语义，具体字段由 G01 冻结。旧记录未捕获则明确缺省，不伪造 ID/版本或合成通用 contractRevision；有副作用再带原收据 effectRef/幂等键，产物带版本与摘要。
- [ ] 本地事务存状态和 outbox、事务外做远端动作再落收据；没有跨系统原子性时明确 unknown 和 reconcile；不新建“执行任意动作”万能 API，不允许前端直接确认外部效果。
- [ ] 增量兼容读模型/安全默认值，先复用既有 records/关联；migration、feature flag、升级/中断/降级和回滚步骤齐全。回滚保留效果账本/投递收据，新旧通知路径共用业务去重键。
- [ ] 独立代码/风险评审完成并有修正证据；确定性检查先于语义验收，self-report 不作为完成证明。
- [ ] 当前集成 SHA 通过要求的 typecheck/build/Vitest/CI/容器检查；按相关 E01–E11 做真实云本地 UI/功能/故障恢复，截图是实际运行页面。
- [ ] light/dark/narrow、键盘/读屏焦点、loading/失败/reload、reduced-motion；任何动画都表达真实状态，无编造百分比、完成或送达。
- [ ] 所需真实服务/设备/账号/费用/目标授权已核实；缺少则精确记录 blocked，不把模拟或 UI 页面成功当真实服务通过。
- [ ] 远端 head、检查版本/环境、产物 checksum、启动命令/地址、截图/回执路径可追溯；未推送/未部署/未验收/真实效果未知分别如实标记。

两条闭环共同作为不变量：工作=`接受→契约→分派→执行→证据→独立验收→投递→收据`；通知=`候选→当前目标/授权→新鲜度→语义去重→渠道→投递→已通知版本`。一个 run 结束不代表任务完成，一次工具成功不代表用户收到；取消一边生效后另一边不能继续误提醒。

## 13. 原文端到端场景（第 12 部分，25–26 页）

| 原场景 | 关联条目 | 必须可观察的结果 / 当前状态 |
| --- | --- | --- |
| **E01 · 并行实现并集成** | O02/O06/O39/O49 | 两隔离 Worker、共享 schema 单人整合、同 SHA 构建/真实流程；**待最新 head 集成复验**。 |
| **E02 · 真实 IM 接入** | O13–O18/O08 | 授权会话唯一标记、providerAccepted→远端ID→observed，超时/重复/错线程不盲发；**具体账号/测试目标/外发授权阻塞**。 |
| **E03 · 中途改要求** | O01/O03/O40/O45 | “修复并提交”改“只分析”，未发生写入停止，旧报告归档，已发生效果不谎称撤回；**待验收**。 |
| **E04 · 隔夜决策和重启** | O09/O10/O11/O44 | 业务问题持久，隔夜答案检验目标/金额/接收人/权限，旧 token 不复用；**功能待补**。 |
| **E05 · 外部成功本地失联** | O07/O08/O11 | 远端成功后断网→unknown→查远端，只补收据/通知，无法确认阻塞；**模拟扩展待补，真实写入另授权**。 |
| **E06 · 事实变化和通知** | O19/O23/O24 | 合并 PR 使旧候选撤销；重新打开+新失败是新事件，非换措辞重复；**功能待补**。 |
| **E07 · 遗忘与异步抽取** | O25–O29 | generation 不匹配迟到抽取丢弃，派生摘要/提醒失效；不声称删第三方副本；**闭环待验收/补齐**。 |
| **E08 · 权限撤销和跨受众** | O15–O18/O40/O44 | 私聊背景群任务不可读；撤连接权限后旧计划/审批也不能动作；**基础待集成验收，真实平台另授权**。 |
| **E09 · 环境丢失** | O11/O12/O32/O41a | 空目录按远端代码/产物重建，依赖/构建/验收重跑；缺失项列清，不借旧测试；**本次恢复已有特定证据，产品化及最新 SHA 演练待补**。 |
| **E10 · 调度和取消竞态** | O03/O21/O23/O40/O49 | misfire 合并策略、暂停未来/取消本轮分离、取消完成竞态状态一致不双发；**基础待验收/扩展**。 |
| **E11 · 可访问性和窄屏** | O13/O09/O32/O38 | 键盘完成连接/答问/下载；减少动画仍清楚，窄屏优先 blocker/下一步；**四项有旧 SHA 记录，新页面/当前 SHA 持续验收**。 |

## 14. 指标基线与零容忍门槛（原文第 13 部分）

先测基线再设性能目标；本清单没有测量新的负载、时延或费用，不承诺固定毫秒数、吞吐或成本节约。

| 维度 | 待采集的可解释指标 | 采集前置 / 判定限制 |
| --- | --- | --- |
| 可信交付 | 当前证据覆盖率；已写/已测试/已部署/已验收误标次数；证据/SHA 不匹配次数。 | O07/O34/O39/O42；只统计当前可复验版本。 |
| 恢复能力 | 故障后恢复比例、重复副作用数、unknown 核实时间、空环境恢复演练通过率。 | O08/O11/O12/O49；无法核实应保留 blocked，不能当失败后自动再做。 |
| 协作效率 | 满载交互排队、解除阻塞到重评时间、局部返工比例、取消确认时间。 | O05/O10/O39/O40；先定义环境/负载和采样窗口。 |
| 主动服务质量 | 无变化重复通知、过时事实拦截、忽略/停主题/采纳、监控覆盖缺口。 | O19/O23/O24；措辞变化不是新事实，检查失败不是无变化。 |
| 连接体验 | 安装→身份→真实端到端的分段耗时；错误修复成功率；多账号串线次数。 | O13–O18；mock 与真实测试分组，缺账号/授权不填“通过”。 |
| 学习和产物 | 独立验收技能通过率、纠错后旧记忆再出现、产物可访问率、发布版本追溯率。 | O26/O29/O31/O32/O33；复杂度/样本数分层，不能只看粗成功率。 |

正确性零容忍：测试集中不得出现 **unknown 误报成功、旧契约触发外部动作、撤权后继续执行、私聊数据跨受众泄漏、同业务事件重复副作用**。一旦出现阻止相关交付，不以漂亮界面、日志齐全或单模型好评抵消。

## 15. 授权阻塞与范围保留

| 阻塞编号 | 涉及条目 | 缺少的具体条件 / 当前可继续工作 |
| --- | --- | --- |
| B-IM | F02、O14/O16/O17、E02/E08 | 真实平台账号/组织、测试会话/线程、接收与发送的明确授权、适用 credentials 与清理策略；此前禁止真实外发仍有效。可继续本地插件/错误/脱敏/revision/去重 fixture 与 UI。 |
| B-ACP | F03/O04/O46/O43 | 指定外部 Agent、账号/认证方式、环境允许列表、可能费用与真实调用授权；标准 ACP 自身不足受管资格。可继续本地协议/异常/权限/取消/兼容测试，不能冒称完整托管。 |
| B-PUBLISH | O08/O33/O47 | 指定远端目标、版本、受众、写入/发布范围与已有授权。可继续本地预演/只读核查/模拟，不公网上线、不 main 合并、不真发测试。 |
| B-IDENTITY | O17/O28/O29b | 双账号/组织成员资料访问与导入来源许可、可见范围和保留规则。可先设计最小读模型、同名/跨组织合成样本，不扫真实私密人物数据。 |
| B-CROSS-ENV | **O41b 及任何跨机/多跳重引入** | 明确的新设计评审与设备/机器/身份/传输/网络/撤销/费用授权；用户 Mac 未授权。此路线曾取消，不能因“全部建议”或已有同机 delegation 自动恢复。O41a 当前环境视图和云本地恢复可独立先做。 |
| B-CI | G00/O49/S1 最终容器/交付门禁 | **普通 CI 三 job 在 `ca6cbc…` 已成功，container acceptance 仍 blocked**；前次交接 `7c117d3390bd05d34debf494b374af18fb32a8e4`，本次负责人回读 `be584f1f9223429e25d2bc7e1c2df917ee770a40`。见 [CONTAINER_CI_BLOCKER.md](../increments/CONTAINER_CI_BLOCKER.md)。AppArmor 命令遭自动审批拒绝且无实现，不得重试/变通。阻相关容器执行和整体完成声明；不阻无此依赖、已授权的 S1-L/S2 本地代码/独立 review/局部验收。 |

P2 已全部进入总待办，而不是删除或默认永久不做；其中不涉及额外外部/设备影响的代码设计可在依赖满足后按授权逐项推进。真正需要补充授权的行动留在相应 blocked 分支，先完成其他独立工作，不恢复取消的多跳自治、不共享全部浏览器身份、不将学习/模板/文档当永久授权。

## 16. 下一批交接与更新规则

1. **G00 仍最高先行处理**：保留三 job 成功的源 SHA/run；按 [容器阻塞记录](../increments/CONTAINER_CI_BLOCKER.md) 等待具体边界决策，未批准不实施 AppArmor，不跳过 probe。整体未绿不宣布最终交付；独立 S1-L/S2 依自身硬前置继续。
2. G01 按 M1–M10 冻结小契约和真实可用生产切片；S1-L 拆小提交，S1-E/E02 保持 B-IM，不自行收发，不作为独立 S2 开工/局部验收前置。
3. 按 11.3 的 S2.0–S2.4，先版本/四状态/效果/错误片，再持久问题和恢复；共设计不当相互阻塞的全量前置。每片给出 records/outbox/approval 复用、迁移/回滚和独立评审，业务等待不得拉长审批 TTL 代替。
4. 每完成一项，在这里更新对应 Oxx 子项的实现 SHA、独立 review、测试/环境、实际 UI 证据、授权条件和未验证项，再由集成负责人更新进度与远端备份。只有全部完成定义成立才勾完成。
5. 原始 Library 文档升级时保留本次 version 0 的映射，以新版本差异更新，不静默覆盖编号或把新增建议计作已授权实现；具体授权以当时用户历史和行动边界为准。

本次产出仅此文件；没有对 runtime、UI、PROGRESS 或 Library 原文执行写入，也没有新增服务、真实外发或设备操作。


## 17. 本轮独立评审回执

独立审查者完整重读原计划 version 0 的 1,467 行，逐条对照确认 49 项标题/编号和混合优先级完整。初审指出依赖循环和真实 IM 阻塞被误作全局前置；`34a08ea` 修正为硬/共/后、M1–M10 和 S1-L/E、S2.0–2.4，独立复验通过。复验另指出共同完成定义与共享契约草案的条件引用/版本措辞不一致，本轮已澄清不得伪造尚不存在的 task/run/attempt 或通用 revision。此回执是文档评审，不是任何 Oxx 功能完成或 G01 正式冻结证明。


## 18. GitHub tracking and latest staged evidence

Master [#11](https://github.com/pythc/agent-hub/issues/11); O01–O49 map exactly to Issues **#12–#60** (`issue = O number + 11`). All remain open. O07 [#18](https://github.com/pythc/agent-hub/issues/18) / draft PR #61 now has independently reviewed four-axis code and the new simple/readable UI, with current local real-page acceptance and regression evidence in [STATUS_STAGE.md](STATUS_STAGE.md) / [STATUS_ACCEPTANCE.json](STATUS_ACCEPTANCE.json). The combined head still needs its own CI results, and the separately rejected O08 recovery POST change is unexecuted/pending scope approval; this does not close O07, O08 or the master.

The CI-specific named narrow policy and pinned CLI passed real container acceptance at `ad34ddc0…`, run43892304831: ten boundary checks and thirteen actual container groups. Ordinary CI and later combined-head checks are tracked separately. The earlier broad policy rejection remains historical and was not bypassed; user subsequently explicitly authorized only the distinct ephemeral-CI profile. O05 [#16](https://github.com/pythc/agent-hub/issues/16) has read-only backend implementation/review on its isolated branch, while its simple team panel and actual UI acceptance are still pending. None of these intermediate results checks a whole Oxx row complete.
