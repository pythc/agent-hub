# DeepSeek 行为一致性修复与验收

2026-11-06，AgentHub 0.10.0。针对上一轮审查确认的七项问题完成修复、回归测试和自行 review。基线为 `eb0dabb4e0f65f48b175189df46b65319cf01421`，修复分支为 `codex/deepseek-parity-fixes-20261106`。

对照的官方原型提交为 [`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)。15 个领域核心文件保持不变，同时匹配本地 SHA-256 清单与该提交源码。本次修复位于宿主、执行后端和 GitHub 来源适配层。

## 七项修复

| 问题 | 修复后的行为 | 回归证据 |
|---|---|---|
| 1. 失败解释、异常人工问题未送达 | `failed` / `blocked` 的可用解释进入持久出箱，状态保持真实；异常问题通过 attention 路由。报告与通知同事务，已发送的问题在重启后保留原 ID 和提问来源。自动恢复时不误发人工重试要求。等待、普通进度仍静默。 | `tests/parity-regression.spec.ts`：失败/阻塞通知、待处理跟进期间的失败、异常、重启幂等、自动恢复与人工恢复 |
| 2. 跟进只能等整轮结束 | 工具边界和调度 tick 把新输入送入当前会话。仅后端确认输入进入模型历史后才登记 delivered/read；RPC 应答不等同于读取。未读输入保留到下一轮，暂停、停止、晚到回执均有边界检查。 | `tests/parity-regression.spec.ts`；`tests/backend-api.spec.ts` 的三协议下一步注入；`tests/codex.spec.ts` 的原生回执；下述真实 Codex 验收 |
| 3. 一条 uncertain 堵住其他任务 | 出箱按 Ticket、来源、会话排序。其他 Ticket 可继续发送；同组普通投递连续失败三次后允许后续消息发送。uncertain 仍需核对，不盲目重发。 | `tests/parity-regression.spec.ts`：跨任务独立发送、同组顺序、三次失败、不确定结果保留 |
| 4. 问题发错会话 | 报告 schema、提示词和 Runtime 保留 `askedBy`，由原领域核心校验和路由。同一句问题换提问人也会刷新 attention；多条人类输入时不猜测最后一个人。旧格式只在单一跟进来源明确时兼容推断。 | `tests/parity-regression.spec.ts`：跨会话、多个输入、同问题换提问人、重启保留提问人 |
| 5. 普通 Issue 被当作 PR 交付物 | 读取 GitHub Issue 类型，只有确认的 PR 才绑定为影响结束条件的 follows。普通 Issue 的分析 ready 后完成，保留订阅和原会话供跟进。分类期间停止任务不会继续执行或遗留运行中的 start 作业。 | `tests/parity-regression.spec.ts`：Issue 完成与恢复、PR 等待审查、分类与停止竞争 |
| 6. 关闭 PR 漏读内联跟进 | 关闭状态处理与评论/review 读取分开；关闭后不读取 CI。活动任务继续轮询，已结束任务按最后消息与结束时间中较晚者保留两周。评论读取失败不推进线程游标。 | `tests/connectors.spec.ts`：closed/merged 内联跟进、游标保留、轮询期限 |
| 7. API 临时网络错误无法重试 | transport 错误使用 `TransientModelError`，覆盖请求连接和响应体中断；用户取消和总轮次期限保持终止语义。恢复沿用原会话及已完成工具回执。 | `tests/backend-api.spec.ts`：三协议真实本地 HTTP 断连恢复、工具只执行一次、请求超时、响应中断与取消区分 |

主要实现见 [Runtime](../src/runtime.ts)、[Codex](../src/codex.ts)、[API 后端](../src/backends/api.ts)、[GitHub 来源](../src/connectors/github.ts)、[报告结构](../src/schemas.ts)。

## 验证结果

- `npm run check`：TypeScript 检查通过，**28 个测试文件、381 项测试全部通过**；相对基线新增 31 项测试。
- `git diff --check`：通过。
- 15 个 vendored 核心文件：全部与 [记录的哈希](upstream-core-sha256.json) 及上述官方提交一致。
- 自行 review 重点检查了报告/出箱事务、恢复后的通知幂等、输入的接收与读取区别、停止后的晚到回执、异步 PR 分类后的任务存活检查、游标推进以及 API 重试保留工具结果。

API 断网用例启动真实本地 HTTP 服务，先让 Worker 通过 `superagent_read` 读取临时文件，再断开下一次请求连接。三种协议均验证：同一持久会话恢复、已完成工具只调用一次、恢复请求包含真实文件结果、最终结果发送成功。模型回复来自测试夹具，这不是三家远端服务的实网认证或可靠性测试。

## 真实 Codex 验收

运行 `npx tsx examples/parity-native-smoke.ts`，由本机真实 Codex app-server 和模型执行，模型报告为 `gpt-6-astra`：

1. 初始要求最终回复 A，先调用一次 checkpoint 工具。
2. 工具执行期间通过 `turn/steer` 注入来源更正 B。
3. 同一个 turn 最终回复 B；原生历史包含完整更正消息。
4. checkpoint 调用一次，输入读取回执一次，历史 turn 数为一。

可复跑脚本：[parity-native-smoke.ts](../examples/parity-native-smoke.ts)。本机成功记录：[evidence.json](../.local/parity-acceptance/native-u7rYIw/evidence.json)；完整检查日志：[check.log](../.local/parity-acceptance/check.log)。`.local` 证据不随源码提交。

## 结论与边界

本次七个已确认缺陷的修复与对应回归均通过。原型关于真实交付、同会话纠偏、原提问渠道回复、独立任务投递、无 PR 完成、结束后跟进和保留历史恢复的相关行为已接入实际执行路径。

上述证据不构成整个项目与原型所有行为等价的证明。GitHub 读取/投递使用隔离接口夹具；本次没有向真实 GitHub、飞书等会话发送消息，没有进行真实合并或部署。修改位于独立工作树 `work/agenthub-parity-fixes-20261106`，原 `agent-hub` checkout 和运行中的服务未改动；修复尚未提交、合并或发布。
