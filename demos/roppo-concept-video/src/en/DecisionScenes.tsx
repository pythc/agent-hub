import { Badge, Button, Field, Icon, Logo, Shell } from "./UI";
import { clamp, ease, reveal } from "../motion";
import "../decision-scenes.css";

// An advisory layer suggests intent. It never directly authorizes execution.
export function DecisionSettings({ t }: { t: number }) {
  const selected = t < 2.5 ? 0 : t < 4.7 ? 1 : 2;
  const providers = [
    {
      icon: "flow",
      name: "Jev",
      subtitle: "TypeSafe · Native classification API",
      connection: "Jev / TypeSafe",
      model: "jev-latest",
      endpoint: "https://api.typesafe.ai/v1",
    },
    {
      icon: "terminal",
      name: "Self-hosted model",
      subtitle: "llama.cpp / Ollama",
      connection: "OpenAI Chat compatible API",
      model: "local-judge",
      endpoint: "http://127.0.0.1:8080/v1",
    },
    {
      icon: "globe",
      name: "External model service",
      subtitle: "Dedicated endpoint or existing API",
      connection: "Use an existing API connection",
      model: "Your selected classification model",
      endpoint: "OpenAI / Anthropic protocols",
    },
  ];
  const provider = providers[selected];
  return (
    <Shell section="Model connections">
      <div className="product-page decision-settings">
        <div className="settings-title">
          <h1>Add an advisory decision layer</h1>
          <Badge>Optional · Enable when needed</Badge>
        </div>
        <div className="decision-modes">
          <span>Off</span>
          <span>Observe only</span>
          <span className="selected" data-decision-mode="advisory">
            <Icon name="check" size={15} />
            Advisory
          </span>
          <p>Intent advice only. Router makes the final decision.</p>
        </div>
        <div className="decision-providers">
          {providers.map((p, i) => (
            <section
              data-decision-provider={i}
              key={p.name}
              className={selected === i ? "selected" : ""}
            >
              <div className="decision-provider-symbol">
                <Icon name={p.icon} size={25} />
              </div>
              <h2>{p.name}</h2>
              <p>{p.subtitle}</p>
              <div className="decision-provider-status">
                {selected === i ? "Selected" : "Available"}
                <Icon name={selected === i ? "check" : "chevron"} size={16} />
              </div>
            </section>
          ))}
        </div>
        <div className="decision-connection">
          <div className="decision-connection-heading">
            <Icon name={provider.icon} size={22} />
            <h2>{provider.name}</h2>
            <Badge>Intent advice</Badge>
          </div>
          <div className="decision-connection-fields">
            <Field label="Connection" value={provider.connection} />
            <Field label="Model" value={provider.model} />
          </div>
          <div className="decision-endpoint">
            <Icon name="link" size={16} />
            {provider.endpoint}
          </div>
        </div>
        <div className="decision-settings-footer">
          <span>
            <Icon name="settings" size={18} />
            Batch context in. Structured intent labels out.
          </span>
          <Button primary icon={t >= 7 ? "check" : "settings"}>
            {t >= 7 ? "Saved" : "Save configuration"}
          </Button>
        </div>
      </div>
    </Shell>
  );
}

function FlowLink({
  t,
  from,
  last = false,
}: {
  t: number;
  from: number;
  last?: boolean;
}) {
  const progress = clamp((t - from) / 0.85);
  return (
    <div className="decision-flow-link">
      <svg viewBox="0 0 30 40">
        <path
          d="M0 20H27m-6-5 6 5-6 5"
          fill="none"
          stroke="#d8d8d8"
          strokeWidth="1.5"
        />
        {progress > 0 && (
          <circle
            cx={3 + 21 * ease(progress)}
            cy="20"
            r="3"
            fill="#333"
            opacity={progress < 0.99 ? 1 : 0.25}
          />
        )}
      </svg>
      {last && <span>advice</span>}
    </div>
  );
}
export function DecisionFlow({ t }: { t: number }) {
  const batched = t >= 2.5;
  const rules = t >= 4.4;
  const advised = t >= 7.1;
  const decided = t >= 10;
  return (
    <Shell section="Proactive listening">
      <div className="product-page decision-flow-page">
        <div className="settings-title">
          <h1>Less repeated context. Layered decisions.</h1>
          <Badge>No @mention · Approved channels</Badge>
        </div>
        <div className="decision-live-status">
          <span className="live-dot" />
          <span>
            {t < 1
              ? "Standing by · No model calls while idle"
              : decided
                ? "Router has accepted the task and is coordinating Workers"
                : "Channel messages received. Evaluating one batch."}
          </span>
          <span>Rules first. Advice next.</span>
        </div>
        <div className="decision-pipeline">
          <section
            className={batched ? "complete" : ""}
            data-decision-stage="batch"
          >
            <div className="decision-step">
              <span>01</span>
              <h2>Batch messages</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-chat-label">
                <Icon name="chat" size={15} />
                #product-engineering · Alex
              </div>
              <div
                className="decision-message-stack"
                style={{
                  height: 135 * (1 - ease((t - 2.5) / 0.65)),
                  opacity: 1 - ease((t - 2.5) / 0.65),
                }}
              >
                {[
                  "The export amounts are wrong.",
                  "Fix them. Keep the format.",
                  "We need it tomorrow morning.",
                ].map((m, i) => (
                  <div
                    className="decision-mini-message"
                    style={reveal(t, 0.8 + i * 0.45)}
                    key={m}
                  >
                    {m}
                  </div>
                ))}
              </div>
              <div className="decision-batch" style={reveal(t, 2.5)}>
                <Icon name="inbox" size={18} />
                <div>
                  <strong>One candidate batch</strong>
                  <p>
                    Incorrect order export amounts
                    <br />
                    Keep format · Due tomorrow
                  </p>
                  <span>3 messages, shared context</span>
                </div>
              </div>
            </div>
            <footer>
              Same thread, sender and policy
              <br />
              Fewer repeated wake-ups
            </footer>
          </section>
          <FlowLink t={t} from={2.7} />
          <section
            className={rules ? "complete" : ""}
            data-decision-stage="rules"
          >
            <div className="decision-step">
              <span>02</span>
              <h2>Check rules</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-rule-heading">
                Check source and scope
              </div>
              {[
                "Source access is valid",
                "Within monitored scope",
                "Policy allows assessment",
              ].map((m, i) => (
                <div
                  className="decision-rule"
                  style={{ opacity: t > 3.1 + i * 0.4 ? 1 : 0.25 }}
                  key={m}
                >
                  <Icon
                    name={t > 3.1 + i * 0.4 ? "check" : "clock"}
                    size={16}
                  />
                  {m}
                </div>
              ))}
              {rules && (
                <div className="decision-pass" style={reveal(t, 4.4)}>
                  Assess intent next
                </div>
              )}
            </div>
            <footer>
              Respect access and scope
              <br />
              No keyword-only auto-execution
            </footer>
          </section>
          <FlowLink t={t} from={5.0} />
          <section
            className={advised ? "complete" : ""}
            data-decision-stage="advice"
          >
            <div className="decision-step">
              <span>03</span>
              <h2>Assess intent</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-other-providers">
                <span>Jev</span>
                <span>Self-hosted</span>
                <span>Model API</span>
              </div>
              <p className="decision-model-note">Optional advisory layer</p>
              <div className="decision-label-result" style={reveal(t, 6)}>
                <span>Current request</span>
                <strong>{advised ? "INTERVENE" : "Assessing…"}</strong>
                <small>
                  {advised
                    ? "Suggest intervention"
                    : "Short context + task summary"}
                </small>
              </div>
              <div className="decision-advice-only" style={reveal(t, 7.1)}>
                <Icon name="file" size={15} />
                Returns labels, never executes
              </div>
            </div>
            <footer>
              Choose for cost and quality
              <br />
              Fall back to Router if unavailable
            </footer>
          </section>
          <FlowLink t={t} from={8} last />
          <section
            className={decided ? "decided" : ""}
            data-decision-stage="router"
          >
            <div className="decision-step">
              <span>04</span>
              <h2>Router decides</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-router-mark">
                <Logo size={37} />
              </div>
              <p className="decision-router-check">
                Verify intent and permission
              </p>
              <div className="decision-router-outcome" style={reveal(t, 9)}>
                <Icon name={decided ? "check" : "clock"} size={19} />
                <strong>
                  {decided ? "Accept and delegate" : "Combine rules and advice"}
                </strong>
              </div>
              {decided && (
                <div className="decision-reply" style={reveal(t, 10.4)}>
                  <Icon name="chat" size={15} />
                  Report back to the Slack thread
                </div>
              )}
            </div>
            <footer>
              Router makes the final decision
              <br />
              Stay quiet for ordinary chat
            </footer>
          </section>
        </div>
        <div className="decision-cost-strip">
          <div>
            <Icon name="inbox" size={18} />
            <strong>Batching</strong>
            <span>Fewer repeated calls</span>
          </div>
          <div>
            <Icon name="file" size={18} />
            <strong>Summaries</strong>
            <span>Less repeated context</span>
          </div>
          <div>
            <Icon name="cpu" size={18} />
            <strong>Model choice</strong>
            <span>Match quality and cost</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
