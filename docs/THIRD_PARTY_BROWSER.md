# 内置浏览器开源依赖

依据实际安装包及锁文件核对：

| 依赖 | 固定版本 | 许可 | 使用范围 |
| --- | --- | --- | --- |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | 0.27.0 | Apache-2.0 | 原生 CLI、独立 Chrome profile、页面快照、浏览器操作和画面流 |
| [ws](https://github.com/websockets/ws) | 8.22.1 | MIT | 宿主连接本机引擎画面流 |

许可副本：[agent-browser](licenses/browser/agent-browser-Apache-2.0.txt)、[ws](licenses/browser/ws-MIT.txt)。浏览器引擎未修改，Roppo 自行实现生命周期、任务归属、授权、控制权交接、账号库与前端。未接入这些项目的商业云服务。Chrome 由宿主安装，不能视为上述开源许可证下的捆绑浏览器发行版。
