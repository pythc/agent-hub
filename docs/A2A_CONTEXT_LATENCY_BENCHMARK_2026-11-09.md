# A2A 重规划时延与未缓存输入：定位和针对性对照

2026-11-09。在 `codex/a2a-context-latency-20261109` 完成本地研究，未部署、推送、修改现有实例配置或发送外部消息。

上轮慢 32.1% 的主要增时已定位到一次原生响应流断开重试；未缓存输入只少 1.2%，是因为大部分消掉的往返本来已缓存，且 Worker 的未缓存输入增加抵消了验收收益。本轮针对性改动后，最终候选 **4/4 次通过原标准**；相对上轮优化版，三对双方通过样本合计总 token 减少 **22.1%**、未缓存输入减少 **17.6%**、原始耗时减少 **26.2%**。重规划的一对成功配对两组均无记录到的原生重试，未缓存输入减少 **37.3%**、耗时减少 **19.3%**；修复两对的未缓存收益仍只有 **2.1%**。这是小样本描述统计，不能把缓存和服务故障差异全部归因于源码。

**上轮为什么重规划慢 32.1%**

这是上轮唯一一对两组均通过的重规划样本：`04-a` 为旧交接基线 `65a9659`，317.178 秒；`04-b` 为上轮优化版 `8d6ef06`，418.848 秒。差额为 101.670 秒。不能把单对差异直接当作交接算法的固定代价。

| 原生／宿主调用阶段 | 旧基线 | 上轮优化 | 差异 |
| --- | ---: | ---: | ---: |
| 重规划后的归一化 Worker | 25.5 秒 | 191.6 秒 | 增加约 166.1 秒 |
| 两次独立验收合计 | 92.3 秒 | 52.7 秒 | 减少约 39.5 秒 |
| 端到端 | 317.2 秒 | 418.8 秒 | 增加 101.7 秒 |

慢 Worker 内有 **151.212 秒**的相邻原生输出间隔，5 次工具往返合计仅 **0.998 秒**。进一步对同一拥有线程、同一调用时间段只读查询原生 `logs_2.sqlite`，在 **12:37:26.973197 UTC** 找到 `codex_core::responses_retry` 的明确警告：响应流断开，重试第 **1/5** 次，退避 **212ms**；随后恢复输出。151 秒主要花在发生故障的原生响应区间，不是 212ms 的退避本身，也不是本地 shell 执行时间。

因此，已定位主要增时发生在原生断流与重试的链路，而非独立验收。日志没有明确 HTTP 错误码，不能进一步确认服务端为何断流，也不能宣称缩短提示词就能消除该故障。旧基线的最终 Router 调用也记录过一次原生重试；“有没有重试”和“重试造成多长阻塞”需要分别看。所有正式对照均保留这种故障耗时，不删掉不顺利样本。

原生内部失败尝试如果没有返回 usage，宿主账本无法补算其 token 或费用。此前“账本与原生累计一致”证明的是已报告用量对账，不证明每个失败传输请求都零成本；不会用猜测补齐数字。

**上轮为什么未缓存输入只少 1.2%**

上轮三对两组均通过的输入从 1,952,017 降至 1,064,635，减少 **887,382 token**；其中已缓存输入从 1,507,200 降至 625,152，减少 **882,048 token**。两者相减，未缓存输入只减少 **5,334 token**，即 **1.2%**。消掉的大部分往返本来已经复用了缓存前缀。

| 用途 | 旧基线未缓存输入 | 上轮优化未缓存输入 | 改变 |
| --- | ---: | ---: | ---: |
| Router | 74,054 | 73,053 | 减少 1,001 |
| Worker | 199,545 | 225,624 | **增加 26,079** |
| 独立验收 | 154,666 | 123,701 | 减少 30,965 |
| 规划＋方案复核 | 16,552 | 17,105 | 增加 553 |
| 合计 | 444,817 | 439,483 | 减少 5,334 |

独立验收节省的大部分未缓存输入，被 Worker 的增加抵消。大份原件一次性内联仍要在全新独立会话里读取；这三对优化样本的验收缓存输入均为零，不能把所有减少的分页成本当作同等未缓存成本节省。

实际重复与额外步骤包括：

- Worker 的完整 `mandate.scope` 同时出现在开发者 `Execution environment.mandate` 与用户输入 `mandate.scope`，首次调用和续接时均会重复传输。
- 原始完整验收、当前节点条件和重规划备注有语义重叠；本轮保留原始完整合同和证据，优先减少可逐字证明相同的副本。
- 上轮两次成功重规划都重写了 clean、aggregate、report 三个节点。原来明确的 `fixture.mjs` 单步命令被扩展成读取、检查、再读取、执行和核对的多轮流程；报告 Worker 各用了 11 次工具调用。这些额外输出随后又进入完整执行证据。

原生会话还会注入权限环境和临时目录等内容；观察到不同新会话在证据正文之前已存在不同临时路径。这里只把它作为输入差异记录，不声称已证明每次缓存未命中的内部原因，也不通过扩大权限或改写 native profile 来强制缓存命中。

**本轮改动与不变量**

最终候选源码冻结在 `5061a3ae6515ce6bd434b178205282782717db24`。

1. 原生 Worker 仅在 managed、非 operator、任务 ID、cwd、完整 scope 与标准开发者环境严格一致，且嵌套及外层 JSON 都可逐字还原时，把 JSON 字符串的 scope 改成 `{jsonText: 完整结构化内容}`。**每一条输入仍自带完整 scope，更高优先级开发者 scope 也完整保留**；通过去除多层 JSON 转义减少传输和解析负担，没有跨消息 hash／引用。缺少匹配条件、较小输入、未知布局或序列化受限时均保留完整原输入。宿主原始请求、存储的 mandate 和审计数据不变。
2. 只给规划模式补充“最小因果策略改动”的要求：保留仍有效的后续指令，保留明确可执行的阶段命令，合并必要的独立检查，避免重复读取整份文件。每项原标准、必要检查、独立方案复核、独立验收及全部失败证据引用继续保留。

首轮、续接、live refresh 均继续发送完整当前开发者 scope；停止／撤销、来源范围、工具／连接权限、已完成效果、当前快照、修复／重规划次数和 sandbox／network 策略检查不变。没有换模型、降低 effort、增加重试或省略原件来换取成绩。独立复核指出的深层 JSON 序列化边界已以 `toJSON:null` 的嵌套数据实际复现，最终版回退原文，精确还原不变量仍单独检查。

覆盖限制：上述传输优化目前用于内置 `kind=codex`。打包执行后端会省略 `activity`，因而保守回退到完整输入；没有为了扩展优化范围转发更多元数据或放宽边界。真实 compaction 后的模型理解不能仅由本地逐字还原证明。

**新对照设计和结果**

A 是**上轮优化版** `8d6ef06` 的等价文档提交 `84b7e5a`，B 是本轮 `5061a3a`。此处效果不与上轮 `65a9659` 混算。

两组使用同一冻结的 V2 harness，SHA-256 `162bd43013c137c03a9422a1613f2d0ec54790341687144d01cb0d9dd36d567c`。新增的观测仅记录模型用量快照时间、公开输出元信息、工具开始／结束／结果大小，以及私有测试请求副本，业务输入、标准和权限相同。比较器要求 `measurementVersion=2` 相同，逐对核对 contract／config／fixture／harness／runtime／目标与标准；逐 tick 断言原始授权、目标、标准和实际 10,000,000 字节预算不变。

Node 26.0.0、macOS arm64、Codex CLI 0.166.0-alpha.6；Router／规划／复核／验收 terra medium，三个 Worker sol high；全新隔离状态，Seatbelt，任务侧 network=false。原三阶段夹具、期望 A=220／B=260／C=300／总计 780、单轮 5 分钟、总 12 分钟、修复与重规划次数均保持。

成对顺序：修复 01-a→01-b；重规划 02-a→02-b；修复 03-b→03-a；重规划 04-b→04-a。最初两份 A 基线在早期候选诊断时已完成，源码、共同仪表、条件和夹具均未改变，因此以只读软链原样复用，失败基线也保留；没有改写原结果或补写 hash。正式样本时间顺序为 01-a→02-a→02-b→01-b→03-b→03-a→04-b→04-a。只有两组均通过的配对计算正常节省。

| 场景 | A token | B token | A 耗时 | B 耗时 | 原验收 |
| --- | ---: | ---: | ---: | ---: | --- |
| 修复，第 1 对 | 285,381 | 236,419 | 306.3 秒 | 174.0 秒 | 两组通过 |
| 重规划，第 1 对 | 76,388 | 407,891 | 37.4 秒 | 415.1 秒 | A 漏引证据失败；B 通过 |
| 修复，第 2 对 | 288,767 | 259,750 | 168.5 秒 | 160.9 秒 | 两组通过 |
| 重规划，第 2 对 | 457,163 | 307,654 | 228.5 秒 | 184.4 秒 | 两组通过 |

| 双方通过的配对 | 总 token 降幅 | 未缓存输入降幅 | 原始耗时降幅 |
| --- | ---: | ---: | ---: |
| 修复两对合计 | 13.6% | 2.1% | 29.5% |
| 重规划一对 | 32.7% | 37.3% | 19.3% |
| 三对合计 | 22.1% | 17.6% | 26.2% |

三对成功配对合计的输入／缓存输入／未缓存输入分别由 **1,016,453／622,336／394,117** 变为 **792,304／467,712／324,592**；输出由 14,858 变为 11,519，总量由 **1,031,311** 变为 **803,823**。耗时合计从 703.325 秒降至 519.227 秒。模型激活次数均为 27，provider steps 从 77 降至 64，Worker 工具调用从 35 降至 21；没有通过少做一次独立验收来减少激活。

**主要收益与仍然存在的波动**

成功重规划对照中，A 改写了 clean、aggregate、report 三个节点，B 只改 clean。A 的 Worker 工具调用为 1＋6＋2＋8，B 为 1＋5＋1＋1。汇总阶段从 29.2 秒降至 17.7 秒，报告从 50.0 秒降至 21.6 秒；两次独立验收总耗时从 59.8 秒降至 52.1 秒，仍完成所有原检查。归一化阶段反而由 31.6 秒升至 36.7 秒，因此没有宣称每个阶段都更快。

| 三对成功配对用途 | A 未缓存输入 | B 未缓存输入 |
| --- | ---: | ---: |
| Router | 79,445 | 71,069 |
| Worker | 195,856 | 143,199 |
| 独立验收 | 105,503 | 93,309 |
| 规划 | 4,566 | 8,497 |
| 方案复核 | 8,747 | 8,518 |

Worker 少了 52,657 个未缓存输入，占整体减少 69,525 的约 75.7%，是本轮主要节省来源。规划自身未缓存输入有所增加，未隐藏其额外提示与缓存差异。成功重规划中，未改业务逻辑的首次失败 Worker 也由 19,373 降至 6,201 个未缓存输入，说明至少这 13,172 的差额不能解释为后续规划改动的直接效果；缓存状态仍是显著变量。

格式改动的确定性收益比较小：最终 B 的 16 次 Worker 调用中仅 **4 次**达到编码收益条件，其他 12 次保留完整原文；实际输入正文合计少 3,168 字节，说明文字增加 1,612 字节，净少 **1,556 字节**。全部 16 次都自带完整当前 scope，没有跨消息引用。它不是 17.6% 未缓存收益的主要来源，主要路径变化是减少无关的执行／检查扩展。

记录到的原生重试：A 的 01-a 验收一次；B 的 01-b 报告 Worker 和验收各一次，02-b 汇总 Worker 一次。03-a、03-b、04-a、04-b 在拥有线程／调用时间段均未记录到该重试。01-a 的长故障明显放大了修复首对 43.2% 的原始耗时收益；反向修复对照只有 4.5%。这些耗时全部保留，没有从主统计中减去故障时间。最后重规划配对的 19.3% 原始耗时收益相对更有说服力，但仍只有一对成功样本，不能承诺生产 SLA 或同等费用降幅。

**验证与证据**

完整 87 文件、**1224 项测试**和宿主／Chat／看板类型检查通过。49 项定向测试包含逐字还原、Unicode／CRLF、不同 scope／任务／工作区不匹配、深层序列化及保守回退，以及实际 native stdio 首轮和续接的完整开发者 scope 与自包含用户正文。原有重规划授权／停止／独立复核与验收回归仍通过。

正式 8 次结果全部与拥有的原生线程最终累计用量及 provider step 数对账，未知／部分用量调用均为零；这只指后端已回报的用量，不补算未回报的内部失败请求。29 次 Worker 实际输入（含 A／B）均与原始宿主请求逐字相同或可精确还原，203 次完整内联证据交付也全部逐字还原通过。预算观测最大 107,060 字节，全部在共同 10MB 上限内。

Codex Security 三个不可变范围均已封存并回读：`84b7e5a..1a48831` 扫描 `286ba8d1-1350-4254-87b5-42d3bcdd47cb`，`1a48831..b685f36` 扫描 `75eaae05-6bbd-4402-9d06-99bea66a1b53`，`b685f36..5061a3a` 扫描 `ad9d002f-54e4-45f4-a1ef-0823e37a04bd`。覆盖全部 4 个不同的变更生产文件及后续修正，0 个确认安全问题。包含 fresh fork 的独立架构与差异复核、父代理自行 review；这不是整个上游仓库审计，亦不证明模型必然理解某种表示。

封存报告：[初始范围](/Users/alex/.codex/state/plugins/codex-security/scans/roppo-token-evidence-20261109/1a488311c1e9c04418afb662351d2b0fe60c444b_20261109T132033Z_qx97qj2e/report.md)、[自包含修正](/Users/alex/.codex/state/plugins/codex-security/scans/roppo-token-evidence-20261109/b685f3664ec53782ac52ef59c962ce011b94e4a6_20261109T135222Z_xdsj1yia/report.md)、[序列化回退](/Users/alex/.codex/state/plugins/codex-security/scans/roppo-token-evidence-20261109/5061a3ae6515ce6bd434b178205282782717db24_20261109T140109Z_lv406dpb/report.md)。扫描器自身回报归属 token 分别 8,097,096／2,472,994／1,102,510，均为 `partial`，有无效计数记录警告且可能相互重叠，不能相加成完整研发消耗，也未混入受控模型试验。见 [扫描用量原始摘要](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/a2a-context-study/security-usage.json)。

**早期候选的失败和成本**

最早的 `1a48831` 尝试把用户字段 scope 引用到更高优先级开发者正文。虽然本地和原生 payload 逐字还原检查通过，但真实重规划续接的 Worker 报告“repair references an unavailable mandate binding”，原有规则因此停止任务。该失败说明数据可还原不能替代模型语义兼容验证；最终版已移除跨消息引用，每条输入都提供完整原文语义。

旧候选三次诊断：修复通过 268,322 token／170.7 秒，重规划失败 104,406 token／71.7 秒，第二次修复通过 298,159 token／183.2 秒。合计 **670,887 个已报告 token**，不混入最终版效果；失败重规划另有 1 次未报用量的 Router 调用，保留未知，不记成零成本。调度发现失败时已进入的修复任务正常结束后，停止了后续旧候选调度。没有覆盖这些记录，也没有降低缺失上下文或原验收标准。

最终 8 次正式运行共 **2,319,413 个已报告 token**，包括失败的基线和未配对成功的 B 运行；加上旧候选诊断，本轮这些试验共报告 **2,990,300 token**。复用的两次 A 只计一次；不包含前两轮研究、研发对话和代码审查，也不把未知调用或未回报的内部失败计成零费用。

本地证据：

- [原研究逐阶段与已报告用量明细](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-10mb-final/performance-profile.json)
- [原生断流重试的脱敏日志摘要](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/a2a-context-study/native-gap-log.json)
- [最终新对照结果](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/comparison.json)
- [Worker 实际输入逐字还原](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/worker-binding-audit.json)
- [最终逐阶段、冷输入与原生重试](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/performance-profile.json)
- [完整证据交付逐字还原](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/input-audit.json)
- [格式改动的净字节收益](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/encoding-bytes.json)
- [早期候选及其失败诊断](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-v2/comparison.json)

原生日志读取仅查询拥有的 thread ID 和对应宿主调用时间段，导出时不包含日志正文或任何凭据。所有试验私有数据位于忽略的 `.local/`。

本地 Codex 适配包 1.0.4 已构建，归档解包后的 digest／代码逐字一致；Agent board 0.1.4 原包 hash 复核通过，未安装或发布。包仅包含适配器，完整变更还包括宿主的规划提示；打包后端的性能回退范围仍适用。隔离基线→最终版→基线→最终版的状态往返也通过：已有 256000／10000000 预算、已知 token、未知覆盖和原件均保留，没有真实模型调用、原生会话迁移或在途任务回滚。证据：[包清单](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/packages/a2a-context-final/packages.json)、[状态兼容记录](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/compatibility-a2a-context-final/result.json)。

所有实验宿主已关闭。2026-11-09 **22:31:11 +08:00** 只读核对现有实例：仍为 `c9b6c6cc5c244449c1c144880bcecfdbb6eda3f2`，健康正常、settings revision 11、active=0，发布快照中没有本轮 `worker-input.ts`。见 [live-readback.json](/Users/alex/Documents/ChatGPT/竞赛/work/roppo-token-evidence-20261109/.local/ab-a2a-context-final/live-readback.json)。

**复现**

使用全新目录；测量 checkout 为 `1a48831`，A 实现为 `84b7e5a`，B 实现为 `5061a3a`。相同测量代码只动态导入指定实现，类型导入已擦除；全部运行均显式传入 `10000000`。先安装各 checkout 的相同依赖。

```sh
node --import tsx /absolute/measurement-code/examples/evidence-cost-acceptance.ts /absolute/fresh/01-a /absolute/baseline-code repair 10000000
node --import tsx /absolute/measurement-code/examples/evidence-cost-acceptance.ts /absolute/fresh/01-b /absolute/optimized-complete-code repair 10000000
python3 examples/compare-evidence-cost.py /absolute/fresh --native-index /absolute/codex/state_5.sqlite --pair repair:01-a:01-b --pair replan:02-a:02-b --pair repair-repeat:03-a:03-b --pair replan-repeat:04-a:04-b
python3 examples/analyze-evidence-performance.py /absolute/fresh --native-index /absolute/codex/state_5.sqlite --native-log-index /absolute/codex/logs_2.sqlite
```

02-a／02-b 和 04-a／04-b 用 `replan`，03-a／03-b 用 `repair`，保持前述成对顺序。模型和用量会真实消耗；不得指向现有实例的 state。没有固定 provider 随机种子；缓存、临时环境、原生故障和推理选择存在波动。本研究不能建立任意生产任务、长期大历史、所有后端或 native compaction 后的普遍性能保证。
