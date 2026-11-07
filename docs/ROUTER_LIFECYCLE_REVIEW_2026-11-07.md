# Router 生命周期与主动管理：实现前 review

2026-11-07。工作树 `work/agenthub-parity-fixes-20261106`。本轮顺序：静态契约 review → 实现 → diff review → 确定性回归 → 真实模型/平台验收。此记录写入时尚未运行本轮测试。

## 已确认的问题与实施决定

| 编号 | 静态证据 | 修复契约 |
| --- | --- | --- |
| L01 | FeishuSource 仅消费 receive_v1；fromMessage 遇 deleted 直接丢弃；编辑改变 hash 可作为新请求进入 | 引入平台无关 SourceChange；修改/撤回先使旧授权和记忆失效，不把编辑自动当新任务。飞书用已支持事件及已知消息回读，不虚构不存在的 CLI EventKey |
| L02 | scopes.sourceActive 只看配置；未消费成员/机器人退出与权限变化 | 平台生命周期通过可信连接器写入持久屏障；未知历史权限按 unknown 处理；群名变化不改变入口或任务身份 |
| L03 | worker_manage rebuild 仅允许 budget stop；moveTaskContext 会复用旧 facts | 增加权限变化的显式同任务接续；新受权输入与新上下文清单，旧线程封锁；保留任务/后端/目录/效果身份，拒绝不确定效果和删除后恢复 |
| L04 | manager inspect/result 直接返回 run/report，未核验 task-context | 旧上下文的正文读取也必须受限；仅返回可解释的 held 元数据，不能从管理工具把旧内容送回模型 |
| L05 | memory-suppression 只有 subject key，且无显式解除操作；无派生事实依赖 | 证据关联抑制与明确解除；派生事实继承版本、来源及发布边界，不能通过去引用扩大受众 |
| L06 | entry namespace 由操作者手填；无验证关联对象 | 增加真实连接身份核验及版本化关联记录；关联不改旧 actor/Mandate，不自动扩权 |
| L07 | 迁移检查 work 只覆盖 pending/running；新持久类型未加入迁移目录；无维护窗口缺口记录 | 核对实际活动状态/进程与原生引用；已发送/不确定效果不重放；记录可回放与不可回放缺口 |
| L08 | 具备单条 inferred admission，但缺少长期主动管理的批处理/节奏/跟进对象 | 本轮按第 1 步范围保留后续阶段；当前 observe/admission 仍遵循 Engine 状态真源，不能冒充长期跟进或发言节奏 |

L09 补充 review：inferred 准入模型的 superagent_read 原先使用操作员空 principal，可能读取非当前输入。将其收缩到当前源消息及其附件，并在读取前后验证当前范围；此项纳入首批回归。

## 平台依据与边界

已读取本机 lark-cli 官方事件目录及输出 schema。当前目录没有消息编辑/撤回 EventKey；这些变化通过受管已知消息的原生 GET 回读同步。群生命周期为 V2 envelope，字段在 event 下；接收消息则是 CLI 展平格式，不能混用。

参考：[群配置变更](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/chat/events/updated)。当前 CLI schema 完整保存在 `validation/router-lifecycle-management-20261107/feishu-event-catalog.json`。

验收必须观察完整模型输入、实际任务/效果 ID 和平台回读。外部读取失败不能直接推断“已删除”；成员变化不得用改群名或模拟真人消息替代。正式服务的迁移须先有可复核计划、排空、备份和回退边界，不通过覆盖旧库跳过验证。

## 第一批实现后的 diff review（先于测试）

核对了生命周期写入/回放、准入工具读取、任务投影、Worker 管理、执行/资源/MCP 回执读取路径。发现并修复：

- 管理 `inspect/result` 未验证上下文、准入读取使用操作员 principal。
- 权限重建后可通过旧任务标题、attention、assignment report、transcript fallback 或重复 MCP requestId 读取旧正文。现在保留不可变核心审计记录，模型使用明确投影，旧效果只提供身份。
- 原生旧线程须单独封锁，不能只清空 run.threadId。
- 撤回终态不能被晚到的旧读取复活；老时间戳不能覆盖较新观察。
- 成员退出撤权不能等同“原事实为假”；新成员的历史可见性未知时需设受众水位。
- 权限重建依赖当前管理人明确复核工作目录；`workspaceReviewed` 是管理人声明，不是系统自动证明。未复核、不确定效果、运行中任务、已删除历史均拒绝。

此阶段尚未宣称全部验收通过。新回归覆盖 F06/F14/F16/C03/C08/R14 及准入资源范围；随后先执行类型检查、定向回归，再全量回归。迁移、连接身份和后续主动管理尚待下一批处理。

## 第二批实现后的静态 review（先于第二批测试）

- 连接核验必须使用原生接口返回的身份；去除 mentionId 回退，不把配置值当身份凭证。远程 entry.bind 校验真实 namespace；历史入口不自动重写身份。
- 账号关联需两个限定来源账号分别在其原生入口完成一次性挑战，十分钟过期；手动重放/HTTP 人工事件不能提供 native proof。关联对象不会改 Mandate 或权限。
- 迁移增加 starting/running 和仍存活的 shell 检查，包含无对应任务的孤立 work；新增记录类型逐项登记。
- 迁移备份逐个读取模型历史，核验 thread ID，并导出受管备份正文及摘要索引；普通未指定原生 reader 的数据库备份明确标 reference_only，不伪称原生历史已备份。
- 维护窗口保存来源重放策略和水位；平台不能回放的内容仍需记录缺口，不能通过移动 cursor 宣称恢复。
- 派生事实失去依赖时持久化 revoked；忘记/清空还清除受影响摘要正文。解除抑制只允许新提取，不复活已删除事实。

第一批定向回归最终 57/57 通过。首次运行的两项失败及修正保留在 regression-1.log / regression-2.log：调度入口仍引用旧 parentTrigger、工具取消后返回契约不一致。

## 收尾 review

- 补查旧版本配置默认值：迁移比较先通过当前 schema 规范化旧配置；保留原数据库记录字节，避免新增默认字段让所有旧库被误判为配置漂移。
- 补查真实连接更换账号：飞书受管轮询、资源读取和生命周期事件重新核验已绑定账号；不能只验证设置页面的一次操作。
- 保留旧版 suppression 格式的解释和解除路径，不能让升级前的忘记记录永久无法管理。
- 维护窗口尚未激活/仍暂停时不推进源游标；否则可能把本应补取的输入提前处理为忽略。窗口缺口仍明确记录，不声称平台事件零丢失。
- 原设计第 1 步明确排除了主动判断批处理、长期业务提醒和发言频控；本轮不把单次 admission 改名为这些能力。它们保留在后续阶段。

维护窗口收尾增加了真实 source cursor 回读：成功轮询后只有全部受管游标覆盖恢复时间才标 messages_replayed；任一来源失败/缺旧水位保持 partial/missing_prior_cursor。平台未留存的事件始终单独列缺口，zeroLossVerified=false。此处先检查水位重叠、失败状态和时间单位，再运行新增回归。

最后检查原生历史索引时发现：仅检查 threadId 会遗漏无法解析目录的 previousThread/from.threadId。改为收集全部必须导出的引用，缺目录时失败；迁移旧线程优先取原目录，不能拿新后端的目标目录替代。添加目录缺失和不同迁移目录的契约回归，并重新验证真实原生历史备份。

真实事件启动验收发现 6 个生命周期消费者退出码 2；官方 CLI 返回 failed_precondition，说明应用控制台未订阅事件。原 on-close 覆盖错误、stderr 又是多行 JSON，会丢失原因。先修复为保留有界 stderr 并提取结构化 type/subtype/message/hint，再增加真实子进程夹具回归。只把消息接收 ready 记为通过；生命周期平台验收保持 blocked，不能用本地事件夹具顶替控制台配置。
