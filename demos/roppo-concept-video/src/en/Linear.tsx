import { BrandMark } from "./Brands";
import { Icon, Logo } from "./UI";
import { reveal } from "../motion";
import "./integrations.css";

export function Linear({ t, review = false }: { t: number; review?: boolean }) {
  const advanced = review ? t >= 2.2 : t >= 3.5;
  const status = review
    ? advanced
      ? "In Review"
      : "In Progress"
    : advanced
      ? "In Progress"
      : "Todo";
  return (
    <div
      className="linear-app"
      data-scene={review ? "linear-review" : "linear-intake"}
    >
      <aside className="linear-sidebar">
        <header>
          <span className="linear-workspace">a</span>
          <b>Acme</b>
          <Icon name="down" size={12} />
          <Icon name="search" size={16} />
          <Icon name="plus" size={17} />
        </header>
        <div>
          <Icon name="inbox" size={16} />
          Inbox <small>3</small>
        </div>
        <div>
          <Icon name="user" size={16} />
          My issues
        </div>
        <label>Workspace</label>
        <div>
          <Icon name="folder" size={16} />
          Projects
        </div>
        <div>
          <Icon name="panel" size={16} />
          Views
        </div>
        <div>
          <Icon name="team" size={16} />
          Teams
        </div>
        <label>Your teams</label>
        <div className="linear-team">
          <span>◆</span>
          <b>Commerce</b>
          <Icon name="down" size={12} />
        </div>
        <div className="linear-nav-indent selected">
          <Icon name="inbox" size={16} />
          Issues
        </div>
        <div className="linear-nav-indent">
          <Icon name="clock" size={16} />
          Cycles
        </div>
        <div className="linear-nav-indent">
          <Icon name="folder" size={16} />
          Projects
        </div>
        <label>Favorites</label>
        <div>
          <span>◈</span>Export reliability
        </div>
        <div className="linear-bottom">
          <Icon name="user" size={16} />
          Invite and manage members
        </div>
      </aside>
      <main className="linear-main">
        <header className="linear-breadcrumb">
          <span>Commerce</span>
          <Icon name="chevron" size={12} />
          <b>ENG-248</b>
          <span className="linear-crumb-menu">•••</span>
          <div>
            <Icon name="link" size={16} />
            <Icon name="bell" size={16} />
            <Icon name="close" size={16} />
          </div>
        </header>
        <div className="linear-workarea">
          <section className="linear-issue">
            <div className="linear-issue-inner">
              <div className="linear-context">
                <BrandMark app="Slack" size={17} />
                Created from #product-engineering
              </div>
              <h1>Incorrect order export amounts</h1>
              <div className="linear-description">
                <p>
                  The amount column in the order export uses the wrong units.
                  <br />
                  Keep the existing CSV structure and have the fix ready for
                  tomorrow’s review.
                </p>
                <h3>Acceptance criteria</h3>
                {[
                  "Correctly format amounts from cents",
                  "Preserve column names and ordering",
                  "Cover refunded orders and invalid values",
                ].map((n) => (
                  <div className="linear-check" key={n}>
                    <span>{review ? "✓" : ""}</span>
                    {n}
                  </div>
                ))}
              </div>
              <div className="linear-attachments">
                <BrandMark app="Slack" size={19} />
                <div>
                  <b>Original Slack discussion</b>
                  <span>Alex · #product-engineering</span>
                </div>
                <Icon name="chevron" size={15} />
              </div>
              <div className="linear-subissues">
                <h3>
                  Sub-issues <span>4</span>
                </h3>
                {[
                  ["ENG-249", "Reproduce the amount conversion", "Research"],
                  ["ENG-250", "Fix units and formatting", "Build"],
                  ["ENG-251", "Verify exports and refunds", "Review"],
                  ["ENG-252", "Prepare report and evidence", "Report"],
                ].map(([id, title, owner], i) => (
                  <div key={id} style={reveal(t, review ? 0 : 4 + i * 0.35)}>
                    <i
                      className={
                        "linear-status-dot " +
                        (review
                          ? "done"
                          : i === 0 && advanced
                            ? "progress"
                            : "")
                      }
                    />
                    <small>{id}</small>
                    <span>{title}</span>
                    <b>{owner}</b>
                  </div>
                ))}
              </div>
              <div className="linear-activity">
                <h3>
                  Activity <span>Subscribe</span>
                </h3>
                <div className="linear-event">
                  <Logo size={18} />
                  <span>Roppo created this issue from Slack.</span>
                  <time>9:42 AM</time>
                </div>
                {advanced && (
                  <div
                    className="linear-event"
                    style={reveal(t, review ? 2.2 : 3.5)}
                  >
                    <Logo size={18} />
                    <span>
                      Roppo moved the issue to <b>{status}</b>.
                    </span>
                    <time>{review ? "10:16 AM" : "9:42 AM"}</time>
                  </div>
                )}
                {review && t > 3.2 && (
                  <div className="linear-result" style={reveal(t, 3.2)}>
                    <div>
                      <Logo size={21} />
                      <b>Roppo</b>
                      <time>10:16 AM</time>
                    </div>
                    <p>
                      Fix and verification complete. 12 checks passed.
                      <br />
                      Ready for Alex to review. No deployment performed.
                    </p>
                    <div className="linear-result-file" data-linear-report>
                      <Icon name="file" size={16} />
                      verification-report.md
                      <Icon name="chevron" size={13} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
          <aside className="linear-properties">
            <h3>
              Properties <span>•••</span>
            </h3>
            <div data-linear-status>
              <i
                className={
                  "linear-status-dot " +
                  (status === "In Review"
                    ? "review"
                    : status === "In Progress"
                      ? "progress"
                      : "")
                }
              />
              <b>{status}</b>
              <Icon name="down" size={12} />
            </div>
            <div>
              <span className="linear-priority">▂▅▇</span>
              <b>High</b>
            </div>
            <div>
              <Logo size={18} />
              <b>Roppo</b>
              <small>Assignee</small>
            </div>
            <div>
              <Icon name="clock" size={17} />
              <span>Cycle 24</span>
            </div>
            <h3>
              Labels <span>+</span>
            </h3>
            <div className="linear-labels">
              <span>
                <i />
                Bug
              </span>
              <span>
                <i />
                Exports
              </span>
            </div>
            <h3>Project</h3>
            <div>
              <span>◈</span>Export reliability
            </div>
            <h3>Due date</h3>
            <div>
              <Icon name="clock" size={17} />
              Tomorrow
            </div>
            <h3>Links</h3>
            <div className="linear-slack-link">
              <BrandMark app="Slack" size={17} />
              Slack thread ↗
            </div>
            {review && (
              <div className="linear-evidence-note" style={reveal(t, 4)}>
                <Icon name="check" size={19} />
                <b>Evidence attached</b>
                <span>
                  Code changes, test results and browser reproduction.
                </span>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
