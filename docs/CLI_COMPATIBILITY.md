# CLI 交互与兼容范围

更新：2026-11-26。交互界面改以 OpenCode 为参考，采用 OpenTUI 的原生输入、布局、Markdown、滚动和鼠标组件。Roppo 本机服务继续负责会话和执行。产品边界见 [CLI_PRODUCT.md](CLI_PRODUCT.md)。

## 当前行为

| 范围 | Roppo 行为 |
| --- | --- |
| 界面 | 空首页、持续个人对话、固定输入、搜索浮层；无项目和 Worker 标签页 |
| 输入 | 中文/宽字符编辑、括号粘贴、多行、目录和文件补全；浮层保留草稿 |
| 动效 | 八格活动条、真实回复更新、等待时停止、减少动效选项 |
| 导航 | `/`、Ctrl+P、F2 模型、Ctrl+K 对话搜索、Ctrl+Y 待处理事项 |
| 滚动 | 原生 ScrollBox；翻阅时暂停跟随，Ctrl+End 回到底部，PageUp 加载更早记录 |
| 文件 | 文本预览、保存交付文件，不覆盖本机已有文件 |
| 记忆 | 读取、编辑、确认后忘记真实个人记忆 |
| 计划模式 | `/plan` 澄清需求、输出详细计划；本轮禁用工具和 Worker 派发 |
| 计划事项 | `/schedules` 读取、暂停和恢复；通过 Router 对话创建或更改要求 |
| 确认 | 权限、结构化问答、Router 选项、业务决策、文件交付确认 |
| 配置 | 用户/目录/本地配置和启动覆盖；主题、动效、语言及共享模型设置 |
| 脚本 | Node 22.19+；文本、JSON、NDJSON、管道、附件、超时和取消机制保持兼容 |

## 实现边界

- OpenTUI 0.9.9 要求 Bun 1.3.14+ 或 Node 26.4+ experimental FFI；本项目随依赖安装 Bun 1.4.5，只用于交互进程。系统 Node 和宿主运行方式不变。
- 默认是一段共享 Router 对话。`--cwd`、`-r` 保留显式脚本兼容用途。交互界面不再提供 `/resume` 和 `/new` 会话切换。`/clear` 改为确认后清理当前对话。
- 模型与思考强度可选择 Router 或具体 Worker，修改共享宿主设置。权限是共享账号设置，仍受宿主沙箱限制。
- 对话搜索作用于已加载消息，可继续加载更早记录。图像和二进制文件可保存，不在终端内解码显示。
- Apple Terminal 不一定区分 Enter 和 Shift+Enter，可使用 Alt+Enter 或 Ctrl+J。中文输入法候选窗口由终端和系统管理。
- `ROPPO_LEGACY_TUI=1 roppo` 可使用旧渲染器；它不包含新浮层。`TERM=dumb` 与脚本输出不加载 OpenTUI。
- 尚未实现外部编辑器、Vim、图片剪贴板、可配置快捷键、会话分叉/rewind、CLI 插件安装认证。不会用空菜单冒充已完成能力。

## 验证

`npm run check` 检查宿主、Chat、预览 UI 类型和既有行为；此前 OpenTUI 基线为 2,914 项通过，4 项按既有条件跳过。本轮命令优化的验证记录见 [设置缺项与变更说明](CLI_SETTINGS_GAPS.md)。终端新增接口覆盖记忆访问、无效对话拒绝和宿主配置隔离。

`npm run test:tui` 使用实际 OpenTUI 原生测试渲染器检查空屏滚动、中文与多行粘贴、草稿/光标保留、快速搜索后回车、消息滚动跟随、回复无外框、审批按键、窗口缩放和中断。

本机通过全局 `roppo` 入口启动真实 PTY，检查共享历史、模型选择入口、命令搜索、记忆、文件和计划菜单，并发送一次明确标记的界面自测消息。Router 返回“CLI 连接正常”，活动条结束后收起，Ctrl+D 正常退出并恢复终端。该测试消息保留在个人对话中。原生画面另外经过渲染捕获检查；网页方案预览不计入通过证据。

## OpenTUI 基线文件变更

| 文件 | 变更用途 |
| --- | --- |
| `src/terminal/tui.ts`（新增） | 新终端的连接、发送、事件流和退出生命周期 |
| `src/terminal/tui-screen.ts`（新增） | 原生布局、输入、滚动、Markdown、浮层和动效 |
| `src/terminal/tui-actions.ts`（新增） | 命令与模型、记忆、文件、计划、确认接口的连接 |
| `bin/roppo.mjs`、`src/terminal/main.ts` | 交互运行时入口与兼容路径 |
| `src/terminal/settings.ts`、`src/terminal/controls.ts` | 跟随终端配色的设置选项 |
| `src/terminal/client.ts` | 文件的二进制下载 |
| `src/personal-account.ts` | CLI 凭据访问个人控制接口 |
| `package.json`、`package-lock.json` | 固定渲染器与运行时依赖，纳入原生测试 |
| `tests/terminal-tui.ts`（新增）、`tests/terminal.spec.ts` | 原生交互回归及新增接口授权验证 |
| `docs/TERMINAL.md`、`docs/CLI_PRODUCT.md`、本文 | 使用说明、产品边界与验证记录 |
| `THIRD_PARTY.md` | 新依赖归属说明 |

没有删除项目文件。

## 参考

- [OpenCode TUI](https://opencode.ai/docs/cli/tui/)
- [OpenTUI](https://github.com/anomalyco/opentui)
- [OpenTUI 运行要求](https://opentui.com/docs/getting-started/runtime-support/)
