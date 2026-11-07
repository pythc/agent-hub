# AgentHub 内嵌知识与长程目标

本次按「将 WeKnora 的一部分融入 AgentHub」实现，不连接知序的 WeKnora 实例，也不要求用户再运行一套 WeKnora 服务。本文描述实现契约；测试结果另见验收记录，代码存在不等于验收通过。

## 来源和实现边界

采用 Tencent/WeKnora `e3fb2335bf3f8cadd32142380c60b2677a27bf99` 的选定算法与设计，保留上游 LICENSE、来源清单、原文件 SHA256 和不参与编译的参考源码。TypeScript 适配在 `src/vendor/weknora/primitives.ts`，业务权限、事务、恢复和工具协议由 AgentHub 自己实现。

| 能力 | 当前实现 | 边界 |
| --- | --- | --- |
| Agent 记忆 | 固定前缀识别明确的「记住」请求；原文证据、已确认/候选状态、忘记抑制、分组展示 | 自动激活仅限短于等于 300 个 Unicode 码点的明确指令；推断记忆仍需确认，不把记忆当执行授权 |
| 文档检索 | 文本/Markdown 入库、标题分段、码点偏移、SQLite FTS5 关键词检索、片段和分数归一化 | 没有接入 PDF/Office 解析、OCR、embedding、向量混合检索或 rerank，不称完整 RAG 引擎 |
| Wiki | 页面 slug、双向链接、版本、回滚到旧版本、结构化来源引用 | 不含自动 Wiki 生成流水线，也未添加独立 Wiki 编辑器 UI；通过 Router 工具及 API/MCP 使用 |
| 来源有效性 | 引用精确到文档 revision 和码点区间；源更新标为 stale，删除/撤权阻断关联读取 | stale 页面仍需重新核验；回滚生成新 revision，不覆盖历史 |

上游内存服务、Wiki 服务和解析流水线是 Go 服务，依赖 WeKnora 的数据库、鉴权和其他基础设施。本次没有把整个 Go 服务改名包装为 AgentHub，也没有复制 LobeHub 的实现。

## Router 连续性

会话分区为 Router、入口、讨论和参与者。后端配置、工具契约、权限 epoch、记忆 generation、来源、历史上下文及知识引用仍有效时复用原生线程，发送本轮增量；发生不兼容变更或累计输入预算需要轮换时，通过持久日志重建。

日志保存已接纳用户原文、Router 回复及其来源。要求可以按原句固定保存，解释性决策与承诺单独记录；新的明确人类输入才能替代旧要求。checkpoint 只能概括 Router 回复，不能删减用户原文。旧版本回复只有在能找到原始回复归属及上下文清单时才导入；无法验证的旧回复以 `legacyUnavailable` 暴露恢复缺口。

原生线程是上下文缓存，SQLite 日志和当前任务/目标状态是恢复依据。权限变化会阻止旧内容被带回新上下文。上下文无法容纳必要原文时会明确停止并保留状态，要求扩大预算或建立经用户确认的交接；没有声称有限上下文能无损容纳无限历史。

## 长程目标

`router_goal` 保存 objective、验收标准、计划、下一步、任务 IDs、唤醒条件、状态及最终核验引用。Router 在多步或持续任务开始时应先建目标再派发 Worker。计划当前是顺序说明列表，并非 LobeHub 那样完整的依赖图调度器。

`active` / `waiting` 持久唤醒；Worker 完成后 Router 重新检查总目标。`needs_input` 必须给出具体问题或阻塞原因。`complete` 要求每条标准对应当前 ready 报告，任务均结束，且没有未决工具效果或不确定交付。报告本身仍需 Router 检查；此结构校验不是现实世界中目标必达的数学证明。

默认每个目标最多 200 次自主 Router turn，连续 3 次失败进入 `held`，保留未完成状态并通知原入口。达到预算、环境失效或需要用户输入都不算成功。用户可显式调整预算或 resume；pause 停止目标继续调度，已派发 Worker 可收尾，cancel 才取消其未结束任务。主机服务关闭期间不执行，重启后按持久状态恢复。

## 接口

Router 工具：`router_knowledge`、`router_journal`、`router_goal`；Worker 仅有 `superagent_knowledge` 的读取能力。普通聊天仍是用户入口，不要求用户手工填写内部 ID。

本机鉴权 API：`POST /router-knowledge`、`/router-journal`、`/router-goals`，请求形如 `{ "triggerId": "已授权输入", "command": { "action": "list" } }`。相应 operator MCP 工具提供相同结构。管理 API 不允许借保存的私聊作者身份读取私有入口。

文档写入需 `operationId` 与 `expectedRevision`，当前明确人类授权，以及所有者/管理者权限。检索内容不会提升权限。源历史删除同时清理文档 chunk 的检索索引；旧备份仍受现有删除账本约束。

## 运维范围

仅修改本地后端工作树。没有启动/替换生产服务、发送飞书消息、部署、推送或合并，也未改动并行的前端工作树。WeKnora 解析/向量能力和完整 Wiki UI 是后续独立范围。
