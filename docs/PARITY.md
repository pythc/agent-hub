# 原型逐项对照与验收 — AgentHub 0.7.0

2026-11-06 对 0.10.0 重新审查后，修复了失败通知、同轮输入投递、出箱排序、提问渠道、Issue/PR 绑定、关闭 PR 跟进和 API 重试七项宿主适配缺陷。当前修复及验证范围见 [专项记录](ACCEPTANCE_PARITY_2026-11-06.md)；下表为历史映射，不能替代该记录中的边界说明。

基线为 2026-11-04 下载的官方原型文档 51 个二级章节。47 个功能章节均有对应实现和下列验收证据，另有 4 个说明章节。**这是实现映射，不是“51/51 实机测试通过”，也不是对所有模型行为和平台环境的等价证明。**

沿用 0.4.0 的逐项实现核对。下列历史实机记录保留在本机，未随源码发布；源码中的自动化用例可重新执行。0.5.0 的客户端实机结果见 [客户端验收](clients/ACCEPTANCE.md)。

| ID | 原型章节 | 实现 | 行为/范围 | 验收层级 | 证据 |
|---|---|---|---|---|---|
| P01 | [000-philosophy.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md) / What follows for the agent | 实现完成 | 从自然语言请求协作；分析任务不需要仓库或 PR。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; 本机历史证据（未发布） |
| P02 | [000-philosophy.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md) / What follows for the design | 实现完成 | Source、Policy、Executor、Channel 分离，保留领域核心。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/vendor/dsh-core; tests/upstream/core-engine.spec.ts |
| P03 | [000-philosophy.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md) / Responsibility | 实现完成 | 区分受理、执行结果和不确定副作用；不确定执行等待核对。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; 本机历史证据（未发布） |
| P04 | [001-domain.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md) / Flow | 实现完成 | 接收、评估、授权、执行、输入跟进、交付及结束。 | 见所列测试或真实记录，不代表所有边界均已实测 | 113 项上游核心测试；真实 GitHub/飞书记录 |
| P05 | [001-domain.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md) / Concepts | 实现完成 | 原型的 Trigger/Thread/Ticket/Mandate/Assignment 及订阅原样保留。 | 见所列测试或真实记录，不代表所有边界均已实测 | docs/upstream-core-sha256.json |
| P06 | [001-domain.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md) / Rejected concepts | 实现完成 | 内部保留 Ticket，用户无须填写工单；支持无 Git 文档请求。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; 本机历史证据（未发布） |
| P07 | [001-domain.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md) / What is reusable | 实现完成 | 自定义 custom-queue 可替换 Source，不修改领域。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts |
| P08 | [001-domain.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md) / Glossary | 说明 | 名称沿用原型；客户端显示请求、讨论和结果。 | 文档/范围说明 | README.md |
| P09 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Two paths for a Trigger | 实现完成 | 新请求与订阅跟进分流，worker handback 后重评；人类停止独立路由。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; tests/upstream/core-engine.spec.ts |
| P10 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Strength | 实现完成 | 显式/推断授权、机器人不得提供显式授权。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/policy.spec.ts |
| P11 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Admission | 实现完成 | 配置准入矩阵、来源身份、目录预览/冲突保护、显式成员同步及受控实时提及发现；目录已在真实群读取，实时发现用事件夹具验收。 | 自动化＋真实目录读取 | tests/policy.spec.ts; tests/connectors.spec.ts; tests/resources.spec.ts; 本机历史证据（未发布） |
| P12 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Routing candidates | 实现完成 | accept/ignore/attach/stop；精确工作 ID/来源 URL/PR URL 跨讨论引用；禁止按主题相似度附会，context 跟随不扩权。 | 自动化 | tests/runtime.spec.ts; src/runtime.ts; src/worker-tools.ts |
| P13 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Accept mode and rules | 实现完成 | off/observe/auto；推断评估必须覆盖每条规则且匹配 ID 一致。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts |
| P14 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Policy version | 实现完成 | 规则和准入独立生成版本；变更交给核心重评，不立即撤销运行授权。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/policy.ts; tests/upstream/core-engine.spec.ts |
| P15 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / Resume and stop | 实现完成 | 停止、暂停跨重启、接管、交还和同 thread 续办；桌面用后台归档释放 writer。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; 本机历史证据（未发布） |
| P16 | [002-authorization.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md) / When Eval does not finish | 实现完成 | 原型 Eval 超时重排及 unavailable 保留；模型失败不误报受理成功。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/upstream/core-engine.spec.ts; tests/runtime.spec.ts |
| P17 | [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) / Ticket stages | 实现完成 | 阶段由原型 ticketStage 计算并在控制台显示。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/runtime.ts; 本机历史证据（未发布） |
| P18 | [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) / The Executor | 实现完成 | 原生 Codex 或宿主 API 持久会话；5/60 秒等待、后台占槽、30 分钟期限、交接豁免、子代理树回收、Assignment 关闭屏障及人类额外槽。 | 自动化＋真实 Codex/进程 | tests/work.spec.ts; tests/runtime.spec.ts; 本机历史证据（未发布）; 本机历史证据（未发布） |
| P19 | [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) / Merging | 实现完成 | 逐 SHA 或团队策略授权；自有 PR、ready、审批、CI、行数、独立身份、撤权、预期 head PUT 和不确定合并核对。 | 隔离 HTTP 成功/故障验收；未真实合并 | tests/merge.spec.ts; 本机历史证据（未发布） |
| P20 | [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) / How a Ticket ends | 实现完成 | 分析 ready 结束；绑定 PR 等关闭；人工停止保持停止。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/upstream/core-engine.spec.ts; 本机历史证据（未发布） |
| P21 | [003-execution.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md) / Failure and recovery | 实现完成 | 忙碌执行重启恢复原 thread 并加入核对说明；不重放旧命令；短暂模型故障三次退避；未知外部写入保留核对。 | 自动化＋真实 SIGKILL | tests/runtime.spec.ts; 本机历史证据（未发布）; 本机历史证据（未发布） |
| P22 | [004-prompts.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) / What a team writes | 实现完成 | 原型 15 个内置键兼容，另保留旧键别名、团队角色文本、技能及生成占位符校验。 | 自动化 | src/prompts.ts; tests/resources.spec.ts; tests/settings-approval.spec.ts |
| P23 | [004-prompts.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) / Assembly and precedence | 实现完成 | 每轮及工具边界重组提示词；Codex 同一 turn 注入，API 下一 HTTP 步生效，保留不可变授权。 | 真实 Codex，动态工具与旧 MCP 两路 | 本机历史证据（未发布）; src/runtime.ts |
| P24 | [004-prompts.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) / Principles of the built-in text | 实现完成 | 一次请求确认、原线程/内联线程回复、修复验证后解决/拒绝解释后解决；机器人审查按 head 限轮。 | 自动化；语义判断仍由模型承担 | src/prompts.ts; src/review.ts; tests/review.spec.ts; tests/connectors.spec.ts |
| P25 | [004-prompts.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md) / Versions | 实现完成 | 不可变历史、冲突与占位符校验、默认升级提示；turn 和实际注入工具步记录版本与摘要。 | 自动化＋真实 Codex | tests/settings-approval.spec.ts; 本机历史证据（未发布） |
| P26 | [005-panel.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) / Three questions | 实现完成 | 展示当前工作、谁需行动和实际结果，待审批及不确定投递可见。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布）; 本机历史证据（未发布） |
| P27 | [005-panel.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) / Tabs | 实现完成 | 关注、来源、讨论、判断、执行、Eval、资源、模型、提示词和设置页面；支持独立记录与作业浏览。 | 真实 Chromium | src/web.ts; 本机历史证据（未发布） |
| P28 | [005-panel.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) / Settings groups | 实现完成 | 分组设置、允许列表、执行、作业、交付/合并和提示词表单；高级字典 JSON、版本保存与回退。 | 真实 Chromium＋自动化 | src/web.ts; 本机历史证据（未发布）; tests/settings-approval.spec.ts |
| P29 | [005-panel.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) / Search | 实现完成 | 搜索工作、事件、判断与投递；投递搜索遗漏已修复；0.7.0 另修复事件正文被父讨论过滤的问题，并在浏览器复验。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布） |
| P30 | [005-panel.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md) / Principles | 实现完成 | 原生审批按问题显示、结果与证据可追溯、无横向溢出；不把受理当成功。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布） |
| P31 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / What runs | 实现完成 | 独立宿主 supervisor、来源轮询、Codex 进程或 API agent loop 和外置 watchdog。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布） |
| P32 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Prerequisites | 实现完成 | Node 和所选后端/沙箱检查；API 密钥变量存在检查不冒充远端认证。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布）; 本机历史证据（未发布） |
| P33 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Accounts | 实现完成 | 独立 gh/飞书 bot CLI 与凭据入口可配置，managed worker 隔离宿主能力；本机仍使用现有账号，未建立独立 OS 账号。 | 真实身份读取；专用账号部署未验证 | src/config.ts; src/codex.ts; src/work-runner.ts; 本机历史证据（未发布） |
| P34 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Install | 实现完成 | 0.4.0 已用官方 CLI 安装；新连接 20 工具。旧桌面目录缓存通过稳定 agent_context 入口兼容，未声称新名称已刷新。 | SDK＋真实桌面兼容调用 | 本机历史证据（未发布）; 本机历史证据（未发布）; ../plugins/codex/plugin.json |
| P35 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Machine configuration | 实现完成 | 配置验证、绝对路径、单状态目录锁、通用来源和工作目录。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/config.ts; tests/workspace.spec.ts |
| P36 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Start and stop | 实现完成 | LaunchAgent 启停、取消轮询、独立监督和意外退出后恢复。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布）; tests/runtime.spec.ts |
| P37 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Settings | 实现完成 | 持久设置版本和暂停；来源部署改动要求受控重启。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/settings-approval.spec.ts |
| P38 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Setup checks | 实现完成 | 运行环境/来源身份 setup 检查及具体修复提示；控制台再次检查、成员预览/应用和故障计数。 | 自动化＋真实身份/群目录 | src/setup.ts; src/server.ts; 本机历史证据（未发布） |
| P39 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Try it | 实现完成 | 真实本地文档、代码、桌面 MCP、飞书真人触发与 GitHub 草稿链路。 | 见所列测试或真实记录，不代表所有边界均已实测 | 本机历史证据（未发布）; 本机历史证据（未发布） |
| P40 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Upgrade | 实现完成 | 一致 DB 备份、校验、离线排他恢复及实际两套源码的升级/回退/再升级。不是工作文件或外部副作用回滚。 | 自动化＋隔离版本演练＋真实服务升级 | tests/backup.spec.ts; 本机历史证据（未发布）; 本机历史证据（未发布） |
| P41 | [006-deployment.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md) / Troubleshooting | 说明 | 提供 writer 冲突、外部不确定写入、备份、停止服务处理方法。 | 文档/范围说明 | README.md |
| P42 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Core classes and glue | 实现完成 | 领域核心原样复制；本宿主实现 ports。 | 见所列测试或真实记录，不代表所有边界均已实测 | docs/upstream-core-sha256.json |
| P43 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Dependency rules | 实现完成 | 领域不依赖 Codex、HTTP、SQLite 或具体平台。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/vendor/dsh-core |
| P44 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Modules | 实现完成 | 领域、多后端执行、作业、作用域工具、资源、来源、审查、交付/合并、设置、监督与 MCP 分离。 | 见所列测试或真实记录，不代表所有边界均已实测 | src/ |
| P45 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Tests | 实现完成 | TypeScript 检查和 293 项测试通过，其中 113 项来自原型核心；真实和隔离验收另列证据。 | 自动化＋分层验收 | 本机历史证据（未发布） |
| P46 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Persistence | 实现完成 | 事务化业务/队列/出箱；发送前持久意图；重启不会盲目重发 uncertain。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; src/store.ts |
| P47 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Model-facing interfaces | 实现完成 | 共享分页 reader 覆盖原型资源族与图片；原生工具、scoped MCP、操作员 MCP、HTTP、控制台共用；工作与父代理能力有撤销检查。 | 自动化＋真实 Codex/来源＋SDK | tests/resources.spec.ts; 本机历史证据（未发布）; 本机历史证据（未发布）; 本机历史证据（未发布） |
| P48 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Configuration reload | 实现完成 | 策略/团队提示词动态生效，工具步与后续 turn 记录版本；来源部署变更采用受控重启，保留输入与原生会话。 | 真实 Codex＋真实服务重启 | src/settings.ts; 本机历史证据（未发布）; 本机历史证据（未发布） |
| P49 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Reviewing a change against real data | 说明 | 真实来源验收只在用户授权仓库/群及隔离 worktree；原 checkout 未改业务内容。 | 文档/范围说明 | 本机历史证据（未发布） |
| P50 | [007-architecture.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/007-architecture.md) / Open questions | 说明 | 保留原型的信任与独立部署问题，不以单机测试证明团队隔离。 | 文档/范围说明 | README.md |
| P51 | [008-cookbook.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md) / Add a Source | 实现完成 | 新来源通过 Source 接口实现身份、线程、投递、上下文、轮询与可选去重，不改核心。 | 见所列测试或真实记录，不代表所有边界均已实测 | tests/runtime.spec.ts; src/sources.ts |

0.6.0 新增三个直接 API 执行后端；各后端验收层级独立记录在 [后端验收](BACKEND_ACCEPTANCE.md)。API 能力不能从历史 Codex 实测推定。

0.7.0 重新核对了原仓库当前提交，15 个核心文件未变化。逐章节的当前测试名称与实机边界见 [结构化验收索引](acceptance/parity-2026-11-04.json)，新增真实 Linux、企微 SDK、办公成员确认及搜索验收见 [0.7.0 记录](ACCEPTANCE_0.7.md)。

## 适配差异

- 主模型/子代理生命周期由宿主管理。
- 合并条件从提示词建议变为宿主检查，提供逐提交或团队策略授权。
- 旧桌面工具目录缓存保留稳定兼容入口。
- 工具边界注入提示词，不干预已经发出的模型请求。
- 来源部署参数采用受控重启。
- 备份/回退只覆盖数据库和配置，工作文件及外部副作用另行处理。

## 未证明的环境与外部动作

- 真实 GitHub 合并（用户选择隔离验收）。
- 未安装客户端的产品界面；已安装客户端详见客户端验收。
- 飞书 liveEvents 的新一轮真人触发。
- 跨机器/AMD64 裸机发行版/Windows/长期运行/专用 OS 账户；Linux ARM64 VM 的真实沙箱已验收。
- 新增企微真实创建/收发：当前企业拒绝创建，用户选择暂缓。
- 插件包内 MCP 独立自动激活；当前有效入口为原生 MCP 注册。

## 2026-11-07 主动 Router 扩展说明

新增范围职责、批次研判、绑定原任务的 attach、持久定时来源与管理界面。核心 Ticket/Assignment、规则授权、observe、人工停止、结果外发与不确定效果边界继续沿用，15 个 vendor 核心文件哈希未变。定时事件为宿主生成的非真人来源，不把订阅或记忆当作授权。此项属于 AgentHub 宿主扩展，不把 Codex/dots 的所有能力或最新 DeepSeek 全部实现标记为已复现。详见 [实现与使用](ROUTER_PROACTIVE_2026-11-07.md)、[review](ROUTER_PROACTIVE_REVIEW_2026-11-07.md) 与 [验收](ROUTER_PROACTIVE_ACCEPTANCE_2026-11-07.md)。
