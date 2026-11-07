# LobeHub 与 AgentHub 对照

审阅固定版本 `31200fc959eb2ef1385e277dcb6fcc8a5530abb0`（2026-11-07 本机获取）。结论：两者已在多 Agent 协作、长程目标、记忆及工具运行方面明显重叠，不能再将 LobeHub 简单归类为聊天 UI。以下是源码证据及架构判断，不是运行其完整产品后的性能或可靠性结论。

| 主题 | LobeHub 源码证据 | 对 AgentHub 的启示 |
| --- | --- | --- |
| 执行循环与宿主分工 | [agent-runtime loop](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/packages/agent-runtime/src/loop/index.ts) 将 done、parked、error、interrupted、cost_limit、max_steps 等停止原因明确区分；锁、持久化和配额由宿主管理 | 结束一次推理不等于结束目标；目标持久化和下一步执行条件归宿主管 |
| 目标推进 | [decideNextMove](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/apps/server/src/services/goal/decideNextMove.ts) 根据依赖前沿与报告节点决定下一步 | AgentHub 应在 Worker 返回后重新对照目标，后续可增强依赖图和增量计划 |
| 恢复策略 | [machineRecovery](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/apps/server/src/services/goal/machineRecovery.ts) 区分机器可恢复问题及需要判断的问题 | 不能把所有失败都做无上限重试；保持目标未完成，记录恢复理由及必要的人类介入 |
| 验收门槛 | [任务工具契约](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/packages/builtin-tool-task/src/systemRole.ts) 区分创建/运行任务，并提供独立 verify gate；周期 tick 结束不关闭总任务 | AgentHub 当前实现验收标准和报告引用门槛；独立 verifier 与完整 release gate 还不是本次能力 |
| 记忆来源 | [用户记忆类型](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/packages/memory-user-memory/src/types.ts) 包含来源消息、摘要和处理水位等结构 | 把原始证据、抽取结果和任务硬性要求分开，重试时避免重复抽取和旧内容复活 |

AgentHub 当前的侧重点是入口授权、Router/Worker 归属、原生 Codex 会话、本机工具效果、回收与删除边界。这个差异不意味着 LobeHub 缺少相应能力，也不能推出 AgentHub 已在可靠性上超过它。更合理的策略是对照它的目标状态机、任务依赖和验收模型，检验自己的边界是否闭合。

[LobeHub Community License](https://github.com/lobehub/lobehub/blob/31200fc959eb2ef1385e277dcb6fcc8a5530abb0/LICENSE) 对商业衍生分发附加条件。本次只做架构分析，没有复制其代码。WeKnora 选定部分按其固定版本许可证保留归属，不能把两者的许可条件混为一谈。
