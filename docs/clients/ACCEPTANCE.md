# 客户端验收 · 2026-11-04

验收版本 AgentHub 0.5.0。环境为本机 macOS Apple Silicon，Node 26.0.0，实际后台执行模型 gpt-6.1-terra / high。新客户端共用独立 loopback 宿主、状态目录和合成文件。没有通过这些客户端读写原有业务项目或向外部群/仓库发送验收消息。

## 实机结果

| 客户端 | 配置/服务界面 | 聊天真实调用 | 后台结果与接续 | 结论 |
|---|---|---|---|---|
| Cursor 3.27.6 | Customize → MCPs 显示 agent-hub，20 tools enabled | agent_send、agent_status、agent_read | 读取 acceptance.txt，返回 client-ui-20261104；创建原生 worker 会话 | 本轮实机通过上述路径 |
| VS Code 1.143.1 / Copilot 聊天 | 测试目录单独信任，MCP: List Servers 启动 agent-hub，输出为正在运行 | agent_status、agent_read；agent_send 出现真实写工具确认，批准后执行 | 在 Cursor 原任务范围内追问，读取文件并返回相同 code；同一个 nativeThreadId，新 nativeTurnId | 本轮实机通过上述路径 |
| WorkBuddy 5.9.3 | 自定义连接器管理中搜索 agent-hub，完成首次信任和启用 | agent_status、agent_read、agent_send | 同一原任务再读取，返回相同 code；宿主确认原会话未 fork | 本轮实机通过上述路径 |
| Codex 桌面 | 历史 0.4.0 已真实注册并调用；旧聊天工具目录缓存使用 agent_context 兼容 | 已验证发送、查询、接管/交还、资源及旧 worker 接续 | 原 native thread 沿用，后台 scoped MCP 桥执行并返回 | 历史实机通过；不把它算成 0.5.0 新插件自动激活测试 |

每行只证明明确列出的操作，不代表所有 20 个工具已逐个在该客户端界面执行。PR 发布、审查写入和真实 GitHub 合并没有在本轮跨客户端验收中操作。

## 可核对的合成记录

共享讨论 `local:client-ui-shared-20261104`；原工作 `6bf223e3829960b40faffa5c797631b2`。原生会话一直为 `01a1a66c-b3a0-7ac0-ac59-4af8dbcbd6a1`。

| 入口 | requestId | 原工作中新 assignment | 实际完成结果 |
|---|---|---|---|
| Cursor | cursor-ui-20261104-2 | 59603d2aa81727d4afa7b52bd3492d75 | client-ui-20261104 |
| VS Code | vscode-ui-20261104-2 | e11408b520b149a6f2397bc3949e4466 | client-ui-20261104 |
| WorkBuddy | workbuddy-ui-20261104-1 | 7b810d02f7740264b5c3540eda1361b8 | client-ui-20261104 |

原生历史包含这些不同的 completed turn，工作记录 `run.threadId` 始终为上面的原生会话。讨论相同、消息入库、assignment 创建或聊天模型自称成功，都不能单独作为续跑证据。最后宿主读回 active=0、三轮均完成，回复投递为 sent。

另一次要求回复 cross-client-ok 的追问超出了原“读取文件 code”任务，原 worker 正常 handback；路由随后把显式的新要求作为新工作完成。它不是原任务的同会话续跑成功用例。

## 联测发现与修复

- Cursor 首次请求因 Codex App Server 启动退出而失败。根因是为不存在的 MCP 服务写入了仅有 enabled=false 的启动配置。删除该启动覆盖，在 managed thread 中根据真实配置逐个禁用；补回归并从 Cursor 重新完成整条路径。
- WorkBuddy 初始模板缺少官方示例要求的 type=stdio，现已补齐。之后仍需管理器中的首次“信任”，仅写文件或重启不替代该动作。最终在真实界面信任后，发现和调用成功。
- WorkBuddy 的聊天模型曾把 transcript 的单轮 id/rootTurnId 报成 native thread ID。宿主独立核对后，为历史列表和单条记录同时增加 nativeThreadId、nativeTurnId；保留旧 id 兼容。新增回归，并从 WorkBuddy 读回更正。
- VS Code 一次使用缺少 source 前缀的 thread 资源路径被拒绝为 Unknown thread。资源目录指明正确语法后继续读取，不能把这个客户端参数错误计作宿主权限放宽。

## 未安装客户端

Claude Code、Claude Desktop、独立 Copilot CLI、Gemini CLI、Qwen Code、OpenCode、Cline、Roo Code、Kiro 本轮未做产品实机测试。已按 [指南中的官方文档](README.md) 实现各自配置格式和可用安装入口。没有为凑实机数量擅自安装这些完整产品。

14 种配置（包括 generic 和 Codex）经同一 MCP SDK 实际启动 stdio 桥：均发现 20 个工具，并调用 agent_status、agent_read(catalog) 成功。这只验证桥、工具清单和读取协议，不验证缺席客户端的解析器、界面、账户、审批和模型行为。

## 回归与发布检查

TypeScript 与 231 项测试通过，含 113 项上游核心用例。安装器覆盖 JSONC 保留、其他服务器保留、同名冲突、幂等、备份模式、原字节和权限恢复、用户后续修改拒绝、坏 JSON 与符号链接拒绝。条件合并的 8 个隔离 HTTP 场景重新通过；未真实合并。15 个上游核心文件与基线哈希一致。

全局配置修改前的备份、界面观察摘录和宿主原始读回保留本机私有目录；远程只包含源码、合成摘要、哈希和可重复脚本。未上传令牌、其他客户端连接凭据、真人消息或非验收任务历史。

客户端默认配置路径及本轮界面证据针对 macOS；其他平台、干净机器、专用 OS 身份、长期运行仍未实机验证。旧插件名兼容入口仍保留；新名字不意味着自动重写现有聊天的工具缓存。
