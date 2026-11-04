# 执行后端

AgentHub 的客户端入口、任务来源和执行后端独立。MCP 客户端调用操作员工具；执行后端承担路由、主代理和子代理的模型推理。接入 Cursor、Codex 桌面或 Claude 客户端，并不会自动取得其订阅对应的 API 凭据。

0.6.0 提供四种执行后端：

| kind | HTTP 路径 / 接入方式 | 会话保存 | 原生桌面接管 |
|---|---|---|---|
| `openai-responses` | `POST <baseUrl>/responses` | 宿主保存 input、output、reasoning 和工具回执，`store=false` | 无 |
| `openai-chat` | `POST <baseUrl>/chat/completions` | 宿主保存 messages、reasoning_content 和工具回执 | 无 |
| `anthropic` | `POST <baseUrl>/messages` | 宿主保存 content、tool_use/tool_result 和推理块 | 无 |
| `codex` | 本机 Codex App Server | 原生 Codex thread | 有 |

三个 API 后端直接发 HTTP，不调用 Codex CLI。当前采用非流式请求；没有自动压缩上下文、后端自动切换或跨供应商迁移。兼容服务必须实际支持所选协议、模型工具调用和所选输出格式；兼容其中一个协议不代表支持所有模型能力。[验收范围](BACKEND_ACCEPTANCE.md) 单独记录。

## 配置

完整模板见 [config.backends.json](../examples/config.backends.json)。使用前替换模型名，设置密钥环境变量，再启动一个独立实例：

```sh
./start.sh backends list
./start.sh backends list examples/config.backends.json
./start.sh check examples/config.backends.json
./start.sh serve examples/config.backends.json
```

模板使用独立状态目录 `.agenthub-api`、端口 4330，默认选择 Responses，并关闭 shell。密钥值仅由宿主进程环境读取；配置文件只保存 `apiKeyEnv` 名称。常驻服务必须在其进程环境中注入对应变量，终端中已设置不意味着 LaunchAgent 已获得它。不要把密钥写进 URL、`parameters`、配置或聊天。

```json
{
  "execution": {
    "backend": "responses",
    "roles": {"router": "chat", "worker": "responses", "subagent": "anthropic"}
  },
  "backends": {
    "responses": {"kind": "openai-responses", "baseUrl": "https://api.openai.com/v1", "model": "YOUR_OPENAI_MODEL", "apiKeyEnv": "OPENAI_API_KEY"},
    "chat": {"kind": "openai-chat", "baseUrl": "https://api.openai.com/v1", "model": "YOUR_CHAT_MODEL", "apiKeyEnv": "OPENAI_API_KEY"},
    "anthropic": {"kind": "anthropic", "baseUrl": "https://api.anthropic.com/v1", "model": "YOUR_ANTHROPIC_MODEL", "apiKeyEnv": "ANTHROPIC_API_KEY"}
  },
  "work": {"sandboxDriver": "disabled"}
}
```

这个片段应合并到包含 `sources` 的完整模板。按角色分配会把该角色所需的提示词和任务数据发送给相应服务；只有需要时才选择不同供应商。也可以定义多个同协议后端，使用不同地址、模型或凭据变量。HTTPS 可指向兼容服务；仅回环地址允许 HTTP。认证使用 OpenAI Bearer 或 Anthropic `x-api-key`，不跟随重定向。

`codex` 是兼容旧配置的隐式默认后端，该 ID 不能重定义为 API 协议。纯 API 实例应显式选择 API 后端，并把命令沙箱改为独立驱动或 disabled；仅改 `execution` 而保留默认 Codex 命令沙箱，执行 shell 时仍需要 Codex。需要时可显式定义 `{"kind":"codex","command":"/absolute/path/to/codex"}`。

## 模型、参数和会话

- 后端 `model` 是 API 新会话默认值；`models.router/worker/subagent` 可以覆盖相应角色的新会话模型。顶层 `model` 和 `effort` 保留给 Codex。混用供应商时不要把某供应商模型名作为其他角色的全局覆盖。
- `execution` 可在设置页按版本保存。已有工作固定原后端、原模型、原目录；新设置用于新会话。更改默认后端不能迁移已有工作。
- 后端定义属于启动配置，修改后受控重启。删除仍有会话的后端，或改变其协议/地址，会拒绝继续该会话，避免静默把历史发送给另一服务。修改模型默认值不改变原会话模型。尚无自动迁移命令。
- 已保存的动态设置优先于启动文件中的同名字段。现有实例要更改 `execution` 或 `work`，应通过版本化设置保存；全新模板使用独立状态目录避免继承旧设置。
- `parameters` 传递供应商的其他 JSON 参数，例如 `temperature`、`reasoning`、`thinking`。不能覆盖受管理的 model、history、tools、stream、store、输出格式或 token 上限。宿主不保证每个兼容模型支持这些参数。
- `maxOutputTokens` 默认 8192。Chat 默认使用 `max_completion_tokens`；仅支持旧字段的兼容服务设置 `chatTokenField: "max_tokens"`。Responses 使用 `max_output_tokens`，Anthropic 使用 `max_tokens`。
- `outputFormat` 默认 `prompt`：提示模型输出 JSON，并用本地 schema 校验；失败最多修正两次。`json-schema` 额外启用供应商结构化输出；`json-object` 启用 OpenAI JSON 模式。Anthropic 的 `json-object` 与 prompt 模式相同，使用本地校验。模板的 json-schema 要求所选模型支持该功能，否则改用 prompt。
- `images` 默认 false。启用前确认模型支持图片。图片保持协议要求的工具结果顺序；未启用时不向模型发送图片字节。纯文本工具仍可使用。
- 每轮默认最多 64 次模型请求、256 次工具调用，单请求/响应默认上限 16 MB，HTTP 超时 120 秒；整个 turn 还有 `turnTimeoutMs`。超限会失败并保留历史，需要明确处理上下文，不会自动丢弃历史或转发给其他模型。

`models` 资源同时列出后端和角色分配。API 返回 `configuredOnly=true`；它是配置清单，不是远端模型发现或凭据验证。setup 只检查环境变量存在和本地依赖，也会明确返回 `remoteVerified=false`。

## 工具和生命周期

三个 API agent loop 将同一组宿主工具转换为各自协议：Responses 的 function_call/function_call_output、Chat 的 tool_calls/tool 消息，以及 Anthropic 的 tool_use/tool_result。模型不能直接执行本机 shell、调用未注册工具或绕过工作作用域。工具输入经过 JSON schema 和宿主权限双重校验。

文件、资源、图片、shell、后台作业、子代理、停止、同讨论跟进和历史查看共用宿主实现。API 的 `api:<backend>:<uuid>` 是宿主会话 ID，不是客户端原生聊天 ID。控制台不会对 API 工作显示 Codex 深链接或接管按钮；`agent_takeover` 也会在改变状态前拒绝。使用 `agent_read` 读取 `ticket/<id>/transcript` 和 `ticket/<id>/message/<n>`。

steer 在下一次模型请求追加操作员说明，提示词刷新也在下一请求生效；中断会取消正在进行的 HTTP 请求。已经开始的工具可能已经产生副作用，仍应查看其作业/外部状态，不能把“停止模型请求”视为撤销外部动作。

工具调用开始前持久化意图，完成后持久化回执。进程中断后，保留的完成结果会补回协议消息；缺少完成回执的调用标记为不确定，不自动重放。同一个调用 ID 不允许重复执行。宿主的 requestId、投递和合并核对继续生效，无法因此证明外部系统提供了事务回滚。

## 不依赖 Codex 的命令沙箱

| sandboxDriver | 环境 | 验收 |
|---|---|---|
| `seatbelt` | macOS `/usr/bin/sandbox-exec` | 本机真实命令、权限、进程回收以及三种 API 工具接入均通过 |
| `bubblewrap` | Linux 已安装 `bwrap`，允许用户命名空间 | 参数构造已测，尚未 Linux 实机验收 |
| `codex` | 已安装 Codex CLI 的平台 | 兼容原有驱动；独立于模型后端选择 |
| `disabled` | 所有平台 | 不提供 managed shell，保留读取与子代理 |

驱动不可用时失败，不回退成无限制命令。只读/可写范围、附件、独立临时目录、宿主状态拒绝访问与环境变量白名单由宿主管理。Windows 尚无新增的独立沙箱驱动；可使用可用的 Codex 驱动或关闭 shell。单用户进程仍不能替代独立 OS 账号或多租户隔离。

## 升级和回退

0.6.0 使用数据库 schema 3；0.5.0 为 2。升级前使用 `backup` 保存一致快照，并原样保留旧版启动 JSON 和 0.5.0 源码。备份中的 config.json 是运行该备份命令的版本解析后的配置；若用 0.6.0 备份旧库，其中也会包含新字段，不能直接给 0.5.0 使用。`restore` 替换数据库，不自动改写启动 JSON。

旧程序会拒绝新库。回退必须停止宿主/监督器，使用 `restore` 恢复**升级前**备份，再用旧源码和原始旧配置启动；不能让旧程序打开含 API 会话的新库。恢复会先保留当前库快照，但升级之后的新工作不会合并回旧备份。演练包含旧/新 Runtime 实际构造、读取保存的动态设置和关闭，未只检查 SQLite 版本。

可用两套源码重演：

```sh
node --import tsx examples/upgrade-backends-acceptance.ts /absolute/path/to/agent-hub-0.5.0
```

数据库备份包含 API 消息与工具回执。它不包含工作文件、Codex 用户目录、环境变量密钥，也不会撤销消息、推送或合并。历史与备份含任务内容，应与宿主状态一起妥善保管。

## 真实服务复验

设置服务的密钥环境变量、地址与支持工具的模型后，可逐个运行：

```sh
node --import tsx examples/backend-smoke.ts examples/config.backends.json responses
node --import tsx examples/backend-smoke.ts examples/config.backends.json chat
node --import tsx examples/backend-smoke.ts examples/config.backends.json anthropic
```

脚本会产生实际 API 费用。它使用独立合成文件和数据库，不启动配置中的外部来源；要求真实路由、文件工具、结果发送及第二轮同会话接续全部成功才通过。报告保留在 `.local/provider-smoke-*`，失败时保留状态供核查。

协议实现依据：[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)、[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)、[Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)。兼容服务可参考 [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls/) 和 [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)，本机未安装 Ollama，未进行其模型实测。
