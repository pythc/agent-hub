import React from "react";
import { CanvasImage, staticFile } from "remotion";
import { Icon, Logo } from "./UI";
import { ease, reveal, typeText } from "./motion";
import "./feishu.css";

// Desktop chrome follows the supplied Feishu screenshot. People and work are staged.
const symbols: Record<string, string> = {
  mail: "M3 5h18v14H3zM3 5l9 8 9-8",
  calendar: "M4 5h16v16H4zM4 9h16M8 3v4m8-4v4M9 13h6v5H9z",
  video: "M3 6h13v12H3zM16 10l5-3v10l-5-3",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  book: "M5 4h14v17H5zM8 8h8M8 12h8M8 16h5",
  smile: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 9v1m8-1v1M8 14c2 3 6 3 8 0",
  scissors:
    "M10 8l10 12M10 16 20 4M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M10 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  expand: "M15 3h6v6M21 3l-7 7M9 21H3v-6m0 6 7-7",
  phone:
    "M6 3h4l1 5-3 2c1 3 3 5 6 6l2-3 5 1v4c0 2-1 3-3 3C10 20 4 14 3 6c0-2 1-3 3-3",
  addUser:
    "M3 21v-2a6 6 0 0 1 11-3M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M19 13v8m-4-4h8",
  more: "M4 12h.01M12 12h.01M20 12h.01",
  send: "M3 3l19 9-19 9 4-9-4-9zM7 12h15",
  unread: "M12 3a9 9 0 1 1-9 9 9 9 0 0 1 9-9",
  checkCircle: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0m-13 0 3 3 5-6",
  group:
    "M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a8 8 0 0 1 16 0v3M17 3a4 4 0 0 1 0 8m2 3a6 6 0 0 1 4 6",
  channels: "M3 5h18M3 12h6m5 0h7M3 19h6m5 0h7",
};
function LarkIcon({ name, size = 20 }: { name: string; size?: number }) {
  if (!symbols[name]) return <Icon name={name} size={size} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={symbols[name]} />
    </svg>
  );
}
function Avatar({
  text,
  color = "#438cff",
  group = false,
  bot = false,
  className = "",
}: {
  text?: string;
  color?: string;
  group?: boolean;
  bot?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`fs-avatar ${className} ${bot ? "fs-bot-avatar" : ""}`}
      style={{ background: color }}
    >
      {bot ? (
        <Logo size={24} />
      ) : text === "人事" ? (
        <CanvasImage
          src={staticFile("feishu.ico")}
          style={{ width: 28, height: 28 }}
        />
      ) : group ? (
        <LarkIcon name="group" size={25} />
      ) : (
        text
      )}
    </div>
  );
}
const nav = [
  ["chat", "消息"],
  ["file", "云文档"],
  ["book", "知识库"],
  ["grid", "工作台"],
  ["panel", "多维表格"],
  ["video", "视频会议"],
  ["user", "通讯录"],
  ["calendar", "日历"],
  ["mail", "邮箱"],
];
const channels = [
  {
    name: "产品研发群",
    preview: "Mia：明天评审要用订单报表",
    color: "#06c3a5",
    initials: "产研",
    time: "09:41",
    selected: true,
  },
  {
    name: "林晓",
    preview: "好的，评审前我再核对一遍",
    color: "linear-gradient(140deg,#438aff,#50c58e)",
    initials: "林晓",
    time: "09:38",
  },
  {
    name: "订单系统 · 研发协作",
    preview: "周明：报表格式已同步，辛苦大家",
    color: "#9180ff",
    badge: 2,
    time: "09:32",
  },
  {
    name: "设计评审",
    preview: "Mia：新版方案已经更新到文档",
    color: "#2eb3f9",
    badge: 1,
    time: "09:26",
  },
  {
    name: "本周项目进展",
    preview: "陈晨：下午一起过一下交付清单",
    color: "#388dff",
    time: "09:15",
  },
  {
    name: "飞书人事",
    preview: "待办提醒",
    color: "#fff",
    initials: "人事",
    bot: true,
    time: "08:30",
  },
  {
    name: "发布与回归验证",
    preview: "Mia：测试环境已经准备好",
    color: "#9285ff",
    time: "昨天",
  },
  {
    name: "审批",
    preview: "你的申请已通过审批",
    color: "#ff8a21",
    initials: "✓",
    bot: true,
    time: "昨天",
  },
  {
    name: "项目周会",
    preview: "周明：会议纪要已更新",
    color: "#0cc2a4",
    initials: "周会",
    time: "昨天",
  },
  {
    name: "产品体验反馈",
    preview: "陈晨：收到，我补充到需求文档",
    color: "#418aff",
    time: "昨天",
  },
];
const pinned = [
  ["AI\n助手", "AI 助手", "#9dbb24"],
  ["AI作\n业批", "AI作业批", "#d6a61d"],
  ["数字\n人", "数字人", "#ed3eaa"],
  ["", "豆包工作", "#508dff"],
  ["", "产品团队", "#d77c00"],
  ["项目\n讨论", "项目讨论", "#4c90ff"],
];
function Rail() {
  return (
    <aside className="feishu-rail">
      <div className="fs-window-buttons">
        <i />
        <i />
        <i />
      </div>
      <Avatar text="A" color="#bc9a76" className="fs-self-avatar" />
      <div className="fs-rail-action">
        <LarkIcon name="search" size={22} />
      </div>
      <div className="fs-rail-action">
        <LarkIcon name="plus" size={24} />
      </div>
      <div className="fs-nav">
        {nav.map(([icon, label], i) => (
          <div className={`fs-nav-item ${i === 0 ? "active" : ""}`} key={label}>
            <span className={i === 0 ? "fs-message-symbol" : ""}>
              {i === 0 ? (
                <>
                  <i />
                  <i />
                  <b>5</b>
                </>
              ) : (
                <LarkIcon name={icon} size={21} />
              )}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="fs-rail-footer">
        <LarkIcon name="more" />
        <i />
      </div>
    </aside>
  );
}
function ConversationList({ preview }: { preview: string }) {
  return (
    <aside className="feishu-list">
      <div className="fs-list-title">
        <LarkIcon name="channels" size={22} />
        <strong>消息</strong>
      </div>
      <div className="fs-pinned">
        {pinned.map(([text, name, color], i) => (
          <div key={name}>
            <div
              className={`fs-pin-icon ${i === 3 ? "fs-doubao" : ""} ${i === 5 ? "filled" : ""}`}
              style={{
                color,
                borderColor: color,
                background: i === 5 ? color : undefined,
              }}
            >
              {text || (i === 4 ? <LarkIcon name="group" size={23} /> : null)}
            </div>
            <span>{name}</span>
          </div>
        ))}
      </div>
      <div className="fs-channels">
        {channels.map((c, i) => (
          <div
            className={`feishu-channel ${c.selected ? "active" : ""}`}
            key={c.name}
          >
            <div className="fs-channel-avatar">
              <Avatar text={c.initials} color={c.color} group={!c.initials} />
              {c.badge && <b>{c.badge}</b>}
            </div>
            <div className="fs-channel-copy">
              <div className="fs-channel-title">
                <strong>{c.name}</strong>
                {c.bot && <em>机器人</em>}
                <time>{c.time}</time>
              </div>
              <p>
                {i === 0 && <LarkIcon name="unread" size={14} />}
                {i === 0 ? preview : c.preview}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="fs-list-scrollbar" />
    </aside>
  );
}
function Message({
  children,
  person = "Alex",
  bot = false,
  sent = false,
  style,
  className = "",
}: {
  children: React.ReactNode;
  person?: string;
  bot?: boolean;
  sent?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={`feishu-message ${sent ? "outgoing" : "incoming"} ${className}`}
      style={style}
    >
      <Avatar
        text={sent ? "A" : "米娅"}
        color={
          bot
            ? "#fff"
            : sent
              ? "#bc9a76"
              : "linear-gradient(140deg,#ff3c42,#ed7fab)"
        }
        bot={bot}
      />
      <div className="person-message">
        {!sent && (
          <div className="person-name">
            {person}
            {bot && <span>机器人</span>}
          </div>
        )}
        <div className={`feishu-bubble ${sent ? "sent" : ""}`}>{children}</div>
        {sent && (
          <span className="fs-read">
            <LarkIcon name="checkCircle" size={16} />
          </span>
        )}
      </div>
    </div>
  );
}
function ProjectCard() {
  return (
    <div className="fs-link-card">
      <div className="fs-link-host">
        <span className="fs-github-mark">●</span> github.com <span>···</span>
      </div>
      <div className="fs-link-content">
        <div className="fs-repo-cover">
          <Logo size={22} />
          <strong>Roppo</strong>
          <span>One router. Your team.</span>
          <i />
        </div>
        <div>
          <strong>GitHub - pythc/agent-hub: Roppo</strong>
          <p>
            A personal workspace for your
            <br />
            Router and agent team.
          </p>
        </div>
      </div>
    </div>
  );
}
export function Feishu({
  t,
  delivery = false,
}: {
  t: number;
  delivery?: boolean;
}) {
  const msg = "订单导出金额列有 bug，按现有格式修复，明早要用。";
  const acknowledgement = "收到，我来确认。辛苦！";
  const typing = delivery ? t >= 5.3 && t < 6.6 : t >= 0.8 && t < 3.5;
  const input = delivery
    ? typeText(acknowledgement, t, 5.3, 1)
    : typeText(msg, t, 0.8, 2.2);
  const preview = delivery
    ? t > 1.1
      ? "Roppo：订单导出问题已修复，供你确认"
      : "继续处理，并补上退款订单的检查"
    : t > 5
      ? "Roppo：已接手，完成后在群里报告"
      : t > 3.5
        ? msg
        : "Mia：明天评审要用订单报表";
  return (
    <div className="feishu">
      <Rail />
      <ConversationList preview={preview} />
      <main className="feishu-main">
        <header className="feishu-header">
          <Avatar text="产研" color="#06c3a5" />
          <div className="fs-header-name">
            <strong>
              产品研发群 <span>12</span>
            </strong>
            <small>产品研发项目组&nbsp; | &nbsp;订单系统与交付协作</small>
          </div>
          <div className="fs-header-tools">
            {["globe", "search", "phone", "addUser", "calendar", "more"].map(
              (n) => (
                <LarkIcon name={n} key={n} />
              ),
            )}
          </div>
        </header>
        <div className="feishu-messages">
          <div
            className="fs-message-flow"
            style={{
              translate: delivery
                ? `0 ${-118 * ease((t - 1.1) / 0.65) - 26 * ease((t - 6.6) / 0.5)}px`
                : `0 ${-48 * ease((t - 8.9) / 0.55)}px`,
            }}
          >
            {!delivery && (
              <>
                <Message sent className="fs-project-message">
                  <ProjectCard />
                </Message>
                <div className="chat-date">今天 09:41</div>
                <Message person="Mia">
                  明天评审要用订单报表，大家帮忙留意一下。
                </Message>
              </>
            )}
            {delivery && (
              <>
                <div className="chat-date">今天 09:41</div>
                <Message person="Mia">
                  明天评审要用订单报表，大家帮忙留意一下。
                </Message>
              </>
            )}
            {(delivery || t > 3.5) && (
              <Message sent style={delivery ? undefined : reveal(t, 3.5)}>
                {msg}
              </Message>
            )}
            {!delivery && t > 5 && (
              <Message person="Roppo" bot style={reveal(t, 5)}>
                已接手。我会复现、修复并验证，完成后在这里报告。
              </Message>
            )}
            {!delivery && t > 8.9 && (
              <Message person="Mia" style={reveal(t, 8.9)}>
                我继续准备其他评审材料。
              </Message>
            )}
            {delivery && (
              <>
                <div className="chat-date">09:46</div>
                <Message sent>继续处理，并补上退款订单的检查。</Message>
              </>
            )}
            {delivery && t > 1.1 && (
              <Message
                person="Roppo"
                bot
                style={reveal(t, 1.1)}
                className="fs-result-message"
              >
                <strong>订单导出问题已修复，供你确认。</strong>
                <p>
                  金额单位已统一，原有导出列保持不变。
                  <br />
                  退款订单与异常金额已补充检查。
                  <br />
                  回归验证完成，尚未发布到生产。
                </p>
                <div className="message-attachment">
                  <Icon name="file" size={30} />
                  <div>
                    <strong>订单导出 · 修复与验证报告.md</strong>
                    <div className="attachment-meta">
                      变更摘要 · 测试结果 · 复现步骤
                    </div>
                  </div>
                  <Icon name="chevron" size={16} />
                </div>
              </Message>
            )}
            {delivery && t > 6.6 && (
              <Message sent style={reveal(t, 6.6)}>
                {acknowledgement}
              </Message>
            )}
          </div>
        </div>
        <div className={`feishu-composer ${typing ? "is-typing" : ""}`}>
          <div className="feishu-input">
            {typing ? (
              <>
                {input}
                <i
                  className="fs-caret"
                  style={{ opacity: Math.floor(t * 2) % 2 ? 0 : 1 }}
                />
              </>
            ) : (
              <span>发送给 产品研发群</span>
            )}
          </div>
          <div className="fs-compose-tools">
            <span className="fs-format">Aa</span>
            <LarkIcon name="smile" />
            <span className="fs-at">@</span>
            <LarkIcon name="scissors" />
            <LarkIcon name="plus" />
            <LarkIcon name="expand" />
            <span className={`feishu-send ${typing ? "ready" : ""}`}>
              <LarkIcon name="send" size={22} />
            </span>
            <Icon name="down" size={13} />
          </div>
        </div>
      </main>
    </div>
  );
}
