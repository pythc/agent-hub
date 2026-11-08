import { Badge, Button, Field, Icon, Logo, Shell } from "./UI";
import { clamp, ease, reveal } from "./motion";
import "./decision-scenes.css";

// An advisory layer suggests intent. It never directly authorizes execution.
export function DecisionSettings({ t }: { t: number }) {
  const selected = t < 2.5 ? 0 : t < 4.7 ? 1 : 2;
  const providers = [
    {
      icon: "flow",
      name: "Jev",
      subtitle: "TypeSafe · 原生判别 API",
      connection: "Jev / TypeSafe",
      model: "jev-latest",
      endpoint: "https://api.typesafe.ai/v1",
    },
    {
      icon: "terminal",
      name: "自部署模型",
      subtitle: "llama.cpp / Ollama 等",
      connection: "OpenAI Chat 兼容 API",
      model: "local-judge",
      endpoint: "http://127.0.0.1:8080/v1",
    },
    {
      icon: "globe",
      name: "外接模型服务",
      subtitle: "独立端点或已有 API 连接",
      connection: "复用已配置的 API 连接",
      model: "所选服务中的判别模型",
      endpoint: "OpenAI / Anthropic 协议",
    },
  ];
  const provider = providers[selected];
  return (
    <Shell section="模型连接">
      <div className="product-page decision-settings">
        <div className="settings-title">
          <h1>为 Router 配置额外决策层</h1>
          <Badge>可选能力 · 按需启用</Badge>
        </div>
        <div className="decision-modes">
          <span>关闭</span>
          <span>仅记录</span>
          <span className="selected" data-decision-mode="advisory">
            <Icon name="check" size={15} />
            提供建议
          </span>
          <p>输出意图建议，最终操作由 Router 决定。</p>
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
                {selected === i ? "当前选择" : "可配置"}
                <Icon name={selected === i ? "check" : "chevron"} size={16} />
              </div>
            </section>
          ))}
        </div>
        <div className="decision-connection">
          <div className="decision-connection-heading">
            <Icon name={provider.icon} size={22} />
            <h2>{provider.name}</h2>
            <Badge>辅助判断</Badge>
          </div>
          <div className="decision-connection-fields">
            <Field label="连接方式" value={provider.connection} />
            <Field label="模型" value={provider.model} />
          </div>
          <div className="decision-endpoint">
            <Icon name="link" size={16} />
            {provider.endpoint}
          </div>
        </div>
        <div className="decision-settings-footer">
          <span>
            <Icon name="settings" size={18} />
            批量输入上下文，返回结构化意图标签。
          </span>
          <Button primary icon={t >= 7 ? "check" : "settings"}>
            {t >= 7 ? "已保存" : "保存配置"}
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
      {last && <span>建议</span>}
    </div>
  );
}
export function DecisionFlow({ t }: { t: number }) {
  const batched = t >= 2.5;
  const rules = t >= 4.4;
  const advised = t >= 7.1;
  const decided = t >= 10;
  return (
    <Shell section="主动监听">
      <div className="product-page decision-flow-page">
        <div className="settings-title">
          <h1>少读重复上下文，把判断分层</h1>
          <Badge>无需 @ · 已授权群聊</Badge>
        </div>
        <div className="decision-live-status">
          <span className="live-dot" />
          <span>
            {t < 1
              ? "持续待命 · 空闲时不调用模型"
              : decided
                ? "Router 已决定介入，开始协调 Workers"
                : "收到群内消息，按批次推进判断"}
          </span>
          <span>先检查规则，再结合辅助建议</span>
        </div>
        <div className="decision-pipeline">
          <section
            className={batched ? "complete" : ""}
            data-decision-stage="batch"
          >
            <div className="decision-step">
              <span>01</span>
              <h2>批处理</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-chat-label">
                <Icon name="chat" size={15} />
                产品研发群 · Alex
              </div>
              <div
                className="decision-message-stack"
                style={{
                  height: 135 * (1 - ease((t - 2.5) / 0.65)),
                  opacity: 1 - ease((t - 2.5) / 0.65),
                }}
              >
                {[
                  "订单导出金额列不对。",
                  "按原有格式修复。",
                  "明早评审需要用。",
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
                  <strong>合成一个候选批次</strong>
                  <p>
                    订单导出金额异常
                    <br />
                    保留格式 · 明早使用
                  </p>
                  <span>3 条消息，共享上下文</span>
                </div>
              </div>
            </div>
            <footer>
              同讨论、同身份、同策略
              <br />
              合批减少重复唤醒
            </footer>
          </section>
          <FlowLink t={t} from={2.7} />
          <section
            className={rules ? "complete" : ""}
            data-decision-stage="rules"
          >
            <div className="decision-step">
              <span>02</span>
              <h2>规则检查</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-rule-heading">先确认来源和范围</div>
              {["来源权限有效", "属于监听范围", "当前策略允许评估"].map(
                (m, i) => (
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
                ),
              )}
              {rules && (
                <div className="decision-pass" style={reveal(t, 4.4)}>
                  进入意图判断
                </div>
              )}
            </div>
            <footer>
              越权或超范围不进入执行
              <br />
              不靠关键词直接开工
            </footer>
          </section>
          <FlowLink t={t} from={5.0} />
          <section
            className={advised ? "complete" : ""}
            data-decision-stage="advice"
          >
            <div className="decision-step">
              <span>03</span>
              <h2>辅助判别</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-other-providers">
                <span>Jev</span>
                <span>自部署</span>
                <span>模型 API</span>
              </div>
              <p className="decision-model-note">可插拔的额外决策层</p>
              <div className="decision-label-result" style={reveal(t, 6)}>
                <span>当前问题</span>
                <strong>{advised ? "INTERVENE" : "正在判断…"}</strong>
                <small>{advised ? "建议介入" : "短上下文 + 任务摘要"}</small>
              </div>
              <div className="decision-advice-only" style={reveal(t, 7.1)}>
                <Icon name="file" size={15} />
                返回标签，不直接执行任务
              </div>
            </div>
            <footer>
              按成本与质量选择模型
              <br />
              建议不可用时回到 Router
            </footer>
          </section>
          <FlowLink t={t} from={8} last />
          <section
            className={decided ? "decided" : ""}
            data-decision-stage="router"
          >
            <div className="decision-step">
              <span>04</span>
              <h2>Router 介入</h2>
            </div>
            <div className="decision-stage-body">
              <div className="decision-router-mark">
                <Logo size={37} />
              </div>
              <p className="decision-router-check">核验原文、意图与授权</p>
              <div className="decision-router-outcome" style={reveal(t, 9)}>
                <Icon name={decided ? "check" : "clock"} size={19} />
                <strong>
                  {decided ? "接手并分派 Workers" : "综合规则与辅助建议"}
                </strong>
              </div>
              {decided && (
                <div className="decision-reply" style={reveal(t, 10.4)}>
                  <Icon name="chat" size={15} />
                  完成后回原群报告
                </div>
              )}
            </div>
            <footer>
              最终决定仍由 Router 作出
              <br />
              普通闲聊保持安静
            </footer>
          </section>
        </div>
        <div className="decision-cost-strip">
          <div>
            <Icon name="inbox" size={18} />
            <strong>合批</strong>
            <span>减少重复调用</span>
          </div>
          <div>
            <Icon name="file" size={18} />
            <strong>摘要</strong>
            <span>减少重复 token</span>
          </div>
          <div>
            <Icon name="cpu" size={18} />
            <strong>辅助模型</strong>
            <span>按成本选型</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
