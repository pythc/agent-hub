# Router 第一步收尾：生命周期、受控接续、身份与迁移

2026-11-07，Asia/Shanghai。工作树 `work/agenthub-parity-fixes-20261106`，基础提交 `eb0dabb4e0f65f48b175189df46b65319cf01421`。本轮按实现前 review → 修改 → diff review → 回归 → 真实验证执行；发现新问题先复核契约再修复。没有提交、推送或切换正式部署。

**实现与本地回归已完成；原设计的完整准出仍有一个平台阻塞。** TypeScript 与 37 个文件的 **584 项测试通过**。76 项设计用例为 **69 pass、1 blocked（R14）、6 not_applicable**；6 个 P 用例因未启用外部记忆组件而不适用。不能将该结果写成“全部验收通过”。

本轮证据目录：`/Users/alex/Documents/ChatGPT/竞赛/validation/router-lifecycle-management-20261107`。逐项层级和边界见 `coverage.json`；上轮真实普通 API、预算与正文删除证据保留在 `validation/router-scope-completion-20261106`，本轮不冒称全部重跑。

## 已完成的行为

| 能力 | 当前行为 |
| --- | --- |
| 来源生命周期 | 平台无关 SourceChange；飞书群事件与已知消息回读，持久化来源版本和撤回屏障。编辑不自动生成新任务，旧事件不能复活撤回内容。读取失败只标 unavailable，不推断已删除 |
| 成员与受众变化 | 退出者失去当前触发权限；新成员历史能力未知时设受众水位。群改名只变显示，入口、任务和回执身份不变。真实平台事件还受下述订阅阻塞限制 |
| 权限收窄后的任务接续 | 原任务 held，运行中输出与旧正文不能继续外发。管理人提供新授权文本、复核工作目录并核对已发生效果后，显式 rebuild 准备新会话；随后新授权 send 才执行。同任务、同目录、同后端，旧线程被封锁 |
| 正文隔离 | Router/Worker 的任务查看、旧报告、工具回执、后台作业和原生线程均检查当前上下文。权限重建使用当前受权投影；核心任务/Mandate 审计记录不改写 |
| 派生记忆与遗忘 | 派生事实依赖父版本与来源，不能通过摘要扩大受众。忘记/清空使相关派生内容失效。抑制关联来源与内容，显式解除只允许新提取，不恢复已删事实；兼容旧抑制格式 |
| 新鲜度与降级 | 受权快照标注来源版本及检查时间。FTS 故障时使用同一权限范围的本地降级结果，并在结果和 manifest 中标明 partial |
| 连接身份 | 远程绑定先核验真实连接账号；不能拿 mentionId 或显示名当凭据。更换飞书账号会阻断既有入口。两来源账号关联须分别完成原生一次性挑战，不自动合并权限 |
| 迁移与备份 | 检查孤立 starting/running 工作和实际存活进程；保持任务/效果 ID 与五态出箱。迁移备份逐条导出原生历史、核验目录和 thread ID；缺引用或损坏就失败。维护窗口保留水位及不可回放缺口 |
| 操作界面 | 绑定连接时核验账号；可查看、解除记忆抑制；原有发布/撤回、清理进度、Router 配置均通过实际浏览器验证 |

管理入口与操作约束见 [实现说明](ROUTER_SCOPE_MEMORY_IMPLEMENTATION_2026-11-06.md)。`workspaceReviewed` 是管理人的复核声明；系统没有自动证明工作目录中不存在旧敏感内容。当前 tenant epoch 采用保守失效策略，可能同时挂起同组织其他上下文，不宣称已实现精细依赖调度。

## 真实验证与证据

| 场景 | 结果与证据 |
| --- | --- |
| Terra 中 + 4 个 Sol 高 | 实际 4 个 Worker、独立原生会话，结果为 2/4/6/8，由 Router 汇总；`native-four/evidence.json` |
| 权限收窄后继续同任务 | 原线程含私有标记，新线程协议不含该标记；任务数仍为 1、目录不变、旧线程不可读取；`native-rebuild/result.json`。该真实标记来自旧请求，记忆依赖撤回另有契约回归 |
| 更新 Worker 配置 | 原任务仍用 Sol high 原线程，新任务用 Terra medium 独立线程；第二范围完整协议无第一任务私有标记；`native-boundaries/result.json` |
| 在途撤回 | 真实 Terra turn 启动后遗忘依赖，迟到输出未进入外发，记录 Context expired；`native-boundaries/result.json` |
| 任务状态真源 | 记忆声称完成，真实任务仍 waiting；Terra 返回 TASK_STILL_OPEN，任务没有被关闭；`native-state-authority/result.json` |
| 飞书隔离、共享与撤回 | 两个指定群的真实机器人消息；未共享不可读，明确共享可读，撤回本轮自建临时消息后实际回读 deleted，来源与共享事实同时失效；`feishu-lifecycle/result.json` |
| 当前代码账号回读 | 再次核验真实机器人账号与第二群消息，不额外发消息；`feishu-lifecycle/current-code-readback.json` |
| 原生历史备份 | 当前代码真实导出并校验 5 条历史；`native-rebuild/current-code-backup.json`。这是历史导出校验，不是从备份重新导入模型服务的证明 |
| 迁移与旧程序 | 有效 Engine 状态迁移后重复事件/命令/inbox 不增加任务、模型调用或出箱；实际旧版 Store 拒绝新库隔离副本，业务指纹不变；`tests/lifecycle-acceptance.spec.ts`、`old-program/result.json` |
| 管理页 | 真实浏览器覆盖共享/撤回、忘记和解除抑制、正文删除、Router 参数、入口绑定、390px 布局、键盘焦点、减少动态效果与无页面错误；`browser/result.json`、`browser/*.png` |

飞书使用用户已授权的「周催办」机器人身份及本轮创建的测试消息。没有冒充真实成员；自动输入保留 human=false 的操作员重放标识，正常连接器仍过滤自身机器人消息。该轮没有重测真人入站，也没有移除真实群成员或机器人。消息编辑为契约/适配器回归，真实平台仅执行撤回。

普通 DeepSeek API 的真实调用、预算和统一正文删除结果沿用 [上轮报告](ROUTER_SCOPE_MEMORY_COMPLETION_2026-11-07.md)；本轮没有保存或重新使用聊天中提供的 API 密钥。共享宿主路径和三种 API 协议回归包含在 584 项检查内。

## 唯一未闭环的设计用例：R14

实际启动 7 个原生事件消费者：消息接收 `im.message.receive_v1` ready；以下 6 项全部被官方 CLI 拒绝，`validation / failed_precondition` 明确指出应用控制台未订阅对应事件：

- `im.chat.updated_v1`
- `im.chat.disbanded_v1`
- `im.chat.member.bot.deleted_v1`
- `im.chat.member.bot.added_v1`
- `im.chat.member.user.deleted_v1`
- `im.chat.member.user.added_v1`

平台返回的原文、各事件开通链接及退出码保存在 `event-readiness/result.json` 的 diagnostic 中；首次结果与修复后的结果分别保留。发现源健康状态原先会覆盖退出原因后，已经补上多行结构化错误保留及实际子进程回归，管理侧可看见具体缺口。

需要该飞书应用的管理员按 CLI 提供的链接在控制台订阅上述 6 项事件，并完成平台要求的权限/版本发布。随后重新启动测试连接器，核对 7 项 ready，再在独立受控群完成成员加入、退出和机器人退出后的读写屏障实测。消费者 ready 本身也不能替代这些实际事件验收。

本轮尝试通过现有浏览器自动化进入平台返回的配置入口，两次均因自动化连接超时结束；没有修改应用设置。不能把缺少控制台订阅视为代码已替用户完成，也没有为了通过测试去移除业务群成员。

## DeepSeek 一致性与范围

15 个 vendored core 文件重新逐个核对 SHA-256，均与仓库固定基线 `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` 一致；本轮未改核心。这证明固定基线一致，不是宣称已经同步最新上游。

外围扩展继续遵守：订阅材料不扩权；明确请求与 inferred candidate 分开；Engine 是任务状态真源；已发送或不确定效果先核对、不盲目重做；旧上下文迟到结果不转成假成功。以上行为有扩展回归与真实协议证据，不能仅凭 vendor 文件未改来断言整体一致。

本阶段没有接入腾讯 Agent Memory/WeKnora 远程服务；内置为结构化事实和 FTS。没有把相同来源的遗忘抑制宣传成任意新来源的语义去重。主动消息聚合、长期跟进、发言节奏属于设计后续阶段，当前单次 admission 不代表这些能力已经完成。

正式 schema 5 服务仍为原进程、原端口 4337，本轮未迁移、重启或切换。所有模型、迁移、恢复和浏览器验证均使用隔离状态目录。外部平台/服务商留存、用户目录及备份原件不属于统一历史删除的物理清理范围；维护窗口对平台未留存事件始终记录缺口。

## 最终 review 与可复核记录

- [实现前与分批 review](ROUTER_LIFECYCLE_REVIEW_2026-11-07.md) 包括每批测试前的契约检查和收尾修正。
- `check-final-3.log`：类型检查通过；584/584，37/37。早期失败日志保留，没有覆盖为成功记录。
- `implementation-fingerprint.json`：当前源码/测试/文档摘要、固定上游核对；`turn-final.diff` 区分本轮与开始时已有工作。
- `coverage.json`：76 项逐条列层级、证据来源、已测范围及未执行部分。历史通过项明确沿用，不混成新一轮真实验证。
- `final-status.json`：本轮总结果、平台阻塞、正式服务与验收进程边界。
