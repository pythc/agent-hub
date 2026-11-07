# Router / Worker 独立配置与三类后端接入

初版实现日期：2026-11-06。本文包含该次实现的配置说明与历史验收结果；当前代码已整合到 Roppo 工作区。历史测试数量不代表当前全量回归数量。

## 已实现的行为

- 每个 Worker、当前 Router 均可独立选择连接、模型、思考强度、提示词、厂商参数、可用工具及执行限制。连接本身支持默认参数；省略值继承，数组替换，嵌套对象合并，`false` / `null` 保留。
- Model services 提供 API、订阅登录、CLI 三种接入入口。API 支持已有的 Responses、Chat Completions、Anthropic 三种协议；直接订阅适配器目前实现 ChatGPT SIWC；CLI 适配器目前实现 Codex app-server。其他厂商的订阅与 CLI 适配器尚未实现。
- `execution.router.mode=host` 为持续的宿主 Router 会话；`client` 表示当前 CLI 对话就是 Router；省略或 `assessment` 保留既有分类模式。每个外部讨论绑定一个宿主 Router 会话，并串行处理该会话的输入。
- Router 通过 `worker_manage` 创建、克隆、配置、委派、追问、查看结果、暂停、恢复、取消、退休、销毁、迁移 Worker / 任务。
- 委派任务沿用 DeepSeek 领域引擎的 Trigger、Ticket、Assignment、Follow-up 与 Outbox。Worker 的报告进入内部 Router 收件箱；用户收到 Router 的汇总。持续 Router 与动态 Worker 管理是 AgentHub 扩展，不声称是 DeepSeek 上游原有实现。
- 界面 Calls 页可检查 `agent-configuration/<call-id>`，区分请求参数、实际发送参数及后端确认的模型；不把“保存配置”或“进入队列”显示成调用成功。
- 子代理使用父 Worker 后端时继承其实际参数；显式选择其他后端时使用目标连接默认模型与参数，避免把不兼容的父模型/参数带入另一种服务。父任务的工具限制仍然生效。

## 配置示例

以下是现有配置文件的片段，仍需有效的 `stateDir`、来源与工作目录。实际模型可用性取决于选中的连接与账号。

```json
{
  "backends": {
    "native": {
      "kind": "codex",
      "command": "codex",
      "args": [],
      "env": {},
      "defaults": {}
    }
  },
  "execution": {
    "backend": "native",
    "router": {
      "mode": "host",
      "backend": "native",
      "model": "gpt-6.1-terra",
      "effort": "medium",
      "prompt": "检查 Worker 的证据后再向用户报告完成。"
    },
    "management": {"enabled": true, "maxWorkers": 4, "backends": ["native"]},
    "workers": [
      {"id": "worker-1", "backend": "native", "model": "gpt-6.1-sol", "effort": "high"},
      {"id": "worker-2", "backend": "native", "model": "gpt-6.1-sol", "effort": "high"},
      {"id": "worker-3", "backend": "native", "model": "gpt-6.1-sol", "effort": "high"},
      {"id": "worker-4", "backend": "native", "model": "gpt-6.1-sol", "effort": "high"}
    ]
  }
}
```

`env` 是“子进程环境变量名 → 宿主已有环境变量名”的映射，不保存明文凭据。安装检查、登录检查、模型调用、历史读取均使用该 CLI 配置。CLI 的实际计费方式由其登录配置决定，不能从 CLI 接入推断一定消耗订阅额度。

API 连接示例：

```json
{
  "kind": "openai-responses",
  "baseUrl": "https://api.openai.com/v1",
  "model": "your-available-model",
  "apiKeyEnv": "OPENAI_API_KEY",
  "headerEnv": {"X-Project-Token": "PROJECT_TOKEN"},
  "defaults": {"effort": "medium", "maxOutputTokens": 8192},
  "parameters": {"text": {"verbosity": "low"}}
}
```

每个 Agent 的 `parameters` 合并到所选连接参数中。Responses 使用 `reasoning.effort`，Chat Completions 使用 `reasoning_effort`；Anthropic 直接设置其支持的 `thinking` / `output_config.effort`，不自动将通用 effort 翻译为另一种含义。`none` 不能降级为 `low`：Codex 的 none/minimal 必须先通过模型目录能力检查，HTTP 服务可明确拒绝不支持的参数。

厂商扩展字段可透传，但模型、消息历史、宿主工具、会话身份及最终输出 schema 由 AgentHub 管理。`text.verbosity` 和 `output_config.effort` 可以设置；它们的 `format` 子字段仍由宿主管理。Codex 参数使用 `thread` / `turn` / `config` 命名空间，仅接受当前适配器确认支持的字段。API 的 `maxSteps`、`maxToolCalls`、`maxOutputTokens` 不能伪装为 Codex 支持；对 Codex 设置这些字段会明确报错。`timeoutMs` 可用于两种传输。

## 官方订阅登录

连接使用 `kind: openai-responses`，固定公共端点 `https://api.openai.com/v1`，配置：

```json
{
  "subscription": {
    "provider": "chatgpt",
    "account": "personal",
    "owner": {"source": "local", "actor": "operator"},
    "backgroundAuthorized": true
  }
}
```

这是 API 连接的认证方式，不能同时填 `apiKeyEnv`。在 Model services 选择订阅接入并打开官方登录；宿主发起 loopback OAuth + PKCE，检查 state、nonce、签名、issuer、audience、账号及所需 scope，保存发放的 client ID，串行刷新并保存轮换的令牌。退出会终止当前登录、清除本地令牌并尝试远端撤销，撤销结果单独返回。

凭据保存在宿主私有状态目录的 `subscription-accounts`，不进入设置历史或状态输出。调用要求来源/操作者与配置的 owner 匹配，并明确允许后台任务。推理使用 `stream: true`、`store: false`；只有 `response.completed` 算完成，断流、失败与不完整响应均不会假报成功。没有付费 API 自动回退；没有实现订阅剩余额度查询，状态显示未知。

依据官方 [SIWC 快速开始](https://developers.openai.com/siwc/quickstart)、[登录协议](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[会话管理](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) 实现。当前只有协议测试，尚未使用真实账号完成该登录与推理验收。不能将 Codex 原生账号实测算作 SIWC 验收。

## Worker 管理与恢复

先调用 `{"action":"list"}` 获取真实 Worker 和设置 revision。变更调用需要稳定的 `requestId` 与当前 revision；同一请求重试返回原回执，内容不一致则拒绝。

```json
{"action":"assign","id":"worker-1","revision":0,"requestId":"sum-1","discussion":"my-cli-session","text":"计算 1+1","acceptance":"返回准确结果"}
```

获取返回的 `ticketId` 后调用 `result`，可选 `waitMs` 0–5000；queued 不代表完成。宿主 Router 的 Worker 报告会自动唤醒原 Router 会话，CLI Router 通过 MCP 读取报告后在原对话回复。

| 操作 | 行为 |
| --- | --- |
| configure / set_prompt | 修改后续激活的参数或提示词；已有任务不会静默切换后端身份 |
| pause | 阻止后续调度，不强杀正在执行的任务 |
| retire | 拒绝新委派，允许已有任务排空 |
| cancel | 停止指定任务的真实执行及受管工作 |
| destroy | 有任务时必须显式 `cancelRunning`；先暂停调度再取消；保留历史、工作目录及产物，不复用退休身份 |
| migrate | 仅允许空闲任务；保存旧会话和结果快照，下一次明确 follow-up 开启新后端会话，不自动重做已有操作 |

销毁等待期间若配置被其他操作修改，取消删除并返回冲突。开始执行的取消/销毁操作有持久回执，可在重启后对账。同一原生会话只允许一个写入者；绑定的连接、端点或账号身份变化需要明确迁移。

CLI 前台模式必须由 CLI 自身的设置选模型和 effort，宿主设置不能修改已启动的前台 CLI。`/request` 在 client 模式返回明确指引，避免额外启动第二个 Router；使用 `worker_manage` 的 assign/result 完成委派。

## 验证结果与边界

验证命令：`npm run typecheck`、`npm test -- --reporter=dot`、`git diff --check`。最终结果记录在下方验收表；测试总数包含此前七项修复的回归用例，不都是本次新增。

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript、全量测试与 diff 检查 | 通过；最新前台入口版本为 31 个测试文件 / 412 个用例 | 本工作树测试；能力实现前基线为 381 个用例 |
| 真实宿主 Router + Codex 四 Worker | 通过 | `native-smoke-v3/evidence.json`：Router Terra/medium；四 Worker Sol/high；2/4/6/8；同一 Router 会话只向用户发送一次 `VERIFIED 2 4 6 8`；无在途调用 |
| Codex CLI 前台 + stdio MCP | 后续已通过两轮实测 | 原 never 拒绝证据保留；正常批准机制、四 Worker 和同会话续聊见 [前台验收记录](CLI_ROUTER_ACCEPTANCE_2026-11-06.md) |
| 浏览器 | 通过 | `browser-evidence.json`、桌面/390px 截图；独立参数保存重载、无效 JSON 阻止保存、三类连接保存、订阅选项与 JSON 双向同步、减少动态效果、键盘焦点、无页面异常 |
| SIWC | 协议测试通过，真实账号未验收 | OAuth、刷新、退出、身份/scope 拒绝、SSE 截断与大小限制、所有者约束测试 |
| DeepSeek 核心 | 未修改 | `src/vendor` 无差异，沿用此前核心一致性检查 |
| 原实例 | 未更改 | 原 checkout 保持干净；没有重启或应用新配置 |

原始实测证据保存在本机私有目录，不随源码发布。失败的前两次宿主实测也保留：第一次发现分类器提示词与持续 Router 职责冲突，第二次发现 Worker 误把父请求当作完整任务；均已修复，并补充对应回归断言。

可重复的隔离示例为 `examples/agent-capabilities-smoke.ts`、`examples/cli-router-smoke.ts`、`examples/capabilities-ui-preview.ts`。用 `AGENTHUB_CODEX` 指定实际 Codex 二进制、`AGENTHUB_SMOKE_DIR` 指定新证据目录；前两个会真实调用模型。前台示例现使用 on-request + auto_review 的正常批准机制；拒绝或调用失败时明确失败。

本轮没有实现 Gemini / Claude CLI、其他厂商直接订阅适配器、多套命名 Router 配置、费用预算/剩余额度、所有厂商能力的自动探测。扩展字段与连接模型已可扩展；这些能力不能标为已支持。
