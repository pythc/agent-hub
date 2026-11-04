# Get started / 首次使用

Open `/configure` on your AgentHub. The default screen guides you to a working browser inbox. English is the initial language; 简体中文 is available in the top bar.

1. **Choose your AI service.** Use an existing Codex sign-in, or enter the service address, model name and API key provided by your service or team. OpenAI and Anthropic have presets; custom services retain all three supported API formats. Credentials stay in the current draft until you apply the setup.
2. **Start in the browser.** No office account is required. Feishu and WeCom can be connected later, after your browser request works.
3. **Choose a dedicated work folder.** The suggested folder is created for you. It starts with read-only access; the assistant can analyze files there. Changing files requires a separately configured write-capable source.
4. **Check and apply.** When asked to connect this browser, select the private `connection.json` file whose location appears on the page. Then check the AI service and save. AgentHub preserves existing connections and conversations, adds this workspace and reloads the host while keeping its address and connection key.

After saving, type a normal request and see its progress and reply on the same page. Source, discussion and request IDs are handled internally. Each message starts a separate task; the operations console remains available for deeper task control.

Returning users can select their connection file and open the last saved browser inbox. Saved settings and request history survive a restart; browser authorization must be supplied again after reloading the page.

## Local examples

Install the repository dependencies first. With Codex already installed and signed in, run:

```sh
node --import tsx examples/getting-started-demo.ts
```

This starts an independent functional instance at `http://127.0.0.1:4335/configure`, using an isolated state directory and read-only work folder. It makes real Codex model calls through the existing login and has no office integrations. The terminal prints the connection file path, never the key itself.

For an offline configuration playground:

```sh
node --import tsx examples/configuration-preview.ts
```

It uses the same port, so stop one example before starting the other. The offline preview can save choices, but its connection checks remain pending and it cannot execute tasks. This restriction is visible before applying setup.

## Advanced settings and recovery

“Advanced settings” retains the complete execution, sources, policy, background work, delivery, prompts, JSON and revision editors. Changing existing backend endpoints or source deployment properties still requires a controlled configuration change. The first-run guide adds a connection and workspace through its own validated, reversible deployment path; it does not rewrite existing connection identities.

Settings saves use version checks. A stale draft receives HTTP 409, and newer settings remain intact. Applying first-run setup while background work is active is refused. If reloading the new configuration fails, the previous settings and managed connection files are restored. An interrupted file update is reconciled with its database commit marker on startup.

Managed connection definitions are stored in `<stateDir>/setup/connections.json`; API key values are in the private `credentials.json` beside it. The browser's connection file contains an operator key and must remain private. The page keeps keys in memory, not its URL or browser storage. Advanced manual token entry remains available.

Version 0.9.0 backups include managed connections and API credentials with checksums. Keep those backups private. Environment variables or external credential files managed outside the guide still require their own backup. Work files, attachments and external actions are outside SQLite/configuration rollback.

## 中文快速说明

默认页面按四步完成首次配置：**选 AI 服务 → 先在浏览器试用 → 选专用文件夹 → 检查并保存**。不需要先理解路由器、后端协议、准入矩阵或作业期限。API 的自定义协议和全部专业参数仍可使用，但不再是默认入口。

连接浏览器时，点击“选择连接文件”，选择页面提示位置的 `connection.json`；无需手抄令牌。保存后直接用普通语言交代任务，在“最近任务”中查看处理进度和回复。刷新后重新连接，再打开上次保存的入口即可。

建议文件夹默认只读。飞书、企业微信可以后续接入，不阻塞第一条浏览器请求。办公平台的创建权限、凭据和真实收发仍需分别完成，见 [办公接入](OFFICE.md)。升级前保留原启动配置和备份，见 [0.9.0 验收与回退](ACCEPTANCE_0.9.md)。
