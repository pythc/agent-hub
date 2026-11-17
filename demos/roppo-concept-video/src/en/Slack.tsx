import type React from "react";
import { BrandMark } from "./Brands";
import { Icon, Logo } from "./UI";
import { reveal, typeText } from "../motion";
import "./integrations.css";

function Avatar({ name, bot = false }: { name: string; bot?: boolean }) {
  return (
    <div
      className={
        "slack-avatar " + (bot ? "bot" : name === "Alex" ? "alex" : "mia")
      }
    >
      {bot ? <Logo size={25} /> : name === "Alex" ? "AL" : "MC"}
    </div>
  );
}
function Message({
  name,
  time,
  children,
  bot = false,
  style,
}: {
  name: string;
  time: string;
  children: React.ReactNode;
  bot?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <article className="slack-message" style={style}>
      <Avatar name={name} bot={bot} />
      <div className="slack-message-body">
        <header>
          <b>{name}</b>
          {bot && <span className="slack-app-badge">APP</span>}
          <time>{time}</time>
        </header>
        {children}
      </div>
    </article>
  );
}
export function Slack({
  t,
  delivery = false,
}: {
  t: number;
  delivery?: boolean;
}) {
  const sent = delivery ? t >= 6.6 : t >= 3.5;
  const typed = delivery
    ? typeText("Thanks! I'll review the change in Linear.", t, 5.4, 1.1)
    : typeText(
        "The order export amounts are wrong. Please fix them and keep the format.",
        t,
        0.9,
        2.4,
      );
  return (
    <div
      className="slack-app"
      data-scene={delivery ? "slack-delivery" : "slack-inbox"}
    >
      <div className="slack-topbar">
        <div className="mac-dots">
          <i />
          <i />
          <i />
        </div>
        <span>←</span>
        <span>→</span>
        <Icon name="clock" size={17} />
        <div className="slack-search">
          <Icon name="search" size={15} />
          Search Acme
        </div>
        <Icon name="user" size={18} />
      </div>
      <div className="slack-layout">
        <aside className="slack-rail">
          <div className="slack-workspace">a</div>
          {[
            ["chat", "Home"],
            ["user", "DMs"],
            ["bell", "Activity"],
            ["folder", "Files"],
            ["plus", "More"],
          ].map(([i, n]) => (
            <div key={n} className={n === "Home" ? "selected" : ""}>
              <Icon name={i} size={23} />
              <span>{n}</span>
            </div>
          ))}
          <div className="slack-rail-bottom">
            <Icon name="plus" size={21} />
            <Avatar name="Alex" />
          </div>
        </aside>
        <aside className="slack-channel-nav">
          <header>
            <b>Acme</b>
            <Icon name="down" size={14} />
            <Icon name="settings" size={17} />
          </header>
          <div className="slack-nav-item">
            <Icon name="chat" size={17} />
            Threads<span>3</span>
          </div>
          <div className="slack-nav-item">
            <Icon name="inbox" size={17} />
            Drafts & sent
          </div>
          <div className="slack-nav-item">
            <Icon name="bell" size={17} />
            Mentions
          </div>
          <label>
            ⌄ &nbsp; Channels <span>+</span>
          </label>
          {[
            "general",
            "product-engineering",
            "customer-support",
            "design",
            "releases",
            "random",
          ].map((n) => (
            <div
              key={n}
              className={
                "slack-channel " + (n === "product-engineering" ? "active" : "")
              }
            >
              <span>#</span>
              {n}
              {n === "customer-support" && <b>2</b>}
            </div>
          ))}
          <label>
            ⌄ &nbsp; Direct messages <span>+</span>
          </label>
          {["Mia Chen", "Jordan Lee", "Sam Rivera"].map((n) => (
            <div key={n} className="slack-channel">
              <i className="slack-online" />
              {n}
            </div>
          ))}
          <label>
            ⌄ &nbsp; Apps <span>+</span>
          </label>
          <div className="slack-channel">
            <Logo size={17} />
            Roppo
          </div>
          <div className="slack-channel">
            <BrandMark app="Linear" size={17} />
            Linear
          </div>
        </aside>
        <main className="slack-channel-main">
          <header className="slack-channel-header">
            <strong># product-engineering</strong>
            <div className="slack-channel-actions">
              <span>12 members</span>
              <Icon name="team" />
              <Icon name="search" />
              <span>•••</span>
            </div>
          </header>
          <div className="slack-channel-tabs">
            <b>
              <Icon name="chat" size={16} />
              Messages
            </b>
            <span>
              <Icon name="file" size={15} />
              Canvas
            </span>
            <span>
              <Icon name="folder" size={15} />
              Files
            </span>
            <Icon name="plus" size={16} />
          </div>
          <div className="slack-date">
            <span>Today</span>
          </div>
          <div className={"slack-messages " + (delivery ? "delivery" : "")}>
            <Message name="Mia" time={delivery ? "9:42 AM" : "9:41 AM"}>
              <p>
                {delivery
                  ? "The export fix is tracked in Linear. Keeping the review in this thread."
                  : "We need the order report for tomorrow’s review. Please keep an eye on the export."}
              </p>
              {delivery && (
                <div className="slack-source-thread">
                  <BrandMark app="Linear" size={16} />
                  ENG-248 · Incorrect order export amounts<span>↗</span>
                </div>
              )}
            </Message>
            {!delivery && sent && (
              <Message name="Alex" time="9:42 AM" style={reveal(t, 3.5)}>
                <p>The order export amounts are wrong.</p>
                {t > 3.9 && (
                  <p style={reveal(t, 3.9)}>
                    Please fix them and keep the existing format.
                  </p>
                )}
                {t > 4.3 && (
                  <p style={reveal(t, 4.3)}>We need it tomorrow morning.</p>
                )}
              </Message>
            )}
            {!delivery && t >= 5.3 && (
              <Message name="Roppo" time="9:42 AM" bot style={reveal(t, 5.3)}>
                <p>
                  On it. I’ll reproduce, fix and verify this within the
                  channel’s approved scope.
                  <br />
                  I’ll track the work in Linear and report back here.
                </p>
                <div
                  className="slack-issue-card"
                  data-slack-issue
                  style={reveal(t, 7.2)}
                >
                  <header>
                    <BrandMark app="Linear" size={18} />
                    <span>Linear</span>
                    <span>↗</span>
                  </header>
                  <b>ENG-248 &nbsp; Incorrect order export amounts</b>
                  <div>
                    <i className="linear-status-dot" />
                    Todo<span className="slack-divider">·</span>
                    <Logo size={14} />
                    Roppo<span className="slack-divider">·</span>Commerce
                  </div>
                </div>
              </Message>
            )}
            {delivery && t >= 0.7 && (
              <Message name="Roppo" time="10:16 AM" bot style={reveal(t, 0.7)}>
                <p>
                  The export fix is ready for review. Amounts now use the
                  correct units, with the original format preserved.
                </p>
                <ul>
                  <li>Partial refunds and edge cases covered</li>
                  <li>12 regression checks passed</li>
                  <li>
                    ENG-248 moved to <b>In Review</b> — not deployed
                  </li>
                </ul>
                <div className="slack-delivery-files">
                  <div data-slack-issue>
                    <BrandMark app="Linear" size={23} />
                    <span>
                      <b>ENG-248</b>
                      <small>Review issue in Linear ↗</small>
                    </span>
                  </div>
                  <div>
                    <Icon name="file" size={24} />
                    <span>
                      <b>verification-report.md</b>
                      <small>Reproduction, changes and test evidence</small>
                    </span>
                  </div>
                </div>
                <div className="slack-reactions">
                  ✅ &nbsp; 1 <span>👀 &nbsp; 1</span>
                </div>
              </Message>
            )}
            {delivery && sent && (
              <Message name="Alex" time="10:17 AM" style={reveal(t, 6.6)}>
                <p>Thanks! I’ll review the change in Linear.</p>
              </Message>
            )}
          </div>
          <div className="slack-composer">
            <div className="slack-format">
              <b>B</b>
              <i>I</i>
              <span>U</span>
              <Icon name="link" size={16} />
              <span>≡</span>
              <Icon name="code" size={17} />
            </div>
            <div className="slack-text-input" data-slack-input>
              {!sent && typed ? (
                typed
              ) : (
                <span>Message #product-engineering</span>
              )}
            </div>
            <div className="slack-compose-bottom">
              <div>
                <Icon name="plus" size={19} />
                <span>Aa</span>
                <span>☺</span>
                <span>@</span>
                <Icon name="file" size={18} />
              </div>
              <div
                className={"slack-send " + (!sent && typed ? "ready" : "")}
                data-slack-send
              >
                <Icon name="play" size={17} />
                <Icon name="down" size={11} />
              </div>
            </div>
          </div>
          <div className="slack-compose-help">
            Shift + Return to add a new line
          </div>
        </main>
      </div>
    </div>
  );
}
