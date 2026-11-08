# Memory recall repair and independent evaluation

后续：本文保留重排版本的历史结果和限制。OpenAPI／护照问题的进一步修复、新 108 问独立集、预算变化及当前错误见 [召回证据验证记录](MEMORY_RELEVANCE_VALIDATION_2026-11-08.md)。

本轮基线：`0977fcdcb9f22646993632a42298d6ac406d56f2`，分支 `codex/weknora-memory-20261108`。使用合成数据、隔离 SQLite 和本地真实模型。没有修改运行实例配置，没有部署、合并或 push，也未恢复暂停的 Wiki 工作。

## 两个原始漏召回的原因

| 问题 | 正确记忆 | BGE cosine / 排名 | 旧实现为何遗漏 |
| --- | --- | --- | --- |
| 后台作业由哪种中间件排队？ | 异步任务通过 Redis 队列处理 | 0.446260 / 第 4 | 固定 `>=0.5` 提前删除正确候选；“管理后台默认采用暗色主题”因“后台”词面重合且 cosine 0.536118 排在前面 |
| 附近城市的商务旅行喜欢什么交通方式？ | 短途出差优先乘坐高铁 | 0.486922 / 第 1 | 正确答案已经是向量第一，但低于固定门槛且无词面重合，两个通道均无结果 |

数据来自实际 `bge-small-zh-v1.5` 推理。尝试官方 query instruction 后，正确分数分别为 0.37696 / 0.42999，仍被截断。因此不能把它归因于少加一句指令，也不能只降低向量门槛：队列问题还存在歧义与排序错误。另修复了 RRF 同分时仅按随机 ID 排序的问题，现在优先比较实际向量相似度，再按 ID 稳定排序。

## 实现与边界

启用 `policy.reranker` 后，先在当前授权事实内分别做向量与词法排序，交替组成有上限的候选池，再由 query-document 模型评分。向量候选不再经过旧的 0.5 硬过滤。候选默认 20、最多 40；不会因大量弱词法匹配把所有向量候选挤掉。

协议为 `POST {model, query, documents, top_n}`，响应为 `results:[{index,relevance_score}]`。必须完整覆盖每个候选一次，分数为有限的 `[0,1]` 数值。服务返回任意 ID、重复/缺失 index、非法分数均不被接受。请求最多 256000 字节、响应最多 1000000 字节、重排最多 5 秒，不跟随重定向；密钥仅通过配置的环境变量读取。

权限过滤、个人类别 owner 过滤与敏感格式检查在发出候选前执行。返回后复核当前权限、开关、generation、策略版本和授权事实/向量版本签名；查询缓存也绑定这些信息。清空、编辑、来源撤销、索引完成会使旧结果失效。关闭宿主会取消并等待正在准备的查询，之后再关闭 SQLite。Router/Worker 继续使用同一个受控检索入口，记忆不修改目标、授权或验收。

失败、超时、未准备或索引不全均报告 `partial`，保守使用基础召回，不把扩大后的候选池直接当作有效记忆。`complete` 表示检索链路完整执行，**不表示每条结果语义正确**。

未配置 reranker 的旧路径继续兼容；单独升级代码不会自动修复其两个原始漏召回。没有向量接口时，重排只能处理词法候选。`maxCallsPerDay` 仅覆盖抽取/整理，**不覆盖 embedding、重排和索引**；UI 已明确命名。每个不同查询可能新增一次重排请求；当前宿主关闭可取消，单轮取消仍可能等待请求 deadline。

回退到本轮基线前，需要用新版宿主移除各范围的 `reranker` 策略，再停止宿主并回退。旧版 strict policy schema 不识别此字段。已在独立状态副本上移除该字段，再用实际 `0977fcd` Runtime 读取，32 条事实完整保留。没有提高已有 schema 7 / memory schema 2，也不支持用旧备份覆盖新外部效果或撤销记录。

## 数据隔离与配置选择

三组数据互不重用事实与问题：

| 数据集 | 事实 | 相关问题 | 无关问题 | 用途 |
| --- | ---: | ---: | ---: | --- |
| 原始 regression | 12 | 12 | 4 | 重现原问题，开发回归 |
| 新 calibration | 20 | 40 | 24 | 模型/门槛选择；音乐、木工、徒步、烘焙、缝纫等 |
| 冻结 holdout | 32 | 64 | 24 | 一次性验收；实验室、课程、图书馆、仓储、活动、生活、媒体等，含 4 个英文相关问题 |

holdout 在实现与模型推理前冻结，SHA-256：`e6b81cf8a2469fadb587ba921908e6131c8740803fb2e20aea2ff388d35f89c5`。冻结后没有按结果修改问题、标签、模型或门槛。它是独立保留集，不是第三方人工标注或线上流量样本。此前在首次推理前修正过一个“羊绒/羊毛”标签不一致，旧 hash 保留在冻结记录中。

开发过程没有隐藏失败：`bge-reranker-base` + 默认 0.5 只保留原始 5/12；两种重排模型都将原始 12 条正确事实排第一，但 sigmoid 分数不等于跨语料可比较的置信度。最初“满足 95% 校准召回率的最高门槛”规则对开发回归过严，被否决，两个模型的原始分数仍保留。最终在查看 holdout 结果前改为：取能拒绝至少 90% 校准负例的最低门槛，向上取到 4 位小数，再单独检查正例召回。

最终固定配置：`bge-small-zh-v1.5` + `bge-reranker-v2-m3`、候选 20、`minScore=0.0042`。该数值由 calibration 的负例最大分数第 90 百分位约 0.004157 导出，不是用原始两个漏召回问题反推。固定配置在 calibration 上召回 40/40，无关返回空 22/24。该门槛仅是这组模型/语料的验证配置，不能作为其它模型的通用默认值。

模型固定 revision：

- embedding：`7999e1d3359715c523056ef9478215996d62a620`，512 维，CLS pooling + L2 normalization。
- reranker：`953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e`，实际 Transformer logits 经 sigmoid。
- 本地 Python 3.9.6、Transformers 4.57.6、Torch 2.8.0，CPU 2 线程。测试适配器没有按 query 返回预设答案。

机制与模型参考：[BGE embedding 模型说明](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[BGE reranker 模型说明](https://huggingface.co/BAAI/bge-reranker-v2-m3)、[Rerank 协议](https://docs.cohere.com/reference/rerank)。

## 实际结果与尚存错误

| 指标 | 旧版 | 新版固定配置 |
| --- | ---: | ---: |
| 原始 12 条 Top1 | 9/12（前轮记录） | 11/12 |
| 原始 12 条 Recall@5 | 10/12（前轮记录） | 11/12 |
| 原始 4 条无关返回空 | 4/4 | 4/4 |
| **独立 64 条 Top1** | **60/64** | **64/64** |
| **独立 64 条 Recall@5** | **64/64** | **64/64** |
| **独立 24 条无关返回空** | **11/24** | **23/24** |
| 独立集 partial | 0/88 | 0/88 |
| 独立集延迟 p50 / p95 | 9 / 13 ms | 607 / 718 ms |

独立旧版对照实际运行 baseline checkout，并非用新代码关闭某个开关近似旧版。延迟为当前机器、当前顺序请求的测量，不是生产 SLA。独立集预设门槛 Top1≥90%、Recall@5≥95%、无关返回空≥90% 均达到。

**不能称所有样本均修复。** 原始“后台作业……”和“附近城市……”均恢复为 Top1；但原始 `HTTP API 的契约用哪套规范表示？` 正确记忆虽然在重排第一，其分数约 0.00191 低于固定门槛，最终未召回，这是相对旧版的一个回退。独立负例“办理护照需要预约哪个政府部门？”误召回图书馆研讨室，分数约 0.005436。为保留独立验收的效力，没有看完 holdout 后继续调门槛或改标签。这两项作为明确的模型边界保留。

## 工程验证与 review

- 类型检查通过；全量 **60 个文件、946 项测试通过**。新增测试覆盖低相似度恢复、词法干扰、权限与未确认候选不外发、缓存失效、敏感数据、非法映射、HTTP 边界、停用/清空/编辑并发和关闭排空。
- 浏览器 **13 项通过**，包括 0.0042 这样的小数门槛保存/重载、确认替换、编辑、来源历史、拒绝、归档、切换入口、清空、390px 布局与无控制台异常。
- 真实本地 HTTP 推理验证：503 标记 partial；服务已完成模型推理但延迟响应时，约 5008ms 超时并降级；推理期间清空拒绝旧结果；关闭 Runtime 取消正在进行的重排，未向已关闭 SQLite 写入。
- 重新构造 Runtime、再用独立 Node 进程打开同一 SQLite：事实向量不重复计算，查询重新重排并获得相同首项。这里不是对重排请求进行 SIGKILL 续传；检索本身可重新执行。
- 自 review 覆盖全部本轮源码与测试辅助改动；独立架构复核确认授权/来源/权限变化/关闭顺序。发现并补上了查询关闭排空、以及 UI 小数 step 和每日预算范围标注。
- Codex Security scan `4e8d1721-3cf3-4c6d-a4e3-548e2ca83dd2`：6 个生产源码文件已审查，最终语义草稿已保存；**报告未完成封存**。首次最终草稿缺少 `coverage.surfaces[].label` 被拒绝，随后 completion 返回 `The latest saved scan draft is incomplete; continue the scan before completing it.` 已修正并保存草稿，但按插件单次 completion 规则没有重试。它不能列作“Security 扫描完成”。随后的 UI 标签和 step 修正另经人工检查与浏览器验证。

证据根目录（本机）：`validation/agenthub-memory-retrieval-20261108/`，相对于外层工作区。关键文件：`root-cause-scores.json`、`holdout-freeze.json`、`final-config-freeze.json`、`calibration-m3-scores.json`、`regression-final/results.json`、`holdout-{baseline,final}/{results,evidence,calls}.json`、`holdout-final/process-restart.json`、`faults-verified/evidence.json`、`rollback-copy/legacy-readback.json`、`browser-final/evidence.json` 和测试日志。调用日志仅含合成文本。

## 复跑

先启动隔离适配器（只绑定 loopback，`/stats`、`/control` 无鉴权，不可用于生产）：

```sh
HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false python3 examples/memory-embedding-server.py \
  --engine transformers --snapshot /path/to/bge-small-zh-v1.5/snapshot \
  --reranker-snapshot /path/to/bge-reranker-v2-m3/snapshot

# 使用适配器输出的实际端口；每次必须用新状态目录。
MEMORY_RETRIEVAL_URL=http://127.0.0.1:PORT \
MEMORY_RERANK_MODEL=BAAI/bge-reranker-v2-m3 MEMORY_RERANK_MIN_SCORE=0.0042 \
MEMORY_RETRIEVAL_DATASET=tests/fixtures/memory-retrieval-holdout.json \
MEMORY_RETRIEVAL_DIR=/tmp/agenthub-retrieval-new-run \
node --import tsx examples/agent-memory-retrieval.ts
```

旧版对照增加 `MEMORY_RETRIEVAL_MODE=baseline` 和 `MEMORY_RETRIEVAL_CHECKOUT=/path/to/0977fcd-checkout`。验收脚本会保留逐项结果与 acceptance booleans；功能执行成功不等于质量门槛通过，应检查两者。重复该冻结集只能算回归，不能再次宣称未知独立测试。
