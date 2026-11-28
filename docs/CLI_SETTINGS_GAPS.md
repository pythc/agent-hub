# CLI 设置缺项与本轮变更

更新：2026-11-27。按当前需求补齐首次配置和日常入口；高级管理功能继续记录在 Issue #2。

## 已有入口

- 首次运行 `roppo`：启动本机服务，在终端依次完成账号、模型连接、检测和保存。`roppo init` 可重新运行向导；OAuth 的服务商登录仍在浏览器进行。
- `/connect`：API 地址、隐藏密钥、模型发现或手填、ChatGPT OAuth、已有连接复用、检测后保存。
- `/workers`：新增、复制、暂停接收任务、启用及确认删除。删除前须处理活动任务。
- `/plugins`、`/skills`、`/mcp`：独立列表与详情，可将管理请求带入 Router 输入框；不会自动发送或执行安装。
- `/compact`：主动压缩、自动压缩开关与触发阈值，默认开启、80%。保留原始聊天记录。
- `roppo login/logout`：终端与本机服务配对及撤销凭据。
- `/model`、`/effort`：先选择 Router 或 Worker，再选具体 Worker，修改模型或思考强度。
- `/rename`：选 Worker 后修改显示名称，保留 Worker 身份和任务记录。
- `/settings`、`/config`：模型、思考强度、Worker 名称、权限、语言、主题、动效等已有设置。
- `/permissions`：共享账号的询问/完全访问设置，仍受来源沙箱限制。
- `/memory`：查看、编辑、忘记记忆内容。`/schedules`：查看和暂停/恢复提醒。
- `/tools`：查看已有工具、技能、MCP 等能力。

## 缺少的终端设置

| 优先级 | 缺项 | 目前可用方式 / 依据 |
| --- | --- | --- |
| 后续 | 已有模型连接的编辑、删除及高级参数 | 本轮已完成新增、复用、检测、保存及选择；完整连接维护仍在网页 |
| 高 | Router/Worker 单轮超时，Worker 浏览器访问权限 | 网页运行配置；`web/chat/runtime-configuration.tsx` |
| 高 | Worker 数量上限、是否允许 Router 管理 Worker、Router 调度方式 | 网页团队调度；`web/chat/structured-settings.ts` |
| 后续 | 插件、技能、MCP 的专用安装、更新、卸载、认证表单 | 本轮按要求提供三个独立列表；通过 Router/Worker 或网页已有流程管理 |
| 中 | 外部消息来源、应用连接、凭据与路由配置 | 网页连接器与来源配置；`web/chat/connectors.tsx`、`src/ui/configuration.ts` |
| 中 | 浏览器设置、来源沙箱、运行限制与隔离、跟进规则、发布与合并策略 | 网页工作区设置；`web/chat/workspace-settings.tsx` |
| 保留网页 | 记忆学习策略和范围 | 原项目具备自动记忆；新安装保持开启，CLI 不增加独立记忆开关；`/memory` 管理内容 |
| 中 | 受理决策器配置及测试、连接的高级参数 | 网页配置；`web/chat/structured-settings.ts` 和高级原始配置 |
| 中 | 主机维护、部署、原始配置、版本历史与恢复 | 网页维护；`web/chat/workspace-settings.tsx` |

单轮超时、调度、来源沙箱、发布和恢复暂不扩展终端表单。`/permissions` 保留便捷入口，仍受宿主来源权限限制。以上列表用于跟踪，不代表都必须做成 CLI 设置。

## 本轮命令行为

`/history` 保留，搜索当前对话中已加载的消息，可继续加载更早内容。`/resume`、`/new` 不再切换个人会话。

`/plan` 选择 Plan 后，Router 先反问澄清目标、约束、范围和验收标准，再给详细计划。服务端用独立的纯文本轮次处理，禁用工具和 Worker 派发。它能参考对话文本，不能读取附件内容或工作目录。模式适用于同一段共享对话，包括网页和脚本发来的新消息。已有任务和提醒照常运行。切回 Act 后需要新的执行指令。

`/clear` 先弹确认，默认取消。确认时清理消息和本轮工作上下文，保留长期记忆、计划事项、文件和任务审计记录。先完成或停止活动任务；确认期间若出现新消息，需要重新确认。它会清空网页共享对话的消息，不会新建第二段个人会话，也不承担执行档案的彻底擦除。

`/diff` 选择 Worker，再选择其具体任务。支持已有改动记录和受管 Git 工作区；普通非 Git 文件任务没有可用对比基线时，提示通过 `/files` 查看交付文件。共享工作区的对比可能包含多个 Worker 的共同改动。

## 文件变更说明

| 文件 | 修改说明 |
| --- | --- |
| `src/chat.ts` | 保存 Plan/Act 模式；清理消息并重置工作上下文；保留记忆和提醒访问；隔离清理前后的轮次和迟到消息 |
| `src/runtime.ts` | 为计划模式提供先澄清再规划的纯文本 Router 路径，禁用工具、派发和自动记忆写入 |
| `src/router-proactive.ts` | 计划消息独立进入 Router，避免混入普通执行消息批次 |
| `src/server.ts` | 增加有限的清理/模式接口；按选定 Worker 校验思考强度 |
| `src/personal-account.ts` | 允许已配对终端使用上述有限接口 |
| `src/terminal/host-settings.ts` | 暴露 Worker 设置并支持独立修改模型、思考强度和名称 |
| `src/terminal/tui-actions.ts` | Router/Worker 选择、Worker 重命名与改动选择、清理确认、计划模式菜单 |
| `src/terminal/tui-screen.ts` | 输入区域显示 Plan 状态 |
| `src/terminal/tui.ts` | 清理后丢弃客户端缓存的旧消息，避免旧记录重新出现 |
| `web/chat/main.tsx` | 同步清理网页缓存，避免旧消息分页在清理后重新出现 |
| `tests/terminal-editor.spec.ts` | 更新旧编辑器对无参数 `/diff` 命令补全的预期 |
| `src/terminal/tasks.ts` | 为个人对话中的 Worker Git 工作区提供改动查询，保留任务归属检查 |
| `src/terminal/commands.ts`、`src/terminal/controls.ts` | 更新命令说明并去除旧的交互会话切换、会话重命名语义 |
| `tests/chat.spec.ts` | 验证多轮澄清、计划无工具/派发，清理后保留记忆与可运行提醒 |
| `tests/terminal.spec.ts` | 验证真实宿主的 Worker 模型、思考强度、重命名、个人任务 diff 和接口边界 |
| `tests/terminal-tui-actions.spec.ts`（新增） | 验证菜单选项连接到正确操作、清理默认取消和确认时序、当前对话搜索保留 |
| `docs/TERMINAL.md`、`docs/CLI_PRODUCT.md`、`docs/CLI_COMPATIBILITY.md` | 更新使用说明、产品边界与兼容行为 |
| 本文（新增） | 设置缺项、命令限制和逐文件变更说明 |

未删除项目文件。清理测试使用隔离测试数据，没有清理用户的真实对话。

## 上一轮验证结果（命令优化）

- TypeScript：宿主、Chat 网页和组件预览均通过。
- 全量 Vitest：2,920 项通过，4 项按既有条件跳过。
- OpenTUI 原生渲染器：空屏滚动、Unicode 粘贴、多行、菜单草稿、滚动跟随、审批按键、窗口缩放与中断均通过。
- 新增菜单行为测试和实际宿主测试覆盖模型/思考强度目标选择、Worker 重命名、diff、清理确认和计划模式。

## 本轮新增与修改文件（首次设置、管理入口和压缩）

| 文件 | 说明 |
| --- | --- |
| `src/terminal/setup.ts`（新增） | 首次服务启动、账号问答、连接向导和取消操作；密码与密钥不回显 |
| `src/terminal/setup-host.ts`（新增） | 限定配置操作、Worker 管理命令及新安装的个人记忆初始化 |
| `src/onboarding.ts` | 复用连接规划、检测、保存；保留已有 Worker 配置 |
| `src/terminal/client.ts` | 终端账号登录和配对、首次服务发现、长操作超时 |
| `src/terminal/main.ts` | 首次启动自动进入终端向导，脚本模式保持非交互 |
| `src/server.ts`、`src/personal-account.ts` | 已配对终端的连接、Worker、压缩接口及账号边界 |
| `src/terminal/tui-actions.ts` | 连接和 Worker 管理、三类能力列表、压缩及阈值菜单 |
| `src/terminal/tui-screen.ts` | 向导取消与空输入；密钥输入仅渲染掩码，支持粘贴 |
| `src/chat-compaction.ts`（新增） | 有来源的工作摘要、自动触发、阈值持久化，失败保留原上下文 |
| `src/chat.ts` | 手动压缩、压缩状态与上下文投影，保留原始聊天记录 |
| `src/runtime.ts`、`src/router-continuity.ts` | Router 下一轮前触发压缩、用摘要重建上下文、保留任务及原文读取 |
| `src/terminal/commands.ts`、`src/terminal/controls.ts` | 压缩命令说明及直接参数操作 |
| `tests/terminal-setup.spec.ts`（新增） | 实际宿主的初始账号、API 检测保存、Worker 管理、OAuth 流程和压缩配置接口 |
| `tests/chat.spec.ts` | 手动与自动压缩、作用域隔离、原文保留、失败重试、阈值与开关 |
| `tests/terminal-tui-actions.spec.ts`、`tests/terminal-tui.ts` | 压缩菜单、掩码粘贴输入与取消 |
| `docs/TERMINAL.md`、本文 | 更新使用方式、边界和逐文件说明 |

本轮没有删除项目文件。验证使用临时账号和测试服务，没有调用真实账号的压缩、清理或修改模型设置。

### 本轮验证结果

- 宿主、Chat 网页、组件预览类型检查通过，网页构建通过。
- 最后一轮全量测试：2,928 项通过、4 项原有条件跳过；2 项既有测试在并行运行中超过 5 秒时限。保持代码和断言不变，单独复跑这两项均通过（约 4.4 秒）。
- 新增设置/压缩及相关 Chat、菜单测试：122 项通过；Worker 连续追问交接回归通过。
- OpenTUI 原生渲染器检查通过，包括隐藏输入、粘贴和向导取消。
- 隔离的真实 PTY 首次启动通过：启动本机服务 → 创建账号 → 隐藏密码/密钥 → 模型检测保存 → 进入聊天 → 正常退出。OAuth 验证覆盖流程与后台授权取消，未用真实账号重新登录服务商。
