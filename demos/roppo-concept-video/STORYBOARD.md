# Roppo — Product walkthrough

159 seconds · 1920 × 1080 · 30 fps · Chinese captions · editable Remotion preview.

The current revision replaces the old 00:59–01:07 listening overview with a 22-second optional decision-layer chapter. All later scenes move forward by 14 seconds. The previous MP4 is preserved.

| Time | Scene | Message |
| --- | --- | --- |
| 00:00–00:05 | 开场 · Roppo | 个人助手与组织协作中枢 |
| 00:05–00:12 | 个人与组织 | 你的 24 小时助手，组织的智能协作中枢。 |
| 00:12–00:18 | 进入工作区 | 本地账号，登录后回到自己的工作空间。 |
| 00:18–00:26 | 连接模型 | API、受支持的订阅或 CLI，各自配置，各尽其用。 |
| 00:26–00:34 | API · 订阅 · CLI | 复用受支持的订阅额度，也可使用 CLI 自带的工具和插件。 |
| 00:34–00:42 | 配置 Router 与 Workers | 你设定目标和边界，Router 管理执行团队。 |
| 00:42–00:50 | 角色提示词与工具 | 模型、思考参数、提示词和工具权限，按角色设置。 |
| 00:50–00:59 | 插件生态与多群协作 | 飞书、Slack、Linear，通过适配器与插件 / MCP 扩展。 |
| 00:59–01:08 | 额外决策层 · 接入配置 | Jev、自部署模型或外接服务，为 Router 提供意图建议。 |
| 01:08–01:21 | 批处理 · 规则 · 辅助判别 · 介入 | 先检查范围，再结合辅助建议；最终介入由 Router 决定。 |
| 01:21–01:32 | 飞书 · 无需 @ 自动接手 | 已授权范围内自动处理，完成后回到原群报告。 |
| 01:32–01:39 | Roppo · 接收任务 | 来源、目标和执行范围，集中在一个工作空间。 |
| 01:39–01:50 | 团队动态 · 分工执行 | 对话、工具调用和任务进展，都在同一个工作空间。 |
| 01:50–01:59 | 浏览器 · 人工接管 | 独立浏览环境，保留登录状态，必要时由你接管。 |
| 01:59–02:07 | 文件 · 查看证据 | 查看文件、代码改动、工具调用与验证记录。 |
| 02:07–02:16 | 停止 · 补充 · 续接 | 补充新的范围，沿用已有上下文继续执行。 |
| 02:16–02:25 | 飞书 · 自动返回结果 | Router 统一回复，交付变更、报告和待确认事项。 |
| 02:25–02:33 | 本地优先 · 开源部署 | 按自己的需求配置模型、角色和工具，打造你的 AI 团队。 |
| 02:33–02:39 | 收尾 · Roppo | 本地优先，开源可部署 |

## Decision-layer narrative

1. 00:59–01:08: choose Jev / TypeSafe, a self-hosted compatible API, or an external model service; advisory mode supplies intent labels to Router.
2. 01:08–01:21: same-discussion, same-identity messages become one candidate batch; permission/scope/policy checks precede optional model advice; Router independently checks original intent and authority before intervention.
3. 01:21 onward: the Feishu story shows the resulting unmentioned admission, visible work, human control, and reply to the original group.

The labels and execution are authored examples. Optional advice adds a call and does not guarantee total token savings. Batching, short cards and on-demand context reduce duplicated work; costs remain provider- and traffic-dependent. See README.md for implementation and staging boundaries.

Coverage also includes personal and organizational positioning, plugins and multiple chats, per-role model/prompt/tool settings, API/subscription/CLI access, visible workspace execution, browser takeover, stopping/continuing, and local open-source deployment.
