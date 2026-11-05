# AgentHub 0.10.0 · 智能助手中心

一个可选择 OpenAI Responses、Chat Completions、Anthropic Messages 或原生 Codex 的通用后台协作宿主。用户从普通对话提出请求，在原话题继续跟进；内部 Ticket 负责持久化，不要求用户填工单。文档、分析、非 Git 工作目录、代码 worktree 和自定义来源都受支持。

沿用官方 `deepseek-ai/dsh-superagent-prototype` 的领域核心，独立实现多后端执行、来源、资源、控制台及生命周期。见 [51 项原型对照](docs/PARITY.md)、[客户端验收](docs/clients/ACCEPTANCE.md) 与 [0.7.0 验收](docs/ACCEPTANCE_0.7.md)。对照表分别记录实现和验收层级，不把协议测试当成所有客户端的产品实测。

## 本机使用

需要 Node 22.19+。首次部署不需要手写 JSON、来源 ID 或复制令牌：

```sh
npm ci
./start.sh setup
```

打开终端给出的临时管理链接，选择要接入的工作软件。已有 AI 服务可以沿用；缺少服务时，直接在入口页连接已有 Codex 登录或添加 API 服务。纯 API 模式不要求安装 Codex。`setup` 默认使用私有的 `~/.agent-hub`、专用只读工作文件夹和自动保存的端口；再次运行会复用正在运行的实例。它仍要求预装 Node，源码安装依赖也仍需 `npm ci`，不是完整桌面安装包。

已有部署继续使用原配置启动，见 [多后端配置](docs/BACKENDS.md)。macOS 常驻服务可用 `examples/generate-launch-agents.ts` 生成宿主和 Watchdog 配置，检查后按需安装。

新实例使用独立的状态目录和端口：

```sh
npm ci
./start.sh serve examples/config.json
./start.sh status http://127.0.0.1:4319 .superagent/access-token
./start.sh request http://127.0.0.1:4319 .superagent/access-token local docs request-001 请比较文件
```

同一讨论沿用 discussion；同一消息重试沿用 request-id；新消息使用新 ID。本地操作员身份来自配置，客户端不能自行指定。

## 在实际工作入口使用：英文 / 中文

打开宿主的 `/configure`。普通使用者按管理员分享的说明，在飞书、企微或自己的客户端找到助手；不需要获得管理令牌或填写模型密钥。部署者进入管理工作台，选择飞书、企业微信、Codex、Cursor、VS Code、WorkBuddy、GitHub 或其他 MCP 客户端，按入口检查、连接并验证。

已有登录与配置尽量复用。飞书可以选择机器人实际可见的群，无须抄群 ID；客户端可通过按钮添加命名条目并保留备份，Codex 使用官方 CLI。客户端自身的重启、首次信任或工具审批仍须完成。后台模型、目录与权限使用默认值，只有缺少条件时补填。英文为默认语言，可切换简体中文；完整参数仍在高级设置。

完成标准是**从所选软件发起请求，并在原入口收到结果**。页面分别显示收到请求、发送者获准、实际执行和结果回传，保存配置不会直接变成验证通过。管理首页优先显示需要人处理的事项和已接入软件。网页聊天仅保留为诊断入口。

启动链接使用十分钟内一次有效的配对码，页面立即移除片段，交换同源 HttpOnly 管理会话。刷新后可继续管理，宿主进程重启后需新链接。`./start.sh open HOST_URL TOKEN_FILE` 可重新生成链接；连接文件和手动令牌保留为备用路径。长期令牌不进入 URL 或浏览器存储。临时管理链接同样应保密。

给同事分享的是可直接粘贴进团队会话的使用说明。当前 localhost 指引链接只适用于同机或安全隧道，不能当作跨机器团队门户。办公用户按来源身份准入；MCP 当前是个人操作员连接，不是多租户员工权限系统。

使用本机已有 Codex 登录的独立体验实例（会调用真实模型，使用专用只读文件夹，初次启动仅有本地入口；之后保留已保存的接入配置）：

```sh
node --import tsx examples/getting-started-demo.ts
```

离线界面预览仍可用 `examples/configuration-preview.ts`，它不执行任务。本次新增软件/模型服务创建、Router 与 1–10 个独立 Worker 配置、角色提示词和任务页，见 [配置台验收](docs/CONTROL_CENTER_2026-11-05.md)。完整说明见 [接入指南](docs/CONFIGURATION.md)，逐入口真实结果和限制见 [0.10.0 验收](docs/ACCEPTANCE_0.10.md)。

## 执行后端和后台生命周期

每项工作复用同一个执行会话。Codex 保留原生 thread；三个 API 后端由宿主持久化完整协议消息和工具回执。新工作可按 router/worker/subagent 分配后端；已有会话固定原后端，不因设置变更自动迁移。工作工具是 `superagent_read/shell/job/spawn/follow/ack/progress/publish/review`，由宿主按工作、Assignment 和子代理父链校验。原生 shell、子代理、外部 MCP、插件、浏览器和桌面工具在 managed worker 中禁用。Codex 新会话使用 dynamic tools，旧会话使用 scoped MCP 桥接；API 模型通过各自协议的 function/tool 调用访问同一组宿主工具。不会为升级 fork 新会话。

- 主 worker 命令等待最多 5 秒，子代理最多 60 秒；之后作为持久作业返回。输出有大小限制和分页。
- 后台 shell 或子代理运行时保留执行槽；完成通知唤醒同一个 worker。前台已经取回的结果不重复唤醒。
- 每次 turn 结束后默认最多等待 30 分钟；到期杀死 shell、收集结果并释放槽位，子代理可继续。实际时长可配置，验收用缩短期限验证同一逻辑。
- ready、问题、blocked/failed 或人工接管时释放槽位并停止子代理。用于评审的 root shell 服务可以继续，直到 Assignment 结束；它不占槽、不再自动唤醒，并在后续 turn 中保持豁免。
- Assignment 结束后等待作业及子代理树关闭，再启动替代工作。崩溃后 runner 监测宿主和锁的变化，终止自己的进程组；新宿主不会向历史 PID 盲目发信号。
- 普通并发之外为人类跟进保留一个槽。机器人/CI 不占用这个额外槽；路由与执行分开调度。
- 重启后忙碌 Assignment 自动恢复，保留原执行会话、工作目录和输入，加入核对说明；旧命令不自动重放。不确定的外部发送、发布和合并仍需核对。

后台命令可选择 Codex sandbox、macOS Seatbelt 或 Linux Bubblewrap，限制在工作目录和明确读取的附件；宿主状态目录禁止访问，环境变量不转发来源令牌或模型密钥。`work.sandboxDriver=disabled` 可以关闭命令，仍保留文件读取和子代理。macOS 与 Linux 独立沙箱已运行真实进程，Linux 范围及容器策略见 [Linux 验收](docs/LINUX.md)；没有不受限进程的自动回退。它仍是单用户进程部署，不能据此声称完成团队或跨主机隔离。

## 工作目录与来源

只读工作可使用配置目录。可写 GitHub 工作默认创建独立 `superagent/<hash>` worktree。非仓库可写来源默认创建独立目录，也可明确配置 `workspace.mode=directory`；prepare 命令失败可重试。只有显式 `workspace.mode=source` 才直接在来源目录写入。

GitHub 支持 Issue、讨论评论、内联审查及无正文审批、CI、关闭/合并事件，按精确任务分支发现自有 PR。回复在原会话或原内联线程发送，用唯一标记核对不确定写入。每个订阅线程独立保留轮询游标和失败次数，某个线程失败不阻塞其他线程。源账号可通过独立的 gh 包装命令或 `github.tokenEnv` 配置；HTTP 凭据只发往 api.github.com。

飞书支持 bot CLI 或应用凭据环境变量、配置群及话题补拉、原话题回复、原文/上下文/图片/附件读取。`feishu.liveEvents=true` 启用机器人事件消费者；`otherChats=mentions` 只发现提及机器人的其他群，`directMessages=true` 才接收未配置私聊。默认均关闭；不会改变现有允许账号列表。实时消费者等待就绪标记，按消息原文去重，并在停止时关闭 stdin、发送 SIGTERM。

`memberSync={enabled:true,scope:"群ID"}` 可从指定目录同步允许列表。控制台也提供“预览成员同步”与显式应用：空目录、过期预览及版本冲突均保留原列表。独立配置来源和凭据入口不等于本机已建立独立系统账号。

自定义来源实现 `src/sources.ts` 的 Source 接口，可选身份、成员目录、只读资源和实时监听，不修改领域核心。受信连接器通过 `POST /events/<source>` 和配置的 tokenEnv 提交已验证身份的事件；不要把它直接当作未经平台签名验证的 webhook。

## 办公软件入口

飞书应用机器人支持原话题请求；新增企业微信智能机器人官方 SDK 长连接，支持私聊/允许的群、接收回执、附件缓存、后台结果和重启恢复。两者都沿用同一领域规则，不绑定模型。企微真实创建受当前企业权限阻止，已按用户选择保留待办；官方 SDK 隔离联测不等于真实平台验收。

```sh
./start.sh office init feishu .local/office/feishu --chat TEST_CHAT_ID
./start.sh office init wecom .local/office/wecom
```

生成独立工作区及私有凭据文件；启动后从控制台“来源”核对收到的用户 ID，逐人允许任务准入。完整的权限、部署、群 Webhook 差异及日常使用方案见 [办公接入指南](docs/OFFICE.md)。

## 交付与条件自动合并

默认 `delivery.workerPublish=false`、`autoMerge=false`。操作员可以调用 `agent_deliver_pr`；显式启用 workerPublish 后，root worker 可通过受控工具提交并发布自己分支的草稿 PR。提交大小上限与自动合并阈值分别配置。发布核对 fetch URL 和全部 push URL，防止隐藏 pushurl 指向其他仓库。

自动合并支持 `authorization=per-head`（默认，逐个 SHA 授权）或 `policy`（显式团队策略授权）。两种方式都要求：工作自有 PR、分支与仓库一致、ready 且没有未处理输入、非草稿、可合并、当前 head 的人类审批及指定审查者、CI 通过、审查线程已处理、变更行数低于阈值，且使用不同于代理账号的 mergeGh。

每次 PUT 携带预期 head SHA。推送新版本前撤权；提交前再次核对授权与运行状态；暂停和关闭阻止新的提交。合并意图先持久化，丢失响应后保持 uncertain 并先观察远端，不盲目重发。审批和 CI 是提交前快照，合并瞬间的强制规则应由 GitHub 分支保护执行。

内联审查支持“修复并验证后解决”或“一次简短解释后解决”。修复要求成功的 managed 验证作业、已发布且干净的当前 head；head 改变后拒绝沿用旧验证。自动审查默认最多处理三个不同 head 的轮次，人类审查不受此限制。

本轮按照用户选择只做隔离合并验收，未在真实 GitHub 仓库合并任何 PR。

## 资源、提示词和控制台

原型资源族均通过同一 reader 暴露：工作、输入、Assignment、报告、执行会话历史、事件、讨论、判断、设置、提示词版本/预览/默认部分、执行后端及模型目录、GitHub 原文/审查/CI/仓库文件、飞书上下文/图片/附件，企微锚定消息/已缓存附件，以及 jobs 和本地文件。`catalog` 列出语法。正文使用快照游标分页，列表使用 offset；图片返回实际图片内容。

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

CLI 配置生成器为 Codex 输出 TOML；新版配置页调用官方 `codex mcp add` 安装命名条目并保留备份，不自行重写 TOML。`examples/generate-plugin.ts` 可生成本机路径对应的 Codex 插件 MCP 文件。保留旧 `superagent-local` 入口兼容已有桌面聊天；旧工具目录缓存可通过 `agent_context(source="$agent", thread="catalog")` 读取资源。插件包内 MCP 自动激活与原生 MCP 注册分别验收，不能相互替代。

`agent_takeover` 仅对支持原生接管的 Codex 后端开放，中断后台执行并暴露原生聊天。API 后端使用资源历史、停止、steer 和同讨论跟进，不能打开不存在的客户端原生聊天。交还后若 Codex 桌面的空闲 writer 仍占锁，通过官方归档入口归档该 worker，再重试。宿主恢复和归档同一个 thread；CLI 人工接管则退出 `codex resume`。

## 检查、升级和回退

运行中在控制台或 agent_setup_check 检查环境与来源身份；离线可用 `./start.sh check CONFIG`。检查结果包含具体缺项和修复方式。不要对正在运行的同一状态目录再启动 CLI 宿主。

```sh
./start.sh backup examples/config.json .superagent/backups/before-upgrade-UNIQUE
./start.sh verify-backup .superagent/backups/before-upgrade-UNIQUE
```

备份包含 SQLite 一致快照、当前解析后的配置，以及 0.9.0 引导保存的受管连接和 API 凭据。备份含私有密钥，需妥善保管；它不包含工作目录、原生 Codex 用户目录及外部管理的凭据。保留旧源码和原始启动 JSON，并另外备份这些目录；新程序归一化后的配置可能含旧版不认识的字段。恢复不会自动改写启动 JSON。停止宿主及 supervisor，确认锁释放后才能恢复：

```sh
./start.sh restore examples/config.json .superagent/backups/before-upgrade-UNIQUE
```

恢复先备份当前数据库，再校验和替换；schema 升级后旧程序拒绝新数据库。历史版本 0.3.1 → 0.4.0，以及 0.5.0 → 0.6.0 → 恢复 0.5.0 → 再升级，均用两套源码演练。0.6.0 将 schema 从 2 升到 3；0.7.0 提升至 4，也已完成 0.6.0 的升级/恢复/再升级演练。0.9.0 因受管连接持久化提升至 schema 5，已演练 0.8.0 → 0.9.0 → 恢复 0.8.0 → 再升级。必须保留相应升级前备份才能回退。涉及 schema 升级时不能直接换旧源码启动；0.9 与 0.10 同为 schema 5，见本轮兼容验收。此演练验证版本和数据库回退，不会撤销工作文件修改、已发送消息、Git 推送或合并。

## 验证与范围

`npm run check` 执行 TypeScript 检查及 346 项测试，其中 113 项来自原型核心。15 个原型核心源码保持下载基线哈希一致，清单在 `docs/upstream-core-sha256.json`。

三个 API 后端已通过隔离 HTTP 与真实 Runtime 的工具、子代理、重启后接续测试，测试使用不存在的 Codex 路径。真实商业 API 模型调用尚未验收，详见 [后端验收](docs/BACKEND_ACCEPTANCE.md)。

0.5.0 在本机真实 Cursor、VS Code 和 WorkBuddy 界面验收工具调用与异步结果，并检查跨端原生会话接续；未安装客户端只记录官方文档适配和 stdio 协议结果。具体记录见 [客户端验收](docs/clients/ACCEPTANCE.md)。历史版本已完成 Codex 桌面接管/交还和原会话续办、后台 shell/subagent、图片读取、提示词工具步更新及崩溃恢复实测；原始记录保留在本机，未随源码上传。

0.9.0 曾在真实 Linux ARM64 内核以普通 UID 跑通全部 312 项测试及独立 Bubblewrap 沙箱，没有跳过 Linux 命令用例。当前不是所有发行版、裸机或 AMD64 的验收。首次配置和真实浏览器请求见 [0.9.0 记录](docs/ACCEPTANCE_0.9.md)；办公适配、事件搜索和 SDK 的历史验收见 [0.7.0 记录](docs/ACCEPTANCE_0.7.md)。

条件自动合并完成隔离 HTTP 成功/故障验收，真实 GitHub 合并仍未验证。尚未完成跨机器、Windows、干净机器、专用 OS 账号及长期运行验收。工作文件和外部副作用不在数据库回退范围内。

0.10.0 的接入页、首次模型配置、真实客户端和原会话回复验收见 [完整记录](docs/ACCEPTANCE_0.10.md)。数据库仍为 schema 5，已演练 0.9.0 → 0.10.0 → 恢复 → 再升级；它不会撤销已经发送到平台的消息。

新版操作员前端已接入真实宿主：固定导航、待处理事项、任务记录、可搜索软件目录、模型服务和原会话详情。接入与浏览器验收见 [前端整合记录](docs/UI_INTEGRATION_2026-11-05.md)。
