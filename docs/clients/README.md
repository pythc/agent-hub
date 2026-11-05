# 客户端接入

AgentHub 是独立后台宿主，客户端通过 stdio MCP 桥访问它。关闭客户端不会关闭宿主。执行任务的后端可选择原生 Codex、OpenAI 两种协议或 Anthropic Messages；客户端自己的聊天模型负责调用操作员工具，二者独立。见 [后端配置](../BACKENDS.md)。

先安装 Node 22.19+，在源码根目录运行 `npm ci`，再运行 `./start.sh setup`。打开终端输出的一次性管理链接，选择“部署或管理助手”，选 Codex、Cursor、VS Code 或 WorkBuddy。页面检查现有配置、保存命名 MCP 条目，再指引你回到对应软件完成真实请求与回复验收；缺少执行模型时在同页配置。

这是宿主电脑上个人使用的操作员连接，不能把管理令牌分给普通员工。团队成员优先通过部署者授权的飞书、企微或 GitHub 入口使用。复制出的使用说明不含令牌；localhost 指引链接只适合同机或安全隧道。

已有部署可继续 `./start.sh serve examples/config.json`。该示例默认 URL 为 `http://127.0.0.1:4319`，令牌文件为 `.superagent/access-token`；个人 setup 自动分配并保存端口。多个实例必须使用不同端口与状态目录。

## 生成、安装和回退

```sh
./start.sh clients list
./start.sh clients config cursor
./start.sh clients install cursor
./start.sh clients install vscode --workspace /absolute/path/to/project
./start.sh clients install gemini --workspace /absolute/path/to/project
```

`--url` 和 `--token-file` 指向另一实例；`--name agent-hub-test` 生成独立条目。配置生成器只输出路径，不读取或打印令牌。命令和每个参数分别保存，中文与空格路径无须拼接 shell 字符串。

安装器只修改选中的服务条目，保留其他条目、设置和 JSONC 注释。同名不同配置必须明确 `--replace`，不隐式覆盖。返回的 `backupDir`、`backupId` 用于回退：

```sh
./start.sh clients restore /absolute/path/to/backupDir BACKUP_UUID
```

备份文件权限为 0600；恢复保留原文件权限。安装器拒绝符号链接和非法配置。恢复会核对安装后的文件哈希；若用户之后编辑过文件，则拒绝覆盖。它不替代多进程文件锁，操作时避免同时编辑同一个配置文件。

下表全局路径适用于 macOS。其他系统或扩展的实际配置位置，请先从客户端官方“打开 MCP 配置”入口获取，再用 `--file /actual/config/path` 安装。不会猜测并改写其他平台的用户配置。

## 各客户端配置

| 客户端 ID | 配置根/stdio 形式 | macOS 用户配置 / 项目配置 | 官方说明 |
|---|---|---|---|
| `cursor` | `mcpServers`，command/args | `~/.cursor/mcp.json` / `.cursor/mcp.json` | [Cursor MCP](https://cursor.com/docs/mcp) |
| `vscode` | `servers`，type=stdio | `~/Library/Application Support/Code/User/mcp.json` / `.vscode/mcp.json` | [VS Code MCP 配置](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) |
| `copilot` | `mcpServers`，type=stdio | `~/.copilot/mcp-config.json` / `.mcp.json` | [Copilot 兼容配置](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) |
| `workbuddy` | `mcpServers`，type=stdio | `~/.workbuddy/mcp.json` | [自定义连接器](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)、[该页链接的 MCP 配置](https://www.codebuddy.cn/docs/ide/User-guide/MCP) |
| `claude-code` | `mcpServers`，type=stdio | `~/.claude.json` / `.mcp.json` | [Claude Code MCP](https://code.claude.com/docs/en/mcp) |
| `claude-desktop` | `mcpServers`，command/args | `~/Library/Application Support/Claude/claude_desktop_config.json` | [Claude Desktop 本地服务器](https://modelcontextprotocol.io/docs/develop/connect-local-servers) |
| `gemini` | `mcpServers`，command/args | `~/.gemini/settings.json` / `.gemini/settings.json` | [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/) |
| `qwen` | `mcpServers`，command/args | `~/.qwen/settings.json` / `.qwen/settings.json` | [Qwen Code 官方文档](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md) |
| `opencode` | `mcp`，type=local，command 数组 | `~/.config/opencode/opencode.json` / `opencode.json` | [OpenCode MCP](https://opencode.ai/docs/mcp-servers/) |
| `cline` | `mcpServers`，command/args | CLI：`~/.cline/data/settings/cline_mcp_settings.json` | [Cline 官方文档](https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx) |
| `roo` | `mcpServers`，command/args | 全局通过 Edit Global MCP 获取 / `.roo/mcp.json` | [Roo Code MCP](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/) |
| `kiro` | `mcpServers`，command/args | `~/.kiro/settings/mcp.json` / `.kiro/settings/mcp.json` | [Kiro 配置](https://kiro.dev/docs/mcp/configuration/) |
| `codex` | TOML `mcp_servers` | `~/.codex/config.toml` | [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) |
| `generic` | `mcpServers`，command/args | 只作为兼容模板，安装时请指定 `--file` | [MCP 本地服务器](https://modelcontextprotocol.io/docs/develop/connect-local-servers) |

VS Code 原生 `servers` 与 Copilot 通用 `mcpServers` 是不同格式，不能直接混用。Cline 的默认路径针对 CLI；扩展中从 MCP Servers → Configure → Configure MCP Servers 打开实际文件，再用 `--file`。Roo 优先使用已文档化的项目配置；全局路径受 VS Code 产品、profile 和远端环境影响，同样从 UI 获取。

CLI 的通用配置生成器为 Codex 输出 TOML 模板；新版配置页的安装按钮调用官方 `codex mcp list/add`，保存私有备份并核对安装结果，不自行重写 TOML。同名冲突拒绝覆盖，原有工具审批保留。移动源码或换 Node 路径后必须重新生成。

## 界面接入步骤

Cursor：Customize → MCPs，应看到 `agent-hub` 和 21 tools enabled。打开独立测试目录，在聊天中实际调用 `agent_status`、`agent_read(resource="catalog")`，再发出 `agent_request(text=...)`，按返回的 discussion/requestId 查询后台结果。

VS Code：只信任自己的测试目录。命令面板运行 MCP: List Servers，选择 agent-hub → Start Server；输出应显示运行和工具发现。聊天的写工具确认独立于服务启动，按实际请求批准。本轮实测使用原生 `servers` 格式；不要将通用 `mcpServers` 根字段直接复制进原生文件。

WorkBuddy：专家·技能·连接器 → 连接器 → 自定义连接器，搜索 agent-hub。首次连接必须在管理器中点击“信任”；仅写 JSON 或重启不会代替信任。确认启用和工具可见，再回到新建的合成工作区聊天调用。客户端可能缓存工具列表；修改配置后重新启动或新开会话。

未安装的客户端完成配置适配不等于产品实测。安装后先检查 MCP 状态，再在界面发送真实请求、等后台结束、读回结果。本轮 Codex、Cursor、VS Code、WorkBuddy 实机均取回并显示了真实后台回复；完整路径、首次失败和修复见 [0.10 验收记录](../ACCEPTANCE_0.10.md)。

`agent_request` 自动选择本机操作员来源并生成请求标识。`agent_status(discussion=..., requestId=...)` 返回有限的工作摘要及回复，避免长历史占满客户端上下文。完整结果、历史和附件通过 `agent_read` 的资源接口读取；生成配置和 MCP 连通本身不等于真实任务验收。

## 常见故障

- 工具不可见：检查实际配置文件、根字段、首次信任、客户端重启及 allow/exclude 设置；不要据此直接判定宿主失败。
- MCP 已连接但任务失败：读 `agent_status` 的 decisions、原生历史及 attention。接收成功仅表示已入库，不能当作执行成功。
- App Server `invalid transport`：不要给不存在的 MCP 服务只写 `enabled=false`。AgentHub 现在只在 managed thread 内关闭实际配置中的服务器。
- 原生 writer 冲突：结束人工接管会话，或在 Codex 桌面归档该 worker 后再重试，保留原 thread ID。

配置/协议复验：`node --import tsx examples/client-profile-acceptance.ts HOST_URL TOKEN_FILE`。报告仅标识 stdio 协议结果，界面验收单独记录。
