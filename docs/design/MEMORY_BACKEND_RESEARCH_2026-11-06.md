# AgentHub 第一步：记忆组件参考与选型边界

日期：2026-11-06（Asia/Shanghai）。状态：设计参考；未安装、集成或运行候选项目。主方案见 [设计规格](ROUTER_SCOPE_MEMORY_V1_2026-11-06.md)，验证要求见 [验收规格](ROUTER_SCOPE_MEMORY_ACCEPTANCE_2026-11-06.md)。

## 1. 调研范围与版本

通过官方仓库、固定提交的文档及指定源码核对，不用宣传指标推断 AgentHub 的实测效果。

| 对象 | 本次核对版本 | 已检查内容 | 证据边界 |
| --- | --- | --- | --- |
| TencentDB Agent Memory | `2002196f2d7c22ea267cfcaf67c5a6fa861df681`，远端 HEAD；网站展示默认分支 `feat/server_team` | README、INSTALL、MemoryCore README/v3 API、MemoryPanel API | 文档核对；未完成其实现审计或集成验证 |
| WeKnora | `e3fb2335bf3f8cadd32142380c60b2677a27bf99`，远端 HEAD | 长期记忆功能/API文档、`scope.go`、`service.go`、个人 API handler | 指定代码路径核对；未运行服务和测试 |
| DeepSeek SuperAgent | 官方领域模型与授权文档 | Ticket/Mandate、来源身份、订阅上下文、主动模式 | 用于确定继承原则；本方案中的组织与记忆控制面属于 AgentHub 扩展 |

GitHub tree API 在本次环境返回限流；部分文件获取失败。因此未宣称遍历全部源码，也未把文档承诺当作全路径正确性证明。

## 2. 可以借鉴什么

### TencentDB Agent Memory

官方描述包含原始会话、事实原子、场景和核心画像的分层，以及记忆资产的可见性与 Agent 绑定。适合参考团队记忆资产组织；其 README 将当前团队能力标为 Beta。参考：[固定版本 README](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/2002196f2d7c22ea267cfcaf67c5a6fa861df681/README.md)。

v3 文档要求关注实例及 team/agent/user 隔离；部分接口使用可信服务调用，并不逐项做最终用户鉴权。部分缺省字段有 default 桶语义，`session/add` 又有单独的 Header 契约。AgentHub 适配器必须自己生成完整范围，禁止依赖缺省桶或直接转发模型提供的身份字段。参考：[MemoryCore v3 API](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/2002196f2d7c22ea267cfcaf67c5a6fa861df681/MemoryCore/v3-api-memorycore-doc.md)。

MemoryPanel 文档区分资产、分配与访问管理。是否能通过所选 API 完整实现 AgentHub 的群级共享和撤回，仍需契约探针验证。参考：[Panel API](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/2002196f2d7c22ea267cfcaf67c5a6fa861df681/MemoryPanel/panel-api-doc.md)。

官方安装文档给出独立 Hub 与完整组合等部署方式；默认 SQLite，MongoDB 后端标为实验能力。不能因提供代理接入方式，就把全部 Router/Worker 历史透明送入代理。参考：[INSTALL](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/2002196f2d7c22ea267cfcaf67c5a6fa861df681/INSTALL.md)。

### WeKnora

长期记忆按空间和调用者隔离，提供显式记录、自动抽取、待确认、替代、管理和清空等能力；个人记忆与知识库访问权限分离。适合借鉴事实生命周期，也可作为文档知识源。参考：[长期记忆](https://github.com/Tencent/WeKnora/blob/e3fb2335bf3f8cadd32142380c60b2677a27bf99/website-docs/03-features/23-memory.md)。

个人 API 的范围来自凭证，并不接受随意选择的 subject；将所有群成员共用同一个服务账号，会改变原本的个人记忆语义。群共享知识不能直接塞进该账号的个人画像。参考：[记忆 API](https://github.com/Tencent/WeKnora/blob/e3fb2335bf3f8cadd32142380c60b2677a27bf99/website-docs/04-api/02-api-memory.md)。

源码 `ResolveScope` 从调用上下文提取空间与主体；`captureGeneration` 在读取输入前取得写入代次，避免旧工作在清空后复活。AgentHub 借鉴这一并发约束，但不依赖 WeKnora 替自己隔离原生 Codex 历史。参考：[scope.go](https://github.com/Tencent/WeKnora/blob/e3fb2335bf3f8cadd32142380c60b2677a27bf99/internal/application/service/memory/scope.go)、[service.go](https://github.com/Tencent/WeKnora/blob/e3fb2335bf3f8cadd32142380c60b2677a27bf99/internal/application/service/memory/service.go)。

## 3. 本期决策

以下是 AgentHub 的设计决定，不是上述项目已经提供的保证。

| 内容 | 权威持有方 | 外部组件的位置 |
| --- | --- | --- |
| Router 归属、入口绑定、任务授权、执行/交付状态 | AgentHub | 不托管给记忆引擎 |
| 事实版本、证据引用、共享许可、撤回和删除代次 | AgentHub | 外部结果只作为候选，验证后才能采纳 |
| 本期受管记忆正文及摘要 | AgentHub 私有状态库/受管文件 | 外部索引是可重建投影，不作为第二个事实真源 |
| 项目文档原文 | 原知识系统 | AgentHub 保存版本引用与授权映射；不得假装已完整复制 |
| 词法/向量检索、抽取建议、文档解析 | 可替换适配器 | 仅处理明确选定的范围与内容 |

**首期基线采用本地结构化记忆与全文检索，独立满足验收。** TencentDB Agent Memory 列为团队记忆增强的首选候选；WeKnora 列为已有文档知识接入和个人记忆生命周期的参考。两者均不成为本期强制运行依赖，不同时建立两套自动抽取与权威状态。这是在参考成熟机制后控制集成范围，不是宣称已经采用了它们。

用户未来选择外部引擎时，通过同一 MemoryProvider 契约接入；不能把一个安装了但无法证明隔离/删除语义的服务包装成“记忆已完成”。这不要求未来重写 Router 归属或迁移模型。

## 4. MemoryProvider 契约

| 操作 | 必须具备的语义 |
| --- | --- |
| 能力探测 | 返回范围过滤、版本引用、幂等写、删除回执、导出/清空和读取一致性的实际能力；不支持须明确失败 |
| 建立投影 | 使用 AgentHub 生成的 tenant/scope/provider namespace；包含事实版本、证据版本、generation 和稳定操作 ID |
| 查询 | 只搜索已准许的命名空间，返回可核验条目 ID/版本；AgentHub 二次校验后才把正文交给模型 |
| 抽取 | 返回候选及原文引用；不能直接将推测写成 active，不能生成政策或修改授权 |
| 撤回/删除 | 返回 accepted、processing、verified 等明确阶段；未回读确认不得显示“已彻底删除” |
| 导出/恢复 | 内容、来源、版本与映射可导出；恢复后先应用最新撤回账本再建索引 |
| 超时/不可用 | 回退到受权本地证据/词法索引；不足时报告缺资料；不扩大搜索范围，也不把未检索到说成不存在 |

固定版本适配必须验证六类探针：身份/范围、修改与确认竞争、来源追溯、撤回与迟到写入、删除/恢复、故障与分页完整性。Tencent 的可信服务 API 只由宿主代理调用；WeKnora 的个人与知识 API 分开映射。原生 CLI、订阅与普通 API 后端都只接收 AgentHub 已构造的记忆上下文，不自动更换模型入口或代理凭证。

## 5. 采用外部组件前的证据要求

1. 固定提交/镜像摘要，复核实际许可证及再分发要求；本轮没有进行发布合规验收。
2. 在隔离实例运行验收规格中的 P 组用例，不能只看 README 或 HTTP 200。
3. 比较同一标注数据集上的召回质量、延迟、模型调用和存储开销；不引用厂商榜单作为 AgentHub 收益。
4. 证明关闭组件后，任务和权威记忆仍可读取；证明索引能够重建。
5. 不导入真实群历史来掩盖合成数据验收缺失；真实群验收另列，记录具体输入、输出和授权范围。

## 6. 与 DeepSeek 的关系

保留来源事件、任务、不可变授权及执行委派；记忆仅提供上下文，不能成为新授权。跨来源身份不因姓名相同而合并。组织成员目录、Router 归属和共享许可放在宿主控制面，明确属于多群产品扩展，不伪称官方核心已有这些实体。参考：[领域模型](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)、[授权](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)。
