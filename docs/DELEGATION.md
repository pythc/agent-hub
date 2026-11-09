# 同机实例与子团队委派

当前已实现同一所有者管理的两个独立 Roppo 实例，A Router → B Router → B Worker → 实际产物 → A 核对，并接入 [结构化目标与独立验收](DELEGATION_GOALS_2026-11-09.md)。它采用独立的宿主任务协议，未实现 A2A 或 MCP Tasks 标准兼容。首期历史验收见 [验收记录](DELEGATION_ACCEPTANCE_2026-11-09.md)，历史设计见 [改造方案](DEPLOYMENT_AND_DELEGATION_PLAN_2026-11-09.md)。

## 启动两个实例

每个实例必须使用独立的配置、状态目录、监听端口和工作目录。账号、浏览器登录、模型认证和 operator token 分别管理。开启委派需要受控重启；普通设置页不能热改监听与身份配置。

下面是下游实例的最小配置示例。替换绝对路径与模型，创建工作目录，并按项目的正常流程准备模型认证与沙箱依赖。不要用它覆盖已有实例配置。

```json
{
  "stateDir": "/absolute/path/child/state",
  "port": 4402,
  "delegation": {"enabled": true},
  "execution": {
    "router": {"mode": "host"},
    "management": {"enabled": true},
    "workers": [{"id": "one", "backend": "codex", "model": "gpt-6.1-sol"}]
  },
  "sources": [
    {
      "id": "local", "kind": "local",
      "cwd": "/absolute/path/child/workspace", "allowedActors": ["operator"],
      "sandbox": "read-only", "workspace": {"mode": "source"}
    },
    {
      "id": "delegation", "kind": "delegation",
      "cwd": "/absolute/path/child/workspace",
      "sandbox": "read-only", "workspace": {"mode": "source"}
    }
  ]
}
```

上游使用另一组绝对路径及端口，例如 4401。两端均需 `delegation.enabled: true`，上游也需 host Router。安装依赖并构建页面后，分别运行：

```sh
npm run build:chat
node --import tsx src/cli.ts serve /absolute/path/child/config.json
```

`delegation.port` 默认 0，首次分配独立的回环服务端口，随后在状态中保留并于重启时复用。它与控制台 HTTP 端口分开，不能作为公开入口。`sourceId` 默认 `delegation`，必须对应专用来源；普通 `/request` 或外部事件不能伪造该来源的服务授权。

## 在控制面连接

1. 在 B 的“部署”页选择允许导出的 Workers，生成配对码。若启用了管理范围，还必须选择包含专用来源与这些 Workers 的范围；该范围的管理身份应明确包含上游服务身份。
2. 在 A 的“部署”页填写团队名称和 B 提供的配对码，核验并连接。配对码含一次性秘密，五分钟过期；成功使用后不能交给别的实例重复配对。双方固定各自的 Ed25519 身份，不共享控制台 token。
3. 在 A 的“Agent 团队”页可看到“子团队”；在对话中要求 Router 使用该团队处理有明确目标和验收条件的工作。若 A 启用了管理范围，必须将目标 ID 加入该范围的 `teamTargetIds`；默认不授权。
4. “部署”页分别显示连接状态、实际远端任务状态、最近观察、模型激活次数、候选交付和父级核对。查看证据后可以由 Router 或操作者记录核对通过。

页面生成的配对默认只读，不能执行命令、联网或启动子代理。程序接口可在导出策略中明确配置权限和限额；任务权限取导出授权、上游目标配置及当前来源许可的交集。扩大授权应重新配对，不能改写已提交合同。管理范围的现有维护接口是 `/router-scopes`，此次未重做其编辑界面。

连接核验只证明签名协议与对端身份可用。“父级已核对”记录普通委派的 Router 或操作者检查；结构化目标另须通过节点和整体独立验收，界面显示“独立验收通过”。两者分开记录，模型报告仍可能判断错误。

## 任务与产物约定

Router 工具 `team_delegate` 提供 `list`、`assign`、`inspect`、`cancel`、`accept`。写操作使用稳定的 `operationId` 和当前设置 `expectedRevision`；重复请求返回当前任务，内容不同则冲突。`assign` 必须明确传入 `text`、`acceptance` 和 `artifacts`；纯文本工作也必须填写 `artifacts: []`，任务正文中写文件名不产生文件权限。

```json
{
  "action": "assign",
  "targetId": "目标实例ID",
  "operationId": "check-input-1",
  "expectedRevision": 1,
  "text": "读取 input.txt，核对其值是否为 1+1 的结果，并返回原文件。",
  "acceptance": "真实读取文件，内容必须为数字 2 加换行。",
  "artifacts": ["input.txt"]
}
```

合同固定发送和接收身份、原始主体、根任务、父输入、祖先链、目标、验收条件、权限、限额、期限和摘要。首期最多跨一个实例边界；B 的委派 Router 不获得继续跨实例委派的工具。

B Worker 可以调用 `superagent_artifact` 捕获已声明文件。宿主读取实际字节，返回大小、SHA-256 和小文件十六进制值；最终交付再次检查文件。文件必须位于该任务工作目录，禁止越界、隐藏路径、私有凭据和宿主状态。首期每任务最多 10 个文件，每文件不超过 1,000,000 字节，通过签名响应传回；二进制以明确标记的 base64 展示，没有公共下载地址。

只有受管 Worker 全部结束且为 `ready`、B Router 的交付回合读取过这些最新报告、所需文件全部存在时，B 才进入候选就绪。A 获取带任务来源的报告摘要、B 汇报和产物；`inspect` 为当前调用主体和远端版本记录读取回执。`accept` 要求当前版本的全部证据 ID；它不会触发新的 Worker 执行。原始任务、B 内部历史及文件系统均不会向 A 全量开放。

后台状态核对由宿主执行，空闲轮询不调用模型。页面只投影各方向最近 25 条任务，普通状态接口不返回文件正文。文件证据通过显式 inspect 读取。

## 停止、撤权和失联

| 操作 | 已实现的含义 |
| --- | --- |
| 暂停新接单 | 目标不再接受新的 assign；已有委派继续受当前合同约束 |
| 停止委派 / 停止父任务 | 先持久化停止屏障，再中断所属远端子树；未确认期间显示等待核对 |
| B 已完成后收到停止 | 保留完成历史，并核对停止控制代次；不冒充撤销已发生效果 |
| 撤销 A 的出站连接 | 禁止新执行和 Router 读取缓存正文；仅保留固定身份的取消核对通道，不重新启用连接 |
| B 撤销上游访问 | 拒绝该身份的任务与状态读取，停止其未结束工作；不影响其他上游任务 |
| 网络中断 / 上游退出 | B 的租约到期后停止受管执行；A 保留未知或过期观察，不自行宣告成功 |

默认租约 30 秒、任务期限 10 分钟，每合同最多 12 次实际模型激活、2 个并发 Worker；上游同一根输入最多预留 48 次远端模型激活。模型重试也计数，预留不因请求重发重复占用。激活次数不是 token 或货币预算；未知用量不能算零。

自定义配置时，两端应对齐 `leaseMs`，并保持 `pollMs` 显著小于租约；首期没有自动协商这些参数。默认值适用于同机连接。

运行中的任务不支持暂停、恢复或输入追加。需要新信息时保留 blocked 原因，由父级处理；目前应停止旧委派后通过新的明确授权创建合同。它不等同于实例级的全局暂停。

## 身份、升级与备份恢复

`delegation-identity.json` 是私有的实例身份文件，首次开启时生成，权限为 0600。数据库固定其公钥；文件丢失或与数据库不符时启动拒绝，不能静默换身份。普通委派升为 schema 10，首次创建远端目标节点再升为 11；版本 8、9 留给 Webhook 授权与续接。未启用委派且未启用其他新协议时保持原配置形状和 schema 7。已用 `main 244dac0` 的真实 Store 验证拒绝 10、11，不能直接切换旧程序继续运行。Webhook 协议激活另行保留，开启委派不会跳过旧 Webhook 的受审升级流程。

租约已过期的执行不能通过迟到续租恢复。父级收窄来源、目标或连接的权限与限额后，超出新上限的旧合同会转入取消；每次异步核对后、提交或续租前重新检查。

正常升级保留原状态和身份，停宿主及监督器后执行现有备份、升级和回读流程。回退应采用向前修复，或使用经核对的完整旧快照；禁止仅将 `user_version` 改小来绕过门禁。若任务、投递或委派记录在备份后前进，恢复流程拒绝覆盖。

备份含身份校验和。恢复先写入持久隔离标记，再替换数据库；恢复失败也不能让服务自动执行旧授权。恢复后的实例不启动委派服务，在“部署”页要求操作者确认原实例已经停止并核对外部效果。恢复确认使用当前 revision 与状态摘要，撤销所有旧配对、停止保留工作并要求重新配对。外部效果和对端已运行的工作不会被备份回滚。

## 程序接口与复验

控制台账号或 operator token 保护以下接口。它们与服务间签名接口分开。

| 接口 | 用途 |
| --- | --- |
| `GET /deployments` | 身份、连接、能力、限额与最近任务投影 |
| `POST /deployments/pairing` | 当前 revision 下创建限时导出票据 |
| `POST /deployments/connect` | 固定对端身份并建立 TeamTarget |
| `POST /deployments/command` | 查看、停止、检查证据和记录父级核对；创建必须来自已授权 Router 上下文 |
| `POST /deployments/revoke` | 撤销指定出站连接或上游访问 |
| `POST /deployments/recover` | 恢复隔离确认，撤销旧连接并要求新配对 |

服务接口只接收 `POST /delegation/v1` 的签名请求，拒绝浏览器 Origin 和控制台 bearer 认证。响应也签名并绑定请求 nonce；任务合同、远端版本及文件摘要逐一校验。只允许回环 HTTP；没有 HTTPS、证书轮换或跨机器支持。

```sh
npm run typecheck
npm test -- --maxWorkers=2
node --import tsx examples/delegation-acceptance.ts .local/new-fixture --keep
```

该脚本必须使用一个尚不存在的私有证据目录，启动两个独立 OS 进程。默认是明确标记的模型夹具；添加 `--real-model` 才调用真实 Codex，消耗对应认证的模型额度。浏览器检查读取夹具生成的私有 `browser.json`，例如：

```sh
python tests/browser/delegation.py .local/new-fixture/browser.json .local/new-browser-evidence
```

Python 环境需要 Playwright 与本机 Chrome。脚本仅操作隔离账号，检查 8 种语言 / 主题 / 宽度组合、证据读取、键盘、草稿保留、配对码隐藏、暂停新接单、停止核对、撤权和重载持久性。证据目录中的配置、身份、账号及模型历史属于私有资料，不应提交。

## 本轮范围与收尾

按 2026-11-09 的最新决定，跨机器部署与 `delegated-coordinator`（当前 Worker 直接统筹另一实例的 Workers）已取消，不再列为后续待办。本轮固定为同一所有者、同一台机器、一跳 `managed-team`：A Router → B Router → B Workers → A 独立验收。界面中的“远端”指另一个同机实例。

已有 Linux 单实例运行支持保留；正式容器打包、多跳、跨组织、HA 和完整实例运维不属于本轮交付。收尾基线、修复及验证见 [收尾记录](DELEGATION_CLOSEOUT_2026-11-09.md)，当前实际部署见 [部署现状](DEPLOYMENT_STATUS_2026-11-09.md)。
