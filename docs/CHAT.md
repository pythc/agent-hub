# Roppo 站内对话

从侧栏「对话」进入，或在当前宿主地址后加 `/chat`。首次创建本地账号，之后沿用个人版的记住登录；登录后返回原会话。账号、模型和对话都保存在自己的宿主中，不使用 assistant-ui Cloud。

对话与工作区、任务、模型等页面共用本地登录。跳转不会要求重新连接宿主；外部客户端接入检查只在相关配置页面按需加载。登录过期后，重新登录会返回原功能页。导航回归脚本位于 `tests/browser/chat-navigation.py`。

## 开始使用

1. 在「模型连接」配置可用后端。沿用现有 API、支持的订阅授权或 Codex CLI 能力，浏览器不接触模型密钥。
2. 在「Agent 团队」将 Router 设置为托管模式（`execution.router.mode: "host"`），选择模型及参数。Worker 继续分别配置。
3. 保留一个启用的本地来源和获准操作员。订阅后端使用与订阅所有者一致的来源和身份。
4. 点击「新建会话」，向 Router 提交任务。Router 决定是否委派 Worker，Worker 的结果由 Router 汇总。

无法发送时，页面提供相应配置入口。配置可用只代表能提交请求；后端拒绝、余额或 CLI 登录失效会显示真实失败状态，不会伪造答案。assessment 和客户端 Router 模式不能同时充当此入口的托管执行器。

## 会话行为

- 新会话独立持久化；刷新、退出后重新登录、宿主重启后继续原生 Router 线程。历史按 100 条分页加载，完整回复不截断。
- 每个会话保存自己的草稿。请求重试使用同一客户端消息标识，避免重发任务。
- 会话固定创建时的 Router 后端、模型和调用选项。修改 Router 选择影响新会话；修改原后端定义会提示新建会话，避免原线程悄悄换服务。后端显示名称可修改。
- 用户只向 Router 发消息。团队侧栏展示当前轮实际派工、执行、待处理和完成状态；任务详情链接到现有任务页。没有 Worker 聊天入口。
- Router 回复按模型实际返回的文本增量更新同一条消息。停止或断流后保留已收到的内容，并标记未完成；最终校验通过后才标记完成。不会展示模型私有推理，也没有模拟打字。
- 每轮请求下展示真实工具调用：执行者、操作、耗时和成功/失败/中断状态；展开可查看工具名称。保留失败和重试记录，不复制原始参数、工具结果或密钥。调用记录随会话持久化，当前页面最多读取最近 200 条执行记录。
- 停止运行会中止该轮 Router、停止该轮拥有的 Worker，并阻止迟到结果再次启动它。已经提交的合并需先在任务页核对，不能假装撤回。
- Worker 阻塞后的明确用户追问沿用既有 follow-up 流程；不会扩大原任务授权范围。自动回调不能冒充新的用户授权。
- 归档不删除历史，也不自动取消任务。恢复后可以继续发送。

前端基于 assistant-ui 的 external-store runtime，与宿主 HTTP API 和 SSE 状态通知相连。Codex 原生文本事件以及 OpenAI Responses、Chat Completions、Anthropic Messages 的流式协议均已接入。宿主将公开回复文本以约 75ms 间隔合并到持久化快照，SSE 通知版本变化，前端读取最新状态；后端若只返回完整 JSON，则完成后一次显示。模型每次返回的增量不保证恰好一个 token。

右侧 Router 环形脉冲、Worker 节点和连接线流光由真实运行状态驱动。闲置、完成、取消或浏览器断线时停止相应动效；恢复连接后重新读取宿主状态，不重放任务。支持减少动效偏好。刷新或宿主重启不会把中断输出伪装为完成。

## 开发和验证

```sh
npm ci
npm run build:chat
npm run check
./start.sh
```

页面源码位于 `web/chat/`，构建产物位于忽略提交的 `dist/chat/`，由现有宿主提供。核心集成是 `src/chat.ts`、`src/server.ts`、`src/runtime.ts`；回归在 `tests/chat.spec.ts`。

隔离验收宿主：`npx tsx examples/chat-acceptance.ts fixture` 使用明确的模型 fixture；`npx tsx examples/chat-acceptance.ts native` 使用本机真实 Codex 登录，可能消耗订阅额度。两者使用 `.local/` 中独立状态和专用测试账号，不覆盖用户实例。测试登录信息只保存在各自 `browser.json` 中，不提交仓库。

回归包括 `tests/chat.spec.ts`、`tests/model-stream.spec.ts` 与 `tests/browser/chat.py`。真实 Codex 流式验收脚本为 `tests/browser/chat-native-stream.py`，需另外配置并有意执行。开源依赖见 [许可记录](THIRD_PARTY_CHAT.md)。
