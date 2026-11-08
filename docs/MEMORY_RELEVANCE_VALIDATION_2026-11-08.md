# 召回证据验证：修复、独立测试与边界

基线 `3db35f3e2b715ef944cb609eb1c794ee7bd8c31a`，分支 `codex/weknora-memory-20261108`。本次修复 OpenAPI 漏召回和护照误召回，使用隔离 SQLite、真实本地 embedding / reranker，以及真实原生 Codex 记忆模型。没有部署、修改运行实例配置、合并或 push；未恢复暂停的 Wiki 工作。

## 原因与修复

| 原问题 | 实际重排结果 | 故障位置 |
| --- | --- | --- |
| HTTP API 的契约用哪套规范表示？ | 正确的 OpenAPI 记忆已排第一，分数 `0.001913817715831101` | 被 `minScore=0.0042` 删除 |
| 办理护照需要预约哪个政府部门？ | 图书馆研讨室预约记忆排第一，分数 `0.005436200648546219` | 高于门槛而被错误接受，记忆没有护照或办理部门信息 |

两条都进入了候选池，问题不是索引丢失。正确候选分数低于错误候选，因此不存在一个“分数大于门槛就接受”的阈值，能同时保留前者并拒绝后者。分数用于相对排序，不能直接等同于对当前问题有证据的概率。[官方模型说明](https://huggingface.co/BAAI/bge-reranker-v2-m3) 描述的是相关性评分及 sigmoid 归一化。

新增可选 `verifyRelevance:true`：排序与是否引用分开处理。权限内词法／向量候选经重排排序后，交给独立记忆模型判断“同一对象和所问事项是否有实质证据”。验证模型不接收分数；启用时不再按 `minScore` 删除候选。没有增加 OpenAPI、护照或测试集的关键词特判、同义词表，也没有修改已有分数阈值。

模型必须返回全部候选的唯一索引列表；支持项必须引用该候选正文中的精确非空文字。主机校验完整映射和引文出处，不接受任意事实 ID、缺项、重复索引或编造引文。**精确引文只能证明出处，不能确定性证明语义相关。** 验证失败、超时、预算耗尽时，相关项为空且状态为 `partial`。`complete` / `verified` 只表示流程及结构校验完成，不代表零误判。

生产入口为 `src/memory-relevance.ts`、`src/agent-memory.ts` 与复用的 `src/memory-learning.ts`。候选外发前及每次异步返回后复核当前授权、来源、generation、策略版本及事实签名。验证复用受管、只读、无工具的临时模型调用和上下文 manifest，不会改变记忆内容、原始目标、授权范围或验收标准。`search` 仍按既有逻辑记录使用时间。

默认关闭，需要在长期记忆工作台启用“验证召回证据”。适用模型沿用记忆 `extractBackend` / `extractModel` 及其 scope / Router 继承链；无 embedding 时只有词法候选。相关项门禁不筛除单独预算内已授权的画像、偏好、明确记忆常驻上下文。详见 [Agent 记忆使用说明](AGENT_MEMORY.md)。

## 冻结与独立性

本轮新增 `tests/fixtures/memory-relevance-holdout.json`：36 条事实、72 个相关问题、36 个无关问题，共 **108 问**。覆盖园区访问、博物馆、制造、机器人、运维、物流和会议记录，包含英文问题，以及“同对象但问到未记录属性”的困难负例。与旧 12 条开发样本、旧 88 问保留集分开；后两者本轮仅作为回归集。

新集在实现及模型推理前冻结，SHA-256 为 `a59c404c8f2ca4a4cbdc08be1a3dee5ac418271c31a1aeb02c3ab39c2a308197`。预设 Top1、Recall@5、负例返回空三项均须 ≥95%。没有看结果后更换模型、提示词、问题、标签或验收门槛。它是自行构造并预先保留的合成测试集，不是第三方标注集或线上流量。

固定配置：`bge-small-zh-v1.5`、`bge-reranker-v2-m3`、候选 20；原策略中的 `minScore=0.0042` 保留，但不参与验证模式筛选。验证使用真实原生 Codex `gpt-6.1-terra`，effort `low`，单次 60 秒，测试 scope 日预算 500。embedding / reranker 使用与前轮相同的固定权重 revision；无按问题返回预设答案的模型适配器。

开发时曾使用较冗长的逐项决策输出，之后改为完整 `reviewed` 列表与支持项引文；30 秒期限也在一次真实开发回归超时后改为 60 秒。以上均在新独立集推理前完成。旧开发结果保留在 `regression-native/` 和 `regression-final/`，不替换为最佳单次成绩。

独立集运行期间，工程 review 加入了 **256000 字节输入上限**，防止旧版允许的大段手工记忆消耗过大请求。这一行不改变提示词、选择或语义判定；移除该行后，文件哈希与冻结版本一致。新、旧独立集实际最大输入分别为 2741 / 2646 字节，不受上限影响。必须区分：它们实际加载的是加上限前的源文件；最终原始回归及新进程重启加载的是加上限后的文件。`post-review-source-evidence.json` 保存哈希、差异和全部实际输入尺寸检查，未声称二者逐字相同。

## 实际结果

| 数据 / 指标 | 基线 | 启用证据验证 |
| --- | ---: | ---: |
| 新独立集 Top1 / Recall@5 | 72/72 / 72/72 | **72/72 / 72/72** |
| 新独立集负例返回空 | 10/36 | **35/36（97.2%）** |
| 新独立集 partial | 0/108 | 0/108 |
| 旧 88 问集 Top1 / Recall@5 | 64/64 / 64/64（前轮记录） | 62/64 / 62/64 |
| 旧 88 问集负例返回空 | 23/24（前轮记录） | 24/24 |
| 原始集 Top1 / Recall@5 | 11/12 / 11/12（前轮记录） | 11/12 / 11/12 |
| 原始集负例返回空 | 4/4（前轮记录） | 4/4 |

新集基线实际运行独立 checkout 的 `3db35f3` Runtime，使用相同语料和重排配置；不是用新代码关闭开关来近似。新集三项预设指标均通过。新、旧验证集没有返回多余的第二条匹配；但仍有下列误判，原标签保持不变：

| 数据集 | 尚存错误 | 已核实的阶段 |
| --- | --- | --- |
| 新独立集负例 | “酒店押金到账需要几天？”接受了只说明原路／现金退还的记忆 | 模型错误接受同对象的其他属性；引文真实但没有到账时长 |
| 旧集正例 | “矩阵课程遇到问题可以什么时候找助教？”拒绝线性代数答疑时间 | 正确候选第一，验证模型输出不支持 |
| 旧集正例 | “录制访谈声音时音频采样频率设多少？”拒绝播客人声采样率 | 正确候选第一，验证模型输出不支持 |
| 原始集正例 | “线上交易记录存放在什么系统里？”拒绝生产订单 PostgreSQL 记忆 | 正确候选进入验证，模型输出不支持；开发过程中出现过接受，说明结果会波动 |

OpenAPI 在最终真实回归中恢复为 Top1，护照问题在旧集回归中返回空。这两个指定错误得到修复；**不能据此称所有漏召回和误召回都已消失**。余下三个正例拒绝体现对对象和语境的保守匹配；模型未输出理由，因此这是根据输入输出作出的解释，不是对模型内部过程的观测。

## 延迟与运行成本

| 测量 | p50 | p95 |
| --- | ---: | ---: |
| 新集基线重排 | 588 ms | 968 ms |
| 新集加验证 | 12889 ms | 27674 ms |
| 旧 88 问集加验证 | 12160 ms | 23027 ms |
| 原始 16 问回归加验证 | 13201 ms | 24211 ms |

每个测试进程并发 2；新旧集曾同时运行，后段有原始回归及重启检查，因此是该机器、该提供方及当时并发负载的测量，不是生产 SLA，也不是每次都增加固定 12.9 秒。每个未命中缓存的非空验证消耗一次记忆模型调用，与提取／整理共享 scope 的 UTC 日预算。测试集模型调用分别 109、89、17 次，包含各自的重构 Runtime 复查一次。缓存最长 60 秒；实际费用未计价。

宿主关闭会取消并排空查询；当前单轮任务的取消信号尚未传入 prepare，可能等到提供方期限。该功能提高拒绝无关证据的能力，但带来显著延迟，保持显式启用。

## 工程验证与审查

- `npm run typecheck` 通过；全量 **60 个文件、964 项测试通过**。新增 18 项覆盖低分正确／高分错误、无分数输入、完整映射、伪造引文、预算、缓存、权限／候选／敏感文本外发、清空／修改／暂停／撤销／策略变更竞态、重排到验证之间的授权、关闭排空，以及大输入在计费前拒绝。旧重排在 embedding 失败时的部分可用行为保留。
- 浏览器 **16 项通过**：真实鉴权 HTTP、验证开关保存重载、提供方失败时显示 partial 且无未验证匹配、关闭后删除字段、确认／编辑／来源／拒绝／归档／入口切换／清空、键盘焦点、390px 布局和无控制台错误。页面 fixture 故意不执行真实模型；语义质量由上述真实模型测试验证。
- 三套质量评估分别关闭并重新构建 Runtime，复用 SQLite 向量并重新验证首个查询。另在旧集运行结束后，用全新 Node 进程 PID `11988` 打开状态：缓存为空、事实向量不重复嵌入、真实模型重新验证一次并命中；事实内容与版本不变，只有既有 `lastUsedAt` 使用记录更新。
- 在独立状态副本中，用新版移除 `verifyRelevance`，停止后用实际 `3db35f3` Runtime（PID `15659`）读取：32 条授权事实、全部事实与向量哈希、其余策略一致。只设为 `false` 不够，旧 schema 不识别字段本身。无数据库版本变更；未覆盖活动实例或回滚其外部效果。
- 自 review 覆盖全部生产、测试和脚本差异，另按 review 技能执行独立架构复核。补上输入上限、共享预算说明和旧 schema 回滚说明。浏览器辅助脚本初次失败分别由不匹配的精确 label 和误读请求包装层造成，修正脚本后以全新 fixture 重跑通过。重启辅助脚本最初错误比较了包含正常使用时间更新的全量事实，改为检查其余字段不变后通过；失败日志保留。
- Codex Security scan `e3be36ab-55c8-4259-a8eb-1f01deece81c` **已完成并封存**，6 个生产源码文件，在审查范围内未发现可确认安全问题。原快照后有期限和输入上限的明确变动，插件保留 `Working-tree contents changed ... results were saved for the original snapshot` 告警；附属证据记录人工复核的变动与最终源文件哈希，不能把快照标识说成最终代码的相同哈希。token 用量工具返回 unavailable，未估算。此前 `4e8d1721` 未封存的扫描保持原状态。

正式扫描报告（本机）：`/Users/alex/.codex/state/plugins/codex-security/scans/agenthub-memory-20261108/3db35f3e2b715ef944cb609eb1c794ee7bd8c31a_20261108T083459Z_qodliv91/report.md`。

证据根目录：`/Users/alex/Documents/ChatGPT/竞赛/validation/agenthub-memory-relevance-20261108/`。重点文件为 `holdout-freeze.json`、`final-config-freeze.json`、`post-review-source-evidence.json`，`holdout-before/`、`holdout-final/`、`previous-holdout-regression/`、`regression-60s-final/` 的 `results.json` / `evidence.json` / `model-calls.json`，`browser-verified/evidence.json`、`rollback-copy/rollback-after.json` 和测试日志。并发评估的 HTTP server 统计是共享的，原始 `calls.json` 可能含另一测试进程请求；各自 `results.json` 与 `model-calls.json` 独立。交付脚本已按当前语料过滤 transport 统计、按自身事实检查重启嵌入，避免未来并发误计。

## 复跑

沿用 [前轮适配器启动方法](MEMORY_RETRIEVAL_VALIDATION_2026-11-08.md)，只在隔离 loopback 测试环境使用 `/stats` 和 `/control`。然后：

```sh
MEMORY_RETRIEVAL_URL=http://127.0.0.1:PORT \
MEMORY_RETRIEVAL_DIR=/tmp/memory-relevance-new-run \
MEMORY_RETRIEVAL_DATASET=tests/fixtures/memory-relevance-holdout.json \
MEMORY_RETRIEVAL_MODE=verified MEMORY_RETRIEVAL_CONCURRENCY=2 \
MEMORY_RERANK_MIN_SCORE=0.0042 AGENTHUB_CODEX=/path/to/codex \
node --import tsx examples/agent-memory-retrieval.ts
```

每次使用全新目录。模型输出可能波动；脚本分别保存链路功能检查与质量门槛状态，不能只凭进程退出成功声称质量通过。
