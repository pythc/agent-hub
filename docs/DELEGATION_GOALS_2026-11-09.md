# 子团队目标调度、独立验收与控制面

日期：2026-11-09。本轮接续 [首期委派](DELEGATION_ACCEPTANCE_2026-11-09.md)，在同机一跳 `managed-team` 上增加结构化目标与独立验收，并补充控制面的目标执行视图。跨机器和 Worker 直接统筹远端 Workers 已按最新决定取消，不再继续实施。本阶段历史代码保留在独立工作树 `work/roppo-delegation-20261109`，基线 `c9b6c6cc5c244449c1c144880bcecfdbb6eda3f2`；没有切换运行实例。最终集成、schema 10/11 与补充验证以 [收尾记录](DELEGATION_CLOSEOUT_2026-11-09.md) 为准。

## 新的执行和验收边界

结构化目标的节点必须且只能指定一个 `workerId` 或 `teamTargetId`。本地节点保留真实 Worker ticket；子团队节点保留真实 delegation ID，目标的 `taskIds` 与 `delegationIds` 分开记录。没有为显示进度而虚构本地 Worker。

宿主按依赖关系和 `maxParallel` 调度节点。远端候选交付通过节点验收后，依赖它的本地或远端节点才会分派；传入的是已验收的证据快照，不会自动把文件同步到另一实例磁盘。每个实例继续使用自己的目录和权限。

节点可以使用程序检查，例如 `json_equals`、`text_contains` 或文件存在检查。整体目标还必须通过一个新的只读验收会话；它沿用 Router 所选模型后端，唯一工具是分页的 `goal_evidence`。验收器必须实际读取并引用证据，不能运行 Worker、执行命令或修改条件。未读取的引用、遗漏的产物、过期来源和撤销授权都会阻止通过。

证据保留三种来源：父宿主的目标创建 / 节点验收回执、配对宿主签名的受管执行记录、实际捕获并校验摘要的文件字节。文件内容与模型报告始终是数据，不产生授权。整体判断同时收到原始请求与原授权范围，避免只核对 Router 概括后的目标。

`superagent_artifact` 本身由宿主读取真实文件字节并生成内部快照，不能把它误认为只有上传声明。配对宿主的受管工具记录只导出当前委派所属任务的工具名称、状态和数量，不导出参数、其他任务、原生历史或宿主凭据。记录不完整时明确标记 `complete: false`；它不证明未导出的命令输出或远端其他 OS 进程的行为。

普通 `team_delegate` 的“父级已核对”继续保留为人工或 Router 检查记录。由结构化目标调度的委派禁止通过该入口手工 accept；只有当前整体独立验收通过后，宿主才能记录 `acceptedBy: goal-verification` 并完成目标。纯远端目标由宿主在原入口发送一次完成通知，不额外唤醒一个 Router 来重复派单。

## 使用方式

A 必须已有管理范围、明确的人类授权输入，并将 B 的目标 ID 加入该范围的 `teamTargetIds`。让 Router 先调用 `team_delegate list` 查找目标，再创建结构化目标；模型不能为已声明节点另行调用 assign 或 accept。

```json
{
  "action": "start",
  "operationId": "verify-child-file-1",
  "expectedRevision": 0,
  "title": "核对远端文件",
  "objective": "远端 input.txt 的内容应为数字 2 加换行",
  "authorizationQuote": "此处填写当前用户请求中的准确原文",
  "criteria": [{
    "id": "value",
    "description": "核对实际返回的文件字节",
    "files": ["input.txt"],
    "check": {"kind": "text_contains", "path": "input.txt", "text": "2\n"}
  }],
  "nodes": [{
    "id": "child",
    "title": "读取并核对文件",
    "instruction": "读取 input.txt，核对数值并返回原文件",
    "teamTargetId": "替换为已授权的实际目标ID",
    "criterionIds": ["value"]
  }]
}
```

这是 `router_goal` 参数示例，原文引用和目标 ID 必须换为当前有效值。精确匹配整份文件可以使用语义标准或 JSON 等值检查；`text_contains` 只证明指定片段存在。远端目标的文本产物仍限制为单文件 128 KiB 的验收读取预算、最多 10 个声明路径；二进制独立验收尚未实现。

新目标冻结被授予的团队策略摘要与配对代次。后续配置扩大权限、改变限额或重新配对，都不能自动改变旧目标的合同。上游原有的远端模型激活预留继续生效；默认 48 次预留配合每委派 12 次上限，最多容纳四个这样的远端节点，不能把图的节点上限当成已经授予足够执行预算。父级验收模型也会消耗额度，未实现货币预算硬限制。

## 失败、控制和恢复

| 情况 | 实际行为 |
| --- | --- |
| 候选文件错误 / 证据不足 | 保留委派和失败轮次，目标挂起；不自动重派远端工作 |
| 验收器传输 / 格式问题 | 在原证据上有界重试只读验收；不重复 B Worker |
| 目标包含远端节点且需要重规划 | 先交人工处理；首期不自动改写远端合同或混合图策略 |
| 前置结果修复后影响已派发远端节点 | 失效该依赖并保留现场，需要明确的新合同；不静默复用旧结果 |
| 暂停团队新接单 | 未提交的节点保留待调度，恢复接单后派发一次；已有合同继续 |
| 暂停目标时远端还在执行 | 明确拒绝执行暂停，提示取消或等待候选；不会把继续执行伪装成暂停 |
| 候选后暂停目标 | 停止新调度和完成发布；已开始的只读检查可保留结果，明确恢复后才结算目标 |
| 取消目标 | 先保存停止意图，按 goal ID 查找所属委派并取消；不依赖节点指针已写完 |
| 提交已持久化、节点指针未写完 | 按 goal ID + node ID 找回原委派；新的人类恢复输入也不会创建第二份工作 |
| 验收中撤权 / 候选观察过期 | 当前证据失效，禁止接受；界面保留等待核对或需要处理状态 |
| 删除来源历史 | 本地相关产物正文和证据不可再读取，删除后的记录不阻塞其余委派泵；对端留存单独管理 |

本阶段历史版本在首次写入远端节点时提升到 schema 9、普通委派为 8；收尾发现与 Webhook 重号，最终版本分别改为 11、10。下述 8/9 门禁记录属于当时的冻结证据；未开启的旧本地配置保持原行为。已保留并执行验证的上一阶段 Store 会拒绝 schema 9；本版重启保留版本，不会降回 8。

备份接受 schema 9，并比较远端目标图的前进状态。即使还没派单，从备份后发生的人类暂停 / 取消也不能被旧备份覆盖。身份恢复仍先进入隔离、撤销旧配对并要求重新配对。删除本地来源历史不等于删除 B 上的记录；A 停止续租后，尚在执行的 B 任务受原租约和期限约束。

执行记录通过可选的 `execution-ledger-v1` 能力协商传输。未协商的对端收到原 v1 投影，不附加其严格 schema 不认识的字段。旧端没有执行记录时，验收器看到的是“不完整”，不会自动获得更强的观测保证。

## 控制面

“部署”页新增“目标执行”：展示目标、真实本地 / 子团队节点、前置依赖及实际状态。每项委派分别展示远端候选状态、节点验收、整体目标验收；结构化目标不显示人工“标记通过”按钮。检查详情展开状态在后台刷新后保留。

未配置导出管理范围时，生成配对码按钮禁用并说明原因。关闭委派功能后，已有任务记录继续可见；关闭开关不证明远端工作已经停止。角色关系仍是一跳的 A Router → B Router → B Worker，不会把 B 的内部拓扑推测为空闲节点。

## 验证和证据

专项回归覆盖假 ready、遗漏证据引用、远端到本地依赖、停止、撤权、策略冻结、重启、指针缺口、旧备份、人类暂停、来源历史删除、能力降级与歧义目标。旧本地目标和普通委派回归一并执行。

```sh
npm run typecheck
npm test -- --maxWorkers=2
node --import tsx examples/delegation-acceptance.ts .local/new-goal-fixture --goal --keep
node --import tsx examples/delegation-acceptance.ts .local/new-goal-native --goal --real-model
python tests/browser/delegation.py .local/new-goal-fixture/browser.json .local/new-goal-browser
```

脚本仍要求新建的私有证据目录。默认模型夹具与真实模型模式分别标记，账号、认证、状态和日志保持隔离；结束验证后关闭本轮进程，不介入当前运行实例。

最终验证如下；所有证据路径均相对于本工作树，`.local/` 中的账号、身份、状态和模型历史属于私有材料。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 类型检查 | TypeScript、React 和插件视图通过 | `.local/delegation-goals-validated-typecheck.log` |
| 完整回归 | 83 个测试文件，1216 项通过 | `.local/delegation-goals-validated-test.log` |
| 新增专项 | 14 项，已纳入完整回归 | `tests/delegation-goals.spec.ts` |
| 两个独立 OS 进程 | 模型夹具完成远端目标、节点和整体独立验收 | `.local/delegation-goal-process-v2-20261109/result.json` |
| 真实 Codex | `gpt-6.1-sol` / medium，113,780 ms，通过 | `.local/delegation-goal-native-v2-20261109/result.json` |
| 实际模型会话 | A：Router 1、独立验收 1；B：Router 2、Worker 1；两轮验收各一次通过 | 同目录两端私有 SQLite 账本 |
| 浏览器 | 中英 × 深浅色 × 1440 / 390 共 8 种；目标视图、检查详情、键盘、刷新持久性、停止和撤权通过 | `.local/delegation-goal-browser-v2-20261109/result.json` |
| 回退门禁 | 保留的首期 Store 拒绝 schema 9；本版保留 9 | `.local/delegation-goals-rollback-gate/result.json` |

真实模型使用合成的 2 字节文件 `input.txt`，内容为数字 `2` 加换行；父实例验收的是签名传回的实际字节，不是示例字符串替代品。没有真实飞书消息或对外业务写入，也没有将控制台登录复用给另一个实例。

首轮真实模型没有通过整体验收：文件本身通过，但证据未解释捕获操作的真实读取语义，也没有父宿主的创建 / 节点验收回执。补齐宿主证据后在新隔离目录复验通过，原失败现场保留于 `.local/delegation-goal-native-20261109`。没有通过修改预期文件内容、放宽权限或手工标记接受来取得通过。

自行复核还修复了异步状态泵覆盖新验收回执、暂停接单节点原因未持久化、删除后记录影响投影和泵、新旧严格 schema 投影兼容等交叉问题。前一版已验证源码另保留在 `.local/delegation-goals-stage1`，本轮源码摘要见 `.local/delegation-goals-source-manifest.json`。DeepSeek vendor 核心未修改。

浏览器保留基线 `/workspaces` 和 `/connection-capabilities` 的已知可选接口 404，未出现页面脚本异常或新增失败请求。当前浏览器验收使用一个真实远端节点，混合本地 / 远端依赖有运行时回归；未声称所有复杂图和故障界面均有视觉验收。跨机器、压力和全时钟边界也不在本轮证明范围内。
