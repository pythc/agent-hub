# Router 归属与记忆：第一步实现说明

本轮在 `work/agenthub-parity-fixes-20261106` 落地宿主管理范围、群入口、任务归属、受权事实记忆和显式迁移。DeepSeek vendor 核心未修改。**核心路径已实现并实测；尚未达到设计中全部 76 项规格的准出标准。** 历史证据见 [首轮验证](ROUTER_SCOPE_MEMORY_VALIDATION_2026-11-06.md)，普通 API、完整预算和统一正文删除的历史结果见 [补齐验收](ROUTER_SCOPE_MEMORY_COMPLETION_2026-11-07.md)。最新生命周期、受控接续、身份与迁移收尾见 [2026-11-07 收尾验收](ROUTER_LIFECYCLE_ACCEPTANCE_2026-11-07.md)：584 项回归通过；76 项规格中 69 pass、1 blocked、6 not_applicable，真实飞书生命周期订阅仍需平台管理员配置。

## 使用入口

工作台侧栏的「Router 与记忆」打开 `/router-management`，沿用当前宿主的操作员登录。可以创建团队、绑定群、设置团队 Router 的后端/模型/思考强度、暂停记忆、设置完整上下文字节上限、管理任务入口与归属、确认/发布/撤回/忘记事实，删除受管历史正文并跟踪清理进度，以及查看迁移与待审回复。

群入口以组织、平台、连接账号命名空间和原生群 ID 标识。群名用于展示。绑定同一 Router 不会导入旧历史或共享全部记忆。远程账号命名空间须先由 source.verify 调用连接器的真实身份核验；管理页绑定自动执行此步骤，不能凭显示名称填写。身份关联通过两个来源各自的原生消息完成一次性挑战；关联不转移原有权限。历史入口不会自动改写账号身份。

本期仍使用显式准入：无需 @ 可以使用配置的命令。闲聊监听、主动判断、任务催办与介入节奏属于下一步；本期没有将这些能力开启。机器人消息不会冒充成员请求，完成任务的重开仍需真实人类授权。

## 核心行为

- `ManagementScope` 保存稳定逻辑 Router、负责人、Worker/来源/后端许可及可接管资料入口。Router 的模型参数可单独覆盖；Worker 配置继续使用已有能力。
- `EntryBinding` 决定新任务的默认 Router。改绑不会迁走旧任务；旧话题/明确任务引用按任务当前归属和入口许可处理。
- `TaskOwnership` 保留原 ticket、Mandate、Worker、原生线程与目录。转交要求同组织、任务排空、目标具备来源/模型/资料/原 Worker 管理许可。
- `TaskChannel` 分开控制读取、提出后续请求和接收结果。增加某个任务的许可不使其他任务失效。新输入推进该任务的数据版本，旧受众不能自动看到新版本结果。
- Router 是唯一对外协调者。Worker 出箱进入内部 Router 收件箱，再由 Router 检查后发送。新委派只向 Worker 提供该子任务正文，保留原请求授权锚点。
- 记忆是有证据和版本的上下文，不是授权或任务状态真源。模型只能提候选；确认、发布与撤回走管理动作。事实必须经过当前受众过滤后才能检索、进入模型或返回工具结果。
- 明确发布只授予指定事实版本。模型输入带宿主生成的 `access` 来源信息，区别历史自然语言表述与当前有效许可。事实纠正后，原发布版本不自动变成新版本。
- 私有记忆只在真实主体的私人入口使用。操作员管理页不能通过选择一条私人消息来冒充其作者读取正文。
- Router 每次构建新的物理模型会话，稳定身份、任务账本和有效事实负责连续性；不会把另一群旧原生协议拼进来。Worker 正常接续保留原线程；权限失效时阻止复用。
- `context manifest` 在工具读取、Worker 调度/完成和 Router 外发前核验。任务输入版本、owner 版本、事实版本与范围撤回均参与检查。已转交任务的待发 Router 回复保留原 ID，由当前 Router 在新上下文中复核；未通过继续挂起。
- 未知群历史权限不能读取周边或完整线程。任务共享不自动授予另一个群的原始来源读取能力；资源分页同样绑定当前上下文。

## 管理 API

所有接口需要宿主操作员身份。原生字段 ID 属于管理 API，控制台提供选择器。

| 接口 | 用途 |
| --- | --- |
| `GET /router-scopes` | 范围、入口、归属、任务入口、迁移、记忆代次与待审回复 |
| `POST /router-scopes` | `scope.put`、`entry.bind`、`task.channel`、`task.transfer`、`reply.resolve`、`migration.hold`、`migration.activate`、`source.verify`、`identity.challenge/link/unlink` |
| `GET /router-management/catalog` | 控制台选项；排除私人记忆上下文 |
| `GET /router-cleanup` | 持久清理回执、当前阶段、错误与重试状态 |
| `POST /router-memory` | `{triggerId, query}` 或 `{triggerId, command}`；从已接纳消息派生真实范围与身份 |

状态变更需要稳定 `operationId` 和 `expectedRevision`。同一操作重试返回原回执；同 ID 不同内容拒绝。读取记忆回执时仍核对当前可见性，不返回已遗忘/已改版正文。

记忆命令包括 `remember`、`confirm`、`share`、`unshare`、`forget`、`source.delete`、`clear`、`history.delete`、`suppression.remove`。`remember` 默认 candidate；原始事实支持 independent/joint 两种证据关系。`clear` 只清理记忆，`history.delete` 同时清理受管历史正文；两者需要当前 scope 的 generation。`source.delete` 清理单一来源及其依赖正文。暂停记忆后仍可清空。删除立即停止使用，后台回读全部成功后才返回 completed；失败持续 processing 并重试。

`reply.resolve` 的 `continue` 必须走异步 HTTP 管理入口，由当前 Router 真实复核；底层同步 `RouterScopes.command` 不允许绕过复核直接放行。`withdraw` 直接撤下原待发记录。

## 完整预算与历史清理

`contextBytes` 使用 UTF-8 序列化字节，不等同于模型 token 数。新范围默认 256000，已有显式配置不自动改写。普通 API 每轮检查实际请求体，计入系统说明、schema、工具定义、历史/思考内容和工具回执；另预留输出及工具空间。Codex 统计原生暴露的模型协议、内置说明和动态工具，不把重复遥测算作上下文；在启动、工具执行、回执、steer/refresh 和结束阶段核验。提供方未暴露的隐藏内部状态无法精确计量，原生首轮隐藏注入也不能声称在 HTTP 发出前已全部获知。

超限会挂起并记录 `context_budget_exceeded`；不通过字符串截断破坏工具调用/回执配对，也不自动重做已执行效果。大工具结果完整留在宿主，以带状态、字节数和散列的完整回执引用进入模型；操作员通过 `model-tool-receipt/<id>` 分页读取。`worker_manage rebuild` 对预算挂起或权限收窄挂起准备新上下文。预算重建要求当前权限有效；权限重建要求当前管理人、新受权任务文本、已复核工作目录且无运行中/不确定效果。它保留任务、目录、后端及效果身份，封锁旧线程，旧正文通过投影隔离，等待新的授权跟进才执行。workspaceReviewed 是管理人声明，系统不自动证明目录内容无敏感材料。

统一清理先停止写入并排空关联活动，再删除受管原生线程/API 协议、状态目录中的附件和作业输出、记录/审计/出箱正文、分页缓存与全文索引，并完成 SQLite checkpoint/VACUUM 回读。保留任务/交付最小信封及已执行效果标识；已发送或结果不确定的交付不会变成待重放。原生线程删除使用 Codex 官方 `thread/delete` 并核对不可读；缺少执行目录、删除能力或读锁未释放时保持 processing。迟到写入仍受删除屏障约束。

原平台消息、服务商留存和历史备份并不因此物理消失。备份恢复前重放最新删除账本；证据归档、用户工作目录及不属受管历史的文件不作任意删除。迁移到不同状态目录时不能将旧绝对附件路径视为已验证映射，需离线核对。

## 迁移与回退

新库为 schema 6。迁移工具也支持已有任务但尚无管理范围的 schema 6 库，避免配置首个范围时搁置旧任务。schema 5 正常启动会稳定拒绝并提示迁移；不会静默重写旧实例。

1. 导出当前生效配置，停止目标宿主及 supervisor，核对正在运行的原生任务、后台作业和不确定交付。
2. 创建只包含 `scope.put` 和 `entry.bind` 的计划，每个创建动作使用 `expectedRevision: 0`。保留原来源 ID 与账号身份；不扩大成员准入。
3. 执行 `npm start -- scope-migration preview <effective-config.json> <plan.json>`。检查 mapped/held/conflict 和快照指纹。保存设置与配置文件不同会拒绝，要求先导出生效配置。
4. 执行 `npm start -- scope-migration apply <effective-config.json> <plan.json> <fingerprint>`。工具持有独占锁，验证完整备份，在副本中迁移并逐条比对旧记录/作业/出箱，再原子切换。
5. 切换后保持 `verified_paused`。遇到中断，使用同一计划与指纹重试：切换前保留失败 staging 并从原库重建；切换后补齐激活清单并返回原回执。
6. 无法核实的条目可以通过 `migration.hold` 明确保留挂起，然后 `migration.activate` 激活已核实归属。此动作仍不自动解除宿主暂停。缺失授权的任务不会自动变成可运行任务。
7. 仅在迁移后状态完全没有推进时，可执行 `npm start -- scope-migration rollback <effective-config.json> <operationId>`。回退保留新版备份，恢复旧库，要求配套原 schema 兼容程序。新增消息、任务、外部效果、配置变化或删除账本都会阻止覆盖，转为保留状态并修复前进。

恢复旧备份必须保留最新 `memory-revocations.jsonl`。账本带序列/哈希链，在开放查询前重放；缺失或分叉会阻止服务。迁移备份会真实读取原生历史并校验 thread ID，输出带散列的 history-index 与历史文件。没有 reader 的普通备份标记 reference_only。历史导出用于核对和恢复资料，不等于已将线程重新导入原模型服务；不能仅凭 SQLite 恢复声称恢复全部原生历史。维护窗口保留各来源水位与不可回放事件缺口，即使消息已补取也不标零丢失。

## 已知边界

- 内置实现是 SQLite 结构化事实与 FTS5 检索。腾讯 Agent Memory / WeKnora 尚未接入，没有伪称已实现向量召回、关系图或外部提供方互换。
- 完整预算覆盖实际 API 请求和原生可观测协议；不能冒充服务商 token 计量或隐藏内部状态的硬上限。
- `forget/clear` 与正文删除是不同动作；已实现的 `source.delete/history.delete` 清理受管正文。平台消息、服务端留存、备份仍分别呈现保留边界，不宣称全部物理删除。
- 已实现平台无关生命周期、飞书已知消息回读与 6 项群事件适配；实际撤回已验证。当前真实应用未订阅 6 项群事件，退群/成员变更链路仍 blocked。原生读取失败标 unavailable，不推定删除。
- 预算与权限收窄均支持受控同任务重建，禁止自动恢复旧正文；无法核实归属的遗留任务仍明确 held，需管理人核对。tenant epoch 采用保守屏障，可能同时挂起同组织其他任务，当前不宣称精细依赖调度。
- 管理 API 当前是部署操作员接口。已有来源账号挑战关联，不等于已完成企业 SSO、组织目录同步和多租户管理门户。主动消息聚合、长期任务跟进与发言节奏不在第 1 步范围。
