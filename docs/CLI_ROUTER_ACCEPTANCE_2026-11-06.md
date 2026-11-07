# Codex CLI 前台 Router 验收

2026-11-06，独立工作树 `codex/deepseek-parity-fixes-20261106`。本轮完成前台 CLI → stdio MCP → AgentHub 四 Worker → 同一前台 Router 汇总，并完成原任务范围内的续聊。原运行实例没有重启或改配置。

## 授权机制

之前的 `approval_policy=never` 无法处理 `worker_manage` 的批准请求。本轮使用本机 Codex `0.166.0-alpha.6` 的正常自动审查入口：

```toml
approval_policy = "on-request"
approvals_reviewer = "auto_review"
[mcp_servers.agenthub-router]
enabled_tools = ["worker_manage"]
required = true
[mcp_servers.agenthub-router.tools.worker_manage]
approval_mode = "prompt"
```

启动使用 `codex exec --approve-for-me`，保留 workspace-write 沙箱与网络限制。配置只作用于该进程，不写用户 `config.toml`。没有使用 bypass 参数、批量预批准或把写操作伪装成只读；真正的 Worker 调用始终走 MCP。

官方依据：[自动批准审查](https://learn.chatgpt.com/docs/agent-approvals-security)、[MCP 工具批准配置](https://learn.chatgpt.com/docs/extend/mcp)。自动审查有额外模型调用成本；本轮未尝试推算其费用或订阅余额。

## 可用入口

实现：`src/codex-router.ts`，CLI 分支：`src/cli.ts`。它读取目标宿主当前设置，要求 `execution.router.mode=client`、Worker 管理已开启、Router 使用 Codex 连接，然后采用该 Router 的模型、effort、提示词和 CLI 环境配置。

在工作树内，已启动并配置好的宿主可使用：

```sh
npm start -- router http://127.0.0.1:PORT /absolute/path/to/access-token \
  --prompt '把任务分给 Worker，核验结果后向我汇总。' --json
```

从原生 `thread.started.thread_id` 取得 Router UUID，后续明确复用：

```sh
npm start -- router http://127.0.0.1:PORT /absolute/path/to/access-token \
  --resume ROUTER_UUID --prompt '请让第二个 Worker 复核原任务。' --json
```

`PORT`、令牌文件路径和 UUID 是占位符。`--json` 可省略，原生 CLI 输出直接呈现在终端。此入口是 Codex exec/resume 对话入口，本轮没有把 TUI 界面的人工点击批准作为验收项目。

该启动器当前明确支持前台模型、effort、提示词和 worker_manage；不能直接映射的 app-server 参数或 API 限制会在启动前报错，不会静默忽略。Worker 的独立参数仍由宿主的已有能力处理。

## 真实证据

证据根目录：`/Users/alex/Documents/ChatGPT/竞赛/outputs/agenthub-design-20261106/cli-router-reviewed-v2`。

| 检查 | 实际结果 |
| --- | --- |
| 前台模型 | `gpt-6.1-terra`，`medium`；原生 thread/read 与两个 turn_context 均确认 |
| 前台会话 | `01a1afe5-4c21-7503-8779-f74a8fbdb493`；两个用户消息、同一 Router 会话 |
| Worker 配置 | 四个独立原生会话，全部 `gpt-6.1-sol` / `high` |
| 首轮 | 四 Worker 分别计算 1+1、2+2、3+3、4+4；Router 最终输出 `VERIFIED 2 4 6 8` |
| 续聊 | Router 用 send 让 Worker 2 在原 ticket / 原 native thread 复核 2+2，等待新结果后输出 `RECHECKED 2 4 6 8` |
| 实际激活次数 | 总计五次；Worker 2 两次，其余各一次；其他 Worker 的 turnId 不变 |
| 用户对话路径 | 用户只进入前台 Router；五条 Worker 交付全部发往内部 routerInbox，直接发给用户为零 |
| 后台 Router | 没有启动；宿主 Router 模型调用和 router-session 记录均为零 |
| 工具路径 | 实际调用仅为 `agenthub-router.worker_manage`，全部完成 |
| 生效批准配置 | 两个原生 turn_context 均为 `on-request` + `auto_review`，沙箱为 workspace-write、网络关闭 |
| 结束状态 | 所有 Worker idle、所有调用 completed、active=0；隔离宿主已关闭 |

`evidence.json` 保存原生历史、请求命令、模型配置回执、两轮事件、委派关系和交付记录；`checks.json` 保存主验收断言；`additional-checks.json` 对保存的证据再次检查仅 Worker 2 续跑、两个用户消息和零直接 Worker 交付。Codex exec 的事件输出没有暴露逐次批准决定的独立条目，因此没有声称取得此类单条决定日志；生效审查配置和实际 MCP 调用结果已核实。

前一次 `cli-router-reviewed-v1` 的首轮也通过。其续聊故意把原任务 2+2 改成 2+3，同时禁止新委派；Worker 判定超出原任务范围，Router 如实反馈未完成。这次记录保留，未为了通过测试放宽 DeepSeek 的任务范围约束。最终 v2 验收使用原任务范围内的独立复核。

## 回归与复核

- 31 个测试文件、412 个测试通过；TypeScript 与 `git diff --check` 通过。
- 新增四项回归覆盖真实 CLI 入口的设置读取与进程启动、审查配置和工具范围、指定会话恢复、不可映射参数/错误模式的提前拒绝。
- 检查了前台与 Worker 模型分离、跟进任务的原会话绑定、配置文件保留、进程关闭与信号转发。没有修改 DeepSeek vendor 核心。
- 原宿主保持 revision 9、两个原配置 Worker、active=0；没有部署、提交或合并本工作树。

可重复完整实测：

```sh
AGENTHUB_CODEX=/absolute/path/to/codex \
AGENTHUB_SMOKE_DIR=/absolute/path/to/a-new-evidence-directory \
node --import tsx examples/cli-router-smoke.ts
```

需提供全新证据目录；会进行真实模型调用。自动审查拒绝或执行失败时保留证据并返回失败，不尝试替代路径。
