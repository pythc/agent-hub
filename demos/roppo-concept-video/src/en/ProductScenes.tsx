import { DecisionSettings, DecisionFlow } from "./DecisionScenes";
import { BrandMark } from "./Brands";
import { Badge, Button, Field, Icon, Logo, Shell } from "./UI";
import { reveal, typeText } from "../motion";
import "../product-scenes.css";

export type ProductKind =
  | "positioning"
  | "runtimes"
  | "roletools"
  | "ecosystem"
  | "decision"
  | "listening"
  | "local";

const AppMark = BrandMark;
function Positioning({ t }: { t: number }) {
  return (
    <div className="positioning-scene">
      <div className="positioning-brand" style={reveal(t, 0.2)}>
        <Logo size={48} />
        <span>Roppo</span>
      </div>
      <h1 style={reveal(t, 0.5)}>One workspace. Built for both.</h1>
      <div className="audience-grid">
        <section style={reveal(t, 1)}>
          <Icon name="user" size={30} />
          <span>FOR YOU</span>
          <h2>Your 24/7 assistant</h2>
          <p>Keep work moving. Pick up where you left off.</p>
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
            Ready while your local host is running
          </div>
        </section>
        <section style={reveal(t, 1.5)}>
          <Icon name="team" size={30} />
          <span>FOR YOUR ORGANIZATION</span>
          <h2>Your coordination hub</h2>
          <p>Connect conversations, applications and people.</p>
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
            <i className="org-node one">Product</i>
            <i className="org-node two">Engineering</i>
            <i className="org-node three">Operations</i>
            <i className="org-node four">Support</i>
          </div>
          <div className="audience-footer">
            <span className="live-dot" />
            One Router across channels and teams
          </div>
        </section>
      </div>
    </div>
  );
}
function Runtimes({ t }: { t: number }) {
  const active = t < 2.5 ? 0 : t < 4.8 ? 1 : 2;
  return (
    <Shell section="Model connections">
      <div className="product-page">
        <div className="settings-title">
          <h1>Your models. Your choice.</h1>
          <Badge>For every Router and Worker</Badge>
        </div>
        <div className="runtime-cards">
          {[
            ["cpu", "Model API", "Cloud services or local model APIs"],
            ["user", "Subscription", "Use supported subscription accounts"],
            ["terminal", "Local CLI", "Reuse CLI sign-in, tools and plugins"],
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
                <span>
                  {active === i ? "Selected" : "Configure independently"}
                </span>
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
                  [
                    "Connect your model service",
                    "Use an existing subscription",
                    "Run your local Codex CLI",
                  ][active]
                }
              </h2>
              <p>
                {
                  [
                    "Choose the protocol, model and parameters for each role.",
                    "Use supported account access under your provider's terms.",
                    "Work through your signed-in CLI and its available tools and plugins.",
                  ][active]
                }
              </p>
            </div>
          </div>
          <div className="runtime-fields">
            {active === 0 ? (
              <>
                <Field
                  label="Protocol"
                  value="OpenAI / Anthropic compatible API"
                />
                <Field
                  label="Service endpoint"
                  value="Cloud endpoint / local model service"
                />
              </>
            ) : active === 1 ? (
              <>
                <Field
                  label="Account provider"
                  value="ChatGPT · Supported subscription"
                />
                <Field
                  label="Access"
                  value="Account sign-in · Existing quota"
                />
              </>
            ) : (
              <>
                <Field label="CLI" value="Codex · native app-server" />
                <Field
                  label="Capabilities"
                  value="Local files · Terminal · MCP plugins"
                />
              </>
            )}
          </div>
        </div>
        <div className="product-summary">
          <Icon name="settings" />
          Mix access methods by role. Match cost to the task.
        </div>
      </div>
    </Shell>
  );
}
function RoleTools({ t }: { t: number }) {
  const worker = t >= 4;
  return (
    <Shell section="Agent team">
      <div className="product-page">
        <div className="settings-title">
          <h1>Every role has its own configuration</h1>
          <Button primary icon={t > 6.5 ? "check" : "settings"}>
            {t > 6.5 ? "Saved" : "Save configuration"}
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
                    <p>{i ? "Executor" : "Coordinator"}</p>
                  </div>
                  <Icon name="chevron" size={15} />
                </div>
              ),
            )}
            <div className="role-independent">
              <Icon name="settings" />
              Models · Prompts · Tools
            </div>
          </div>
          <div className="role-editor">
            <h2>
              <Icon name={worker ? "cpu" : "flow"} />
              {worker ? "Research" : "Router"}
            </h2>
            <div className="role-backend">
              <Field
                label="Model connection"
                value={
                  worker
                    ? "Model API · gpt-6.1-sol"
                    : "Model API · gpt-6.1-terra"
                }
                select
              />
              <Field
                label="Reasoning"
                value={worker ? "High · Optional" : "Medium · Optional"}
                select
              />
            </div>
            <label className="product-label">Role instructions</label>
            <div className="prompt-editor">
              {worker ? (
                <>
                  Reproduce issues and gather evidence.
                  <br />
                  Use approved browser and file tools.
                  <br />
                  Report findings, evidence and blockers to Router.
                </>
              ) : (
                <>
                  Be the user's assistant and the team's coordinator.
                  <br />
                  Identify work within the approved scope. Manage Workers.
                  <br />
                  Review evidence, report back, and respect human stop requests.
                </>
              )}
            </div>
            <label className="product-label">Tool access</label>
            <div className="tool-permissions">
              {[
                worker ? "Browser control" : "Create and manage Workers",
                "Files and terminal",
                "App plugins / MCP",
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
              Each role can use a model API, supported subscription or local
              CLI.
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
function Ecosystem({ t }: { t: number }) {
  return (
    <Shell section="Tools and apps">
      <div className="product-page">
        <div className="settings-title">
          <h1>Connect where work happens</h1>
          <Button icon="plus">Add plugin / MCP</Button>
        </div>
        <div className="app-integrations">
          {["Slack", "Linear", "MCP"].map((app, i) => (
            <section data-app={app} key={app} style={reveal(t, 0.2 + i * 0.4)}>
              <AppMark app={app} />
              <div>
                <h2>{app}</h2>
                <p>
                  {
                    [
                      "Channels and conversations",
                      "Issues and projects",
                      "Your tools and applications",
                    ][i]
                  }
                </p>
              </div>
              <Badge>{"Plugin / MCP"}</Badge>
            </section>
          ))}
        </div>
        <div className="ecosystem-map">
          <div className="connected-scopes">
            <label className="product-label">Channels and projects</label>
            {[
              ["Slack", "#product-engineering"],
              ["Slack", "#customer-support"],
              ["Linear", "Commerce / Export reliability"],
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
            <p>Understand · Delegate · Follow up · Report</p>
            <div className="scope-policy">
              <Icon name="check" size={17} />
              Handle work within the approved scope
            </div>
            <Button primary icon={t > 6.5 ? "check" : "settings"}>
              {t > 6.5 ? "Scope saved" : "Save scope"}
            </Button>
          </div>
        </div>
        <div className="product-summary">
          <Icon name="plug" />
          Connect more apps through adapters and MCP. Coordinate across
          discussions.
        </div>
      </div>
    </Shell>
  );
}
function Local({ t }: { t: number }) {
  const command =
    "git clone https://github.com/pythc/agent-hub.git\ncd agent-hub\nnpm ci\n./start.sh";
  return (
    <Shell section="Workspace settings" dark>
      <div className="product-page local-page">
        <div className="settings-title">
          <h1>Local first. Open source.</h1>
          <Badge>YOUR AI TEAM</Badge>
        </div>
        <div className="local-layout">
          <div>
            <div className="local-brand">
              <Logo size={47} />
              <span>Roppo</span>
            </div>
            <h2>Make this AI team yours.</h2>
            <p>
              Your models, roles, instructions and tools.
              <br />
              Configured for the way you work.
            </p>
            <div className="local-properties">
              {[
                ["folder", "Workspace state stays on your machine"],
                ["cpu", "Cloud or local model connections"],
                ["code", "Open source. Deploy and extend it yourself."],
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
              <span>Deploy Roppo</span>
              <Icon name="code" size={16} />
            </div>
            <pre>{typeText(command, t, 0.8, 3.7)}</pre>
            {t > 4.7 && (
              <div className="local-ready" style={reveal(t, 4.7)}>
                <Icon name="check" />
                Workspace ready
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
