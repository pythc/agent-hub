import React from "react";
import { CanvasImage, staticFile } from "remotion";

const paths: Record<string, string> = {
  chat: "M3 4h18v13H8l-5 4V4z",
  user: "M4 21v-3a8 8 0 0 1 16 0v3M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  clock: "M12 3a9 9 0 1 1-7 3M3 2v6h6m3-2v6l4 2",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 3a4 4 0 0 1 0 8M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  plug: "M8 2v6m8-6v6M5 8h14v3a7 7 0 0 1-14 0V8zm7 10v4",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6",
  folder: "M3 6h7l2 2h9v13H3V6z",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  plus: "M12 4v16M4 12h16",
  chevron: "m8 4 8 8-8 8",
  down: "m5 9 7 7 7-7",
  search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  panel: "M3 4h18v16H3zM14 4v16",
  sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  moon: "M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10",
  arrow: "M12 20V4m-7 7 7-7 7 7",
  check: "m4 12 5 5L20 6",
  cpu: "M5 5h14v14H5zM9 9h6v6H9zM9 1v4m6-4v4m-6 14v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4",
  terminal: "m4 6 6 6-6 6M13 18h7",
  close: "m5 5 14 14M19 5 5 19",
  file: "M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h6",
  refresh: "M20 4v6h-6m6 0a8 8 0 1 0-1 7",
  hand: "M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 5-3 7-7 7h-1c-2 0-3-1-5-3l-4-5a2 2 0 0 1 3-3l2 2",
  pause: "M8 4v16M16 4v16",
  play: "m8 4 12 8-12 8V4z",
  inbox: "M4 4h16l2 12v4H2v-4L4 4zM2 15h6l2 3h4l2-3h6",
  flow: "M4 5h6v5H4zM14 14h6v5h-6zM7 10v5a2 2 0 0 0 2 2h5M10 7h7v4",
  bell: "M6 9a6 6 0 0 1 12 0v7l2 2H4l2-2V9zM10 22h4",
  lock: "M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4",
  code: "m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18",
};
export const Icon = ({
  name,
  size = 19,
  style,
}: {
  name: string;
  size?: number;
  style?: React.CSSProperties;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.55}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    <path d={paths[name] || paths.chat} />
  </svg>
);
export const Logo = ({ size = 32 }: { size?: number }) => (
  <CanvasImage
    className="brand-mark"
    src={staticFile("roppo-mark.png")}
    style={{ width: size, height: size, objectFit: "contain" }}
  />
);
export const Button = ({
  children,
  primary = false,
  icon,
}: {
  children: React.ReactNode;
  primary?: boolean;
  icon?: string;
}) => (
  <div className={"ui-button " + (primary ? "primary" : "")}>
    {icon && <Icon name={icon} size={15} />}
    <span>{children}</span>
  </div>
);
export const Field = ({
  label,
  value,
  active = false,
  select = false,
}: {
  label: string;
  value: string;
  active?: boolean;
  select?: boolean;
}) => (
  <div className="ui-field">
    <label>{label}</label>
    <div className={"input " + (active ? "focused" : "")}>
      {value || <span className="muted">请输入</span>}
      {select && <Icon name="down" size={13} />}
    </div>
  </div>
);
export const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="badge">{children}</span>
);
export const Shell = ({
  children,
  section = "对话",
  history = false,
  dark = false,
  title = "订单导出金额异常",
  panel = false,
}: {
  children: React.ReactNode;
  section?: string;
  history?: boolean;
  dark?: boolean;
  title?: string;
  panel?: boolean;
}) => (
  <div className={"app-ui " + (dark ? "dark" : "")}>
    <aside className="feature-rail">
      <Logo size={23} />
      <div className="rail-items">
        {[
          "user",
          "chat",
          "clock",
          "inbox",
          "team",
          "link",
          "plug",
          "settings",
          "chat",
        ].map((name, i) => (
          <div
            key={i}
            className={
              "rail-item " +
              ((section === "模型连接" && name === "link") ||
              (section === "Agent 团队" && name === "team") ||
              (section === "对话" && i === 1)
                ? "active"
                : "")
            }
          >
            <Icon name={name} />
          </div>
        ))}
      </div>
      <div className="rail-bottom">
        <Icon name="folder" />
        <Icon name="settings" />
        <Icon name="panel" />
        <span className="avatar">A</span>
      </div>
    </aside>
    {history && (
      <aside className="history-rail">
        <div className="history-title">
          对话
          <Icon name="panel" size={17} />
        </div>
        <div className="new-chat">
          <Icon name="plus" size={17} />
          新建会话
          <Icon name="search" size={17} />
        </div>
        <div className="muted small">最近会话</div>
        <div className="history-current">{title}</div>
        <div className="history-item">本周工作计划</div>
        <div className="history-item">产品资料整理</div>
      </aside>
    )}
    <main className="app-main">
      <header className="app-header">
        <span className="muted">{history ? "对话" : "当前工作区"}</span>
        <span className="muted">/</span>
        <strong>{history ? title : section}</strong>
        <div className="header-actions">
          <Icon name="panel" />
          <Icon name={dark ? "sun" : "moon"} />
          <span>EN</span>
        </div>
      </header>
      <div className={"app-content " + (panel ? "with-panel" : "")}>
        {children}
      </div>
    </main>
  </div>
);
export const ResourceTabs = ({ active }: { active: string }) => (
  <div className="resource-tabs">
    {[
      ["folder", "文件"],
      ["globe", "浏览器"],
      ["team", "团队动态"],
    ].map(([i, l]) => (
      <div key={l} className={active === l ? "selected" : ""}>
        <Icon name={i} size={15} />
        {l}
        <Icon name="close" size={11} />
      </div>
    ))}
    <Icon name="plus" size={17} />
  </div>
);
export const Composer = ({
  text = "",
  sending = false,
}: {
  text?: string;
  sending?: boolean;
}) => (
  <div className="composer">
    <div className={text ? "" : "muted"}>{text || "向 Router 发送消息…"}</div>
    <div className="composer-footer">
      <span>Router · gpt-6.1-terra</span>
      <Icon name="settings" size={15} />
      <span className="muted worker-label">
        <Icon name="team" size={15} />4 个 Worker
      </span>
      <div className="send">
        <Icon name={sending ? "pause" : "arrow"} size={19} />
      </div>
    </div>
  </div>
);
export const RouterMessage = ({
  children,
  label = "Router",
}: {
  children: React.ReactNode;
  label?: string;
}) => (
  <div className="router-message">
    <div className="message-author">
      <Logo size={22} />
      <strong>{label}</strong>
    </div>
    <div className="message-copy">{children}</div>
  </div>
);
export const ToolRow = ({
  name,
  detail,
  done = false,
}: {
  name: string;
  detail: string;
  done?: boolean;
}) => (
  <div className="tool-row">
    <Icon name={done ? "check" : "terminal"} size={16} />
    <span>{name}</span>
    <span className="muted">{detail}</span>
    <Icon name="down" size={13} />
  </div>
);
