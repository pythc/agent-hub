# Agent memory validation — 2026-11-08

实现基于 `ff0abe894e85ad2b9d23f29b33e5f7131cde3341` 的独立分支 `codex/weknora-memory-20261108`。暂停的 Wiki 工作区未修改，未部署、合并或 push。本文件区分自动回归、真实模型、浏览器和生产验证。

| 检查 | 结果与证据 |
| --- | --- |
| 类型检查 | `npm run typecheck` 通过，包含宿主、示例和 Chat 前端。 |
| 全量自动测试 | `npm test -- --maxWorkers=4`：59 个文件、923 项通过。默认高并发运行曾触发 5 秒 CLI 时序超时；限制并发后原断言全部通过，未放宽测试条件。 |
| 记忆边界 | 覆盖候选不进上下文、待确认保留旧值、revision 冲突、精确来源引文、原契约不变、失败段保留、独立会话、别名抑制、人工保护、容量归档、节流、日预算、敏感文本和向量降级。 |
| 恢复与权限 | 覆盖运行 lease 恢复、clear 后迟到输出拒绝、权限与来源失效、合法 epoch 刷新、共享详情不泄露来源／旧版本、Worker 实际 broker、旧 SQLite 恢复后遗忘及向量／主题清理。 |
| 升级／回退 | 用基线旧 Store 实际打开 schema 7 副本，确认拒绝；对带已完成迁移回执的 schema 8 状态确认拒绝且 journal 未修改。构造失败可在同进程再次尝试，不残留锁。 |
| API / embedding 协议 | 三类 API 后端临时调用不保留输入、不增加历史召回工具。真实本地 HTTP 测试检查 embedding 环境变量凭据、请求格式、禁止重定向和流式响应大小上限。向量语义排序使用受控向量测试。 |
| 真实记忆模型 | 原生 Codex 模型完成 queue → crash → extract → update → verify。实际模型 turn 开始后 SIGKILL 独立测试进程组，重启恢复未完成观察，再确认记忆、替换偏好、新进程按新偏好输出、清空并重启保持清空。 |
| 真实长任务 | 见本地 evidence.json：旧解析器失败后 Router 依据证据拆分 `decode_v2`、`validate_duplicates` 并调整依赖，验证阶段重启后继续推进。最终通过状态由独立验收产生。 |
| 浏览器 | 真实隔离 HTTP/SQLite + Chromium，12 组流程检查通过；1440px 桌面、390px 手机、reduced motion、焦点恢复、安全文本渲染、无控制台错误。包括实际后端搜索、候选确认、编辑、来源／历史、归档恢复、拒绝、设置持久化、入口隔离、清空后重载。 |

两轮自查覆盖了新增源文件和直接调用链。初轮 Codex Security diff scan 对固定初稿记录两项中等风险：Router inspect 绕过新记忆开关／actor 过滤，及遗忘主题仍被发送给提取模型。两项均已修复并加回归；共享详情、归档后遗忘、别名重新出现、间接替换依赖和未来 schema 重放等组合问题也已修复。初轮扫描报告对应修复前快照，不应被当作修复后整树扫描结果。扫描 ID：`e4659095-c779-4edc-8a9a-324f0be539e4`。

本地验收产物位于工作区 `validation/` 下：

- `agenthub-memory-20261108-accepted/evidence.json`：最终记忆模型验证。
- `agenthub-memory-20261108-accepted/inflight.json`：被终止时的实际 turn 和运行 lease。
- `agenthub-memory-20261108-browser-final/evidence.json`、`desktop.png`、`mobile.png`：最终浏览器验证。
- `agenthub-memory-20261108-long-task/evidence.json`：真实多阶段重规划／重启验收。
- `agenthub-memory-20261108-final/`：自动检查日志、升级拒绝证据、源文件摘要和修复回读。

真实长任务从本轮 runtime 开始运行。期间的最后修复局限于记忆边界及未来 schema 迁移入口，未修改 Router goal、验证器、重规划器或 Worker 调度逻辑；对应改动另由最终全量回归、记忆模型和浏览器测试验证。任何时间点和版本边界都以 evidence 和源文件摘要为准。

初轮未验证真实 embedding 模型；下面的后续验证补充了本地真实权重推理。仍未声称通过：现用业务实例的部署验收、实际业务语料上的检索质量、线上 embedding 服务配置、远程平台私有身份管理 UI、供应商历史副本删除，以及此前暂停的 Wiki 页面工作。默认自动提取仍为关闭，需要在学习设置中选择自动抽取。

## 后续验证：整理恢复与真实语义检索

从已提交的 `c8ce3a64a5729796efc488d4ae5876c4a015a1ff` 继续验证，确实复现并修复了一处恢复缺口：真实整理模型 turn 开始后强制终止进程，旧实现重启后仍保留 `running`，日频节流还会延迟再次处理。现在启动时标记 `interrupted`，自动模式在重新检查当前权限和开关后重调度；仅显式写入模式不会自动续跑人工发起的整理。人工整理也纳入关闭时的取消、等待和互斥，并把合并候选与完成回执放进同一 SQLite 事务。

最终 `npm run typecheck` 与 `npm test -- --maxWorkers=4` 通过：59 个文件、**927 项**测试。新增四项覆盖暂停／恢复、显式模式、重入与关闭、回执写入失败时整批回滚。真实 Codex 提取流程再次通过 queue → crash → extract → update → verify。真实整理流程通过 seed → crash → recover → confirm → forget → verify；两者均在收到实际模型 turn 后 SIGKILL 独立进程组，再用新进程恢复，未使用测试时钟绕过整理节流。整理保持候选状态，确认前六条旧记忆全部有效；开发环境 30 秒和生产环境 10 秒两条限定事实没有被合并成无条件结论，原始目标／授权／验收夹具未改动。

语义测试通过真实本地 HTTP embedding 接口进入 AgentMemory 的索引与检索路径。数据在推理前固定为 12 条中文事实与同义问法、4 条无关问题；另设其他成员偏好和其他入口事实验证隔离。模型权重、版本、请求次数、样本摘要和每条结果保存在证据中。两轮使用相同样本、现有余弦阈值 0.5 与 RRF，未按结果调整阈值或改写样本。

| 检索方式 | 首条命中 | 前 5 条内命中 | 7 个关键词完全未匹配样本中的找回数 | 4 个无关问题产生结果数 |
| --- | --- | --- | --- | --- |
| 关键词 | 5 / 12 | 5 / 12 | 0 / 7 | 未单独测量 |
| potion-multilingual-128M 混合召回 | 6 / 12 | 6 / 12 | 1 / 7 | 0 / 4 |
| bge-small-zh-v1.5 混合召回 | 9 / 12 | 10 / 12 | 5 / 7 | 0 / 4 |

这里使用本机权重实际推理，没有返回固定向量。Potion 使用 Model2Vec 0.10.0、256 维、权重快照 `73908c3438cf03b6a01bcb9611d62b23d0726f08`；其加载方式见[官方模型卡](https://huggingface.co/minishlab/potion-multilingual-128M)。BGE 使用 Transformers 4.57.6 / PyTorch 2.8.0、512 维、快照 `7999e1d3359715c523056ef9478215996d62a620`，采用官方说明的 CLS pooling 与归一化，不加 query instruction，见[官方用法](https://huggingface.co/BAAI/bge-small-zh-v1.5#using-huggingface-transformers)。依赖只装入隔离验证环境或复用本机已有环境，未修改项目依赖。

两种模型均通过六个独立进程阶段：索引与召回、新进程复用已存向量、503／2 秒超时词法降级、遗忘与来源撤销、真实推理进行中清空、再次重启保持清空。另检查个人暂停后不发请求、识别到的敏感查询不发给 embedding，以及其他 actor／entry 事实不返回。测试中的来源撤销直接更新隔离证据记录，不代表外部平台撤回流程验收。

**质量限制仍然存在。** BGE 未召回“后台作业由哪种中间件排队？”对应的 Redis 队列事实，也未召回短途出差优先高铁；前一个问题还因“后台”关键词返回了界面主题事实。另有一个样本目标在前 5 条但不在首条。这不是生产准确率，更不能将“4 个无关问题均无结果”推广成零误召回。下一步应以独立业务语料扩大评估，再决定模型、阈值或重排；不依据这 12 个样本直接调参上线。

后续产物位于 `validation/`：

- `agenthub-memory-20261108-consolidation-before/`：原提交上的真实崩溃失败证据。
- `agenthub-memory-20261108-consolidation-final/`：修复后真实整理、恢复、确认与遗忘证据。
- `agenthub-memory-20261108-native-followup/`：再次通过的真实提取、更新和召回。
- `agenthub-memory-20261108-semantic-potion-verified/`、`agenthub-memory-20261108-semantic-bge-verified/`：真实 embedding 请求与逐项结果。
- `agenthub-memory-20261108-followup/evidence.json`：源文件摘要、版本、自动检查与上述结果汇总。

本次修复及验收脚本已自行 review。后续 Codex Security diff scan `178921f0-ff38-4057-9356-e7ca3b0c793d` 完成，对比基线为 `c8ce3a6`，覆盖两处生产源文件变更及相关调用链，另人工检查四个测试／示例文件；未发现新增可确认安全问题。扫描绑定文档补充前的代码快照 `8424ee6b71aea4d3cf3d8370b055559d32c57f89966bd536d08767444ca9a6c0`，不是最初整套记忆集成的重审。后续只补充了本说明及复跑命令，源文件摘要保持不变。真实业务实例、平台和 Wiki 的边界不变。
