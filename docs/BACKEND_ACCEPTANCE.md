# 0.6.0 后端验收

验收日期：2026-11-04，macOS、Node 26。本轮实现四种执行后端；保留原型 15 个核心源码文件的基线哈希，未修改其领域规则。**隔离 HTTP 使用确定性响应，不是真实商业模型，也不能据此证明任意兼容供应商的行为。**

## 当前结果

| 项目 | Responses | Chat Completions | Anthropic Messages |
|---|---|---|---|
| 正确请求路径、认证头、工具定义 | 隔离 HTTP 通过 | 隔离 HTTP 通过 | 隔离 HTTP 通过 |
| 工具循环及推理/opaque 块回传 | 通过 | 通过 | 通过 |
| JSON schema 输出字段及失败修正上限 | 通过 | 通过 | 通过 |
| 未注册工具、非法参数、重复调用 ID、工具预算 | 通过 | 通过 | 通过 |
| 图片与多工具结果的协议顺序 | 通过 | 通过 | 通过 |
| steer、提示词刷新 | 下一 HTTP 步通过 | 下一 HTTP 步通过 | 下一 HTTP 步通过 |
| 实际 Runtime 路由→文件读取→交付 | 通过 | 通过 | 通过 |
| 关闭 Runtime/SQLite 后重开，同工作同会话跟进 | 通过 | 通过 | 通过 |
| 实际 managed 子代理、文件读取及结果回收 | 通过 | 通过 | 通过 |
| 实际 managed shell→macOS Seatbelt→结果回收 | 通过 | 通过 | 通过 |
| 真实供应商模型/密钥调用 | 未验收 | 未验收 | 未验收 |

上述 Runtime 和 shell 测试把 Codex 可执行路径设为 `/missing/codex`。其成功证明宿主执行链路不依赖 Codex；模型响应仍来自本机 HTTP 测试服务。shell 使用真实进程、真实文件和系统沙箱，子代理使用真实 WorkManager 和 API agent loop。

另有跨后端角色分配、原会话固定后端、地址改变拒绝隐式迁移、原生 codex ID 保留、HTTP 取消、缺少工具回执时不重放的自动化用例。非 Codex 工作接管会在状态变更前拒绝，历史不冒充 nativeThreadId。

`npm run check`：TypeScript 检查通过，17 个测试文件、274 项测试通过，其中 113 项来自原型核心。相关新增用例为 [backend-api.spec.ts](../tests/backend-api.spec.ts)、[sandbox.spec.ts](../tests/sandbox.spec.ts) 与资源目录回归用例。

## 控制台真实界面

通过实际 Chromium 界面访问独立回环实例，配置三个合成后端，不调用远端模型：

1. “模型”页展示三种协议、配置模型和 `configuredOnly=true`，明确区别配置清单和认证验证。
2. 设置页将路由设为 Chat、主执行设为 Responses、子代理设为 Anthropic。
3. 点击保存，配置版本从 0 增至 1；刷新、重新连接，再打开设置，三项选择均保留。

界面记录保留在本机私有验收目录。该结果是控制台配置联测，不是三个供应商的模型或客户端原生界面实测。0.6.0 还重新跑过 14 种客户端配置的 stdio MCP 目录/状态读取，均通过；这不是 14 种产品界面验收。历史 Cursor、VS Code、WorkBuddy 产品界面接入记录仍见 [客户端验收](clients/ACCEPTANCE.md)。

## 真实 Codex 和升级回归

独立客户端验收宿主从 0.5.0 升级至 0.6.0，升级前保存 schema 2 一致快照并确认没有活动工作。通过真实 stdio MCP 发出已有讨论的跟进请求，让后台重新读取合成文件 `acceptance.txt`。

- 使用实际登录的 Codex，模型 `gpt-6.1-terra`、high。
- 复用 0.5.0 同一原生 thread，重新产生 turn，没有替换聊天。
- 实际资源工具读取返回 `client-ui-20261104`，结果在原讨论发送成功，运行回到 idle。
- run 增补 `backendId=codex`、`backendKind=codex`，原会话和目录保留。

本次没有重复人工桌面接管/交还；该项历史结果不能冒充 0.6.0 的新一轮完整桌面验收。原始 MCP 请求、运行状态及原生历史保留在本机。

用 0.5.0 真实源码与 0.6.0 运行了独立升级演练：schema 2→3，旧程序拒绝 schema 3，恢复升级前快照、使用原始旧配置后旧 Runtime 正常启动/读取/关闭，再升级至 3，新 Runtime 同样正常，原生 thread ID 全程保留。脚本见 [upgrade-backends-acceptance.ts](../examples/upgrade-backends-acceptance.ts)。备份不覆盖工作文件和外部副作用；新版本归一化的配置不能替代原始旧配置。

## 沙箱和未完成项

macOS Seatbelt 实测覆盖状态目录内的默认隔离工作区读写、仅分配附件可读、其他工作区拒绝读取、工作目录写入、只读拒绝写入、宿主私有状态拒绝读取、目录外写入拒绝、模型密钥环境不转发、Assignment 结束后的进程回收。错误平台驱动会在创建作业前拒绝。runner 缺少持久回执退出时不会留下永久 running 作业。

Linux Bubblewrap 仅验证参数构造；Linux 实机、Windows 独立驱动、跨机器、长期运行与专用 OS 账号隔离未验收。没有自动降级为不受限进程。

本机未发现可用 API 密钥或本地模型服务，因此三个商业 API 均保留“未验收”。已提供 [真实服务验收脚本](../examples/backend-smoke.ts)：使用配置的地址和模型，逐个验证真实路由、文件工具、结果交付和同会话跟进。配置步骤、服务费用与能力限制见 [后端指南](BACKENDS.md)。GitHub 真实合并及其他历史未完成项仍见 [原型对照](PARITY.md)。
