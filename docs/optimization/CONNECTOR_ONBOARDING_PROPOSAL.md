# O13 / O14：连接草稿与一次性只读诊断提案

状态：**proposal / 待独立审查；不是实现或验收结论**。基于 IM 工作线 `88a7c20` 的实际调用链。第二版纳入独立审查的四项边界修订；不得据本提案先实现 activation 或解除 disabled gate。本文只提出本地可实施的 O13 与 O14 前置切片；真实 IM 收发、目标消息权限和端到端回执仍受 B-IM / G05 授权阻塞。此前被拒的 POST 恢复范围、Workspace 桥与路由不在本提案内。

## 1. 已确认的问题与保留的体系

现有调用链是：插件的 `setup.fields` → `SourceRegistry.connectionDefinitions()` → `GET /api/connectors` → `ConnectorManagement.validate/plan()` → `Onboarding.sourcePlan()` → 既有 `/api/plugin-market/connection/apply` → managed config / credential store / 受控重启。插件定义、SourceConfig 实例和诊断回执已分离，继续复用这条链，不增加另一套连接注册表或凭据系统。

已独立复现：

- `src/connector-management.ts` 的草稿 `actors.min(1)` 拒绝未知 actor 的草稿；但 core 的非 local SourceConfig 已允许 `allowedActors: []`。用户当前必须先自行查出 actor ID 才能保存。
- 草稿固定 `enabled:false`；除 configuration 外，`probe()` 均拒绝 disabled。启用后 `Runtime.pollSources()` 可以开始 `start/poll`，所以当前必须先开启实际入口才能认证或读取成员。
- packaged Slack 的 `ProcessSource.active()/guard()` 另有 disabled gate，且启动要求非空显式 scopes。仅改 UI、取消 service gate、临时 clone `enabled:true` 都不能形成正确的诊断授权边界。
- 当前 capabilities probe 只保留目录检查状态、数量，不返回可选择的成员；`Setup.previewMembers()` 虽有成员预览，`applyMembers()` 却把全体非 bot 加入白名单，不能直接当作本向导的单人选择动作。
- `ProcessSource` 的 `identity/members` 是类方法，存在不等于 manifest 声明可用。`Runtime.status().sourceCapabilities.memberDirectory = !!source.members` 对旧包可能过度报告“有成员目录”。
- 缺 chat、错误环境变量名等都返回同一个 `connector_invalid`，不能定位字段。环境引用的本地结构校验通过不等于对应宿主凭据存在，更不等于认证成功。

已有可复用行为：Feishu 旧 `EntrySetup.probe()` 能在 source 落地前用显式凭据认证并列 chat；Slack 适配器已有只读 `probe()` 列 bot 已加入的频道。它们是参考实现和回归入口，不能把平台 switch 再加到 connector 核心；本切片先支持已明确选择的目标，前置目标发现可另加插件方法。

## 2. 默认用户路径：两个主要动作

1. **检查并继续**：用户填写名称、插件字段与凭据，明确看到“保存为未启用，不接收或发送消息”。通过既有 plan/apply 保存 `enabled:false, allowedActors:[]` 的 SourceConfig；受控重启完成并取得新 revision 后，由本次明确操作发起一次性身份与所选目标成员检查。不会后台自动重试。字段校验失败直接定位该字段，不生成第二个实例。
2. **选择人员并启用**：展示当前 operator 有权读取的候选成员，默认无人勾选。用户明确选择后，单独确认启用；后端复验凭据、账号、目标、候选身份与 revision，先纯准备，再把 settings / identity / receipt 同事务提交，最后在隔离闸门内同步发布内存视图。正常监听只在提交与发布均完成、最后闸门释放后开始；不得在外层 store.atomic 中调用旧 Runtime.updateSettings（详见 5.1）。

高级区域可选“使用宿主环境变量”；默认直接输入 app 凭据并由既有 onboarding 保存。普通文字至少 14px；不要求用户理解 revision、RPC、环境变量路径或状态机。原始 ID 仅在需要人工确认身份或高级手填时出现。字段帮助说明“去哪复制、填什么格式、缺什么权限”，不靠一段平台长文替代字段帮助。

本切片不消除所有平台 ID：显式目标仍是范围边界。提供插件自己的 target 字段帮助；插件未声明安全目标发现时，不能假装可自动选择群。后续可选发现扩展必须使用同一诊断 purpose，不能拿伪造 chat/scope 绕过现有配置校验。

中断恢复沿用既有 onboarding plan ID / apply receipt。apply 结果不明时先用同一 ID 核对，不能创建新 ID 重复添加 source。重启后的诊断凭证一律失效；已保存草稿仍保持 disabled，用户可重新“检查并继续”。

## 3. 草稿、普通连接与撤权

仅把 connector 草稿 schema 的 actors 改为 `min(0)`；非 local core schema无需放宽。新 SourceConfig 仍显式 `allowedActors:[]`、`allowedBots:[]`、`enabled:false`，无自定义 admission 放行、无 Worker tool grant、无 memberSync、无自动监听。字段仍只能写插件特定的允许子树，不能覆盖身份、workspace、capabilities、grants、enabled 或 admission。

普通 Source/ProcessSource 的 disabled gate **保持原样**。停用仍阻止普通 `identity/members/read/context/start/poll/receive/deliver/invoke` 等新调用；既有外部效果不因此撤销。只有当前 operator 显式申请的一次性 setup-purpose 能力可读取该 source 的身份/成员，它不是普通连接重新启用。停用、revision 变更、凭据变化、会话撤销会取消尚在运行的诊断并使旧 proof 失效。

新向导对空 allowlist 不提供普通 Enable 旁路：空草稿展示“检查并继续”，通过选择人员后使用下述 activate 命令。后端 `/control` 对 `enabled:true && allowedActors.length===0` 返回固定 `connector_actors_required`，不修改配置。此约束仅属于 ConnectorManagement 的显式 enable 命令，不改旧 config/entry admission 引擎；已有刻意配置非白名单 admission 的连接继续通过其原设置流程管理，不能被新向导误解释成普通待授权草稿。`enabled:false` 始终允许，旧已启用连接读取/运行不受这项检查影响。

## 4. 可选插件扩展：同一执行器中的 setup purpose

下面是拟议契约，不是现有 API。需先冻结本切片的精确字段名再实现。

```ts
// PluginManifest.setup 的可选字段；旧 manifest 缺省为 unsupported。
diagnostics?: {
  version: 1;
  methods: ('identity' | 'members')[];
}

// SourcePlugin.connection 的可选 registry 工厂；绝不是 live Source 的 hook。
createSetupDiagnostic?(input: SetupDiagnosticInput): Promise<SetupDiagnosticHandle>;
interface SetupCallOptions { signal: AbortSignal; deadlineAt: number }
interface SetupDiagnosticInput extends SetupCallOptions {
  config: Readonly<SourceConfig>; // 深复制并冻结，enabled 仍为 false
  credentials: Readonly<Record<string, string>>; // 仅声明字段所需的私有材料
  http: SetupHttpTransport; // 明确 origin/method policy 的专属传输
}
interface SetupDiagnosticHandle {
  identity(options: SetupCallOptions): Promise<{ id: string; type: string; verified: true }>;
  members?(scope: string, options: SetupCallOptions): Promise<{ id: string; name?: string; bot: boolean }[]>;
  close(options: SetupCallOptions): Promise<void>;
}
```

SourceRegistry 从可信原生插件注册的独立工厂 opt-in 或已固定 digest 的 manifest 推导诊断支持；支持、已检查、已通过分别返回。包声明的 setup methods 必须是普通 manifest methods 的子集，不能仅凭 ProcessSource 上的 wrapper 方法存在就声称支持。无 opt-in、旧 worker 协议、缺工厂或缺方法均返回 `unsupported`，不回退到普通 Source 调用。

packaged 插件在同一个插件模块可选导出 `createSetupDiagnostic(config, diagnosticContext)`，返回上面的有限 handle；原 `create()` 和普通生命周期完全不变。以同一个 ProcessSource 进程管理实现增加 **独立 purpose 的短生命周期执行实例**；不把它加入 Runtime.sources，不创建第二类连接实例，不调用普通 `create/start/poll`。SourceConfig 原样 `enabled:false`，不改写为 true。builtin Feishu 同样必须由 registry 插件工厂创建全新的 HTTP-only client/handle；不得从 host.sources 取 live Source，不得给 live Source 加 openSetupDiagnostics hook，不得捕获其 SourceContext、缓存、流连接、CLI 或全局 process.env。可复用纯请求路径、解析器和无状态辅助函数，不能复用 live client。Slack 显式增加同样的工厂与 manifest 声明，不移植平台代码到核心。packaged 工厂也不调用普通 create；config 不以 enabled:true clone 绕过 gate。

### 精确执行 allowlist 与宿主拒绝项

- wire purpose 固定 `setup-diagnostic-v1`；此 purpose 唯一允许的宿主命令为 `init-setup`、`setup-identity`、`setup-members`、`close-setup`。`close-setup` 同时承担 cancel：runner 控制通道必须在串行调用队列之外即时处理它，abort 当前 HTTP/分页，禁止等待被取消方法自然返回后才 close；无需新增第五个普通业务方法。UI 不能提交任意 method 名。第一阶段不含普通 `probe`、`read`、`context`、目标发现或任意 invoke。
- `setup-members` 只能访问请求绑定的、SourceRegistry 明确配置的目标与 listenScopes 交集；不得因参数而扩大范围。身份先验证，再读成员；verified 不为 true 即停止。
- runner 仅调用 `createSetupDiagnostic`。diagnosticContext 无 SourceContext、receive、change、bind、closed、repositoryUpdate、host DB、历史 snapshot 或 state writer。
- 宿主在 setup purpose 下拒绝全部 `records`、`events`、repository-check 和非空 `result.operations`，终止进程；拒绝发生在 `apply()` 之前。runner 也拒绝对应请求。不能把普通 plugin 的 state/receive 副作用吞掉后当作成功。
- init、import、factory 期间也适用拒绝规则。普通进程不能收到 setup proof；setup 进程不能升级成普通进程。仅关闭本次专属进程，不能关闭正在运行的普通 source。
- 沿用包 digest 校验、read-only sandbox 与包允许的 network。diagnostic 子进程从固定空环境构造：PATH 只能是宿主固定可信工具目录（使用显式 process.execPath，不能直接继承用户 PATH），HOME/TMPDIR/TMP/TEMP 为本次 scratch，LANG 固定。随后仅注入 manifest 声明的凭据；任何 credential 引用若目标变量名会覆盖 PATH/HOME/临时目录、全部 NODE_*、OPENSSL_*、SSL_CERT_*、LD_*/DYLD_*、BASH_ENV/ENV/SHELLOPTS、PYTHON* 或下述 proxy 项，启动前返回该字段的 invalid_environment_reference，不允许后覆盖。
- **不调用现有 networkEnvironment() 继承代理**：HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY/FTP_PROXY/WS_PROXY/WSS_PROXY/CGI_HTTP_PROXY 及大小写变体、任何 *_PROXY/*_proxy 与 NODE_USE_ENV_PROXY 一律不从宿主继承，尤其不能把含用户名/密码的 proxy URL 送入子进程。首切片使用明确 direct-network transport；确需代理时返回受限/不支持，后续独立设计经授权的代理凭据策略，不隐式 fallback。native HTTP-only transport 同样不得借全局 dispatcher/宿主代理获得额外凭据，也不能为诊断修改全局 process.env。
- 缺失的宿主 credential 在启动前定位到其声明字段；不继承宿主账户、历史或 Worker 凭据。
- setup handle close、异常、超时、撤权都走 finally：取消请求，关闭管道，杀死本次进程组，删除 scratch 和内存候选。默认单 RPC 20 秒、整次 45 秒，最多 20 个已选目标、每目标至多 500 名候选、总计至多 1000 名；超限返回固定 `directory_too_large`，不静默截断后声称完整。可信原生 handle 也必须遵守 signal 和关闭契约。

本提案的“只读”精确定义为无业务写入、无消息发送、无入站事件/任务创建，不意味着 HTTP 只能 GET。Feishu 认证 Token 发行和 Slack auth.test 可按平台协议使用 HTTP POST；它们必须列入插件的固定 origin/path/method allowlist。Token 仅在本次 handle 私有内存中使用，到期/关闭即清理，不写普通 source 缓存。禁止 chat.postMessage、业务修改接口和任意 URL；不能用笼统的“POST 都是写”替代实际操作审查，也不能因认证 POST 而放行其他 POST。

### 4.1 真实取消与会话 fence 是新增接口，不是已有能力

上述 SetupCallOptions 必须贯穿工厂、Token 请求、每页 members HTTP、runner RPC 以及 cleanup；不能只在 await 返回后检查布尔授权。旧 FeishuSource.identity/members 和 SlackSource.identity/members 没有完整的 signal/deadline 传递，**不可直接视作满足此契约**。新 HTTP-only client 必须接收合成 AbortSignal（operator 失效、host 替换、source 撤权、请求关闭及绝对 deadline），所有 fetch 使用同一最短 deadline；每次请求前后/分页间检查。超时/撤权后立即取消 socket/request，迟到结果不落候选或 proof。没有可用 abort transport 的插件声明 unsupported，不回退到旧不带取消的方法。runner 为该 purpose 建自己的 AbortController；宿主超时/撤权立即发 close-setup，宽限期内不退出则杀该进程组。cleanup 使用全新、独立且只允许关闭的 2 秒 deadline/signal，不能复用已 abort 的业务 signal 而令 finally 立刻跳过；超时强杀/删 scratch 不需要业务授权继续有效。close 控制帧必须可抢占正在等待的串行 RPC；操作总超时和 cleanup 上界分别记录，不能声称已取消却留子进程在跑。

现有 authorized(req) 只返回 boolean；现有 OperatorSessions / PersonalAccount 没有本提案所需的 proof identity + 撤权通知 API。必须新增类似：

```ts
interface OperatorFence {
  readonly binding: { method: 'bearer' | 'operator-cookie' | 'account-cookie';
    opaqueSessionId: string; generation: number; hostGeneration: string };
  readonly signal: AbortSignal;
  assertCurrent(): void;
  close(): void; // 取消订阅与 expiry timer，不注销用户
}
captureOperatorFence(req: IncomingMessage): OperatorFence;
```

由服务端认证实现提供不含 token/cookie 的私有 binding，按真实 session record/凭据代次产生，不是把 authorized=true、user ID 或请求提供的字符串当身份。创建时固定一种认证方式；若请求带 Authorization，必须验证该方式且无效立即拒绝，不能用 cookie fallback；使用 cookie 时固定实际 account session 或 pairing session。后续 setup-check/activate 必须匹配同一 method/session/generation，不能从 cookie 换 bearer 或从一条 cookie 换另一条 cookie 继承 proof。logout、logout-all、密码/恢复变更、session expiry、pairing revokeAll、宿主凭据轮换/重启都要 abort，并在各 await 后及最终提交前 assertCurrent。此接口需覆盖实际撤销事件的独立测试；没有完整 fence 时 C 切片不能启用。

这仍是可信插件边界：宿主方法/状态隔离不能证明任意恶意插件的网络实现没有副作用。只给已安装、已信任并声明该契约的插件开放；测试必须验证 Feishu/Slack 实际实现仅做认证和目录读，不把“manifest 自述只读”当成可执行代码安全证明。

## 5. 诊断请求、成员候选与最终启用

沿用 `/api/connectors/*` 与 ConnectorManagement 的诊断记录/attempt head，新增明确 setup 操作；不扩张普通 `/probe` 的权限。拟议接口：

```ts
POST /api/connectors/setup-check
{ sourceId, revision, requestId } // 服务端从已存 source 取目标、凭据引用

// 仅当前 operator 的私有响应，不进入全局 snapshot/日志。
{ status, code, proofId?, expiresAt?, candidates?: [
  { id, name?, bot: false, targetIds }
] }

POST /api/connectors/activate
{ sourceId, revision, proofId, selectedActorIds, requestId }
```

两者统一 `operatorBody()`，然后 captureOperatorFence；每次外部 await 前后再调用固定身份的 fence.assertCurrent；account/session logout、host 替换、并发 settings 更新均失败关闭。proof 绑定当前 operator 会话/凭据身份、host generation、source ID、plugin digest、revision、config fingerprint、credential generation、已选 targets/listenScopes digest、已验证账号 namespace 和 source-identity revision、候选集合与 expiry（建议 5 分钟）。Bearer 使用宿主私有 HMAC 和真实凭据代次绑定，不把 token 写入 proof/日志；cookie 会话绑定实际 session 标识，不仅是 user ID。不能仅调用旧 boolean guard 后虚构 binding。

环境引用的值可在不改 settings 的情况下变化，因此仅 config fingerprint 不够。用进程私有随机 key 的 HMAC 比较本次实际凭据材料/代次，绝不返回、记录凭据值或其可离线猜测的裸 hash；宿主重启 key 变化即 proof 失效。managed credential store 如已有可靠 generation 可一并复用。

诊断记录只存固定 code、层级、时间、revision、target 数、evidenceMode；实际候选名/ID/账号资料和 proof 只保留有界短期内存，当前 operator 请求时按 no-store 返回。候选名作为文本渲染并限制长度/控制字符；不得进入通用 snapshot、audit、错误、URL、localStorage 或截图公开资料。必要 actor ID 是 operator 明确授权读取的候选 PII，不是供模型使用的上下文。最终被明确授权的 IDs 按既有 allowedActors 配置持久化；未选择的候选和名字不因此进入配置或历史。

候选从允许目标内读取，仅 `bot === false` 可选；未知类型不自动当人。成员身份是事实而非授权，默认全不选，不调用 `/members-apply`，也不设置 memberSync。白名单是 **source 级**，UI 必须说明所选人员可在此连接配置的会话发起任务，不能暗示已实现每群独立白名单。

本切片的 activate 仅用于当前仍 disabled、空 allowedActors/Bots、无自定义放行 admission 的草稿；已有连接的授权编辑和已有人员重新启用沿用原权限/设置流程，不用此动作覆盖既有白名单。activate 要求非空、不重复的所选 IDs 均在当前 proof 的人类候选集合中。先通过同一专属 purpose 重读 identity、所选成员所属目标并核对账号和范围，随后在无 await 的事务内复验所有本地 fence、显式写入所选 allowedActors 并启用。使用 SourceIdentities 的同一 namespace/expected revision 规则：已有绑定绝不因本次诊断换账号；新账号的既有 identity 元数据只在最终明确激活动作提交，诊断阶段不偷偷注册或链接身份。可抽取其纯校验/写入 helper 复用，普通 `source.verify` 的 enabled 要求不放宽。

任何账号不匹配、成员消失、凭据轮换、proof 过期/跨会话、目标变化均保留 disabled 和空白名单，要求重新检查。settings 更新、identity 元数据与 activation receipt 按 5.1 的 prepare/commit/publish 协议提交。requestId 绑定输入指纹：成功但响应丢失只读原 receipt，不重新启用已被后续停用的 source；重放返回 appliedAtRevision 与是否仍 current，不能把旧 receipt 冒称当前已启用。最终启用成功仅表示入口授权已配置，**不表示消息收发或目标发送权限测试通过**。

### 5.1 冻结提交顺序：纯 prepare → 同 DB commit → 同步 publish

独立审查已用故障注入证明：`store.atomic(() => runtime.updateSettings(...); 后续写失败)` 会回滚 DB，但 Settings.save 的 Object.assign 与 Runtime.sources 上的 enabled/allowedActors 已改变。**禁止这种嵌套写法**，也禁止捕获异常后仍声称旧 runtime 一定未变。

拟拆出明确的内部接口（名称可调整，阶段职责不可混合）：

```ts
prepareActivation(expectedRevision, selectedActors, verifiedEvidence): PreparedActivation;
commitPreparedActivation(prepared): CommittedActivation;
publishCommittedActivation(committed): void; // 同步、无 await / I/O / 插件回调
```

1. **纯 prepare**：在最后一次只读 HTTP 检查后再复验 fence，读取 DB 当前 settings/identity；深复制并验证源补丁、SourceRegistry schema、namespace/revision、manager 校验、policy 变化和所有发布对象。生成 next settings、identity、输入指纹、receipt、所需 policy metadata writes 与旧视图快照；不得写 DB、改 Runtime.config/Source.config、消费 proof、启动 adapter 或执行 Settings.save/updateSettings。所有可能失败的构造/校验都在此完成。
2. **同一 DB 事务 commit**：末次同步复验 DB revision/identity/proof/fence；依次写 settings-history、settings-current、新 identity/identity receipt、policy metadata/audit/jobs（若该配置变更需要）、activation receipt。receipt 初始为 committed_not_published，兼作重启 fail-closed 标记；不是第二套配置权威。此处不得直接持久化 enabled:true 的未完成目标配置；见下述旧 binary 屏障与安全 staging 修订。所有写只能操作 authoritative DB，无 Object.assign、内存 clock/游标改变、插件 callback、网络或真实发送。commitPrepared 不能调用现有 Settings.save、Runtime.updateSettings 或带内存副作用的 engine clock/callback；需要新增 Settings 的纯 prepare/DB-only commit/publication helper，保留旧 save 行为不被本切片偷偷重写。若 policyChanged 链路不能证明事务内纯 DB，则 C 继续阻塞，先抽取/验证所需 metadata plan，不能在 publish 后补跑一个可能失败的隐式 policy 写。
3. **同步 publish，暂不开放入口**：在目标 source 的 publication gate 下发布全部已准备的 Runtime.config / Settings config / Source.config / policy 视图。gate 不等于 enabled 开关，不授任何业务方法权限；发布期间和异常后目标 ordinary 调用、poll、flush、Worker 工具都不得运行。不能调用插件工厂/生命周期、SourceContext callback、await 或 DB 写。发布中任一步失败立即保留 gate，尽力恢复旧内存快照并将宿主置 unavailable；旧 disabled 状态恢复失败也不能放开宿主。不得有从“第一份对象已变 true”到普通调用可见的窗口。
4. **落盘完成并释放 gate**：成功发布的视图仍被 gate 隔离；在最后同一 DB 事务写最终 settings/identity/activation receipt published（这是显式的完成事务，不藏在 publish 内；完成前所有旧格式权威配置仍 disabled）。该写失败同样保持 gate/unavailable。只有这项 durable completion 成功后才以不会抛错的 primitive swap 释放 gate；此后没有可能失败的必需写入或 callback，再返回成功。durable published 后仅响应丢失属于已提交结果未知，用原 receipt 核对；不能为构造一个新失败响应而再尝试自动启用。

DB 首事务任一写失败：整库回到旧 revision/identity/receipt，内存仍完全旧视图，proof 不消费，source disabled。commit 成功后 publish/完成标记失败：保留 committed_not_published 与 gate，旧格式权威配置必须仍是 enabled:false；**绝不根据 receipt 内的待完成意图自动开启**。尽力用新事务写补偿 settings（新 revision、enabled:false；所选人员/identity 可作为显式历史保留）及 failed publication receipt；补偿也失败则保持 unavailable，仅可人工/受控恢复。

重启必须在 Settings 载入覆盖、adapter 构造、Source polling/flush 或任何 ordinary API 之前检查此 pending marker；存在 marker 时先 fail-closed，受控恢复只提交 disabled 补偿视图，再发布 disabled、清理候选/proof。不能自动完成 enabled:true 的 pending 激活。完整成功 published 的既有连接保持通常启动语义；回滚功能不重放 activation，不删除已明确提交历史。旧 settings 构造器当前会把保存配置覆盖到内存并写回 DB，需先增加这个启动恢复屏障，否则不能交付 C。

**C0 仍未冻结：旧 binary 与 Store observer 是实现前置阻塞，不可只增加 marker 后交付。**

- 存储协议需有真实 schema/version 能力屏障，新宿主在 Settings 构造/覆盖之前验证协议，受支持 launcher/降级工具核验 binary capability 与 schema version。不认识协议时拒绝启动或只进入禁用恢复；API2 plugin artifact 的版本检查不能代替 host storage 屏障。旧 binary 若根本不读取新 marker/version，添加一个新 record/PRAGMA 不能使它自行拒绝，必须以旧 binary 启动实测，不能只靠新代码单测声称兼容。
- 为防旧 binary 忽略新标记，本提案修订为 **disabled staging**：第一事务写当前格式可读的 disabled settings（stage revision）、诊断 identity 元数据及 pending receipt；预期启用配置只在私有 prepared plan / receipt intent 中。publish 全程 gate 关闭，最后完成事务才写 enabled:true 最终 settings（新的 final revision）、identity 与 published receipt；所有必需对象已准备并同步发布就绪后，该事务成为成功的 durable 决策点，再用不可抛错的 primitive release。stage 与 final 均有独立 revision/history，不能同 revision 静默改配置。旧 binary 在任一 pending/失败点读到的 settings / managed config / 启动可见配置都必须 disabled；完成后旧 binary 看到的是用户已明确完成的启用。若无法保证所有旧可读权威输入在 pending 时 disabled，C0 继续阻塞，不能落地 enabled:true pending 版本。
- DB COMMIT 可能已成功但 wrapper/连接在返回前抛错。不得 catch 后一律称 rollback；重开受控读连接按 requestId/输入指纹、revision、identity/receipt 核查，分别报告 not_committed、committed_pending、published 或 unknown。未知时保持 unavailable/gate，不重放激活；下一次调用只核原 receipt。每个 COMMIT 的“提交成功后丢返回”都要注入测试。
- Store.put / bodyFilter / observers、audit hooks、engine clock/callback 并非天然 DB-only。prepare 必须生成经纯校验/脱敏后的稳定写入字节；commit 使用明确审查过的 DB-only 路径。SQL trigger 的 DB audit 可同事务执行；任何 JS observer/缓存/内存通知必须事务感知地暂存至安全发布阶段，且不能夹带业务效果。若未能证明 callback 的全部行为，禁止调用，不能用“最终 SQL 在 transaction 中”掩盖内存副作用；对应 C0 未解。
- publication gate 的调用图需覆盖 **全部** 路径，而非只挡 scheduler：HTTP/events、poll/live stream/webhook ingress 在 recordNative / source-observed / native proof 记录前；SourceContext.receive/change/bind/closed/repositoryUpdate；flush 在 deliveryStarted/调用外部 adapter 之前及其 await 后；resources/read/context/identity/members、Worker/MCP/tools/普通 invoke；ProcessSource 的 records/events/result.operations 在 apply 之前。旧捕获闭包也必须动态读取当前 gate。测试直接调用各入口证明 gate 内不会产生触发、native proof、身份/成员结果、权限变更、外发或 outbox sending 标记；不能只测试 UI 入口。正在完成的旧外部效果仍按 unknown/已有回执处理，gate 不伪称撤销。

逐写点/发布故障矩阵（C 的合入门槛）：

| 注入点 | 预期 DB / 内存 / 入口 |
| --- | --- |
| prepare 校验、HTTP 末次校验或 fence 失败 | 零写、旧视图、disabled；不消费 proof |
| settings-history 写前后抛错 | 首事务完整回滚；无 source/config 内存变化 |
| settings-current 写前后抛错 | 同上，尤其 enabled/actors 不可只在内存生效 |
| source-identity / identity receipt 每一写前后 | settings 与 identity 一起回滚，不留半绑定 |
| policy metadata/audit/job 的每一写前后 | 同事务回滚；内存 clock、游标和队列不得前进 |
| activation pending receipt 写失败 / COMMIT 明确未提交 | 所有首事务写回滚；无 publish；Store observer/缓存不变 |
| 每个 COMMIT 已落盘但丢返回 | 读原 receipt 核查真实结果，禁止直接声称 rollback；无法核查保持 unavailable/unknown |
| 旧 binary 忽略 marker/version 后启动 pending | 所有旧格式权威配置仍 disabled，不监听；真实兼容启动测试证明而非只读新 marker |
| DB commit 后、publish 前中断/重启 | marker 阻普通入口；仅恢复 disabled 补偿 |
| config / Source / policy 内存每个 swap 抛错 | gate 保留、宿主 unavailable；所有 ingress/recordNative/Context callbacks/resources/tools/ProcessSource apply 均不能越 gate |
| receipt published 写 / 其 COMMIT 失败 | 不释放 gate；补偿失败也不能开放或重启自动启用 |
| 补偿 settings/receipt 任一写失败 | marker 保留，宿主 unavailable；不从失败中自动启用 |
| durable completion 后响应丢失 / receipt 重放 | 核对原 receipt 与当前 revision，不复活后来已停用的 source |

## 6. 字段定位错误与诊断支持

固定顶层错误继续保留，不返回 Zod/Ajv/adapter exception、stderr、原始请求/响应或输入值。validate 失败建议响应：

```ts
{ valid: false, code: 'connector_invalid', issues: [
  { field: 'app-secret', code: 'required' }
] }
// field 仅为 label / actors / 已安装插件 setup.fields[].name。
// code: required | invalid_format | invalid_environment_reference |
//       credential_unavailable | too_many | unsupported_field
```

host 维护 JSON path → 已声明 field name 的安全映射。Ajv required 的 missingProperty 和 instancePath 只用于该映射，绝不直接返回；未能安全映射时显示固定表单级错误。原生插件可选返回相同 typed issue，不把 throw 文本翻译后透传。权限/revision/expiry 冲突不是字段错误。

credential 字段分别提供结构有效、宿主引用可用、认证已验证三种证据；不存在的环境变量定位到字段，不显示引用名称或值。UI 按公开 metadata 做必填/格式提示，后台重复验证。插件字段帮助需本地化可选元数据或清楚原文；目标字段须给复制入口和前缀示例，actor 不再是初次保存必填。

`connectionDefinitions` 增加只读 diagnostic support 描述（configuration/reachable/setup identity/setup directory），基于 manifest+opt-in，而非 wrapper 方法存在；旧实例支持变化会使旧 proof 失效。目录支持/目录读通过仍不代表消息读取、接收、发送或目标频道写权限。公网 HEAD/401 只证明服务可达。真实结果未知继续要求先核查，不能发测试消息“确认一下”。

## 7. 可独立交付的实现顺序

1. **A：草稿与字段错误**。允许空 actor 的 disabled 草稿；字段 issues 协议与凭据引用 availability；UI 不再要求先猜 ID。普通 enable 空白名单返回明确错误。单独本地测试和审查，不宣称 bootstrap 已完全打通。
2. **B1：取消与认证身份契约**。先增加真实 OperatorFence/session 撤销通知及 HTTP signal/deadline client，独立验证 logout、认证方式固定、过期、凭据轮换和所有分页可取消。不能把当前 boolean guard 当实现完成。
3. **B2：插件 setup-purpose 边界**。SourceRegistry 独立 native HTTP-only 工厂、manifest、ProcessSource/runner 可选 opt-in；旧包 unsupported；最小 env、严格 RPC/副作用拒绝/cleanup。Feishu 与新版本 Slack artifact 显式 opt-in；普通 source/撤权/旧 package pin 不变。
4. **C0：提交与发布机制（仍未冻结）**。先独立设计审查 schema/version + 旧 binary 实际屏障、disabled staging 的双 revision/最终事务、Store observer 延后语义、全部入口 gate；再实现并故障注入验证 5.1 的纯 prepare、DB-only commit、逐对象 publish、丢 COMMIT 返回核查和 disabled 补偿。不得先接 activate 再补原子性。
5. **C1：候选与明确激活**。在 B1/B2/C0 均通过后复用既有 plan/apply 及诊断 store，新增 setup-check/proof/activate；只选定人员，跨 await operator、revision、账号、目标和 credential fence；不调用全员同步接口。
6. **D：两动作 UI 与云本地验收**。接入动态字段/诊断支持与候选；简单常规字、可选高级引用、错误定位；桌面/窄屏/键盘/reduced-motion/中断恢复截图。B/C 未完成前不把 A 的保存当作“已连接”。

A–D 合并后仍只可标本地代码/协议/UI 验收；O14 真实端到端和 issue 的完整退出项保持未完成。不得将既有 fake pass 改写为真实平台通过。

## 8. 测试矩阵与验收边界

| 场景 | 本地必须证明 |
| --- | --- |
| 空 actor 草稿 | plan/apply 生成 disabled、空 allowedActors/Bots；无监听/调用/工具授权；local operator 规则不变 |
| 旧 plugin / 缺工厂 / 缺方法 | 明确 unsupported；绝不调用普通 create/identity/members 或临时 enabled:true |
| purpose wire 越权 | start/poll/receive/deliver/invoke/read/context/records/events/repository-check 和 result.operations 在 apply 前拒绝；初始化阶段同样拒绝 |
| 生命周期 | native/packaged 均独立 registry 工厂；捕获 live SourceContext 的旧 hook 不会被调用；Token/每页 members HTTP 真正 abort，专属进程/管道/scratch/候选清理，不终止普通 source |
| 凭据边界 | 只注入 manifest 指定引用；含 userinfo proxy 与大小写 proxy/NO_PROXY/NODE_USE_ENV_PROXY 均不继承；credential 引用不能覆盖 HOME/PATH/loader 变量；缺引用准确字段；值/名称/裸 hash/stderr/raw 不出 UI/日志 |
| 账号与目标 | 错 workspace/账号、不同 source、listenScopes 缩小、凭据同名换值、包 digest 改变均使 proof 失效 |
| 成员候选 | 只来自允许目标，bot/未知类型不可选；空名单不自动授权；选择 A 不会把 B 或整个群加白 |
| operator | 真 session id/generation + 撤销 signal；每个 await 窗口拒绝；跨 operator/会话、cookie↔bearer 换认证、无效 bearer fallback cookie、过期 proof 均不可复用 |
| revision / 并发 | 旧 attempt 不覆盖新诊断；同 requestId 同输入核回执、异输入冲突；完整执行 5.1 各 DB 写/COMMIT/内存 swap/完成标记/补偿点故障矩阵，pending 重启从不自动启用 |
| 启用前远程变化 | 重读 identity/membership 失败保留 disabled；同名账号或 ID 类型异常保守拒绝 |
| 先成功后丢响应 | 同 receipt 核实，不重复加 source、不复活已停用连接；当前状态与 appliedAtRevision 分开 |
| error mapping | 缺 required、错误 chat/team/env、未知字段分别定位；故意包含 secret 的异常始终固定脱敏 |
| availability | ProcessSource wrapper 存在但 manifest 无 members 仍 unsupported；目录通过不能变成收发绿色 |
| 既有兼容 | 普通 disabled gate、source identity namespace、scope/actor admission、权限撤销、原生 Codex/任务与插件协议回归不变 |
| UI | 两主要动作、>=14px、无默认全选、作用范围明确、旧结果/不可用/错误恢复可懂；暗浅主题/窄屏/键盘/减少动画/console |
| 真实平台 | 本轮**不执行**认证联网、发消息或消耗模型费用；fake transport 允许仅 Token/auth.test 的认证 POST、拒业务写 POST；providerAccepted/remoteId/readback 不得伪造 |

现有回归入口：`tests/connector-management.spec.ts`、`tests/plugin-protocol.spec.ts`、`tests/plugin-packages.spec.ts`、`tests/plugin-history.spec.ts`、`tests/slack-plugin.spec.ts`、`tests/source-plugins.spec.ts`、`tests/entry-setup.spec.ts`、`tests/onboarding.spec.ts`。新增 setup-purpose 与 activation 测试使用 fake adapter / fake child / loopback fixture，不使用真实凭据。最终按仓库 check/typecheck/build 和完整聚焦回归验收。

本提案形成前的新证据：独立运行 connector-management 22/22；slack-plugin + entry-setup 26/26 通过。另以不启动 Runtime/不联网的假 host 复现：core 接受 disabled 空白名单、connector 草稿拒绝空 actor、缺失宿主环境引用仍本地结构有效、缺 chat 与错 env 得到相同无字段错误、disabled authentication 在任何 adapter 调用前拒绝。这些是现状证据，不是上述提案已实现的证明。

## 9. 迁移、回滚与风险

无强制配置迁移；新 registry 工厂与 metadata 均可选，旧插件保持原普通行为且 setup 诊断显示 unsupported。当前 apiVersion:2 的 manifest 是 strict schema，**没有 minimumHostVersion/minHost 字段**，不能据不存在的版本门槛声称兼容。新增 setup.diagnostics 需作为新插件版本和新构建 artifact/digest 发布，并由支持该可选 schema/worker purpose 的宿主显式安装/激活；旧宿主校验拒绝新字段即保持其原安装包与 pin，不静默改写/删字段使新包在旧宿主假兼容。若需最低宿主字段，另走协议版本提案，不在本切片偷偷添加。回滚新包使用已保存的旧版本 artifact+digest/pin（包括旧 manifest），不能只去掉新字段而保留新 digest。关闭新功能后保留 disabled 草稿与既有设置/历史，不删除连接或旧诊断。

回滚前先在新宿主按 5.1 处理 committed_not_published，使相关 source 落为 disabled；不得在旧宿主仍不会检查 pending marker 时直接带 enabled:true 的未完成配置降级。随后撤掉新入口和 setup-purpose 支持，丢弃所有短期 proof/候选；已由用户明确启用的连接沿用已有 SourceConfig/identity 元数据，回滚不自动启用/停用、不撤销或重发历史外部效果。保留普通 enabled gate 和旧包隔离。实际环境中认证和目录本身也是外部读取，仍需用户针对具体账号授权；当前仅允许模拟测试，首次真实验证另列清楚账号、目标、动作与证据，不能据本 proposal 自动执行。


## 10. 第二版审查回应与冻结条件

- P1 原子性：明确旧 updateSettings 在外层事务内不可用；冻结 prepare/commit/publish/完成标记、pending 启动屏障及 disabled 补偿，逐写点矩阵列为 C0 必测，不允许“DB 回滚所以内存也没变”的推断。
- P2 native 隔离：移除 live Source hook 方案，native 和 packaged 同由 registry/plugin 独立工厂创建 HTTP-only 实例；不能捕获 live SourceContext，不能 normal create 或 enabled clone。
- P2 signal/session：将真实 signal/deadline、OperatorFence 的实际 session identity/generation 和撤权通知列为 B1 新接口；旧方法不满足就 unsupported，不用 boolean proof、不换认证方式 fallback。只读定义允许固定认证 HTTP POST，禁止业务写与消息。
- P2 环境/兼容：空环境+固定 PATH/HOME，禁止凭据覆盖 loader/环境保留项、禁止继承含凭据 proxy；承认 API2 strict manifest 无 minHost 字段，新版本 artifact/digest 与旧 pin 回滚必须真实存在。

第三轮追加：C0 仍不冻结；补入旧 binary schema/version + disabled staging、防 Store observers 内存副作用、全部 ingress/recordNative/SourceContext/flush/resources/tools/apply gate、COMMIT 丢返回核查；close-setup 抢占取消 + 独立 cleanup deadline，环境额外禁 NODE_*/OPENSSL_*/SSL_CERT_* 与 proxy 变体。A 独立安全切片已获授权，B/C 未获冻结或实现授权。

先由 root 与独立 review 线复验 B/C 设计；A 可按明确限定先行。B1/B2/C0/C1 未实现时 UI 必须如实保留认证/选人 bootstrap 限制；本提案和现有 fake tests 均不能标为已支持真实 IM。


## 11. A 安全切片的实际 API 增量（不代表 B/C/D 已实现）

A 仅修改本地 recipe/validation/control 边界，沿用现有 validate → plan → Onboarding.sourcePlan → connection/apply。`POST /api/connectors/validate` 与 `/plan` 新增可选 `intent: 'draft'`；此明确意图要求 `actors: []` 并生成 disabled、空 allowedBots、无 memberSync/custom admission/工具 grant 的草稿。不带 intent 的既有非空 actors 流程保持兼容；无 intent 的空 actors 仍按 actors.required 拒绝，intent=draft 却带 actors 也拒绝歧义。

validate 成功新增 `credentialAvailability: [{field, available}]`，只表示本次材料已提供或对应宿主环境引用存在；不返回环境变量名称/值，不认证，不要求变量现在已存在才能保存 disabled 草稿。失败返回固定 `issues: [{field, code}]`，field 仅 label、actors、当前已安装插件声明的字段名，code 仅固定枚举。plan 错误通过 ConnectorError 的同一固定 envelope 返回 issues；未知/无法安全映射的异常保持表单级 code，不解析错误文案。packaged Ajv path 仅映射声明字段；native 可选 connection.validateFields 只提供本地 typed issue 元数据，现有 validate 仍是权威，metadata 不能使失败变成通过。插件校验使用冻结副本，不能把待返回 recipe 变成 enabled 或偷偷增加 actor。

普通事件入口若无 allowedActors、无显式 allowedBots、也无明确 unlisted admission 放行，control(enabled=true) 在任何 settings/receipt 写入前返回 connector_actors_required；disable 沿用原行为。既有明确 bot/custom admission、events:false 的工具专用连接不受此 gate 误伤，也不增加或修改 Worker/tool grants。A 不调用认证、members/start/poll/deliver，不开诊断工厂、不接 activate，不触碰 C0 的 enabled:true 提交机制；UI actor 必填和 disabled 不能认证的现状仍待 D/B 处理，不能标 O13/O14 完成。

本地回归新增显式草稿无 DB 写/无适配器调用、字段白名单与恶意错误过滤、环境引用 availability、空入口启用前拒绝、bot/custom/tool-only 兼容、实际 HTTP plan/apply disabled/replay、既有 apply 事务前写失败+同 plan 重试零 grant/run；这只验证 A 的现有流程，不证明新 C0 协议。C0 的每个 COMMIT 丢返回/observer/全入口/旧 binary 故障矩阵仍未实现、未冻结。
