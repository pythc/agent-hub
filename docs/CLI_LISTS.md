# CLI 列表排序与鼠标交互

斜杠命令按命令名称 A–Z 排列；Commands、设置、模型、Worker、插件、Skills、MCP、文件及操作列表按显示名称排列。忽略大小写，数字按自然顺序排列（如 item2 在 item10 前）。共用菜单默认应用此规则，后续新增条目无需手动调整位置。聊天内容搜索保留消息顺序。

TUI 菜单和输入框上方的补全列表支持鼠标滚轮、触控板滚动、拖动滚动条和点击选择。方向键、搜索、Enter 和 Esc 继续可用。后台刷新保留鼠标滚动位置；搜索或键盘选择会把选中项带入视野。首次启动的文字问答仍使用编号输入，其选项也按名称排序，并映射回原来的操作。

## 文件变更

- `src/terminal/list-order.ts`：新增共用名称排序工具。
- `src/terminal/tui-screen.ts`：统一菜单和补全排序，使用真正的滚动区域，支持滚轮、滚动条和点击，保留刷新时的阅读位置。
- `src/terminal/tui-actions.ts`：排序命令、文件和能力详情，聊天搜索显式保留消息顺序。
- `src/terminal/commands.ts`：排序文字命令帮助、能力分组和工具名称。
- `src/terminal/setup.ts`：排序文字引导选项，保持显示编号与操作对应。
- `src/terminal/editor.ts`、`src/terminal/suggestions.ts`：兼容终端入口使用同一排序规则，移除来源优先和搜索结果重排规则。
- `tests/terminal-tui.ts`：验证排序、滚轮双向浏览、拖动滚动条、点击、滚动后搜索、后台刷新和小窗口显示。
- `tests/terminal-editor.spec.ts`：更新排序预期，验证排序后仍执行正确命令、回答和能力详情。
- `docs/TERMINAL.md`：更新使用说明。
- `docs/CLI_LISTS.md`：记录行为与文件变更。

没有删除项目文件。验证通过：TypeScript 类型检查、38 项 CLI 测试、OpenTUI 原生渲染与鼠标/键盘交互测试。
