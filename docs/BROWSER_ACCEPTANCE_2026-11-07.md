# 内置浏览器实施与验收

工作区：`work/agenthub-frontend-20261106`，分支 `codex/agenthub-frontend-20261106`。本次增加独立浏览器工具与前端，不修改 vendored DeepSeek 核心。使用真实浏览器和本机合成网站，未使用用户的外部网站账号。

## 已验证

| 层次 | 结果 | 证据 |
| --- | --- | --- |
| 类型检查与前端构建 | TypeScript、React 和 Vite 通过 | `npm run typecheck`、`npm run build:chat` |
| 全量回归 | 41 个文件、537 项通过 | `npm test`；新增浏览器管理/坐标映射 22 项，原生流式时序 1 项 |
| 真实浏览器 + Roppo 页面 | 账号保存/填入登录、关闭恢复、授权复用、两个 Worker 的页面存储隔离、人工输入、黑白/展开/窄屏 | UI 结果（本机历史证据，未公开） |
| 真实 Router / Worker | Terra medium Router 派发至两个 Sol high Worker；实际调用浏览器，各自点击后的计数均为 1，个人浏览器保持 0；人工交还后 Worker 再次调用浏览器 | 原生模型结果（本机历史证据，未公开） |
| 宿主重启 | Cookie、localStorage、多个标签页网址与当前标签页恢复；保存账号可重新解密、填入；页面快照不返回测试密码 | 重启结果（本机历史证据，未公开） |

管理层回归包括 assignment/子代理归属、用户所有权、关闭浏览器权限、授权撤回、站点状态过滤、人工接管队列与旧操作拦截、跨窗口强制交接、租约过期、重复 requestId、未确认动作和重启回执、任务取消、启动/关闭竞争、密码加密与回显过滤、密钥替换、按需画面流及重连、标签页稳定 ID、配置继承和 HTTP 认证。

实施后的自行 review 修正了真实验收发现的四类兼容问题：鼠标命令不接受小数坐标；画面实际高度与窗口元数据高度不同；引擎不支持数字标签页下标；合成按键的全选不能依赖平台默认快捷键。另修正了任务结束清理入口、初始化期间被提前访问、旧窗口输入、弹窗 Escape 和远程输入区的键盘退出路径。

全量复跑还暴露了既有 Codex 流式通道的时序竞争：`turn/start` 的 Promise 继续执行前，同一 stdout 数据块中的旧轮次通知可能被接收。现已在 RPC 回复处理时同步绑定轮次，确认前的输出先缓冲，旧轮次的 started/delta 均被过滤；新增单数据块的确定性用例后，全量 537 项通过。

原有 `127.0.0.1:62589` 预览在确认没有运行任务后更新。更新前保存私有数据库快照；回读记录（本机历史证据，未公开）确认既有配置值、对话、运行记录、后端线程和访问令牌保留。预期变化仅为归一化配置新增 browser 默认值，以及验收启动器新增一个记住登录的本地会话。原入口截图（本机历史证据，未公开）确认可创建浏览器并向原有四个 Worker 授权。

## 界面

以下为历史验收项目；当前公开界面截图见 [README](../README.md)，原始截图和本机回读记录不随源码发布。

- 白色侧栏（本机历史证据，未公开）
- 黑暗侧栏（本机历史证据，未公开）
- 展开浏览器（本机历史证据，未公开）
- 窄屏（本机历史证据，未公开）
- 真实模型对话（本机历史证据，未公开）

界面截图经过人工查看；最终视觉偏好仍由用户确认。页面错误监听为零，窄屏无外层横向或纵向溢出。网站内容保持网站自己的配色，Roppo 外壳遵循黑白主题。

## 复现

先构建前端，并准备安装了 Playwright/Chromium 的 Python 环境。启动独立 fixture 宿主（不要使用个人运行目录）：

```sh
npm run build:chat
ROPPO_BROWSER_PORT=61567 ROPPO_BROWSER_SITE_PORT=61566 npx tsx examples/browser-acceptance.ts fixture .local/browser-fixture
python tests/browser/browser-workspace.py .local/browser-fixture .local/browser-check
python tests/browser/browser-restart.py prepare .local/browser-fixture .local/browser-check
# 正常停止上面的独立宿主，再使用相同端口和目录重新启动
python tests/browser/browser-restart.py verify .local/browser-fixture .local/browser-check
```

真实模型验收使用另外的全新目录，并要求宿主已有可用的 Codex CLI 登录：

```sh
ROPPO_BROWSER_PORT=61569 ROPPO_BROWSER_SITE_PORT=61568 npx tsx examples/browser-acceptance.ts native .local/browser-native-fresh
python tests/browser/browser-native.py .local/browser-native-fresh .local/browser-native-check
```

`browser.json` 位于被忽略的 `.local` 目录，含合成验收账号及本地 Cookie，不作为公开证据提交。测试页面提供真实登录表单、HttpOnly Cookie 和独立存储计数。fixture 验收只替换模型决策，浏览器、宿主、HTTP、Worker 工具、画面流和页面操作均真实执行；原生模型验收另外记录，二者不混为一项。

## 范围

本次不是所有网站或平台的兼容认证。未验证 Linux/Windows、外部 SSO/验证码/Passkey、IndexedDB 专项恢复、十实例负载、商业 API 服务商真实调用。API 后端与 Codex 使用同一 Worker 工具入口；既有 API 协议回归通过，但不能据此宣称已对各厂商商业接口逐个进行浏览器验收。浏览器持久化不会延长网站规定的登录有效期。
