import { ProductScene, isProductKind, type ProductKind } from "./ProductScenes";
import { Slack } from "./Slack";
import { Linear } from "./Linear";
import { BrandMark } from "./Brands";
import "./english.css";
import {
  AbsoluteFill,
  CanvasImage,
  Interactive,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Badge,
  Button,
  Composer,
  Field,
  Icon,
  Logo,
  ResourceTabs,
  RouterMessage,
  Shell,
  ToolRow,
} from "./UI";
import {
  Camera,
  Cursor,
  Focus,
  Point,
  clamp,
  ease,
  reveal,
  typeText,
  wide,
} from "../motion";

type Kind =
  | ProductKind
  | "intro"
  | "access"
  | "connect"
  | "team"
  | "inbox"
  | "route"
  | "work"
  | "browser"
  | "files"
  | "control"
  | "delivery"
  | "outro"
  | "linear-intake"
  | "linear-review";
type SceneProps = {
  kind: Kind;
  title: string;
  caption: string;
  dark?: boolean;
};
const path = (points: number[][]): Point[] =>
  points.map(([t, x, y]) => ({ t, x, y }));
const focus = (points: number[][]): Focus[] =>
  points.map(([t, x, y, z]) => ({ t, x, y, z }));
const shots: Record<
  Kind,
  { camera: Focus[]; mouse: Point[]; clicks: number[] }
> = {
  positioning: { camera: wide, mouse: [], clicks: [] },
  runtimes: {
    camera: wide,
    mouse: path([
      [0, 350, 300],
      [2.5, 760, 255],
      [4.8, 1175, 255],
      [7, 1175, 255],
    ]),
    clicks: [2.5, 4.8],
  },
  roletools: {
    camera: wide,
    mouse: path([
      [0, 900, 450],
      [4, 260, 315],
      [6.5, 1328, 124],
      [7.2, 1328, 124],
    ]),
    clicks: [4, 6.5],
  },
  ecosystem: {
    camera: wide,
    mouse: path([
      [0, 900, 400],
      [3, 355, 445],
      [6.5, 1047, 592],
      [8, 1047, 592],
    ]),
    clicks: [6.5],
  },
  decision: {
    camera: wide,
    mouse: path([
      [0, 340, 330],
      [2.5, 750, 330],
      [4.7, 1170, 330],
      [7, 1334, 695],
      [8.4, 1334, 695],
    ]),
    clicks: [2.5, 4.7, 7],
  },
  listening: { camera: wide, mouse: [], clicks: [] },
  local: { camera: wide, mouse: [], clicks: [] },
  intro: { camera: wide, mouse: [], clicks: [] },
  access: {
    camera: focus([
      [0, 720, 405, 1],
      [0.7, 720, 405, 1],
      [1.5, 1060, 430, 1.35],
      [4.9, 1060, 430, 1.35],
      [5.7, 720, 405, 1],
    ]),
    mouse: path([
      [0, 760, 630],
      [1, 976, 356],
      [2.3, 976, 453],
      [4.2, 1080, 586],
      [5, 1080, 586],
    ]),
    clicks: [1, 2.3, 4.2],
  },
  connect: {
    camera: focus([
      [0, 720, 405, 1],
      [1.2, 720, 405, 1],
      [2.2, 625, 390, 1.2],
      [5.8, 625, 390, 1.2],
      [7.5, 720, 405, 1],
    ]),
    mouse: path([
      [0, 900, 590],
      [0.9, 300, 200],
      [2.3, 525, 391],
      [4.2, 695, 480],
      [5.5, 251, 631],
      [6.8, 251, 631],
    ]),
    clicks: [0.9, 2.3, 4.2, 5.5],
  },
  team: {
    camera: focus([
      [0, 720, 405, 1],
      [1.1, 720, 405, 1],
      [2.2, 1100, 420, 1.3],
      [4.3, 1100, 420, 1.3],
      [5.3, 560, 480, 1.1],
      [7.5, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1070, 300],
      [1.5, 1124, 515],
      [3.4, 1124, 606],
      [4.9, 385, 560],
      [6.5, 1124, 756],
    ]),
    clicks: [1.5, 3.4, 4.9, 6.5],
  },
  "linear-intake": {
    camera: wide,
    mouse: path([
      [0, 1030, 660],
      [2.2, 920, 267],
      [6, 1260, 278],
      [8, 1260, 278],
    ]),
    clicks: [],
  },
  "linear-review": {
    camera: focus([
      [0, 720, 405, 1],
      [1, 720, 405, 1],
      [2.5, 900, 410, 1.13],
      [7, 900, 410, 1.13],
      [8.8, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1200, 500],
      [2, 1100, 365],
      [5.5, 733, 561],
      [8, 733, 561],
    ]),
    clicks: [],
  },
  inbox: {
    camera: focus([
      [0, 720, 405, 1],
      [1, 720, 405, 1],
      [2.5, 940, 560, 1.08],
      [7.8, 940, 500, 1.08],
      [10.8, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1100, 720],
      [0.7, 760, 691],
      [3.5, 1373, 758],
      [7, 870, 468],
      [9.7, 700, 500],
      [10.5, 700, 500],
    ]),
    clicks: [0.7, 3.5, 9.7],
  },
  route: {
    camera: focus([
      [0, 720, 405, 1],
      [1.8, 720, 405, 1],
      [3, 740, 340, 1.18],
      [5.5, 740, 340, 1.18],
      [6.7, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1200, 640],
      [1.3, 600, 250],
      [4, 1319, 31],
      [5.8, 1060, 91],
    ]),
    clicks: [4, 5.8],
  },
  work: {
    camera: focus([
      [0, 720, 405, 1],
      [1, 720, 405, 1],
      [2.3, 1090, 410, 1.32],
      [8.6, 1090, 410, 1.32],
      [10.5, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1050, 90],
      [1.5, 1102, 92],
      [3, 1055, 280],
      [7.5, 1223, 445],
      [9.8, 1070, 90],
    ]),
    clicks: [1.5],
  },
  browser: {
    camera: focus([
      [0, 720, 405, 1],
      [0.9, 720, 405, 1],
      [2, 1100, 440, 1.3],
      [3.5, 1100, 540, 1.3],
      [6.9, 1100, 540, 1.3],
      [8.7, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1050, 90],
      [0.65, 992, 92],
      [2.3, 1368, 372],
      [4.3, 1386, 779],
      [6.7, 1372, 779],
      [8, 1372, 779],
    ]),
    clicks: [0.65, 2.3, 4.3, 6.7],
  },
  files: {
    camera: focus([
      [0, 720, 405, 1],
      [1.4, 720, 405, 1],
      [2.3, 1110, 440, 1.35],
      [6.2, 1110, 440, 1.35],
      [7.7, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1025, 90],
      [0.8, 894, 90],
      [2, 1141, 188],
      [5.1, 1141, 275],
      [6.5, 1141, 275],
    ]),
    clicks: [0.8, 2, 5.1],
  },
  control: {
    camera: focus([
      [0, 720, 405, 1],
      [1, 720, 405, 1],
      [2.2, 765, 490, 1.18],
      [5, 765, 490, 1.18],
      [6.8, 1070, 390, 1.14],
      [8.8, 720, 405, 1],
    ]),
    mouse: path([
      [0, 680, 720],
      [0.8, 520, 687],
      [2.8, 773, 755],
      [4.8, 520, 687],
      [6.6, 773, 755],
      [8, 1100, 410],
    ]),
    clicks: [0.8, 2.8, 4.8, 6.6],
  },
  delivery: {
    camera: focus([
      [0, 720, 405, 1],
      [1.2, 720, 405, 1],
      [2.5, 960, 455, 1.08],
      [7.5, 960, 455, 1.08],
      [8.8, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1100, 700],
      [2.5, 820, 458],
      [5.3, 760, 691],
      [6.6, 1373, 758],
      [8, 1373, 758],
    ]),
    clicks: [5.3, 6.6],
  },
  outro: { camera: wide, mouse: [], clicks: [] },
};
const Intro = ({ t, outro = false }: { t: number; outro?: boolean }) => (
  <AbsoluteFill
    style={{
      background: outro ? "#111" : "#fafafa",
      color: outro ? "#f5f5f5" : "#171717",
    }}
  >
    <div
      className="intro-wrap"
      style={{ opacity: clamp(t / 0.65), scale: 0.97 + 0.03 * ease(t / 1.6) }}
    >
      <div className="intro-brand">
        <div style={{ filter: outro ? "invert(1)" : undefined }}>
          <Logo size={112} />
        </div>
        <span>Roppo</span>
      </div>
      <div
        className="intro-tagline"
        style={{ color: outro ? "#a8a8a8" : "#666", ...reveal(t, 0.7) }}
      >
        {outro
          ? "From conversation to work, handled."
          : "One conversation. Your entire AI team."}
      </div>
      <div
        style={{
          fontSize: 21,
          color: outro ? "#8d8d8d" : "#8c8c8c",
          marginTop: 27,
          ...reveal(t, 1.3),
        }}
      >
        {outro
          ? "Local first · Open source · Your AI team"
          : "Your 24/7 assistant. Your team's coordination hub."}
      </div>
    </div>
    <div
      className="intro-foot"
      style={{ left: 0, right: 0, textAlign: "center" }}
    >
      YOUR MULTI-AGENT WORKSPACE
    </div>
  </AbsoluteFill>
);
function Access({ t }: { t: number }) {
  return (
    <div
      data-scene="access"
      style={{ position: "relative", width: 1440, height: 810 }}
    >
      <CanvasImage
        src={staticFile("captures/login.png")}
        style={{ width: 1440, height: 810 }}
      />
      <div
        style={{
          position: "absolute",
          right: 48,
          top: 40,
          background: "white",
          padding: "3px 18px",
          fontSize: 13,
        }}
      >
        EN
      </div>
      <div style={{ position: "absolute", left: 895, top: 345, fontSize: 14 }}>
        {typeText("Alex", t, 1.05, 0.7)}
      </div>
      <div
        style={{
          position: "absolute",
          left: 895,
          top: 440,
          fontSize: 18,
          letterSpacing: 3,
        }}
      >
        {typeText("••••••••••", t, 2.35, 0.9)}
      </div>
      {t > 4.2 && (
        <div
          style={{
            position: "absolute",
            left: 882,
            top: 561,
            width: 384,
            height: 48,
            borderRadius: 7,
            background: "#171717",
            color: "white",
            display: "grid",
            placeItems: "center",
            fontSize: 14,
          }}
        >
          Opening your workspace…
        </div>
      )}
    </div>
  );
}
function Connect({ t }: { t: number }) {
  return (
    <Shell section="Model connections">
      <div className="settings-page">
        <div className="settings-title">
          <h1>New model connection</h1>
          <Button>Back to connections</Button>
        </div>
        <div className="connection-kinds">
          {[
            ["cpu", "Model API"],
            ["user", "Subscription"],
            ["terminal", "CLI"],
          ].map(([i, l], n) => (
            <div
              className={
                "connection-kind " + (n === 0 && t > 0.9 ? "active" : "")
              }
              key={i}
            >
              <Icon name={i} />
              <strong>{l}</strong>
            </div>
          ))}
        </div>
        <div className="connection-form" style={reveal(t, 1.1)}>
          <Field label="Connection name" value="Team model service" />
          <Field
            label="API endpoint"
            value={typeText("https://api.example.com/v1", t, 2.4, 1.1)}
            active={t > 2.3 && t < 4}
          />
          <div className="field-pair">
            <Field label="Protocol" value="OpenAI Responses" select />
            <Field
              label="Default model"
              value={typeText("gpt-6.1-terra", t, 4.3, 0.7)}
              active={t > 4.2 && t < 5.3}
            />
          </div>
          <Field
            label="API key environment variable"
            value="ROPPO_MODEL_API_KEY"
          />
          <div className="form-actions">
            <Button primary icon={t > 6.1 ? "check" : "plus"}>
              {t > 6.1 ? "Connection saved" : "Check and save"}
            </Button>
            {t > 6.1 && (
              <span className="success-line" style={reveal(t, 6.1)}>
                <Icon name="check" size={16} />
                Available to Router and Workers
              </span>
            )}
          </div>
          <div className="mode-indicator">
            <Icon name="settings" size={16} />
            <span>Choose a model and parameters for each agent</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
function TeamConfig({ t }: { t: number }) {
  const worker = t > 4.9;
  return (
    <Shell section="Agent team">
      <div className="settings-page">
        <div className="settings-title">
          <h1>Agent team</h1>
          <Button icon="plus">New model connection</Button>
        </div>
        <div className="tabs" style={{ width: 250, marginBottom: 24 }}>
          <span>Activity</span>
          <span className="selected">Configure team</span>
        </div>
        <div className="team-config-grid">
          <div className="team-map">
            <div className="team-intro">
              <Icon name="chat" size={18} />
              You and your team
            </div>
            <div className={"team-node " + (!worker ? "active" : "")}>
              <div className="node-symbol">
                <Icon name="flow" />
              </div>
              <div>
                <strong>Router</strong>
                <p>Coordinate work · Bring results together</p>
                <p>gpt-6.1-terra</p>
              </div>
              <Icon name="chevron" size={17} />
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                padding: "5px 20px 14px",
              }}
            >
              Delegate tasks · Receive results
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>
                Executor <span className="muted small">4 / 10</span>
              </strong>
              <Button icon="plus">Add Worker</Button>
            </div>
            <div className="worker-configs">
              {["Research", "Build", "Review", "Report"].map((n, i) => (
                <div
                  className={"team-node " + (worker && i === 0 ? "active" : "")}
                  key={n}
                >
                  <div className="node-symbol">
                    <Icon name="cpu" size={18} />
                  </div>
                  <div>
                    <strong>{n}</strong>
                    <p>gpt-6.1-sol</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="team-inspector">
            <h2>
              <Icon name={worker ? "cpu" : "flow"} />
              {worker ? "Research" : "Router"}
            </h2>
            <div className="tabs">
              <span className="selected">Basics</span>
              <span>Tools</span>
              <span>Advanced</span>
            </div>
            <Field
              label="Model connections"
              value="Team model service"
              select
            />
            <Field
              label="Model"
              value={worker ? "gpt-6.1-sol" : "gpt-6.1-terra"}
              active={!worker && t > 1.5 && t < 3}
            />
            <Field
              label="Reasoning effort"
              value={worker ? "High" : "Medium"}
              select
              active={t > 3.4 && t < 4.8}
            />
            <Field
              label="Responsibility"
              value={
                worker
                  ? "Reproduce issues and gather evidence"
                  : "Understand, delegate and review work"
              }
            />
            <Button primary icon={t > 6.5 ? "check" : "settings"}>
              {t > 6.5 ? "Saved" : "Save configuration"}
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
const job =
  "The order export amounts are wrong. Please fix them, keep the format, and have it ready tomorrow.";
function TeamActivity({
  t,
  paused = false,
  resumed = false,
}: {
  t: number;
  paused?: boolean;
  resumed?: boolean;
}) {
  const progress = t > 7,
    complete = t > 9;
  const names = ["Research", "Build", "Review", "Report"],
    tasks = [
      "Reproduce amount conversion",
      "Fix units and edge cases",
      "Test exports and refunds",
      "Summarize changes and evidence",
    ];
  return (
    <>
      <ResourceTabs active="Team activity" />
      <div className="panel-content">
        <div className="panel-heading">
          <span>Team activity</span>
          <Badge>
            {paused
              ? "Paused"
              : resumed
                ? "Resumed"
                : complete
                  ? "Summarizing"
                  : "Running"}
          </Badge>
        </div>
        <div className="router-node">
          <Logo size={27} />
          <div>
            <strong>Router</strong>
            <p>gpt-6.1-terra · Medium</p>
          </div>
          <div>{paused ? "Waiting to resume" : "Coordinating"}</div>
        </div>
        <svg
          viewBox="0 0 556 390"
          style={{
            position: "absolute",
            left: 22,
            top: 100,
            width: 556,
            height: 390,
            overflow: "visible",
          }}
        >
          {[125, 415, 125, 415].map((x, i) => {
            const d =
              i < 2
                ? `M278 35V65Q278 80 ${x} 80V112`
                : `M278 35V235Q278 250 ${x} 250V280`;
            return (
              <g key={i}>
                <path
                  d={d}
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth={1.3}
                />
                {!paused && !complete && !(progress && i < 2) && (
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--text)"
                    strokeWidth={1.8}
                    strokeDasharray="18 420"
                    strokeDashoffset={
                      ((progress ? 1 : -1) * (t * 70 + i * 85)) % 438
                    }
                    opacity={0.65}
                  />
                )}
              </g>
            );
          })}
        </svg>
        <div className="worker-grid">
          {names.map((n, i) => {
            const done = complete || (progress && i < 2),
              active = !paused && !done && t > i * 0.7;
            return (
              <div
                key={n}
                className={"worker-card " + (active ? "running" : "")}
                style={reveal(t, i * 0.3)}
              >
                <header>
                  <Icon name="cpu" size={17} />
                  {n}
                </header>
                <div className="worker-status">
                  <Icon
                    name={
                      paused
                        ? "pause"
                        : done
                          ? "check"
                          : active
                            ? "terminal"
                            : "clock"
                    }
                    size={14}
                  />
                  {paused
                    ? "Stopped"
                    : done
                      ? "Completed"
                      : active
                        ? "Running"
                        : "Waiting"}
                </div>
                <p>{tasks[i]}</p>
              </div>
            );
          })}
        </div>
        <div className="activity-list">
          <div className="activity-row">
            <Icon name="flow" size={14} />
            <strong>Router</strong>assigned 4 tasks<time>09:42</time>
          </div>
          {t > 2 && (
            <div className="activity-row" style={reveal(t, 2)}>
              <Icon name="globe" size={14} />
              <strong>Research</strong>opened the browser<time>09:42</time>
            </div>
          )}
          {t > 5 && (
            <div className="activity-row" style={reveal(t, 5)}>
              <Icon name="file" size={14} />
              <strong>Build</strong>updated export logic<time>09:43</time>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
function BrowserPanel({ t }: { t: number }) {
  const human = t >= 4.3 && t < 6.7;
  return (
    <>
      <ResourceTabs active="Browser" />
      <div className="browser-profile">
        <span>Research's browser</span>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Badge>Isolated profile</Badge>
          <Icon name="settings" size={16} />
        </div>
      </div>
      <div className="browser-controls">
        <Icon name="chevron" size={16} style={{ rotate: "180deg" }} />
        <Icon name="refresh" size={16} />
        <div className="address">
          <Icon name="lock" size={13} />
          orders.demo.local
        </div>
      </div>
      <div className="browser-tab">
        <Icon name="globe" size={14} />
        Orders dashboard
        <Icon name="close" size={12} />
      </div>
      <div className="browser-website">
        <div className="website-header">
          <strong>Order management</strong>
          <span style={{ fontSize: 12, color: "#777" }}>Alex · Signed in</span>
        </div>
        <div className="orders-header">
          <span>All orders</span>
          <Button primary icon="file">
            Export report
          </Button>
        </div>
        <table className="orders-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ORD-1042", "$ 128.00", "Completed"],
              ["ORD-1043", "$ 256.50", "Completed"],
              ["ORD-1044", "$ 89.00", "Refunded"],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((c) => (
                  <td key={c}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {t > 2.3 && (
          <div className="browser-notice" style={reveal(t, 2.3)}>
            <Icon name="file" size={17} />
            <div>
              <strong>orders-export.csv</strong>
              <div style={{ color: "#777" }}>
                Export ready. Checking amount formatting.
              </div>
            </div>
          </div>
        )}
        {human && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: "2px solid #555",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div className="browser-owner">
        <span>
          <Icon name={human ? "hand" : "cpu"} size={15} />
          {human ? "Your control · Worker paused" : "Research is in control"}
        </span>
        <Button icon={human ? "play" : "hand"}>
          {human ? "Return to Worker" : "Take over"}
        </Button>
      </div>
    </>
  );
}
function FilesPanel({ t }: { t: number }) {
  const report = t > 5.1;
  const lines = [
    "export function toExportRow(order) {",
    "  return {",
    "    id: order.id,",
    "    amount: formatAmount(order.amountCents),",
    "    refund: formatAmount(order.refundCents),",
    "    status: order.status,",
    "  };",
    "}",
  ];
  return (
    <>
      <ResourceTabs active="Files" />
      <div className="file-toolbar">
        <Icon name="folder" size={17} />
        Order export fix
        <Icon name="down" size={14} />
      </div>
      {[
        "export-orders.ts",
        "export-orders.test.ts",
        "verification-report.md",
      ].map((n, i) => (
        <div
          className={
            "file-row " + ((report ? i === 2 : i === 0) ? "selected" : "")
          }
          key={n}
        >
          <Icon name="file" size={16} />
          <span>{n}</span>
          <span className="muted">{i === 2 ? "Added" : "Modified"}</span>
        </div>
      ))}
      {!report ? (
        <>
          <div
            className="file-toolbar"
            style={{ fontSize: 12, color: "var(--muted)" }}
          >
            src / exports / export-orders.ts
          </div>
          <div className="code-view">
            {lines.map((line, i) => (
              <div
                className={"code-line " + (i === 3 || i === 4 ? "added" : "")}
                key={i}
              >
                <span className="number">{i + 1}</span>
                {line}
              </div>
            ))}
          </div>
          <div className="file-result">
            <div>
              <Icon name="check" size={16} />
              <strong>Regression checks complete</strong>
            </div>
            <div className="muted">12 / 12 checks passed</div>
          </div>
        </>
      ) : (
        <div style={{ padding: "25px 25px", fontSize: 14, lineHeight: 1.9 }}>
          <h2 style={{ fontSize: 21, margin: "0 0 20px" }}>
            Order export · Verification
          </h2>
          <strong>Changes</strong>
          <p>
            Normalized amounts; preserved the export format.
            <br />
            Covered refunds and invalid amounts.
          </p>
          <strong>Evidence</strong>
          <p>
            Browser reproduction and comparison
            <br />
            Sample export files
            <br />
            12 regression test results
          </p>
          <div className="pause-notice">
            <Icon name="user" size={16} />
            Ready for your review. Not deployed.
          </div>
        </div>
      )}
    </>
  );
}
function Chat({
  t,
  stage,
  dark = false,
}: {
  t: number;
  stage: "route" | "work" | "browser" | "files" | "control";
  dark?: boolean;
}) {
  const paused = stage === "control" && t >= 2.8 && t < 6.6,
    resumed = stage === "control" && t >= 6.6;
  const showPanel = stage !== "route" || t > 4;
  const controlInput =
    stage === "control"
      ? t < 2.8
        ? typeText("Pause here. Also check partial refunds.", t, 0.9, 1.4)
        : t < 6.6
          ? typeText("Continue with that scope.", t, 4.9, 1.2)
          : ""
      : "";
  return (
    <Shell history dark={dark} panel title="Incorrect order export amounts">
      <div className="transcript">
        <div className="message-scroll">
          <div className="entry-tag">
            <BrandMark app="Slack" size={17} />
            Slack · #product-engineering · ENG-248
          </div>
          <div className="user-bubble">{job}</div>
          <RouterMessage>
            {stage === "route" ? (
              <>
                <p>
                  {typeText(
                    "I've picked this up within the channel's approved scope. I'll reproduce, fix and verify it, then report back to this Slack thread. You can stop me anytime.",
                    t,
                    0.6,
                    2.5,
                  )}
                </p>
                {t > 3.3 && (
                  <div className="pause-notice" style={reveal(t, 3.3)}>
                    <Icon name="check" size={16} />
                    Task accepted · Preserve the existing format
                  </div>
                )}
              </>
            ) : stage === "control" ? (
              <>
                <p>Your progress and generated files are preserved.</p>
                {t >= 2.8 && (
                  <div className="user-bubble" style={{ margin: "16px 0 0" }}>
                    Pause here. Also check partial refunds.
                  </div>
                )}
                {paused && (
                  <div className="pause-notice" style={reveal(t, 2.8)}>
                    <Icon name="pause" size={17} />
                    <div>
                      <strong>Execution stopped</strong>
                      <br />
                      <span className="muted">
                        Waiting for the updated scope.
                      </span>
                    </div>
                  </div>
                )}
                {resumed && (
                  <>
                    <div className="user-bubble" style={{ margin: "16px 0 0" }}>
                      Continue with that scope.
                    </div>
                    <p style={{ marginTop: 17, ...reveal(t, 6.6) }}>
                      Resumed the same task, with partial-refund checks added.
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <p>
                  I've delegated four workstreams and will review the results
                  together.
                </p>
                <ol>
                  <li>Research: reproduce and diagnose</li>
                  <li>Build: fix amount handling</li>
                  <li>Review: run independent checks</li>
                  <li>Report: assemble evidence</li>
                </ol>
              </>
            )}
          </RouterMessage>
          {stage !== "route" && stage !== "control" && (
            <>
              <ToolRow name="worker_manage" detail="assign × 4" done />
              <ToolRow
                name={
                  stage === "browser"
                    ? "browser_navigate"
                    : stage === "files"
                      ? "read_file"
                      : "worker_result"
                }
                detail={
                  stage === "browser"
                    ? "Research"
                    : stage === "files"
                      ? "Verification report"
                      : "Waiting for Workers"
                }
                done={stage === "files"}
              />
              {stage === "files" && (
                <RouterMessage>
                  <p>
                    The fix and evidence are ready. I'll update ENG-248 in
                    Linear and report back to Slack.
                  </p>
                </RouterMessage>
              )}
            </>
          )}
        </div>
        <Composer
          text={controlInput}
          sending={stage === "work" || stage === "browser"}
        />
      </div>
      {showPanel && (
        <aside
          className="resource-panel"
          style={stage === "route" ? reveal(t, 4) : {}}
        >
          {stage === "browser" ? (
            <BrowserPanel t={t} />
          ) : stage === "files" ? (
            <FilesPanel t={t} />
          ) : (
            <TeamActivity
              t={
                stage === "control"
                  ? resumed
                    ? 8
                    : 4
                  : stage === "route"
                    ? t - 4
                    : t
              }
              paused={paused}
              resumed={resumed}
            />
          )}
        </aside>
      )}
      {stage === "route" && t < 3.4 && (
        <div className="stage-toast" style={reveal(t, 0.2)}>
          <Logo size={26} />
          <div>
            <strong>New task received</strong>
            <p>Slack · #product-engineering</p>
          </div>
        </div>
      )}
    </Shell>
  );
}
function SceneInner({ kind, title, caption, dark = false }: SceneProps) {
  const frame = useCurrentFrame(),
    { fps } = useVideoConfig(),
    t = frame / fps;
  const shot = shots[kind];
  if (kind === "intro" || kind === "outro")
    return <Intro t={t} outro={kind === "outro"} />;
  const content = isProductKind(kind) ? (
    <ProductScene kind={kind} t={t} />
  ) : kind === "access" ? (
    <Access t={t} />
  ) : kind === "connect" ? (
    <Connect t={t} />
  ) : kind === "team" ? (
    <TeamConfig t={t} />
  ) : kind === "inbox" || kind === "delivery" ? (
    <Slack t={t} delivery={kind === "delivery"} />
  ) : kind === "linear-intake" || kind === "linear-review" ? (
    <Linear t={t} review={kind === "linear-review"} />
  ) : (
    <Chat t={t} stage={kind} dark={dark} />
  );
  return (
    <AbsoluteFill className="video-root english-video">
      <div className="scene-label">{title}</div>
      <div
        className="stage"
        style={{
          opacity: clamp(t / 0.3),
          translate: `0 ${(1 - ease(t / 0.55)) * 10}px`,
        }}
      >
        <div className="stage-scale">
          <Camera t={t} focus={shot.camera}>
            {content}
            <Cursor t={t} path={shot.mouse} clicks={shot.clicks} />
          </Camera>
        </div>
      </div>
      <div
        className="scene-caption"
        style={{ opacity: clamp((t - 0.3) / 0.5) }}
      >
        {caption}
      </div>
    </AbsoluteFill>
  );
}
export const DemoScene = Interactive.create({
  Component: SceneInner,
  layout: "absolute-fill",
  schema: {
    title: { type: "string", default: "", description: "Scene title" },
    caption: { type: "string", default: "", description: "Caption" },
    dark: { type: "boolean", default: false, description: "Roppo dark theme" },
  },
});
