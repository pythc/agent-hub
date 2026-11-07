# 参与 Roppo 开发

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

欢迎贡献代码、问题复现、文档、翻译和兼容性验证。交流请遵守[行为准则](CODE_OF_CONDUCT.md)，中文和英文都可以。

## 从哪里开始

- 使用 [Discussions](https://github.com/pythc/agent-hub/discussions) 提问、分享工作流和讨论初步想法。
- 使用 [Issues](https://github.com/pythc/agent-hub/issues/new/choose)报告可复现问题、提出明确需求；先检查是否已有同类问题。
- 可以寻找 `good first issue` 或 `help wanted` 标签。较大改动先在 Issue 讨论，避免重复开发。
- 漏洞或凭据泄露按[安全报告流程](SECURITY.md)私下提交。

修改产品行为或安装说明时，请同步英文和中文 README。

## 本地开发

需要 Node.js 22.19+ 和 Git，纯 API 开发不要求安装 Codex。

```sh
git clone https://github.com/pythc/agent-hub.git
cd agent-hub
npm ci
npm run check
```

个人测试部署使用 `./start.sh setup /path/to/private-directory`，与日常使用的实例分开。宿主在 `src/`，React 会话界面在 `web/chat/`，共享管理界面在 `src/ui/`，测试在 `tests/`。

`npm run check` 会检查宿主与前端类型、构建页面并执行 Vitest。编辑时可以先运行相关用例：

```sh
npm test -- tests/chat.spec.ts tests/resource-state.spec.ts
```

界面测试可以在独立终端启动隔离 fixture：

```sh
npm run build:chat
npx tsx examples/chat-acceptance.ts fixture .local/contributor-chat
```

它使用固定模型响应，不调用付费模型。生成的 `browser.json` 含测试登录信息，不能提交。Python 浏览器脚本需要在虚拟环境安装 Playwright 和 Chromium；执行前阅读各脚本参数。截图与报告放入 `.local/`，不要公开账号恢复码页面。

界面改动检查黑白主题、窄屏、键盘焦点、减少动效、加载及失败状态和控制台错误。动效必须跟随真实状态。Fixture 截图不是模型或外部平台实测。`native` 示例可能调用本机 CLI、消耗额度或操作外部服务，仅在自己的隔离配置下有意执行；常规回归不应依赖个人凭据。

## 需要保持的行为

- 用户与 Router 对话，Worker 向 Router 汇报。
- 保留来源身份、任务所有权与版本校验；读取上下文不等于获得执行授权。
- 已有会话固定后端身份，不静默换账号或替换不支持的思考参数。
- 不确定的外部写入先核对，不在重启后盲目重放。
- 浏览器保持任务隔离与人工控制权；同一网站账号的服务端数据仍然共享。
- 验证证据应对应实际被审查的产物或提交。
- 更新 vendored 领域核心时，明确上游基线、许可证、校验清单和回归结果。

上游核心与产品扩展的区别见 [PARITY.md](docs/PARITY.md)。

## 提交 PR

在自己的 fork 创建分支，向 `main` 提交范围清晰的 PR。说明问题、改后行为、验证及限制。可见变化附截图，有意义的失败场景补回归。持久格式和恢复流程的修改需要交代兼容、迁移、回滚与中断行为。

提交前运行 `npm run check` 和 `git diff --check`，自行 review。不要包含令牌、Cookie、浏览器资料、恢复码、本机路径、私密模型输出、`dist/` 或 `node_modules/`，保留第三方许可证。不做无关格式化。

维护者会检查范围、行为、测试、文档和兼容性；测试通过不代表必然合并。较大的架构改动先讨论，社区不承诺固定响应时间。

提交贡献表示同意将自己的原创贡献按 Apache-2.0 授权。只提交有权提供的内容，第三方材料需保留兼容许可和署名；目前不要求单独签署 CLA。
