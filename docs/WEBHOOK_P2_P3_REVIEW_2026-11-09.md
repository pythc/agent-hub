# Webhook P2/P3 实现、自查与验收

日期：2026-11-09。基线：P1 `4e53674`；实现分支 `codex/webhook-p2-p3-20261109`。本次没有合并、push 或部署到用户正在使用的飞书实例。运行方法和协议见 [WEBHOOKS.md](WEBHOOKS.md)。

## 交付能力

| 范围 | 实现 |
| --- | --- |
| P2 长期推进 | 固定授权规则下的 Worker 事件等待；早到/迟到事件；同 assignment 续接；超时、撤权、暂停/取消、完成后事件处理 |
| P2 恢复 | 消费与唤醒同事务；收件重放；回调分类重试/held/dead；领域事件到投递队列补偿；独立 Watchdog 观察合法外部等待 |
| P3 工作台 | 登录后的 `/webhook-workbench`；授权创建、搜索、规则及事件详情、目标控制、dry run、回放、投递历史和重试、对账、密钥轮换 |
| P3 扩展 | 隔离 ProcessSource 的纯 `webhook` 规范化能力、SDK 和示例包；首个平台为 GitHub Actions `workflow_run`，宿主原生验签 |
| P3 运维 | CAS 密钥版本与有界旧密钥重叠；CloudEvents 1.0 / grant protocol 2 / DB schema 9；离线锁、备份校验、激活与拒绝旧程序 |

没有复制其他 Agent 项目代码，复用本项目现有 Router、任务依赖、独立验收、返工和重规划机制。外部事件只提供已声明的不可信数据，不赋予人类身份、记忆写入权或变更原目标/验收标准的能力。

## 自查后修正的问题

- Worker 工具使用现有 JSON schema 约定，避免混入不被当前模型传输适配器接受的 schema dialect。
- 原 P1 grant 的 policy hash 保持兼容；无 Webhook 授权的实例不会因新对账记录被误判为需要升级。
- 早于启动的事件不会挡住启动队列；等待截止前已提交的收件，恢复发生在截止后仍能消费。
- 自动返工会递增任务数据版本。已消费证据按固定归属/授权验证，待消费订阅仍按完整版本验证，防止返工被误阻断。
- 全局重规划版本不应使未修改节点的等待失效。经审查重规划后，已消费事件继续有效；原始规则在目标完成时还要经过消费账本双向关联检查。
- 现有重规划协议本身不能删除原节点；另增防御测试，确保将来若允许替换节点，也不能跳过原授权的事件前置条件。
- Outbox 补偿先筛选缺失投递再限制数量，并复用尝试账本，不能重发已成功事件或绕过 held/dead。
- 密钥轮换发生在投递中时，后续重试读取最新获准密钥引用；旧重叠窗口不被后续轮换无意覆盖。
- 移动端横向溢出、显式深浅主题与系统主题的优先级已修复。

## 验证记录

类型检查通过；全量回归 79 个文件、1,172 项测试全部通过（其中新增 P2/P3 26 项）。最终真实模型从空白隔离目录复跑，25 个检查全部通过；五个真实宿主进程经历四次 SIGKILL，两个事件恰好消费一次，错误产物拦截后一次自动返工，三次回调尝试产生一次接收端业务效果。21 个实现文件在整个复跑期间未变化，完成后再次核对哈希一致。下表区分验证环境，避免将测试替身或公网链路检查称为真实模型验收。

| 层次 | 验证内容 | 证据 |
| --- | --- | --- |
| 自动回归 | 原 P1、权限和长期任务回归；新增 P2/P3 的事件/事务/插件/升级/重规划边界 | `tests/webhooks-p2.spec.ts`、`tests/webhooks-p3.spec.ts` |
| 真实模型 | 三阶段核账，18 条唯一记录；两个外部事件；四次 SIGKILL；错误产物 ready 拦截、自动返工、独立 verifier 读取证据、回调 ACK 丢失和 503 重试 | [native](evidence/webhook-p2-p3-native-20261109.json) |
| 浏览器 | 实际 HTTP 宿主、登录、新建授权、dry run 零副作用、收件开关、轮换、去重、等待、暂停恢复、回调重试、搜索、键盘和 390px 布局；模型为测试替身 | [browser](evidence/webhook-p2-p3-browser-20261109.json)、[重启与主题](evidence/webhook-p2-p3-browser-final-20261109.json) |
| 独立 Watchdog | 两个真实 daemon 进程读取 HTTP 快照；合法外部等待不触发模型复审或重启 | [watchdog](evidence/webhook-p2-p3-watchdog-20261109.json) |
| 公网平台 | 真实 GitHub workflow_run、原生 HMAC、公网 HTTPS 入站、GitHub 重投去重、公网 HTTPS 回调 503→204；模型为测试替身 | [public](evidence/webhook-p2-p3-public-20261109.json) |
| 升级回滚 | 离线备份/激活、重复升级、活宿主锁、旧备份恢复保护；用真实 P1 Store 打开 schema 9 的副本被拒绝 | [downgrade](evidence/webhook-p2-p3-downgrade-20261109.json) |

公网检查最初遇到本机 DNS 失败，该次探测不作为通过证据。随后 GitHub-hosted Actions runner 独立确认 `/settings`、`/webhooks`、`/watchdog/snapshot`、`/worker-mcp` 均在公网入口返回 404。流水线 run `42579091393`；边界验证 run `42579548433`。最终 public 证据合并两个独立通过记录，并保留最初本地探测失败的说明。

首次真实模型验证也发现已消费事件被返工的数据版本变化误判失效，失败记录保留；修复后重新从空白独立目录执行，不修改失败任务的账本以冒充通过。

## 运维边界

- 已有 P1 数据库启用 P2 前需要停止宿主，执行带备份验证的 `webhooks upgrade`。旧二进制不兼容 schema 9，不能直接降级。
- 签名 listener 只监听 loopback，公网只能代理这个独立端口。此次 Cloudflare 临时 HTTPS 隧道仅用于合成测试数据；它会终止 TLS，不代表生产中继的隐私承诺或 SLA。
- 宿主离线时不返回成功；提供方应重试。已被本地提交并 ACK 的事件可恢复。没有新增云端离线持久队列。待处理收件容量 1,000，超限拒收；此验证不是吞吐或长期压力测试。
- 目前不自动清除原始事件和去重账本，事件预算和磁盘容量需由运维控制。未实现上游 cursor/API 全量补漏，不声称能发现从未送达的事件。
- 正规化插件没有网络、凭据或宿主读写操作；平台签名在宿主执行。这是本次交付的窄扩展接口，不是任意 HTTP 插件或平台 challenge/decrypt 框架。
- 工作台复用现有 operator 账户权限；事件原文不会出现在公网 listener。审批仍需原入口的真实 scope manager 授权记录。
- GitHub 验证只使用新建的私有测试仓库 `pythc/agenthub-webhook-acceptance-1794208262010`。Webhook 已移除、临时隧道已停止、仓库已归档；仓库删除未确认，因此不声称已删除。
- 回调 2xx 仅证明接收方 ACK；生产接收方仍须按稳定 ID 持久去重，不能将测试中的一次业务效果泛化为跨系统 exactly-once。

## 复现

```sh
npm run typecheck
npm test -- --maxWorkers=2 --testTimeout=15000 --hookTimeout=15000
WEBHOOK_ACCEPTANCE_DIR=/absolute/fresh/native-evidence node --import tsx examples/webhook-acceptance-p2-p3.ts
WEBHOOK_UI_DIR=/absolute/fresh/browser-evidence node --import tsx examples/webhook-workbench-fixture.ts
# 另一终端，使用安装了 Playwright Chromium 的 Python 环境：
python tests/browser/webhooks.py /absolute/fresh/browser-evidence
python tests/browser/webhook_watchdog.py /absolute/fresh/browser-evidence
# 重启上述隔离 fixture 后：
python tests/browser/webhook_views.py /absolute/fresh/browser-evidence
```

`examples/webhook-public-acceptance.ts` 提供独立公网测试脚本，需要本机 GitHub 登录和 Cloudflared；会在指定私有测试仓库上创建/移除临时 webhook，产生真实 Actions。不要用生产仓库或生产密钥运行。全部本次测试宿主及临时隧道已停止。原始验证目录可能包含测试 token 和临时密钥，不提交这些目录；本仓库证据只保留脱敏结果。
