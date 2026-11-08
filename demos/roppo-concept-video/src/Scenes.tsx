import { ProductScene, isProductKind, type ProductKind } from "./ProductScenes";
import { Feishu } from "./Feishu";
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
} from "./motion";

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
  | "outro";
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
  inbox: {
    camera: focus([
      [0, 720, 405, 1],
      [1, 720, 405, 1],
      [2.2, 1000, 560, 1.1],
      [6.8, 1000, 490, 1.1],
      [9.8, 720, 405, 1],
    ]),
    mouse: path([
      [0, 980, 730],
      [0.7, 710, 754],
      [3.5, 1361, 754],
      [6.5, 1000, 425],
      [9, 1000, 425],
    ]),
    clicks: [0.7, 3.5],
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
      [1.4, 720, 405, 1],
      [2.6, 1000, 530, 1.12],
      [6.8, 1000, 530, 1.12],
      [8.7, 720, 405, 1],
    ]),
    mouse: path([
      [0, 1130, 650],
      [3, 740, 470],
      [4.5, 740, 470],
      [5.3, 710, 754],
      [6.6, 1361, 754],
      [7.8, 1361, 754],
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
        {outro ? "消息进来，工作有着落。" : "一个入口，整支 Agent 团队。"}
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
          ? "本地优先 · 开源可部署 · 属于你的 AI 团队"
          : "个人的 24 小时助手 · 组织的智能协作中枢"}
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
    <div style={{ position: "relative", width: 1440, height: 810 }}>
      <CanvasImage
        src={staticFile("captures/login.png")}
        style={{ width: 1440, height: 810 }}
      />
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
          正在进入工作区…
        </div>
      )}
    </div>
  );
}
function Connect({ t }: { t: number }) {
  return (
    <Shell section="模型连接">
      <div className="settings-page">
        <div className="settings-title">
          <h1>新建模型连接</h1>
          <Button>返回模型连接</Button>
        </div>
        <div className="connection-kinds">
          {[
            ["cpu", "API 服务"],
            ["user", "订阅账号"],
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
          <Field label="连接名称" value="团队模型服务" />
          <Field
            label="API 地址"
            value={typeText("https://api.example.com/v1", t, 2.4, 1.1)}
            active={t > 2.3 && t < 4}
          />
          <div className="field-pair">
            <Field label="协议" value="OpenAI Responses" select />
            <Field
              label="默认模型"
              value={typeText("gpt-6.1-terra", t, 4.3, 0.7)}
              active={t > 4.2 && t < 5.3}
            />
          </div>
          <Field label="API 密钥环境变量" value="ROPPO_MODEL_API_KEY" />
          <div className="form-actions">
            <Button primary icon={t > 6.1 ? "check" : "plus"}>
              {t > 6.1 ? "连接已保存" : "检查并保存"}
            </Button>
            {t > 6.1 && (
              <span className="success-line" style={reveal(t, 6.1)}>
                <Icon name="check" size={16} />
                可用于 Router 与 Workers
              </span>
            )}
          </div>
          <div className="mode-indicator">
            <Icon name="settings" size={16} />
            <span>每个 Agent 可独立选择模型与参数</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
function TeamConfig({ t }: { t: number }) {
  const worker = t > 4.9;
  return (
    <Shell section="Agent 团队">
      <div className="settings-page">
        <div className="settings-title">
          <h1>Agent 团队</h1>
          <Button icon="plus">新建模型连接</Button>
        </div>
        <div className="tabs" style={{ width: 184, marginBottom: 24 }}>
          <span>运行记录</span>
          <span className="selected">配置团队</span>
        </div>
        <div className="team-config-grid">
          <div className="team-map">
            <div className="team-intro">
              <Icon name="chat" size={18} />
              你与团队
            </div>
            <div className={"team-node " + (!worker ? "active" : "")}>
              <div className="node-symbol">
                <Icon name="flow" />
              </div>
              <div>
                <strong>Router</strong>
                <p>统筹任务 · 汇总结果</p>
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
              分派任务 · 接收结果
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <strong>
                执行者 <span className="muted small">4 / 10</span>
              </strong>
              <Button icon="plus">添加 Worker</Button>
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
              <span className="selected">基本配置</span>
              <span>工具与管理</span>
              <span>高级参数</span>
            </div>
            <Field label="模型连接" value="团队模型服务" select />
            <Field
              label="模型"
              value={worker ? "gpt-6.1-sol" : "gpt-6.1-terra"}
              active={!worker && t > 1.5 && t < 3}
            />
            <Field
              label="思考强度"
              value={worker ? "高" : "中"}
              select
              active={t > 3.4 && t < 4.8}
            />
            <Field
              label="职责"
              value={
                worker ? "定位问题，收集复现证据" : "理解目标，分派并验收任务"
              }
            />
            <Button primary icon={t > 6.5 ? "check" : "settings"}>
              {t > 6.5 ? "已保存" : "保存配置"}
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
const job = "订单导出金额列有 bug，按现有格式修复，明早要用。";
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
      "复现并定位金额转换",
      "修复单位与边界值",
      "验证导出与退款场景",
      "整理变更和验证证据",
    ];
  return (
    <>
      <ResourceTabs active="团队动态" />
      <div className="panel-content">
        <div className="panel-heading">
          <span>团队动态</span>
          <Badge>
            {paused
              ? "已暂停"
              : resumed
                ? "任务已续接"
                : complete
                  ? "汇总中"
                  : "执行中"}
          </Badge>
        </div>
        <div className="router-node">
          <Logo size={27} />
          <div>
            <strong>Router</strong>
            <p>gpt-6.1-terra · 中</p>
          </div>
          <div>{paused ? "等待继续" : "统筹任务"}</div>
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
                    ? "已停止"
                    : done
                      ? "已完成"
                      : active
                        ? "执行中"
                        : "等待分派"}
                </div>
                <p>{tasks[i]}</p>
              </div>
            );
          })}
        </div>
        <div className="activity-list">
          <div className="activity-row">
            <Icon name="flow" size={14} />
            <strong>Router</strong>分派 4 项工作<time>09:42</time>
          </div>
          {t > 2 && (
            <div className="activity-row" style={reveal(t, 2)}>
              <Icon name="globe" size={14} />
              <strong>Research</strong>打开浏览器复现<time>09:42</time>
            </div>
          )}
          {t > 5 && (
            <div className="activity-row" style={reveal(t, 5)}>
              <Icon name="file" size={14} />
              <strong>Build</strong>更新导出逻辑<time>09:43</time>
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
      <ResourceTabs active="浏览器" />
      <div className="browser-profile">
        <span>Research 的浏览器</span>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Badge>独立环境</Badge>
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
        订单后台
        <Icon name="close" size={12} />
      </div>
      <div className="browser-website">
        <div className="website-header">
          <strong>订单管理</strong>
          <span style={{ fontSize: 12, color: "#777" }}>Alex · 已登录</span>
        </div>
        <div className="orders-header">
          <span>全部订单</span>
          <Button primary icon="file">
            导出报表
          </Button>
        </div>
        <table className="orders-table">
          <thead>
            <tr>
              <th>订单</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ORD-1042", "¥ 128.00", "已完成"],
              ["ORD-1043", "¥ 256.50", "已完成"],
              ["ORD-1044", "¥ 89.00", "已退款"],
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
              <div style={{ color: "#777" }}>已生成报表，正在核对金额格式</div>
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
          {human ? "由你接管 · Worker 已暂停" : "Research 正在操作"}
        </span>
        <Button icon={human ? "play" : "hand"}>
          {human ? "交还 Worker" : "接管"}
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
      <ResourceTabs active="文件" />
      <div className="file-toolbar">
        <Icon name="folder" size={17} />
        订单导出修复
        <Icon name="down" size={14} />
      </div>
      {["export-orders.ts", "export-orders.test.ts", "验证报告.md"].map(
        (n, i) => (
          <div
            className={
              "file-row " + ((report ? i === 2 : i === 0) ? "selected" : "")
            }
            key={n}
          >
            <Icon name="file" size={16} />
            <span>{n}</span>
            <span className="muted">{i === 2 ? "新增" : "已修改"}</span>
          </div>
        ),
      )}
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
              <strong>回归验证完成</strong>
            </div>
            <div className="muted">12 / 12 用例通过 · 演示结果</div>
          </div>
        </>
      ) : (
        <div style={{ padding: "25px 25px", fontSize: 14, lineHeight: 1.9 }}>
          <h2 style={{ fontSize: 21, margin: "0 0 20px" }}>
            订单导出 · 验证报告
          </h2>
          <strong>已处理</strong>
          <p>
            统一金额单位，保留原有导出格式。
            <br />
            覆盖退款订单与异常金额。
          </p>
          <strong>验证证据</strong>
          <p>
            浏览器复现与对照结果
            <br />
            导出文件样本
            <br />
            12 项回归测试记录
          </p>
          <div className="pause-notice">
            <Icon name="user" size={16} />
            等待人工确认，尚未发布。
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
        ? typeText("先停一下，补查退款订单。", t, 0.9, 1.4)
        : t < 6.6
          ? typeText("按这个范围继续。", t, 4.9, 1.2)
          : ""
      : "";
  return (
    <Shell history dark={dark} panel title="订单导出金额异常">
      <div className="transcript">
        <div className="message-scroll">
          <div className="entry-tag">
            <CanvasImage
              src={staticFile("feishu.ico")}
              style={{ width: 17, height: 17 }}
            />
            来自飞书 · 产品研发群
          </div>
          <div className="user-bubble">{job}</div>
          <RouterMessage>
            {stage === "route" ? (
              <>
                <p>
                  {typeText(
                    "已按群聊授权接手。我会复现、修复并验证，完成后自动回原群报告。你可以随时让我停止。",
                    t,
                    0.6,
                    2.5,
                  )}
                </p>
                {t > 3.3 && (
                  <div className="pause-notice" style={reveal(t, 3.3)}>
                    <Icon name="check" size={16} />
                    任务已接收 · 保留原有格式
                  </div>
                )}
              </>
            ) : stage === "control" ? (
              <>
                <p>当前进度和已生成的文件都已保留。</p>
                {t >= 2.8 && (
                  <div className="user-bubble" style={{ margin: "16px 0 0" }}>
                    先停一下，补查退款订单。
                  </div>
                )}
                {paused && (
                  <div className="pause-notice" style={reveal(t, 2.8)}>
                    <Icon name="pause" size={17} />
                    <div>
                      <strong>已停止执行</strong>
                      <br />
                      <span className="muted">等待你确认新的范围。</span>
                    </div>
                  </div>
                )}
                {resumed && (
                  <>
                    <div className="user-bubble" style={{ margin: "16px 0 0" }}>
                      按这个范围继续。
                    </div>
                    <p style={{ marginTop: 17, ...reveal(t, 6.6) }}>
                      已续接原任务，增加退款订单检查。
                    </p>
                  </>
                )}
              </>
            ) : (
              <>
                <p>我把工作拆给四个 Worker，并保留统一验收。</p>
                <ol>
                  <li>Research：复现问题与定位原因</li>
                  <li>Build：修复金额处理逻辑</li>
                  <li>Review：独立回归验证</li>
                  <li>Report：整理报告与证据</li>
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
                      ? "验证报告"
                      : "等待 Worker"
                }
                done={stage === "files"}
              />
              {stage === "files" && (
                <RouterMessage>
                  <p>修复和验证证据已整理完成，结果将自动汇总回原群。</p>
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
            <strong>收到新的工作请求</strong>
            <p>飞书 · 产品研发群</p>
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
    <Feishu t={t} delivery={kind === "delivery"} />
  ) : (
    <Chat t={t} stage={kind} dark={dark} />
  );
  return (
    <AbsoluteFill className="video-root">
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
    title: { type: "string", default: "", description: "镜头标题" },
    caption: { type: "string", default: "", description: "底部字幕" },
    dark: { type: "boolean", default: false, description: "Roppo 深色主题" },
  },
});
