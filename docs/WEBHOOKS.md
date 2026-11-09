# Webhook P1：外部事件到独立验收结果

P1 提供独立签名入口、持久收件、人工批准的自动化模板、现有 Router Goal 执行和独立验收、持久结果回调。普通 `/events/:sourceId` 与 `MessageSource.replyUrl` 保留原有协议；本功能不会改变它们对不确定外部副作用的处理。

```mermaid
flowchart LR
  A[签名外部事件] --> B[校验授权与参数]
  B --> C[(Inbox 先提交再返回 202)]
  C --> D[固定模板创建唯一 Router Goal]
  D --> E[现有 Worker 与依赖调度]
  E --> F[独立验收]
  F -->|未通过| G[原任务自动返工或受审重规划]
  G --> E
  F -->|整体通过| H[(目标完成与领域事件同事务)]
  H --> I[冻结结果投影与签名回调]
  I -->|临时失败| J[相同 ID 与正文退避重试]
  J --> I
```

## 启用

在启动配置添加 `"webhooks":{"port":4338}`，启动宿主。管理服务继续仅监听原端口的 loopback；签名入口另监听 `127.0.0.1:4338`，只接受 `POST /webhooks/<endpointId>`。`serve()` 返回 `webhookUrl`，用于端口设为 0 的隔离验收。

本阶段不自动配置公网地址、反向代理、TLS 或飞书入口。未来代理只能暴露这个独立 listener，不能代理管理端口。该配置是启动参数，不是热更新设置。

准备两个独立的环境变量，例如 `INTAKE_WEBHOOK_KEY`、`RESULT_WEBHOOK_KEY`，值格式为 `whsec_` 加 24–64 字节随机密钥的标准 Base64。配置与账本只存环境变量名。不要用管理 token 充当签名密钥。入站允许同时指定两个密钥引用；通过重叠保留旧/新引用进行轮换，轮换期间两个引用都必须可用。秘密值在受控启动环境更新，不写入任务文件。

仅本机验收允许显式配置 `loopbackCallbackOrigins:["http://127.0.0.1:9876"]`。例外必须匹配完整 origin，并且目标主机是字面量 `127.0.0.1` 或 `::1`；不会放开其他私网地址或 `localhost` DNS。生产回调默认要求 HTTPS，不允许 URL 凭据、查询串 token、重定向、私网或特殊地址。每次连接重新解析 DNS，检查全部返回地址，并固定实际连接地址，保留 TLS 主机名校验。

## 人工授权与模板

先在已绑定的群/共享入口，由当前 scope manager 明确提出长期自动化授权。通过已有聊天入口或管理端 `/send` 记录真实的人类输入，取得 `triggerId`。不能用一个机器事件声明 `human:true` 来创建授权。

管理端操作需要现有 operator token 或登录会话（仍执行同源检查）：

| 方法与路径 | 含义 |
| --- | --- |
| `POST /webhooks/grants` | 审批并创建不可变版本的事件绑定、参数规则、目标模板及回调投影 |
| `GET /webhooks` | 查看授权、收件状态、投递状态与尝试记录；不返回密钥值 |
| `POST /webhooks/control` | 停止/恢复收件、暂停/恢复回调、撤销授权、人工重投死信 |
| `POST /router-goals` | 使用现有 scope manager 权限查看、暂停、恢复、取消自动化目标 |

`POST /webhooks/grants` 请求示例（JavaScript 对象，序列化为 JSON）：

```js
const grant = {
  operationId: 'approve-intake-v1',
  triggerId: 'local:your-real-approval-message',
  authorizationQuote: '持续处理经过签名的审计事件', // 必须逐字来自这个人类输入
  namespace: 'intake-audit',
  eventSource: 'https://producer.example/intake',
  eventTypes: ['intake.audit'],
  secretEnvs: ['INTAKE_WEBHOOK_KEY'],
  parameters: { batch: { type: 'string', maxLength: 100 } },
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  maxEvents: 100,
  maxConcurrent: 1,
  perMinute: 60,
  template: {
    title: '核对批次',
    objective: '核对指定批次并输出 result.json；不得部署。',
    criteria: [{
      id: 'verified', description: '结果通过核对',
      check: { kind: 'json_equals', path: 'result.json', pointer: '/verified', expected: true }
    }],
    nodes: [{
      id: 'audit', title: '核对', workerId: 'existing-worker',
      instruction: '根据 automationData.data.batch 核对已授权的本地数据，并生成 result.json。',
      criterionIds: ['verified']
    }],
    maxRepairs: 2, maxReplans: 2, maxTurns: 100
  },
  callback: {
    url: 'https://consumer.example/agenthub-results',
    secretEnv: 'RESULT_WEBHOOK_KEY',
    idempotent: true,
    events: ['goal.completed', 'goal.held', 'goal.needs_input', 'goal.cancelled'],
    resultFiles: ['result.json'],
    maxAttempts: 12
  }
};
```

模板审批必须认真选择验收标准：仅检查 `verified:true` 是接口示意，不足以证明复杂业务任务正确。实际模板应声明具体结果、证据文件和必要的独立语义验收。

授权保存真实审批人、来源引用及摘要、scope/entry、模板、期限、事件与并发预算、Worker/工具/网络配置快照。每次调度、工作工具调用和投递都复核当前授权。Worker、工具、网络或入口权限变化会阻止原授权继续使用，需要重新批准新的版本。P1 模板版本不可就地改写；新模板创建新授权。已接收事件不会被新版本重新解释。

事件只能填入明确声明的参数：字符串（长度上限，可选枚举）、数值（有限上下界）、布尔值；所有声明参数必填，额外字段拒收。不支持在目标、验收标准、权限、Worker ID 或回调地址中进行字符串模板替换。数据以 `automationData` 传给现有执行链，并标明不可信。机器身份与人类批准记录分开保存；机器输入不能写入激活的 Agent 记忆或改写原始要求。自主重规划只能使用原模板批准的 Worker/backend，并继续受原有合同和独立审查约束。

P1 使用现有 source 工作目录策略，不替每个事件自动创建业务目录。共享工作目录的模板应保持 `maxConcurrent:1`，并避免多个授权同时写同一批文件；需要隔离时使用既有 task workspace 策略和明确的模板路径。

## 外部入站协议

发送 CloudEvents 1.0 结构化 JSON（P1 子集）：

```json
{"specversion":"1.0","id":"batch-unique-id","source":"https://producer.example/intake","type":"intake.audit","data":{"batch":"2026-11-09"}}
```

必需 `specversion/id/source/type/data`；可选 `subject/time/datacontenttype`，`datacontenttype` 如提供必须是 `application/json`。`source` 必须是已批准的绝对 URI，`type`/可选 subjects 必须在批准范围。拒绝其他 envelope 字段；正文限 64,000 字节，不接受压缩请求。入口只返回收件凭证，不等待模型执行。

使用 Standard Webhooks HMAC-SHA256：

```text
webhook-id: transport_123
webhook-timestamp: 1790000000
webhook-signature: v1,<Base64 HMAC>

signed bytes = UTF8(webhook-id + "." + webhook-timestamp + ".") + exactRawBody
```

`webhook-id` 仅允许 1–200 个字母、数字、下划线、连字符；时间戳为秒，容差 300 秒。重复签名头会被拒绝。签名正文必须是 HTTP 实际发送的原始字节。密钥轮换可同时提供以空格分隔的 `v1,...` 签名。

- 首次有效请求：SQLite 提交 Inbox 后返回 `202 {receiptId,state,duplicate:false}`。
- 同业务事件重试：返回同一 receipt/goal，`duplicate:true`，不消耗第二次事件预算。
- 业务身份由可信 tenant、entry、provider account、namespace、CloudEvents source/id 组成；端点或 transport ID 变化不会生成第二个目标。
- 同身份不同规范化业务正文：409 `event_identity_conflict`。JSON 键顺序、空白和重新签名不影响去重；业务 time/subject/data 改变属于冲突。
- 无效签名 401；越权 403；schema 400；超限 413；预算/速率/待处理队列超限 429；存储不可用 503。429/503 携带 Retry-After。不会先返回 202 再依赖内存队列保存。
- 总待处理 Inbox 上限 1,000；grant 有独立速率、总事件和未结束目标并发限制。不同 grant 的等待队列不会相互饿死。

## 结果回调与故障恢复

所有自动化目标的状态变更在宿主 Store 事务中生成领域事件。`goal.completed` 还要求整体独立验收通过且证据仍有效，Worker 的 ready 声明不会直接产生完成回调。支持 started、waiting、needs_input、paused、held、completed、cancelled、verification_failed、replanned；只投递该授权显式订阅的类型。

回调 CloudEvent 包含 `data.schemaVersion:1`、goalId、receiptId、单目标递增 sequence、state、contractHash、模板版本、验收 round/criterion verdict，以及明确批准的结果投影。不发送原始事件参数、私有会话、Worker 断言、内部执行日志或 Agent 记忆。

`resultFiles` 只能选原始验收合同声明的文件。完成时从已验收快照取内容与 SHA-256；最多 10 个文件，每个最多 16,000 UTF-8 字节。过大的文件只发送路径、字节数、摘要与 `omitted` 原因；跨任务同路径但内容不同会标为 ambiguous，不猜选其中一个。此版本没有外部附件下载 API。

每个领域事件和订阅形成唯一 delivery。HTTP 头 `webhook-id` 是稳定 delivery ID，正文 `id` 是稳定 domain event ID。目标地址、正文和摘要在生成 delivery 时冻结；重试只刷新签名时间。接收端须以 delivery ID 持久去重，并在自己的业务提交后再返回 2xx。传输是有预算的 at-least-once，不能保证跨系统 exactly-once，也不保证抵达顺序；用 sequence 处理旧状态覆盖。

| 结果 | 处理 |
| --- | --- |
| 2xx | 标记 sent，仅表示接收端已接收 |
| 连接失败、丢失响应、408、429、5xx | 同 ID/正文重试；指数退避加抖动，基础上限 5 分钟，Retry-After 最多采纳 1 小时 |
| 401/403、缺失密钥 | held，等待管理员修复后显式 retry_delivery |
| 其他非 2xx、重定向、禁止的目标/DNS 地址 | dead，不自动重试 |
| 超过 maxAttempts | dead，保留全部尝试摘要 |
| 进程在 sending 中退出 | 新宿主恢复 pending，以同 ID 再投；不会重新执行 Goal |

管理 control 请求包含 `id`（授权 ID）、`operationId` 和 action：

- `stop_receiving/start_receiving`：只改变新收件，不撤销已接收工作的授权。
- `pause_delivery/resume_delivery`：暂停/恢复尚未发送的回调。被中断或已经 held 的投递须单独 retry_delivery。
- `revoke`：不可逆撤销自动化授权；阻止新事件和新执行，保留未完成目标为 held，终止执行能力并阻止待发回调。已被外部系统接收的副作用无法撤回。
- `retry_delivery`：额外提供 deliveryId，只允许 dead/held；复核原授权后增加一个投递尝试窗口。保留原目的地、ID、正文和目标执行结果。

授权过期或撤销后的目标不能通过普通 resume 复活；需要新的明确授权/目标。人工 pause/cancel 的状态在重启和重复事件后保留。回调暂停/死信与目标验收结果分别呈现，避免把“回调失败”误报为“任务失败”。

## 升级、数据与验收

首次创建授权在同一事务把数据库 user_version 提升为 8；旧版程序（最高支持 7）会拒绝打开，防止旧二进制忽略新的执行/投递语义。没有创建授权的现有库不会因此升版本。不要手工降低 user_version。回滚必须恢复完整的升级前一致性备份，并对升级后已经发生的外部事件/回调进行人工对账，不能仅替换二进制或复用旧 ID 盲重放。

P1 不自动删除收件去重记录或死信，避免晚到重试生成第二个目标；原事件参数和结果投影也会保留在宿主私有数据库。事件预算必须根据实际容量设置，后续需要接入带去重占位保留的归档/保留期策略。此版本不声称能发现上游从未发送的事件，平台 cursor/API 对账属于后续阶段。

自动回归：`npx vitest run tests/webhooks.spec.ts`。真实模型与 HTTP 验收：

```sh
WEBHOOK_ACCEPTANCE_DIR=/absolute/fresh/evidence-dir node --import tsx examples/webhook-acceptance.ts
```

该脚本隔离 state/workspace，启动真实 Router、Worker 和独立 verifier，执行 30 行/18 唯一记录的三阶段任务；显式注入一次错误产物和假 ready 报告。四个宿主进程间进行三次真实 SIGKILL：收件落盘后、错误验收后、接收端已提交但尚未回应时。接收端下一次返回 503，随后 204。结果证据验证一次业务效果、同 ID 三次投递、原合同保持、原任务返工、回调不重跑任务，以及只有获准文件出现在结果中。失败注入是受控测试条件，不冒称自然发生的模型错误。

实现参考 [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)、[CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)、[Node BlockList](https://nodejs.org/api/net.html#class-netblocklist) 和 IANA [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)/[IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) 特殊地址注册表。没有复制其他 Agent 项目的任务引擎。
