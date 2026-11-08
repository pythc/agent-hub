import { DecisionSettings, DecisionFlow } from "./DecisionScenes";
import { CanvasImage, staticFile } from "remotion";
import { Badge, Button, Field, Icon, Logo, Shell } from "./UI";
import { reveal, typeText } from "./motion";
import "./product-scenes.css";

export type ProductKind =
  | "positioning"
  | "runtimes"
  | "roletools"
  | "ecosystem"
  | "decision"
  | "listening"
  | "local";

function AppMark({ app }: { app: string }) {
  if (app === "飞书")
    return (
      <CanvasImage
        src={staticFile("feishu.ico")}
        style={{ width: 32, height: 32 }}
      />
    );
  if (app === "Slack")
    return (
      <svg width="33" height="33" viewBox="0 0 40 40">
        <rect x="17" y="1" width="8" height="19" rx="4" fill="#36c5f0" />
        <rect x="1" y="16" width="19" height="8" rx="4" fill="#e01e5a" />
        <rect x="16" y="21" width="8" height="18" rx="4" fill="#ecb22e" />
        <rect x="21" y="17" width="18" height="8" rx="4" fill="#2eb67d" />
        <circle cx="12" cy="5" r="4" fill="#36c5f0" />
        <circle cx="5" cy="29" r="4" fill="#e01e5a" />
        <circle cx="29" cy="35" r="4" fill="#ecb22e" />
        <circle cx="35" cy="11" r="4" fill="#2eb67d" />
      </svg>
    );
  return (
    <svg width="33" height="33" viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="#6565df" />
      <path
        d="m8 17 15 15M7 23l10 10M11 12l17 17M16 8l17 17"
        stroke="white"
        strokeWidth="2"
      />
    </svg>
  );
}
function Positioning({ t }: { t: number }) {
  return (
    <div className="positioning-scene">
      <div className="positioning-brand" style={reveal(t, 0.2)}>
        <Logo size={48} />
        <span>Roppo</span>
      </div>
      <h1 style={reveal(t, 0.5)}>一个工作空间，两种规模。</h1>
      <div className="audience-grid">
        <section style={reveal(t, 1)}>
          <Icon name="user" size={30} />
          <span>个人</span>
          <h2>你的 24 小时助手</h2>
          <p>接住消息，推进任务，随时续接。</p>
          <div className="personal-clock">
            <strong>
              24<span>h</span>
            </strong>
            <svg viewBox="0 0 180 180">
              <circle
                cx="90"
                cy="90"
                r="79"
                fill="none"
                stroke="#e6e6e6"
                strokeWidth="2"
              />
              <circle
                cx="90"
                cy="90"
                r="79"
                fill="none"
                stroke="#303030"
                strokeWidth="3"
                strokeDasharray="100 396"
                strokeDashoffset={-t * 28}
              />
            </svg>
          </div>
          <div className="audience-footer">
            <span className="live-dot" />
            本地持续运行，随时待命
          </div>
        </section>
        <section style={reveal(t, 1.5)}>
          <Icon name="team" size={30} />
          <span>企业 / 组织</span>
          <h2>智能协作中枢大脑</h2>
          <p>连接群聊、应用和团队，统筹协作。</p>
          <div className="organization-diagram">
            <svg viewBox="0 0 370 130">
              <path
                d="M40 28 185 65 330 28M40 103 185 65 330 103"
                fill="none"
                stroke="#ddd"
                strokeWidth="2"
              />
              <path
                d="M40 28 185 65 330 103M330 28 185 65 40 103"
                fill="none"
                stroke="#555"
                strokeWidth="2"
                strokeDasharray="20 140"
                strokeDashoffset={-t * 35}
              />
            </svg>
            <b className="org-router">
              <Logo size={30} />
            </b>
            <i className="org-node one">产品</i>
            <i className="org-node two">研发</i>
            <i className="org-node three">运营</i>
            <i className="org-node four">支持</i>
          </div>
          <div className="audience-footer">
            <span className="live-dot" />
            多群协同，由 Router 统一协调
          </div>
        </section>
      </div>
    </div>
  );
}
function Runtimes({ t }: { t: number }) {
  const active = t < 2.5 ? 0 : t < 4.8 ? 1 : 2;
  return (
    <Shell section="模型连接">
      <div className="product-page">
        <div className="settings-title">
          <h1>让模型按你的方式工作</h1>
          <Badge>适用于每个 Router 和 Worker</Badge>
        </div>
        <div className="runtime-cards">
          {[
            ["cpu", "API 模型服务", "云端服务或本地模型 API"],
            ["user", "订阅账号", "复用受支持的账号订阅额度"],
            ["terminal", "本地 CLI", "沿用 CLI 登录、工具与插件"],
          ].map(([icon, label, copy], i) => (
            <section
              data-runtime={i}
              className={active === i ? "selected" : ""}
              key={label}
            >
              <Icon name={icon} size={30} />
              <h2>{label}</h2>
              <p>{copy}</p>
              <div className="runtime-choice">
                <span>{active === i ? "当前选择" : "独立配置"}</span>
                <Icon name={active === i ? "check" : "chevron"} size={17} />
              </div>
            </section>
          ))}
        </div>
        <div className="runtime-detail" key={active}>
          <div className="runtime-detail-heading">
            <Icon name={["cpu", "user", "terminal"][active]} size={24} />
            <div>
              <h2>
                {
                  ["连接自己的模型服务", "使用已有订阅", "调用本地 Codex CLI"][
                    active
                  ]
                }
              </h2>
              <p>
                {
                  [
                    "每个角色独立选择协议、模型与参数。",
                    "适配支持的账号授权方式，按服务商规则使用额度。",
                    "通过已登录的 CLI 工作，使用其允许的原生工具与插件。",
                  ][active]
                }
              </p>
            </div>
          </div>
          <div className="runtime-fields">
            {active === 0 ? (
              <>
                <Field label="协议" value="OpenAI / Anthropic 兼容 API" />
                <Field label="服务地址" value="云端端点 / 本地模型服务" />
              </>
            ) : active === 1 ? (
              <>
                <Field label="账号来源" value="ChatGPT · 支持的订阅账号" />
                <Field label="使用方式" value="账号授权 · 复用已有额度" />
              </>
            ) : (
              <>
                <Field label="CLI" value="Codex · native app-server" />
                <Field label="能力" value="本地文件 · 终端 · MCP 插件" />
              </>
            )}
          </div>
        </div>
        <div className="product-summary">
          <Icon name="settings" />
          按角色组合接入方式，让成本与任务相匹配。
        </div>
      </div>
    </Shell>
  );
}
function RoleTools({ t }: { t: number }) {
  const worker = t >= 4;
  return (
    <Shell section="Agent 团队">
      <div className="product-page">
        <div className="settings-title">
          <h1>每个角色，都有自己的配置</h1>
          <Button primary icon={t > 6.5 ? "check" : "settings"}>
            {t > 6.5 ? "已保存" : "保存配置"}
          </Button>
        </div>
        <div className="role-settings">
          <div className="role-picker">
            {["Router", "Research", "Build", "Review", "Report"].map(
              (name, i) => (
                <div
                  data-role={name}
                  className={(worker ? i === 1 : i === 0) ? "selected" : ""}
                  key={name}
                >
                  <Icon name={i ? "cpu" : "flow"} />
                  <div>
                    <strong>{name}</strong>
                    <p>{i ? "执行者" : "管理与统筹"}</p>
                  </div>
                  <Icon name="chevron" size={15} />
                </div>
              ),
            )}
            <div className="role-independent">
              <Icon name="settings" />
              模型 · 参数 · 提示词 · 工具
            </div>
          </div>
          <div className="role-editor">
            <h2>
              <Icon name={worker ? "cpu" : "flow"} />
              {worker ? "Research" : "Router"}
            </h2>
            <div className="role-backend">
              <Field
                label="模型接入"
                value={
                  worker ? "API 服务 · gpt-6.1-sol" : "API 服务 · gpt-6.1-terra"
                }
                select
              />
              <Field
                label="思考"
                value={worker ? "高 · 可关闭" : "中 · 可关闭"}
                select
              />
            </div>
            <label className="product-label">角色提示词</label>
            <div className="prompt-editor">
              {worker ? (
                <>
                  你负责复现问题与收集证据。
                  <br />
                  使用已授权的浏览器和文件工具。
                  <br />向 Router 汇报发现、证据与阻塞。
                </>
              ) : (
                <>
                  你是用户的个人助手或组织协作中枢。
                  <br />
                  按已授权的范围识别任务，管理 Workers。
                  <br />
                  汇总证据，向原会话报告；听从人工停止。
                </>
              )}
            </div>
            <label className="product-label">工具权限</label>
            <div className="tool-permissions">
              {[
                worker ? "浏览器操控" : "创建与管理 Workers",
                "文件与终端",
                "应用插件 / MCP",
              ].map((n) => (
                <div key={n}>
                  <span className="permission-check">
                    <Icon name="check" size={13} />
                  </span>
                  {n}
                </div>
              ))}
            </div>
            <div className="role-note">
              API、订阅账号或本地 CLI，均可按角色选择。
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
function Ecosystem({ t }: { t: number }) {
  return (
    <Shell section="工具与应用">
      <div className="product-page">
        <div className="settings-title">
          <h1>把工作发生的地方连起来</h1>
          <Button icon="plus">添加插件 / MCP</Button>
        </div>
        <div className="app-integrations">
          {["飞书", "Slack", "Linear"].map((app, i) => (
            <section data-app={app} key={app} style={reveal(t, 0.2 + i * 0.4)}>
              <AppMark app={app} />
              <div>
                <h2>{app}</h2>
                <p>{["群聊与消息", "频道与团队协作", "需求、问题与项目"][i]}</p>
              </div>
              <Badge>{i ? "插件 / MCP" : "消息接入"}</Badge>
            </section>
          ))}
        </div>
        <div className="ecosystem-map">
          <div className="connected-scopes">
            <label className="product-label">一个或多个群聊</label>
            {[
              ["飞书", "产品研发群"],
              ["Slack", "# product"],
              ["Slack", "# support"],
            ].map(([app, scope], i) => (
              <div className="scope-row" data-scope={i} key={scope}>
                <AppMark app={app} />
                <span>{scope}</span>
                <span className="permission-check">
                  <Icon name="check" size={13} />
                </span>
              </div>
            ))}
          </div>
          <svg className="ecosystem-lines" viewBox="0 0 230 240">
            <path
              d="M0 50C130 50 90 120 230 120M0 120H230M0 190C130 190 90 120 230 120"
              fill="none"
              stroke="#ddd"
              strokeWidth="2"
            />
            <path
              d="M0 50C130 50 90 120 230 120M0 120H230M0 190C130 190 90 120 230 120"
              fill="none"
              stroke="#333"
              strokeWidth="2"
              strokeDasharray="24 210"
              strokeDashoffset={-t * 55}
            />
          </svg>
          <div className="ecosystem-router">
            <Logo size={40} />
            <h2>Router</h2>
            <p>统一理解 · 分派 · 跟进 · 报告</p>
            <div className="scope-policy">
              <Icon name="check" size={17} />
              自动处理已授权范围内的任务
            </div>
            <Button primary icon={t > 6.5 ? "check" : "settings"}>
              {t > 6.5 ? "范围已保存" : "保存范围"}
            </Button>
          </div>
        </div>
        <div className="product-summary">
          <Icon name="plug" />
          通过适配器与 MCP 扩展更多应用，统一管理多个讨论。
        </div>
      </div>
    </Shell>
  );
}
function Local({ t }: { t: number }) {
  const command =
    "git clone https://github.com/pythc/agent-hub.git\ncd agent-hub\nnpm ci\n./start.sh";
  return (
    <Shell section="工作区设置" dark>
      <div className="product-page local-page">
        <div className="settings-title">
          <h1>本地优先，开源可部署</h1>
          <Badge>YOUR AI TEAM</Badge>
        </div>
        <div className="local-layout">
          <div>
            <div className="local-brand">
              <Logo size={47} />
              <span>Roppo</span>
            </div>
            <h2>配置属于你的 AI 团队。</h2>
            <p>
              模型、角色、提示词和工具，
              <br />
              都由你按自己的需求组合。
            </p>
            <div className="local-properties">
              {[
                ["folder", "工作区状态保存在本地"],
                ["cpu", "模型可接云端，也可接本地"],
                ["code", "开源代码，可自行部署与扩展"],
              ].map(([i, n]) => (
                <div key={n}>
                  <Icon name={i} />
                  {n}
                </div>
              ))}
            </div>
          </div>
          <div className="local-terminal">
            <div>
              <Icon name="terminal" size={17} />
              <span>部署 Roppo</span>
              <Icon name="code" size={16} />
            </div>
            <pre>{typeText(command, t, 0.8, 3.7)}</pre>
            {t > 4.7 && (
              <div className="local-ready" style={reveal(t, 4.7)}>
                <Icon name="check" />
                工作区就绪
              </div>
            )}
            <footer>github.com/pythc/agent-hub</footer>
          </div>
        </div>
      </div>
    </Shell>
  );
}
export function ProductScene({ kind, t }: { kind: ProductKind; t: number }) {
  if (kind === "positioning") return <Positioning t={t} />;
  if (kind === "runtimes") return <Runtimes t={t} />;
  if (kind === "roletools") return <RoleTools t={t} />;
  if (kind === "ecosystem") return <Ecosystem t={t} />;
  if (kind === "decision") return <DecisionSettings t={t} />;
  if (kind === "listening") return <DecisionFlow t={t} />;
  return <Local t={t} />;
}

export function isProductKind(kind: string): kind is ProductKind {
  return [
    "positioning",
    "runtimes",
    "roletools",
    "ecosystem",
    "decision",
    "listening",
    "local",
  ].includes(kind);
}
