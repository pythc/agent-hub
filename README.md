# AgentHub 0.6.0 · 智能助手中心

一个可选择 OpenAI Responses、Chat Completions、Anthropic Messages 或原生 Codex 的通用后台协作宿主。用户从普通对话提出请求，在原话题继续跟进；内部 Ticket 负责持久化，不要求用户填工单。文档、分析、非 Git 工作目录、代码 worktree 和自定义来源都受支持。

沿用官方 `deepseek-ai/dsh-superagent-prototype` 的领域核心，独立实现多后端执行、来源、资源、控制台及生命周期。见 [51 项原型对照](docs/PARITY.md) 与 [客户端验收](docs/clients/ACCEPTANCE.md)。对照表分别记录实现和验收层级，不把协议测试当成所有客户端的产品实测。

## 本机使用

需要 Node 22.19+，以及一个已配置的执行后端。默认兼容旧配置，使用已登录的 Codex CLI；纯 API 模式不要求安装 Codex，见 [多后端配置](docs/BACKENDS.md)。源码运行还需要开发依赖，使用 `npm ci`，不要省略 devDependencies。启动后控制台默认位于 http://127.0.0.1:4319 。macOS 常驻服务可用 `examples/generate-launch-agents.ts` 生成宿主和 Watchdog 配置，检查后按需安装。连接令牌在 `.superagent/access-token`，不要放入聊天、仓库或共享包。

新实例使用独立的状态目录和端口：

```sh
npm ci
./start.sh serve examples/config.json
./start.sh status http://127.0.0.1:4319 .superagent/access-token
./start.sh request http://127.0.0.1:4319 .superagent/access-token local docs request-001 请比较文件
```

同一讨论沿用 discussion；同一消息重试沿用 request-id；新消息使用新 ID。本地操作员身份来自配置，客户端不能自行指定。

## 执行后端和后台生命周期

每项工作复用同一个执行会话。Codex 保留原生 thread；三个 API 后端由宿主持久化完整协议消息和工具回执。新工作可按 router/worker/subagent 分配后端；已有会话固定原后端，不因设置变更自动迁移。工作工具是 `superagent_read/shell/job/spawn/follow/ack/progress/publish/review`，由宿主按工作、Assignment 和子代理父链校验。原生 shell、子代理、外部 MCP、插件、浏览器和桌面工具在 managed worker 中禁用。Codex 新会话使用 dynamic tools，旧会话使用 scoped MCP 桥接；API 模型通过各自协议的 function/tool 调用访问同一组宿主工具。不会为升级 fork 新会话。

- 主 worker 命令等待最多 5 秒，子代理最多 60 秒；之后作为持久作业返回。输出有大小限制和分页。
- 后台 shell 或子代理运行时保留执行槽；完成通知唤醒同一个 worker。前台已经取回的结果不重复唤醒。
- 每次 turn 结束后默认最多等待 30 分钟；到期杀死 shell、收集结果并释放槽位，子代理可继续。实际时长可配置，验收用缩短期限验证同一逻辑。
- ready、问题、blocked/failed 或人工接管时释放槽位并停止子代理。用于评审的 root shell 服务可以继续，直到 Assignment 结束；它不占槽、不再自动唤醒，并在后续 turn 中保持豁免。
- Assignment 结束后等待作业及子代理树关闭，再启动替代工作。崩溃后 runner 监测宿主和锁的变化，终止自己的进程组；新宿主不会向历史 PID 盲目发信号。
- 普通并发之外为人类跟进保留一个槽。机器人/CI 不占用这个额外槽；路由与执行分开调度。
- 重启后忙碌 Assignment 自动恢复，保留原执行会话、工作目录和输入，加入核对说明；旧命令不自动重放。不确定的外部发送、发布和合并仍需核对。

后台命令可选择 Codex sandbox、macOS Seatbelt 或 Linux Bubblewrap，限制在工作目录和明确读取的附件；宿主状态目录禁止访问，环境变量不转发来源令牌或模型密钥。`work.sandboxDriver=disabled` 可以关闭命令，仍保留文件读取和子代理。macOS 独立沙箱已实测，Linux 仅完成参数测试；没有不受限进程的自动回退。它仍是单用户进程部署，不能据此声称完成团队或跨主机隔离。

## 工作目录与来源

只读工作可使用配置目录。可写 GitHub 工作默认创建独立 `superagent/<hash>` worktree。非仓库可写来源默认创建独立目录，也可明确配置 `workspace.mode=directory`；prepare 命令失败可重试。只有显式 `workspace.mode=source` 才直接在来源目录写入。

GitHub 支持 Issue、讨论评论、内联审查及无正文审批、CI、关闭/合并事件，按精确任务分支发现自有 PR。回复在原会话或原内联线程发送，用唯一标记核对不确定写入。每个订阅线程独立保留轮询游标和失败次数，某个线程失败不阻塞其他线程。源账号可通过独立的 gh 包装命令或 `github.tokenEnv` 配置；HTTP 凭据只发往 api.github.com。

飞书支持 bot CLI 或应用凭据环境变量、配置群及话题补拉、原话题回复、原文/上下文/图片/附件读取。`feishu.liveEvents=true` 启用机器人事件消费者；`otherChats=mentions` 只发现提及机器人的其他群，`directMessages=true` 才接收未配置私聊。默认均关闭；不会改变现有允许账号列表。实时消费者等待就绪标记，按消息原文去重，并在停止时关闭 stdin、发送 SIGTERM。

`memberSync={enabled:true,scope:"群ID"}` 可从指定目录同步允许列表。控制台也提供“预览成员同步”与显式应用：空目录、过期预览及版本冲突均保留原列表。独立配置来源和凭据入口不等于本机已建立独立系统账号。

自定义来源实现 `src/sources.ts` 的 Source 接口，可选身份、成员目录、只读资源和实时监听，不修改领域核心。受信连接器通过 `POST /events/<source>` 和配置的 tokenEnv 提交已验证身份的事件；不要把它直接当作未经平台签名验证的 webhook。

## 交付与条件自动合并

默认 `delivery.workerPublish=false`、`autoMerge=false`。操作员可以调用 `agent_deliver_pr`；显式启用 workerPublish 后，root worker 可通过受控工具提交并发布自己分支的草稿 PR。提交大小上限与自动合并阈值分别配置。发布核对 fetch URL 和全部 push URL，防止隐藏 pushurl 指向其他仓库。

自动合并支持 `authorization=per-head`（默认，逐个 SHA 授权）或 `policy`（显式团队策略授权）。两种方式都要求：工作自有 PR、分支与仓库一致、ready 且没有未处理输入、非草稿、可合并、当前 head 的人类审批及指定审查者、CI 通过、审查线程已处理、变更行数低于阈值，且使用不同于代理账号的 mergeGh。

每次 PUT 携带预期 head SHA。推送新版本前撤权；提交前再次核对授权与运行状态；暂停和关闭阻止新的提交。合并意图先持久化，丢失响应后保持 uncertain 并先观察远端，不盲目重发。审批和 CI 是提交前快照，合并瞬间的强制规则应由 GitHub 分支保护执行。

内联审查支持“修复并验证后解决”或“一次简短解释后解决”。修复要求成功的 managed 验证作业、已发布且干净的当前 head；head 改变后拒绝沿用旧验证。自动审查默认最多处理三个不同 head 的轮次，人类审查不受此限制。

本轮按照用户选择只做隔离合并验收，未在真实 GitHub 仓库合并任何 PR。

## 资源、提示词和控制台

原型资源族均通过同一 reader 暴露：工作、输入、Assignment、报告、执行会话历史、事件、讨论、判断、设置、提示词版本/预览/默认部分、执行后端及模型目录、GitHub 原文/审查/CI/仓库文件、飞书上下文/图片/附件，以及 jobs 和本地文件。`catalog` 列出语法。正文使用快照游标分页，列表使用 offset；图片返回实际图片内容。

worker 只能读自己工作、可达事件及相关讨论；全局设置、判断、模型目录等由操作员读取。跨工作、过期 Assignment、父代理撤销、游标串用、路径穿越和符号链接逃逸都有拒绝测试。

`execution.backend` 选择默认后端，`execution.roles.router/worker/subagent` 可覆盖各角色。后端定义包含协议、地址、模型与密钥环境变量名；`models.router/worker/subagent` 可覆盖新会话的模型。旧顶层 `model` 是 Codex 的默认模型。API 模型目录只展示配置，不声称已验证远端认证。

兼容原型全部 15 个内置提示词键，保留旧键别名、团队文本/技能、版本历史、默认升级提示和冲突校验。每轮开始读取最新版本；managed 工具调用前后检查变更，Codex 用 `thread/inject_items` 在同一 turn 中注入；API 后端在下一次 HTTP 请求采用新提示词，并记录实际使用的版本。它不是修改已经发出的模型请求，也不宣称能够干预 Codex 未暴露的内部推理过程。

控制台包括关注、来源、讨论、判断、执行、Eval、资源、模型、提示词和分组设置。高级 JSON 编辑保留；保存、回退和成员同步都有版本校验。

## 客户端接入

同一个宿主可从 Codex、Cursor、VS Code、WorkBuddy 等 MCP 客户端接入。客户端与执行后端独立：例如 Cursor 可调用使用 Anthropic 的宿主，Codex 桌面也可调用使用 OpenAI API 的宿主。支持的三个 API 协议及原生 Codex 见 [后端指南](docs/BACKENDS.md)；新执行器实现 `src/model.ts` 的 Model 接口，来源实现 Source 接口。客户端订阅和登录不会自动变成其他服务的 API 凭据。

```sh
./start.sh clients list
./start.sh clients config cursor
./start.sh clients install cursor
./start.sh clients install vscode --workspace /absolute/path/to/project
./start.sh clients install workbuddy
```

安装器仅修改命名的 `agent-hub` 条目，保留其他服务器、设置和 JSONC 注释。存在同名但不同的条目时先拒绝，检查后才使用 `--replace`。每次修改返回独立备份 ID；回退拒绝覆盖之后的用户修改。配置只保存令牌文件路径，不嵌入令牌。Mac 全局路径、各客户端官方说明、信任/重启步骤和其他平台的 `--file` 用法见 [客户端指南](docs/clients/README.md)。

Codex 输出 TOML，不自动改写已有 TOML；通过官方 MCP 配置入口合并。`examples/generate-plugin.ts` 可生成本机路径对应的 Codex 插件 MCP 文件。保留旧 `superagent-local` 入口兼容已有桌面聊天；旧工具目录缓存可通过 `agent_context(source="$agent", thread="catalog")` 读取资源。插件包内 MCP 自动激活与原生 MCP 注册分别验收，不能相互替代。

`agent_takeover` 仅对支持原生接管的 Codex 后端开放，中断后台执行并暴露原生聊天。API 后端使用资源历史、停止、steer 和同讨论跟进，不能打开不存在的客户端原生聊天。交还后若 Codex 桌面的空闲 writer 仍占锁，通过官方归档入口归档该 worker，再重试。宿主恢复和归档同一个 thread；CLI 人工接管则退出 `codex resume`。

## 检查、升级和回退

运行中在控制台或 agent_setup_check 检查环境与来源身份；离线可用 `./start.sh check CONFIG`。检查结果包含具体缺项和修复方式。不要对正在运行的同一状态目录再启动 CLI 宿主。

```sh
./start.sh backup examples/config.json .superagent/backups/before-upgrade-UNIQUE
./start.sh verify-backup .superagent/backups/before-upgrade-UNIQUE
```

备份是 SQLite 一致快照和当前版本解析后的配置，不是工作目录、原生 Codex 用户目录及凭据的完整备份。保留旧源码和原始启动 JSON，并另外备份这些目录；新程序归一化后的配置可能含旧版不认识的字段。恢复不会自动改写启动 JSON。停止宿主及 supervisor，确认锁释放后才能恢复：

```sh
./start.sh restore examples/config.json .superagent/backups/before-upgrade-UNIQUE
```

恢复先备份当前数据库，再校验和替换；旧程序拒绝新数据库。历史版本 0.3.1 → 0.4.0，以及本轮 0.5.0 → 0.6.0 → 恢复 0.5.0 → 再升级，均用两套源码演练。0.6.0 将 schema 从 2 升到 3；必须保留升级前备份才能退回 0.5.0。旧程序拒绝读取新库，不能直接换旧源码启动。此演练验证版本和数据库回退，不会撤销工作文件修改、已发送消息、Git 推送或合并。

## 验证与范围

`npm run check` 执行 TypeScript 检查及 274 项测试，其中 113 项来自原型核心。15 个原型核心源码保持下载基线哈希一致，清单在 `docs/upstream-core-sha256.json`。

三个 API 后端已通过隔离 HTTP 与真实 Runtime 的工具、子代理、重启后接续测试，测试使用不存在的 Codex 路径。真实商业 API 模型调用尚未验收，详见 [后端验收](docs/BACKEND_ACCEPTANCE.md)。

0.5.0 在本机真实 Cursor、VS Code 和 WorkBuddy 界面验收工具调用与异步结果，并检查跨端原生会话接续；未安装客户端只记录官方文档适配和 stdio 协议结果。具体记录见 [客户端验收](docs/clients/ACCEPTANCE.md)。历史版本已完成 Codex 桌面接管/交还和原会话续办、后台 shell/subagent、图片读取、提示词工具步更新及崩溃恢复实测；原始记录保留在本机，未随源码上传。

条件自动合并完成隔离 HTTP 成功/故障验收，真实 GitHub 合并仍未验证。尚未完成跨机器、Windows、干净机器、专用 OS 账号及长期运行验收。工作文件和外部副作用不在数据库回退范围内。
