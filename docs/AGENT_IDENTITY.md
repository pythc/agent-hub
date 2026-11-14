# Agent 头像（2026-11-14）

采用用户确认的第一版 [R 形角色稿](images/agent-identity-concept.png)。Router 为墨黑色，Worker 使用鼠尾草绿、灰蓝、陶土、暖石灰四款造型。沿用现有界面布局和导航品牌标志。

## 界面行为

- 同一头像用于聊天消息、好友列表、团队动态与空白聊天页。
- Worker 通过固定 ID 选择形象，切换视图、重新加载、更改显示名称或执行不同任务不改变头像。不新增配置项。
- 四款 Worker 形象会复用，头像不是唯一身份凭证；名称和现有只读说明始终保留。
- 深色主题只反转 Router 的明暗，Worker 保留色系。头像作为装饰图片，不重复朗读相邻名称。
- 本次使用中性静态头像。任务进度沿用实际运行状态对应的文字和图标，不以角色表情推断进度。

## 素材

通过内置 ImageGen 分别生成五款透明素材，保留选定稿的形体与哑光质感；完整生成提示词在 [素材目录](../src/ui/assets/agents/README.md)。发布资源为 256 × 256 WebP，合计 42,110 字节，通过 Vite 打包在本地提供。

消息头像为 32 px，好友列表为 36 px，动态列表为 24 px，空白页为 72 px（手机 64 px）。[实际小尺寸与浅深主题对照](images/agent-identity-portrait-proof.png)由浏览器渲染生产素材生成。

## 验证

- 构建、前后端 TypeScript 检查和 `git diff --check` 通过。
- `tests/browser/chat-space.py` 的 6 组流程通过，并检查图片解码、消息与联系人头像一致、重新加载后身份稳定和深色主题。
- 额外查看全部五款素材的 24/32/36/72 px 效果，核对团队动态、390 px 好友列表和只读空白页。浏览器 page error 与非预期 console error 均为 0。
- 已对照选定稿与实际渲染，完整复核见根目录 [design-qa.md](../design-qa.md) 的 2026-11-14 Agent 头像记录。

浏览器验证使用隔离宿主、真实 HTTP/SQLite 和确定性模型回复，截图中的 Bug 修复内容属于测试数据。没有改动用户运行实例或向外部入口发送消息。

## 界面截图

- [浅色 Worker 对话](images/agent-identity-worker-light.png)
- [深色 Worker 对话](images/agent-identity-worker-dark.png)
- [团队动态](images/agent-identity-team-dark.png)
- [手机好友列表](images/agent-identity-contacts-mobile.png)
- [手机只读空白页](images/agent-identity-empty-mobile.png)
