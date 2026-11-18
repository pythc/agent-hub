import '../../src/ui/tab-motion.js';
import '../../src/ui/tab-motion.css';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  useAui,
  useAuiState,
  useMessagePartText,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import {
  ArrowUp,
  ArrowDown,
  Users,
  SlidersHorizontal,
  Sun,
  Moon,
  PanelRight,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Check,
  LoaderCircle,
  Square,
  Paperclip,
  AlertCircle,
  RefreshCw,
  Wrench,
  Globe,
  Hand,
} from "lucide-react";
import type { ChatSessions } from "../../src/chat.ts";
import { ResourceWorkspace } from "./resource-workspace.tsx";
import { initialResources, openResource, resourceKey, type ResourceKind } from "./resource-state.ts";
import { FeatureNavigation } from "./navigation.tsx";
import {lazy,Suspense} from "react";
const PluginMarketplace=lazy(()=>import("./plugin-marketplace.tsx").then(m=>({default:m.PluginMarketplace})));
const AutomationWorkspace=lazy(()=>import("./automations.tsx").then(m=>({default:m.AutomationWorkspace})));
const WorkerTemplates=lazy(()=>import("./worker-templates.tsx").then(m=>({default:m.WorkerTemplates})));
const ConnectorManagement=lazy(()=>import("./connector-management.tsx").then(m=>({default:m.ConnectorManagement})));
const ArtifactCatalogPage=lazy(()=>import("./artifact-catalog.tsx").then(m=>({default:m.ArtifactCatalogPage})));
const ArtifactResult=lazy(()=>import("./artifact-result.tsx").then(m=>({default:m.ArtifactResult})));
const ExecutionTrace=lazy(()=>import("./execution-trace.tsx").then(m=>({default:m.ExecutionTrace})));
import {spaceRequest,clearChatDrafts,type ChatSpace} from './chat-settings.tsx';
import { Configuration } from "./configuration.tsx";
import {WorkspaceTransportOwner} from "./workspace-context.tsx";
import {preserveWorkspaceLink} from "./workspace-transport.ts";
import {WorkspaceView,useWorkspaceViews} from './workspace-view.tsx';
import { FilesPanel } from "./files.tsx";
import { BrowserPanel } from "./browser.tsx";
import { AgentAvatar } from "./agent-avatar.tsx";
import {RouterModelControl} from './router-model.tsx';

import {ChatCompanion} from "./companion.tsx";
import {companionStatus} from "./companion-state.ts";
import {CopyButton} from './copy-button.tsx';
import {attachmentError,attachmentParts,createAttachmentAdapter,DraftAttachment,MessageAttachments} from './attachments.tsx';
import type {ChatAttachment} from '../../src/chat-attachments.ts';
const RichMarkdown=lazy(()=>import("./markdown.tsx"));
import "../../src/ui/theme.css";
import "../../src/ui/typography.css";
import "./style.css";
import "./rich-content.css";
import "./navigation.css";
import "./chat-layout.css";

type Snapshot = ReturnType<ChatSessions["view"]>;
type Conversation = Snapshot["conversation"];
type Ready = Snapshot["readiness"] & { user?: { displayName: string } };
type Worker = Snapshot["workers"][number];
type Language = "en" | "zh-CN";
type Arrivals = {conversationId:string;since:number;seen:Set<string>};
const read = (key: string, fallback = "") => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const draftKey = (id: string | null) => "roppo.chat.draft." + (id ?? "new");
const pendingKey = (id: string) => "roppo.chat.pending." + id;
function savedPending(
  id: string | null,
): { text: string; id: string; conversationId: string;attachments?:string[] } | null {
  try {
    const value = id ? JSON.parse(read(pendingKey(id), "null")) : null;
    return value &&
      typeof value.text === "string" &&
      typeof value.id === "string" &&
      value.conversationId === id
      ? value
      : null;
  } catch {
    return null;
  }
}
class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/chat" + path, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 401) {
    location.assign("/chat" + location.search);
    throw new ApiError("login_required");
  }
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.code ?? "request_failed");
  return result;
}
const Context = createContext({
  lang: "en" as Language,
  L: (en: string, zh: string) => en,
  calls: [] as Snapshot["calls"],
  workers: [] as Worker[],
  routerLabel: 'Router',
  run: null as Snapshot['run'],
  runMessageId: '',
  arrivals: {since: Infinity, seen: new Set<string>()},
});
const useUI = () => useContext(Context);
function IconButton({
  label,
  children,
  ...props
}: {
  label: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
function ErrorNotice({ code, clear }: { code: string; clear: () => void }) {
  const { L } = useUI();
  const message =
    code.startsWith("attachment_")?attachmentError(code,L):
    code==='sent_refresh_failed'?L('Message sent. Refresh to see the latest replies.','消息已发送，请刷新查看最新回复。'):
    code === "conversation_busy"
      ? L("This conversation is still running.", "当前会话仍在运行。")
      : code === "conversation_missing"
        ? L("This conversation is unavailable.", "此会话暂不可用。")
        : code === "chat_entry_unavailable"
          ? L("This Chat entry is unavailable. Check its entry settings.", "当前 Chat 入口不可用，请检查会话入口设置。")
        : code === "request_not_admitted"
          ? L("The current entry rules did not accept this message.", "消息未被当前入口规则接收，请检查会话入口设置。")
          : code === "message_conflict"
            ? L(
                "This message changed. Please send it again.",
                "消息内容已改变，请重新发送。",
              )
            : code === "merge_in_progress"
              ? L(
                  "A merge is in progress. Check it in Tasks before stopping.",
                  "合并正在进行，请先在任务页核对结果。",
                )
              : L(
                  "Couldn’t complete this action. Your draft is saved.",
                  "操作未完成，草稿已保留。",
                );
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
      <IconButton label={L("Dismiss", "关闭")} onClick={clear}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
function SendMessage({sending}:{sending:boolean}){
  const {L}=useUI(),aui=useAui();
  const canSend=useAuiState(s=>!s.thread.isDisabled&&s.composer.canSend);
  return <button type="button" className="send-button" disabled={!canSend} aria-label={L('Send message','发送消息')} onClick={()=>aui.composer.send()}>
    {sending?<LoaderCircle size={18} className="spin"/>:<ArrowUp size={20}/>}
  </button>;
}
function useArrival(id: string, createdAt: number) {
  const { arrivals } = useUI();
  const [fresh] = useState(() => createdAt >= arrivals.since && !arrivals.seen.has(id));
  useEffect(() => { arrivals.seen.add(id); }, [arrivals, id]);
  return fresh || undefined;
}
function Timestamp({ at }: { at: Date | number }) {
  const { lang } = useUI(), date = new Date(at);
  return <time className="message-time" dateTime={date.toISOString()} title={new Intl.DateTimeFormat(lang, {dateStyle:'medium', timeStyle:'medium'}).format(date)}>{new Intl.DateTimeFormat(lang, {hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)}</time>;
}
function runLabel(state: string, L: (en: string, zh: string) => string) {
  return ({queued:L('Waiting for Router','等待 Router'),running:L('Working','处理中'),waiting:L('Waiting for your input','等待你的补充'),completed:L('Complete','已完成'),cancel_requested:L('Stopping…','正在停止…'),cancelled:L('Stopped','已停止'),failed:L('Couldn’t finish. Send a follow-up to retry.','未能完成，可补充消息后重试。')} as Record<string,string>)[state];
}
function UserMessage() {
  const { calls, workers, L } = useUI(),
    id = useAuiState((s) => s.message.id),
    attachments = useAuiState((s) => s.message.metadata.custom?.attachments) as ChatAttachment[]|undefined,
    hasText = useAuiState((s) => s.message.content.some(c=>c.type==='text'&&!!c.text)),
    createdAt = useAuiState((s) => s.message.createdAt),
    arrival = useArrival(id, createdAt.getTime()),
    own = calls.filter((c) => c.runId === id.replace(/^user:/, "") && c.name !== "superagent_status");
  return (
    <>
      <MessagePrimitive.Root className="message user-message" data-arrival={arrival}>
        <MessageAttachments files={attachments??[]} L={L}/>
        {hasText?<div className="user-bubble"><MessagePrimitive.Parts components={{Text:Markdown}}/></div>:null}
        <Timestamp at={createdAt} />
      </MessagePrimitive.Root>
      {own.some((c) => c.kind === "tool") ? (
        <div className="message-tool-activity">
          <ToolCalls calls={own} workers={workers} />
        </div>
      ) : null}
    </>
  );
}
function ComposerAttachment(){const {L}=useUI();return <DraftAttachment L={L}/>}
function PlainText(){const {text}=useMessagePartText();return <span>{text}</span>}
function Markdown(){const {L}=useUI();return <Suspense fallback={<PlainText/>}><RichMarkdown L={L}/></Suspense>}
function AssistantMessage() {
  const { L, run, runMessageId, routerLabel } = useUI(),
    id = useAuiState((s) => s.message.id),
    attachments = useAuiState((s) => s.message.metadata.custom?.attachments) as ChatAttachment[]|undefined,
    createdAt = useAuiState((s) => s.message.createdAt),
    arrival = useArrival(id, createdAt.getTime()),
    speaker = useAuiState((s) => s.message.metadata.custom?.speaker) as Snapshot["participants"][number]|undefined,
    recipient = useAuiState((s) => s.message.metadata.custom?.recipient) as Snapshot["participants"][number]|undefined,
    status = useAuiState((s) => s.message.status),
    copyText = useAuiState((s) => s.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')),
    hasText = useAuiState((s) =>
      s.message.content.some((c) => c.type === "text" && !!c.text),
    ),
    streaming = status?.type === "running";
  if (streaming && !hasText) return null;
  return (
    <MessagePrimitive.Root
      className="message assistant-message"
      data-arrival={arrival}
      data-streaming={streaming ? "true" : undefined}
    >
      <div className="assistant-identity">
        <AgentAvatar id={speaker?.id} kind={speaker?.kind} size={32} />
        <strong>{speaker?.label ?? routerLabel}</strong>
        {speaker && speaker.label !== (speaker.kind === "worker" ? "Worker" : "Router") ? <span className="agent-role">{speaker.kind === "worker" ? "Worker" : "Router"}</span> : null}
        {recipient ? <span className="message-recipient">→ {recipient.label}</span> : null}
        {streaming ? (
          <span className="output-state">
            <span className="live-dot" />
            {L("Writing", "正在输出")}
          </span>
        ) : null}
      </div>
      <div className="assistant-body">
        <MessagePrimitive.Parts components={{ Text: Markdown }} />
        <MessageAttachments files={attachments??[]} L={L}/>
        <div className="message-footer">
          <Timestamp at={createdAt} />
          {run && runMessageId === id ? <span className={'message-status ' + run.state} role="status"><StatusIcon state={run.state} />{runLabel(run.state, L)}</span> : status?.type === 'incomplete' ? <span className="message-status">{status.reason === 'cancelled' ? L('Output stopped','输出已停止') : L('Output interrupted','输出中断')}</span> : null}
        <ActionBarPrimitive.Root className="message-actions">
          <CopyButton value={copyText} L={L}/>
        </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}
function StatusIcon({ state }: { state: string }) {
  return state === "running" || state === "queued" ? (
    <LoaderCircle className={state === "running" ? "spin" : ""} size={17} />
  ) : state === "completed" ? (
    <Check className="success" size={17} />
  ) : ["waiting", "failed", "interrupted"].includes(state) ? (
    <AlertCircle size={17} />
  ) : state === "cancelled" ? (
    <Square size={12} />
  ) : (
    <span className="idle-dot" />
  );
}
function workerState(w: Worker) {
  return w.tasks.some((t) => t.state === "running")
    ? "running"
    : w.tasks.some((t) => t.state === "queued")
      ? "queued"
      : w.tasks.some((t) => t.state === "waiting")
        ? "waiting"
        : w.tasks.length
          ? w.tasks.at(-1)!.state
          : w.state === "enabled"
            ? "available"
            : w.state;
}
function WorkerRows({
  workers,
  details = false,
}: {
  workers: Worker[];
  details?: boolean;
}) {
  const { L } = useUI(),
    labels: Record<string, string> = {
      running: L("Running", "运行中"),
      queued: L("Queued", "排队中"),
      waiting: L("Needs attention", "待处理"),
      completed: L("Complete", "已完成"),
      cancelled: L("Stopped", "已停止"),
      available: L("Available", "可用"),
      paused: L("Paused", "已暂停"),
      retiring: L("Retiring", "退出中"),
    };
  return (
    <div className="worker-list">
      {workers.map((w) => {
        const state = workerState(w);
        return (
          <details className="worker-row" key={w.id}>
            <summary>
              <span className="worker-name">
                <AgentAvatar id={w.id} kind="worker" size={24} />
                <StatusIcon state={state} />
                <span>{w.label}</span>
              </span>
              <span className="worker-state">{labels[state] ?? state}</span>
              {details && w.tasks.length > 0 ? <ChevronDown size={14} /> : null}
            </summary>
            {w.tasks.map((t) => (
              <div className="task-detail" key={t.id}>
                <strong>{t.title}</strong>
                <p>{t.summary || labels[t.state]}</p>
                {t.question ? <p>{t.question}</p> : null}
                <a href="/configure#tasks/history">
                  {L("View task", "查看任务")}
                  <ChevronRight size={13} />
                </a>
              </div>
            ))}
          </details>
        );
      })}
    </div>
  );
}
function ToolCalls({
  calls,
  workers,
}: {
  calls: Snapshot["calls"];
  workers: Worker[];
}) {
  const { L } = useUI(),
    arrival = useArrival('tools:' + calls[0]!.runId, calls[0]!.startedAt),
    [open, setOpen] = useState(false),
    [now, setNow] = useState(Date.now()),
    tools = calls.filter((c) => c.kind === "tool" && c.name !== "superagent_status"),
    busy = tools.some((c) => c.state === "running");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [busy]);
  if (!tools.length) return null;
  const names: Record<string, string> = {
    list: L("Inspect team", "查看团队"),
    assign: L("Delegate task", "分派任务"),
    send: L("Continue task", "继续任务"),
    result: L("Read result", "读取结果"),
    inspect: L("Inspect task", "查看任务"),
    create: L("Create worker", "创建 Worker"),
    configure: L("Configure worker", "配置 Worker"),
    set_prompt: L("Set instructions", "设置提示词"),
    clone: L("Clone worker", "复制 Worker"),
    retire: L("Retire worker", "停用 Worker"),
    destroy: L("Remove worker", "移除 Worker"),
    migrate: L("Migrate worker", "迁移 Worker"),
    cancel: L("Cancel task", "取消任务"),
    pause: L("Pause worker", "暂停 Worker"),
    resume: L("Resume worker", "恢复 Worker"),
    remove: L("Remove worker", "移除 Worker"),
    stop: L("Stop task", "停止任务"),
    superagent_read: L("Read resource", "读取资源"),
    superagent_shell: L("Run command", "执行命令"),
    superagent_job: L("Inspect background job", "查看后台任务"),
    superagent_spawn: L("Delegate subtask", "分派子任务"),
    superagent_progress: L("Update progress", "更新进展"),
    superagent_tool: L("Call connected tool", "调用连接工具"),
    superagent_tools: L("Inspect tools", "查看工具"),
  };
  Object.assign(names, {
    superagent_browser: L("Use browser", "\u64cd\u4f5c\u6d4f\u89c8\u5668"),
    "browser:profiles": L(
      "Read browser profiles",
      "\u67e5\u770b\u6d4f\u89c8\u5668\u8d44\u6599",
    ),
    "browser:open": L("Open browser", "\u6253\u5f00\u6d4f\u89c8\u5668"),
    "browser:navigate": L("Open website", "\u6253\u5f00\u7f51\u7ad9"),
    "browser:snapshot": L("Read page", "\u8bfb\u53d6\u9875\u9762"),
    "browser:click": L(
      "Click page element",
      "\u70b9\u51fb\u9875\u9762\u5143\u7d20",
    ),
    "browser:fill": L("Fill field", "\u586b\u5199\u5185\u5bb9"),
    "browser:press": L("Press key", "\u6309\u952e\u64cd\u4f5c"),
    "browser:scroll": L("Scroll page", "\u6eda\u52a8\u9875\u9762"),
    "browser:login": L(
      "Fill saved account",
      "\u586b\u5165\u5df2\u4fdd\u5b58\u8d26\u53f7",
    ),
    "browser:request_takeover": L(
      "Request takeover",
      "\u8bf7\u6c42\u4eba\u5de5\u63a5\u7ba1",
    ),
    "browser:close": L("Close browser", "\u5173\u95ed\u6d4f\u89c8\u5668"),
    "browser:new_tab": L("Open tab", "\u65b0\u5efa\u6807\u7b7e\u9875"),
    "browser:select_tab": L("Switch tab", "\u5207\u6362\u6807\u7b7e\u9875"),
    "browser:close_tab": L("Close tab", "\u5173\u95ed\u6807\u7b7e\u9875"),
    "browser:back": L("Go back", "\u540e\u9000"),
    "browser:forward": L("Go forward", "\u524d\u8fdb"),
    "browser:reload": L("Reload page", "\u91cd\u65b0\u52a0\u8f7d"),
  });
  const states: Record<string, string> = {
    running: L("Running", "运行中"),
    completed: L("Complete", "已完成"),
    failed: L("Failed", "失败"),
    interrupted: L("Interrupted", "已中断"),
  };
  return (
    <details
      className="tool-activity"
      data-arrival={arrival}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <Wrench size={15} />
        <strong>{L("Tool calls", "工具调用")}</strong>
        <span>{tools.length}</span>
        <ChevronDown size={14} />
      </summary>
      <div className="tool-calls">
        {tools.map(call => <ToolCall key={call.id} call={call} workers={workers} names={names} states={states} now={now} />)}
      </div>
    </details>
  );
}
function ToolCall({call, workers, names, states, now}: {call: Snapshot['calls'][number];workers: Worker[];names: Record<string,string>;states: Record<string,string>;now: number}) {
  const { L, routerLabel } = useUI(), arrival = useArrival('call:' + call.id, call.startedAt);
  const actor =
      workers.find((w) => w.id === call.workerId)?.label ??
      (call.workerId || routerLabel),
    target =
      workers.find((w) => w.id === call.target)?.label ?? call.target,
    title = names[call.action ?? call.name] ?? call.name,
    elapsed = Math.max(0, (call.endedAt ?? now) - call.startedAt);
  return (
    <details
      className="tool-call"
      data-arrival={arrival}
      data-state={call.state}
    >
      <summary>
        <StatusIcon state={call.state} />
        <span className="tool-call-title">
          <strong>
            {title}
            {target ? " · " + target : ""}
          </strong>
          <span>{actor}</span>
        </span>
        <Timestamp at={call.startedAt} />
        <span className="tool-call-time">
          {(elapsed / 1000).toFixed(1)}s
        </span>
        <ChevronDown size={13} />
      </summary>
      <dl>
        <dt>{L("Tool", "工具")}</dt>
        <dd>{call.name}</dd>
        <dt>{L("Status", "状态")}</dt>
        <dd>{states[call.state]}</dd>
      </dl>
    </details>
  );

}
function TeamPanel({
  workers,
  active,
  connected,
  calls,
}: {
  workers: Worker[];
  active: boolean;
  connected: boolean;
  calls: Snapshot["calls"];
}) {
  const { L, routerLabel } = useUI(),
    flow = connected && workers.some((w) => workerState(w) === "running");
  return (
    <aside
      className="team-panel"
      aria-label={L("Team activity", "团队动态")}
      id="team-panel"
    >
      <div className="team-scroll">
        <div
          className={"team-map" + (flow ? " has-flow" : "")}
          aria-label={L("Router coordinates the workers", "Router 协调 Worker")}
        >
          <div
            className={"router-node" + (active && connected ? " running" : "")}
            data-state={active && connected ? "running" : "idle"}
          >
            <AgentAvatar size={28} />
            <strong>{routerLabel}</strong>
            {active && connected ? (
              <LoaderCircle size={13} className="spin" />
            ) : null}
          </div>
          <div
            className={"team-branches" + (workers.length > 3 ? " multi" : "")}
          >
            {workers.map((w) => {
              const working = connected && workerState(w) === "running",
                tool = calls.findLast(
                  (c) =>
                    c.workerId === w.id &&
                    c.kind === "tool" &&
                    c.state === "running",
                );
              return (
                <div
                  className={"team-branch " + (working ? "flowing" : "")}
                  key={w.id}
                >
                  <span className="connector" />
                  <div
                    className="worker-node"
                    data-state={working ? "running" : workerState(w)}
                  >
                    <AgentAvatar id={w.id} kind="worker" size={32} />
                    {working ? <LoaderCircle size={13} className="spin" /> : null}
                    <span>{w.label}</span>
                    {tool ? (
                      <span className="node-tool">
                        <Wrench size={10} />
                        {L("Using a tool", "调用工具")}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <WorkerRows workers={workers} details />
        {workers.length === 0 ? (
          <a
            className="configure-team"
            href="/configure#execution/configuration"
          >
            <Users size={16} />
            {L("Configure your team", "配置团队")}
          </a>
        ) : null}
      </div>
      <a className="team-settings" href="/configure#execution/configuration">
        <SlidersHorizontal size={16} />
        {L("Agent team settings", "Agent 团队设置")}
        <ChevronRight size={15} />
      </a>
    </aside>
  );
}
function Readiness({ ready }: { ready: Ready | null }) {
  const { L } = useUI();
  if (!ready || ready.ready) return null;
  const messages: Record<string, string> = {
    host_router_required: L(
      "Enable a host Router to start chatting here.",
      "启用托管 Router 后即可在这里对话。",
    ),
    host_paused: L("The host is paused.", "运行已暂停。"),
    local_source_required: L(
      "Add a local conversation entry.",
      "请添加本地会话入口。",
    ),
    model_credentials_missing: L(
      "Connect your Router model.",
      "请连接 Router 模型。",
    ),
    model_unavailable: L(
      "Your Router model is unavailable.",
      "Router 模型暂不可用。",
    ),
    preview_restricted: L(
      "This preview cannot run tasks.",
      "此预览不执行任务。",
    ),
  };
  return (
    <div className="notice readiness">
      <AlertCircle size={18} />
      <span>
        {messages[ready.code] ??
          L("Configure your Router to begin.", "配置 Router 后开始。")}
      </span>
      <a
        href={
          ready.code === "host_paused"
            ? "/configure#advanced/host"
            : ready.configurationUrl
        }
      >
        {L("Configure Router", "配置 Router")}
        <ChevronRight size={15} />
      </a>
    </div>
  );
}
function App() {
  const chatArrivals = useRef<Arrivals>({conversationId:'',since:Infinity,seen:new Set()});

  const [route, setRoute] = useState(
    location.pathname + location.search + location.hash,
  );
  const [id, setId] = useState<string | null>(null),
    [display, setDisplay] = useState<ChatSpace["display"]>("group"),
    [ready, setReady] = useState<Ready | null>(null);
  const [navExpanded, setNavExpanded] = useState(read("roppo.navigation.expanded") === "true");
  useEffect(() => write("roppo.navigation.expanded", String(navExpanded)), [navExpanded]);
  const [lang, setLang] = useState<Language>(
      read("agenthub.configuration.language") === "zh-CN" ? "zh-CN" : "en",
    ),
    [dark, setDark] = useState(read("agenthub.configuration.theme") === "dark");
  const L = useCallback(
    (en: string, zh: string) => (lang === "zh-CN" ? zh : en),
    [lang],
  );
  const spaceVersion=useRef(0);
  const refreshList = useCallback(async () => {
    const version=++spaceVersion.current,space=await spaceRequest();if(version!==spaceVersion.current)return;
    if(space.cleanup && read("roppo.chat.reset") !== space.cleanup.id){clearChatDrafts();write("roppo.chat.reset",space.cleanup.id)}
    setId(space.conversation?.id??null);setDisplay(space.display);
  }, []);
  useEffect(()=>{const change=()=>void refreshList();window.addEventListener('roppo:chat-space',change);return()=>window.removeEventListener('roppo:chat-space',change)},[refreshList]);
  const navigate = useCallback((next: string | null) => {
    setId(next);
    const url = new URL("/chat", location.origin);

    history.pushState(null, "", url);
    setRoute(url.pathname + url.search + url.hash);
  }, []);
  useEffect(() => {
    const sync = () => {
      if (location.hash === "#prompts/memory") history.replaceState(null, "", location.pathname + location.search + "#advanced/memory");
      if (location.pathname === "/chat" && location.search) history.replaceState(null, "", "/chat" + location.hash);
      setRoute(location.pathname + location.search + location.hash);
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !anchor ||
        anchor.target ||
        anchor.hasAttribute("download") ||
        anchor.getAttribute("href")?.startsWith("#")
      )
        return;
      const url = preserveWorkspaceLink(new URL(anchor.href),new URL(location.href));
      if (
        url.origin !== location.origin ||
        !["/configure", "/configure/", "/chat"].includes(url.pathname)
      )
        return;
      event.preventDefault();
      if (url.pathname === "/chat") url.search = "";
      history.pushState(null, "", url);
      sync();
    };
    sync();
    document.addEventListener("click", click);
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener("roppo:navigation", sync);
    return () => {
      document.removeEventListener("click", click);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("roppo:navigation", sync);
    };
  }, [id]);
  useEffect(() => {
    let alive = true;
    api<Ready>("/readiness")
      .then((r) => {
        if (alive) setReady(r);
      })
      .catch(() => {});
    refreshList().catch(() => {});
    const timer = setInterval(() => {
      api<Ready>("/readiness")
        .then((r) => {
          if (alive) setReady(r);
        })
        .catch(() => {});
      refreshList().catch(() => {});
    }, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshList]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    write("agenthub.configuration.theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    document.documentElement.lang = lang;
    write("agenthub.configuration.language", lang);
  }, [lang, L]);
  useEffect(() => {
    const storage = (e: StorageEvent) => {
      if (e.key === "agenthub.configuration.theme")
        setDark(e.newValue === "dark");
      if (e.key === "agenthub.configuration.language")
        setLang(e.newValue === "zh-CN" ? "zh-CN" : "en");
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);
  return (
    <>
      <div
        id="announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
      />
      <Chat
        arrivals={chatArrivals}
        refreshReady={async()=>setReady(await api<Ready>("/readiness"))}
        key={id ?? "new"}
        {...{
          id,
          display,
          ready,
          lang,
          L,
          dark,
          setDark,
          navigate,
          refreshList,
          setLang,
          route,
          navExpanded,
          setNavExpanded,
        }}
      />
    </>
  );
}
type ChatProps = {
  arrivals: React.RefObject<Arrivals>;
  refreshReady: () => Promise<void>;
  navExpanded: boolean;
  setNavExpanded: (value: boolean) => void;
  display: ChatSpace["display"];
  route: string;
  id: string | null;
  ready: Ready | null;
  lang: Language;
  L: (en: string, zh: string) => string;
  dark: boolean;
  setDark: (v: boolean) => void;
  navigate: (id: string | null) => void;
  refreshList: () => Promise<void>;
  setLang: (v: Language) => void;
};
function Chat(p: ChatProps) {
  const {
    id,
    display,
    ready: boot,
    lang,
    L,
    dark,
    setDark,
    navigate,
    refreshList,
    setLang,
    route,
    navExpanded,
    setNavExpanded,
  } = p;
  const configuring = !route.startsWith("/chat");
  const [resources, setResources] = useState(() =>
    initialResources(read(resourceKey(id)), read("roppo.chat.panel." + (id ?? "new"))),
  );
  const panel = resources.visible
    ? resources.tabs.find((tab) => tab.id === resources.active)?.kind ?? "new"
    : null;
  const [pendingWebsite, setPendingWebsite] = useState(() => {
    try { return sessionStorage.getItem("roppo.website." + id) || ""; } catch { return ""; }
  });
  const consumeWebsite = () => {
    setPendingWebsite("");
    try { sessionStorage.removeItem("roppo.website." + id); } catch {}
  };
  useEffect(() => write(resourceKey(id), JSON.stringify(resources)), [id, resources]);
  const [browserRequest,setBrowserRequest]=useState<{id:string;takeover:boolean;key:number}>();
  const [panelExpanded, setPanelExpanded] = useState(false),
    [pickerRequest, setPickerRequest] = useState(0);
  const creating = useRef(false);
  const choosePanel = async (next: ResourceKind | null, url?: string) => {
    if (next === "browser" && !id) {
      if (creating.current) return;
      creating.current = true;
      try {
        const conversation = (await spaceRequest({}, "POST")).conversation!;
        write(resourceKey(conversation.id), JSON.stringify(openResource(resources, "browser")));
        if (url) try { sessionStorage.setItem("roppo.website." + conversation.id, url); } catch {}
        write(draftKey(conversation.id), runtime.thread.composer.getState().text);
        write(draftKey(null), "");
        await refreshList();
        if (alive.current && location.pathname === "/chat") navigate(conversation.id);
      } catch (error) { fail(error); }
      finally { creating.current = false; }
      return;
    }
    if (url) setPendingWebsite(url);
    if(next&&!panel)panelOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setResources((state) => next ? openResource(state, next) : { ...state, visible: false });
    if (!next) setPanelExpanded(false);
  };
  const hash = route.split("#")[1] ?? "tasks";
  const automationRoute=configuring&&hash==='automations';
  const templatesRoute=configuring&&hash==='worker-templates';
  const connectorsRoute=configuring&&hash==='connectors';
  const traceRoute=configuring&&hash==='execution-trace';
  const catalogRoute=configuring&&hash==='artifacts';
  const artifactRoute=configuring&&hash.startsWith('artifact/');
  const capabilityRoute=templatesRoute||connectorsRoute||traceRoute||artifactRoute||catalogRoute;
  const marketRoute=configuring&&(hash==='integrations'||hash.startsWith('integrations/'));
  const marketTools=hash==='integrations'||hash==='integrations/tools';
  const views=useWorkspaceViews();
  const pluginId=configuring&&hash.startsWith('plugin/')?hash.slice(7):null;
  const currentView=views.find(view=>view.id===pluginId);
  const pageNames: Record<string, string> = {
    tasks: L("Workspace", "工作区"),
    "tasks/active": L("Tasks", "任务"),
    "tasks/history": L("Tasks", "任务"),
    attention: L("Needs your attention", "待处理"),
    automations: L("Event automations", "事件自动化"),
    "worker-templates": L("Worker templates", "Worker 模板"),
    connectors: L("Connectors", "连接器"),
    "execution-trace": L("Task progress", "任务进展"),
    artifact: L("File version", "文件版本"),
    artifacts: L("Artifacts", "产物目录"),
    execution: L("Agent team", "Agent 团队"),
    deployments: L("Deployments", "部署"),
    models: L("Model connections", "模型连接"),
    connections: L("Conversation entries", "会话入口"),
    integrations: L("Plugins & tools", "插件与工具"),
    prompts: L("Behavior rules", "行为规则"),
    advanced: L("Settings", "设置"),
    usage: L("Usage guide", "使用指引"),
  };
  const pageTitle =
    currentView?.label[lang] ??
    pageNames[hash] ??
    pageNames[hash.split("/")[0]!] ??
    L("Workspace", "工作区");
  useEffect(() => {
    document.title =
      (configuring ? pageTitle : L("Conversations", "对话")) + " · Roppo";
    setMenu(false);
  }, [route, lang, pageTitle]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(!!id),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true),
    [sending, setSending] = useState(false),
    [menu, setMenu] = useState(false),
    [selectedAgent, setSelectedAgent] = useState("router"),
    [panelOverlay, setPanelOverlay] = useState(false),
    [narrow, setNarrow] = useState(
      () => matchMedia("(max-width:800px)").matches,
    );
  const alive = useRef(true),
    fetchVersion = useRef(0),
    messagesRef = useRef<Snapshot["messages"]>([]),
    pending = useRef<{
      text: string;
      id: string;
      conversationId: string;
      attachments?:string[];
    } | null>(savedPending(id)),
    bodyRef = useRef<HTMLDivElement>(null),
    threadRef = useRef<HTMLDivElement>(null),
    panelOpener = useRef<HTMLElement|null>(null),
    teamButton = useRef<HTMLButtonElement>(null),
    menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const thread=threadRef.current, transcript=thread?.querySelector<HTMLElement>('.transcript');
    if(!thread||!transcript)return;
    const measure=()=>{
      if(!thread.clientWidth)return;
      thread.closest<HTMLElement>('.chat-main')?.style.setProperty('--chat-lane-width',thread.clientWidth+'px');
      thread.style.setProperty('--chat-scrollbar-gutter',(transcript.offsetWidth-transcript.clientWidth)/2+'px');
    };
    const observer=new ResizeObserver(measure);observer.observe(thread);observer.observe(transcript);measure();
    return ()=>observer.disconnect();
  }, []);
  const closeNavigation = useCallback(() => {
    setMenu(false);
    // The main region must leave inert before its menu button can receive focus.
    requestAnimationFrame(() => menuButton.current?.focus());
  }, []);
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setPanelOverlay(
          innerWidth <= 800 ||
            entry.contentRect.width -
              Math.max(360, Math.min(innerWidth * 0.43, 600)) <
              360,
        );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const participants = snapshot?.participants ?? [{id:"router",label:boot?.routerLabel??"Router",kind:"router" as const,latestMessage:null},...(boot?.workers??[]).map(w=>({id:w.id,label:w.label,kind:"worker" as const,latestMessage:null}))];
  const uploadConversation=useRef<Promise<string>|null>(null),uploadConversationId=useRef(id),[loadingAttachments,setLoadingAttachments]=useState(!!id),[attachmentBlocked,setAttachmentBlocked]=useState(false);
  const ensureConversation=useCallback(()=>{
    if(id)return Promise.resolve(id);
    if(!uploadConversation.current)uploadConversation.current=spaceRequest({},'POST').then(space=>{const target=space.conversation!.id;uploadConversationId.current=target;write(draftKey(target),read(draftKey(null)));return target}).catch(error=>{uploadConversation.current=null;throw error});
    return uploadConversation.current;
  },[id]);
  const attachmentLanguage=useRef(L);attachmentLanguage.current=L;
  const attachmentAdapter=useMemo(()=>createAttachmentAdapter(ensureConversation,boot?.uploads.maxBytes??25*1024*1024,(en,zh)=>attachmentLanguage.current(en,zh)),[ensureConversation,boot?.uploads.maxBytes]);
  const currentRouter = participants.find(a=>a.id===(snapshot?.routerId??"router"))!;
  const selected = participants.find(a=>a.id===selectedAgent) ?? currentRouter;
  const readonly = display === "agents" && selected?.id !== currentRouter?.id;
  const participantFilter = readonly ? selected.id : undefined;
  const ready = snapshot?.readiness ?? boot,
    run = snapshot?.run,
    reply = snapshot?.reply,
    workers = snapshot?.workers ?? boot?.workers ?? [],
    running =
      !!run && ["queued", "running", "cancel_requested"].includes(run.state),
    disabled =
      readonly || !ready?.ready ||
      !!snapshot?.conversation.archived ||
      loading ||
      loadingAttachments ||
      attachmentBlocked ||
      sending;
  const arrivals = p.arrivals;
  if (snapshot && arrivals.current.conversationId !== snapshot.conversation.id) arrivals.current = {
    conversationId:snapshot.conversation.id, since:Date.now(), seen:new Set(snapshot.messages.map(m=>m.id)),
  };
  const runMessageId = !readonly ? snapshot?.messages.findLast(m => m.runId === run?.id && m.role === 'assistant' && !m.recipient)?.id ?? '' : '';
  const fail = (e: unknown) => {
    if (alive.current)
      setError(e instanceof ApiError ? e.code : "network_error");
  };
  const refresh = useCallback(async () => {
    if (!id) return;
    const version = ++fetchVersion.current;
    const data = await api<Snapshot>("/conversations/" + id + (participantFilter ? "?participant="+encodeURIComponent(participantFilter) : ""));
    if (!alive.current || version !== fetchVersion.current) return;
    const older = messagesRef.current.filter(
      (m) => m.sequence < (data.messages[0]?.sequence ?? Infinity),
    );
    const messages = [...older, ...data.messages];
    messagesRef.current = messages;
    setSnapshot({
      ...data,
      messages,
      hasMore: messages[0]?.sequence === 1 ? false : data.hasMore,
    });
    setLoading(false);
    const saved = savedPending(id);
    if (saved && messages.some((m) => m.clientMessageId === saved.id)) {
      write(pendingKey(id), "null");
      if (read(draftKey(id)) === saved.text) write(draftKey(id), "");
    }
  }, [id, participantFilter]);
  useEffect(() => {
    alive.current = true;
    messagesRef.current=[];setLoading(!!id);setSnapshot(s=>s?{...s,messages:[]}:s);
    if (!id)
      return () => {
        alive.current = false;
      };
    let source: EventSource | null = null;
    const load = async () => {
      if (!navigator.onLine) {
        setConnected(false);
        return;
      }
      try {
        await refresh();
        if (
          alive.current &&
          source?.readyState === EventSource.OPEN &&
          navigator.onLine
        )
          setConnected(true);
      } catch (e) {
        if (alive.current) {
          setConnected(false);
          setLoading(false);
          if (e instanceof ApiError) fail(e);
        }
      }
    };
    const connect = () => {
      source?.close();
      if (!navigator.onLine) {
        setConnected(false);
        return;
      }
      const connection = new EventSource(
        "/api/chat/conversations/" + id + "/events",
      );
      source = connection;
      connection.onopen = () => {
        if (source === connection) void load();
      };
      connection.addEventListener("change", () => {
        if (source === connection) void load();
      });
      connection.addEventListener("reset", () => {
        connection.close();clearChatDrafts();pending.current=null;window.dispatchEvent(new Event("roppo:chat-space"));
      });
      connection.onerror = () => {
        if (alive.current && source === connection) setConnected(false);
      };
      connection.addEventListener("reconnect", () => {
        if (source === connection) {
          setConnected(false);
          api("/readiness").catch(fail);
        }
      });
    };
    const offline = () => {
      source?.close();
      fetchVersion.current++;
      setConnected(false);
    };
    const online = () => {
      connect();
      void load();
    };
    connect();
    void load();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const poll = setInterval(() => void load(), 8000);
    return () => {
      alive.current = false;
      fetchVersion.current++;
      source?.close();
      clearInterval(poll);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [id, refresh, refreshList]);
  const runtime = useExternalStoreRuntime({
    isRunning: !readonly && (!!reply || sending),
    isLoading: loading,
    isSendDisabled: disabled,
    adapters:{attachments:attachmentAdapter},
    activeRunId: reply?.runId,
    messages: (snapshot?.messages ?? []).filter(m => display === "group" || (readonly ? m.speaker?.id===selected.id || m.recipient?.id===selected.id : !m.recipient && (m.role==="user" || !m.speaker || m.speaker.id===selected.id))),
    convertMessage: (m): ThreadMessageLike => ({
      id: m.id,
      role: m.role,
      createdAt: new Date(m.createdAt),
      metadata:{custom:{speaker:m.speaker,recipient:m.recipient,attachments:m.attachments}},
      content: [{ type: "text", text: m.text }],
      ...(m.role === "assistant"
        ? {
            status:
              m.status === "streaming"
                ? { type: "running" }
                : m.status === "interrupted" || m.status === "failed"
                  ? {
                      type: "incomplete",
                      reason:
                        m.status === "interrupted" ? "cancelled" : "error",
                    }
                  : { type: "complete", reason: "stop" },
          }
        : {}),
    }),
    onNew: async (message) => {
      const text = message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      const attachments=message.attachments?.map(a=>a.id)??[];
      if ((!text&&!attachments.length) || sending || readonly) return;
      setSending(true);
      setError("");
      let target = id;
      let submittedId:string|undefined,accepted=false;
      try {
        if (!target) {
          target = await ensureConversation();
        }
        if (
          !pending.current ||
          pending.current.text !== text ||
          JSON.stringify(pending.current.attachments??[])!==JSON.stringify(attachments) ||
          pending.current.conversationId !== target
        )
          pending.current = {
            text,
            id: crypto.randomUUID(),
            conversationId: target,
            attachments,
          };
        write(pendingKey(target), JSON.stringify(pending.current));
        submittedId=pending.current.id;
        write(draftKey(target), text);
        if (!id && alive.current) {
          const url = new URL(location.href);
          url.search = "";
          history.replaceState(null, "", url);
        }
        if (arrivals.current.conversationId !== target) arrivals.current = {conversationId:target,since:Date.now(),seen:new Set()};
        await api("/conversations/" + target + "/messages", {
          text,
          attachments,
          clientMessageId: pending.current.id,
          locale: navigator.language || lang,
        });
        accepted=true;
        pending.current = null;
        write(pendingKey(target), "null");
        write(draftKey(id), "");
        write(draftKey(target), "");
        await refreshList();
        if (alive.current) {
          if (target !== id) navigate(target);
          else await refresh();
        }
      } catch (e) {
        // Admission and refreshing the view are separate: an acknowledged send is no longer a draft.
        if(accepted){if(alive.current)setError('sent_refresh_failed');return;}
        if(submittedId&&pending.current?.id!==submittedId)return;
        fail(e);
        write(draftKey(target ?? id), text);
        if (alive.current) {
          runtime.thread.composer.setText(text);
          for(const attachment of message.attachments??[])await runtime.thread.composer.addAttachment(attachment);
          if (target && target !== id) navigate(target);
        }
      } finally {
        if (alive.current) setSending(false);
      }
    },
    hasEarlier: snapshot?.hasMore ?? false,
    onLoadEarlier: async () => {
      if (!id || !snapshot?.messages.length) return;
      const data = await api<Snapshot>(
        "/conversations/" +
          id +
          "/messages?before=" +
          snapshot.messages[0]!.sequence + (participantFilter ? "&participant="+encodeURIComponent(participantFilter) : ""),
      );
      if (!alive.current) return;
      const ids = new Set(messagesRef.current.map((m) => m.id));
      const messages = [
        ...data.messages.filter((m) => !ids.has(m.id)),
        ...messagesRef.current,
      ];
      messagesRef.current = messages;
      setSnapshot((s) => (s ? { ...s, messages, hasMore: data.hasMore } : s));
    },
  });
  useEffect(()=>{
    if(!id)return;
    let active=true;
    api<{attachments:ChatAttachment[]}>("/conversations/"+id+"/attachments").then(async result=>{
      for(const file of result.attachments)if(active&&!runtime.thread.composer.getState().attachments.some(a=>a.id===file.id))await runtime.thread.composer.addAttachment(attachmentParts(file));
    }).catch(fail).finally(()=>{if(active)setLoadingAttachments(false)});
    return()=>{active=false};
  },[runtime,id]);
  useEffect(() => {
    runtime.thread.composer.setText(
      read(draftKey(id)) || savedPending(id)?.text || "",
    );
    return runtime.thread.composer.subscribe(() => {
      const composer=runtime.thread.composer.getState(),text=composer.text;write(draftKey(id),text);
      setAttachmentBlocked(composer.attachments.some(a=>a.status.type==='running'||a.status.type==='incomplete'));
      if(uploadConversationId.current&&uploadConversationId.current!==id)write(draftKey(uploadConversationId.current),text);
    });
  }, [runtime, id]);
  useEffect(() => {
    const media = matchMedia("(max-width:800px)");
    const change = () => {
      setNarrow(media.matches);
      if (!media.matches) setMenu(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const saved = pending.current;
    if (
      saved &&
      snapshot?.messages.some((m) => m.clientMessageId === saved.id)
    ) {
      pending.current = null;
      for(const [index,file] of [...runtime.thread.composer.getState().attachments.entries()].reverse())
        if(saved.attachments?.includes(file.id))void runtime.thread.composer.getAttachmentByIndex(index).remove();
      if (runtime.thread.composer.getState().text === saved.text)
        runtime.thread.composer.setText("");
    }
  }, [snapshot, runtime]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !e.defaultPrevented) {
        if (menu) {
          closeNavigation();
        } else if (panel) {
          void choosePanel(null);
          (panelOpener.current?.isConnected?panelOpener.current:teamButton.current)?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, panel, closeNavigation]);
  useEffect(() => {
    if (narrow && menu)
      document
        .querySelector<HTMLAnchorElement>('.function-link[aria-current="page"]')
        ?.focus();
  }, [narrow, menu]);
  const current = snapshot?.conversation;
  return (
    <Context.Provider
      value={{
        lang,
        L,
        calls: snapshot?.calls ?? [],
        workers,
        routerLabel:currentRouter.label,
        run: run ?? null,
        runMessageId,
        arrivals:arrivals.current,
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <div
          className={
            "chat-shell" +
            (menu ? " menu-open" : "") +
            (panel ? " team-open" : "") +
            (navExpanded ? " functions-expanded" : "") +
            (configuring ? " management-mode" : "") +
            (display === "group" ? " conversation-list-hidden" : "")
          }
        >
          <a className="skip-link" href="#conversation">
            {configuring
              ? L("Skip to content", "跳转到内容")
              : L("Skip to conversation", "跳转到对话")}
          </a>
          <FeatureNavigation
            L={L}
            configuring={configuring}
            hash={hash}
            expanded={navExpanded}
            onExpanded={() => setNavExpanded(!navExpanded)}
            mobile={narrow}
            menuOpen={menu}
            closeMenu={closeNavigation}
            openWorkspaces={() => {if(capabilityRoute||automationRoute||pluginId||marketRoute&&!marketTools){history.pushState(null,"",preserveWorkspaceLink(new URL("/configure#tasks",location.origin),new URL(location.href)));window.dispatchEvent(new Event('roppo:navigation'))}setPickerRequest((value) => value + 1)}}
            user={boot?.user}
            views={views.map(view=>({id:view.id,label:view.label[lang]}))}
          />
          {display === "agents" && !configuring ? <aside className="conversation-sidebar" id="agent-list" inert={(narrow && !menu) || (narrow && navExpanded)} aria-label={L("Agents", "Agents 列表")}>
            <header className="conversation-heading"><h2>{L("Agents", "Agents 列表")}</h2></header>
            <div className="agent-list">{participants.map(agent=>{
              const latest=agent.latestMessage,prefix=latest?.role==='user'?L('You: ','你：'):latest?.speaker&&latest.speaker!==agent.label?latest.speaker+': ':'';
              const preview=latest?prefix+latest.text.replace(/\s+/g,' ').trim():L('No messages yet','暂无消息');
              return <div key={agent.id} className="agent-contact-row"><button className="agent-contact" aria-pressed={selected?.id===agent.id} onClick={()=>{setSelectedAgent(agent.id);if(narrow)closeNavigation()}}>
                <AgentAvatar id={agent.id} kind={agent.kind} size={36} /><span><span className="agent-name"><span className="agent-label">{agent.label}</span><span className="agent-role">{agent.kind === "worker" ? "Worker" : "Router"}</span></span><small title={preview}>{preview}</small></span>
              </button><a className="agent-manage" href={"/configure#execution/configuration/"+encodeURIComponent(agent.kind==='router'?'router':agent.id)} aria-label={L('Manage ','管理 ')+agent.label} title={L('Manage ','管理 ')+agent.label}><SlidersHorizontal size={15}/></a></div>
            })}</div>
          </aside> : null}
          {menu ? (
            <button
              className="nav-scrim"
              aria-label={L("Close navigation", "关闭导航")}
              onClick={closeNavigation}
            />
          ) : null}
          <main
            className="chat-main"
            id="conversation"
            tabIndex={-1}
            inert={narrow && menu}
          >
            <header className="chat-header" data-chat={!configuring||undefined}>
              <button
                className="icon-button mobile-menu"
                ref={menuButton}
                onClick={() => setMenu(true)}
                aria-label={L("Open navigation", "打开导航")}
                aria-expanded={menu}
                aria-controls={display === "agents" ? "function-navigation agent-list" : "function-navigation"}
              >
                <Menu size={20} />
              </button>
              <div className="chat-breadcrumb">
                <span>
                  {configuring
                    ? L("Current workspace", "当前工作区")
                    : L("Conversations", "对话")}
                </span>
                <span className="slash">/</span>
                <strong>
                  {configuring
                    ? pageTitle
                    : display === "agents" ? selected?.label : L("Team chat", "团队群聊")}
                </strong>
              </div>
              {!configuring ? <ChatCompanion key={(id??"new")+":"+(readonly?selected.id:"group")} status={companionStatus(snapshot,L,{participantId:readonly?selected.id:undefined,connected,sending,loading})} L={L} onOpen={()=>void choosePanel("activity")}/> : null}
              <div className="header-actions">
                {!configuring ? (
                  <button
                    ref={teamButton}
                    className={"icon-button" + (panel ? " selected" : "")}
                    onClick={() => void choosePanel(panel ? null : resources.tabs.find(t => t.id === resources.active)?.kind ?? "new")}
                    aria-label={L("Session panel", "会话面板")}
                    title={L("Session panel", "会话面板")}
                    aria-expanded={!!panel}
                    aria-controls="session-panel"
                  >
                    <PanelRight size={19} />
                  </button>
                ) : null}
                <IconButton
                  label={
                    dark
                      ? L("Switch to light mode", "切换为浅色模式")
                      : L("Switch to dark mode", "切换为深色模式")
                  }
                  onClick={() => setDark(!dark)}
                >
                  {dark ? <Sun size={19} /> : <Moon size={19} />}
                </IconButton>
                <button
                  className="language-button"
                  onClick={() => setLang(lang === "en" ? "zh-CN" : "en")}
                  aria-label={L("Switch to Chinese", "切换为英文")}
                >
                  {lang === "en" ? "中文" : "EN"}
                </button>
              </div>
            </header>
            {marketRoute?<Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading plugins…","正在加载插件…")}</div>}><PluginMarketplace route={hash} language={lang}/></Suspense>:null}
            {automationRoute?<Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading automations…","正在加载自动化…")}</div>}><AutomationWorkspace language={lang}/></Suspense>:null}
            {capabilityRoute?<WorkspaceTransportOwner language={lang}><Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading workspace…","正在加载工作区…")}</div>}>{templatesRoute?<WorkerTemplates language={lang}/>:connectorsRoute?<ConnectorManagement language={lang}/>:catalogRoute?<ArtifactCatalogPage language={lang}/>:artifactRoute?<ArtifactResult key={hash} id={hash.slice(9)} language={lang}/>:<ExecutionTrace language={lang}/>}</Suspense></WorkspaceTransportOwner>:null}
            <Configuration
              visible={configuring&&!capabilityRoute&&!automationRoute&&!pluginId&&(!marketRoute||marketTools)}
              route={route}
              language={lang}
              pickerRequest={pickerRequest}
            />
            {pluginId?<WorkspaceView key={pluginId} id={pluginId} view={currentView} dark={dark} language={lang}/>:null}
            <div
              ref={bodyRef}
              className={
                "conversation-body" + (panelOverlay ? " panel-overlay" : "")
              }
              hidden={configuring}
            >
              <ThreadPrimitive.Root
                ref={threadRef}
                className="thread"
                inert={panelExpanded || (panelOverlay && !!panel)}
              >
                <ThreadPrimitive.Viewport className="transcript">
                  <div className="transcript-inner">
                    <ThreadPrimitive.LoadEarlier className="load-earlier">
                      {L("Load earlier messages", "加载更早的消息")}
                    </ThreadPrimitive.LoadEarlier>
                    {loading ? (
                      <div className="loading" role="status">
                        <LoaderCircle size={22} className="spin" />
                        {L("Loading conversation", "正在加载会话")}
                      </div>
                    ) : null}
                    <ThreadPrimitive.Empty>
                      <div className="empty-state">
                        <AgentAvatar id={selected.id} kind={selected.kind} size={72} />
                        <h1>
                          {readonly ? L("No collaboration messages yet", "暂无协作消息") : L("What shall we work on?", "今天想完成什么？")}
                        </h1>
                      </div>
                    </ThreadPrimitive.Empty>
                    <ThreadPrimitive.Messages
                      components={{ UserMessage, AssistantMessage }}
                    />
                    {(snapshot?.browsers??[]).filter(b=>(!b.ended||b.runId===run?.id)&&(!readonly||b.workerId===selected.id)).map(b=><div className="chat-browser" key={b.id}>
                      <Globe size={20}/><div><strong>{b.title||L('Browser','浏览器')}</strong><span>{b.handoffReason|| (b.ended?L('Task ended','任务已结束'):b.control==='worker'?L('Agent is browsing','Agent 正在浏览'):L('Waiting for you','等待你操作'))}</span></div>
                      <button onClick={()=>{setBrowserRequest({id:b.id,takeover:!b.ended&&b.control==='paused',key:Date.now()});void choosePanel('browser')}}>{!b.ended&&b.control==='paused'?<Hand size={15}/>:null}{!b.ended&&b.control==='paused'?L('Take control','接管'):L('View page','查看网页')}</button>
                    </div>)}
                    {run && !readonly ? (
                      <div className="run-activity" hidden={!!runMessageId && !workers.some(w=>w.tasks.length)} aria-live="polite">
                        {!runMessageId ? <div className={"run-status " + run.state}>
                          <StatusIcon state={run.state} />
                          <span>{runLabel(run.state, L)}</span>
                        </div> : null}
                        {workers.some((w) => w.tasks.length) ? (
                          <details className="inline-team" open={undefined}>
                            <summary>
                              <ChevronRight size={15} />
                              {L("Team activity", "团队动态")}
                              <span>
                                {workers.filter((w) => w.tasks.length).length}{" "}
                                {L("workers", "个 Worker")}
                              </span>
                            </summary>
                            <WorkerRows
                              workers={workers.filter((w) => w.tasks.length)}
                            />
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </ThreadPrimitive.Viewport>
                <div className="composer-area">
                  <ThreadPrimitive.ScrollToBottom
                    className="scroll-bottom"
                    aria-label={L("Scroll to latest", "回到最新消息")}
                  >
                    <ArrowDown size={17} />
                  </ThreadPrimitive.ScrollToBottom>
                  {error ? (
                    <ErrorNotice code={error} clear={() => setError("")} />
                  ) : null}
                  {!connected ? (
                    <div className="connection-state" role="status">
                      <RefreshCw size={14} />
                      {L(
                        "Reconnecting… Your work continues.",
                        "正在重连，任务仍在继续。",
                      )}
                    </div>
                  ) : null}
                  <Readiness ready={ready} />
                  {readonly ? <div className="composer worker-readonly"><textarea disabled rows={1} aria-label={L("Please talk to Router", "请与 Router 对话")} placeholder={L("Please talk to Router", "请与 Router 对话")}/><button onClick={()=>setSelectedAgent(currentRouter.id)}>{L("Go to Router", "前往 Router")}</button></div> : <ComposerPrimitive.AttachmentDropzone asChild disabled={sending||loadingAttachments||!ready?.ready}><ComposerPrimitive.Root className="composer">
                    <div className="composer-attachments"><ComposerPrimitive.Attachments components={{Attachment:ComposerAttachment}}/></div>
                    <ComposerPrimitive.Input
                      className="composer-input"
                      placeholder={L("Message " + currentRouter.label + "…", "向 " + currentRouter.label + " 发送消息…")}
                      aria-label={L("Message " + currentRouter.label, "向 " + currentRouter.label + " 发送消息")}
                      rows={2}
                      maxLength={100000}
                      submitMode="none"
                      onKeyDown={event=>{
                        if(event.key!=="Enter"||event.shiftKey||event.nativeEvent.isComposing||event.keyCode===229)return;
                        event.preventDefault();
                        runtime.thread.composer.send();
                      }}
                    />
                    <div className="composer-toolbar">
                      <ComposerPrimitive.AddAttachment className="icon-button attach-button" disabled={sending||loadingAttachments||!ready?.ready} aria-label={L('Attach files','上传文件')} title={L('Attach files','上传文件')}><Paperclip size={18}/></ComposerPrimitive.AddAttachment>
                      <RouterModelControl label={currentRouter.label} model={current?.model || ready?.model} busy={running||sending} L={L} onSaved={async()=>{await p.refreshReady();await refresh()}}/>
                      {workers.length ? (
                        <button
                          className="team-chip"
                          type="button"
                          aria-expanded={panel === "activity"}
                          aria-label={L("View Workers and team settings", "查看 Worker 和团队设置")}
                          onClick={() =>
                            void choosePanel(
                              panel === "activity" ? null : "activity",
                            )
                          }
                        >
                          <Users size={15} />
                          <span>
                            {workers.length} {L("workers", "个 Worker")}
                          </span>
                        </button>
                      ) : null}
                      <div className="send-actions">
                        <SendMessage sending={sending}/>
                      </div>
                    </div>
                  </ComposerPrimitive.Root></ComposerPrimitive.AttachmentDropzone>}
                </div>
              </ThreadPrimitive.Root>
              {panel ? (
                <ResourceWorkspace
                  state={resources}
                  onChange={setResources}
                  onOpen={(kind, url) => void choosePanel(kind, url)}
                  expanded={panelExpanded}
                  onExpand={() => setPanelExpanded(!panelExpanded)}
                  onClose={() => { void choosePanel(null); (panelOpener.current?.isConnected?panelOpener.current:teamButton.current)?.focus(); }}
                  L={L}
                >
                  {panel === "files" ? (
                    <FilesPanel conversationId={id} L={L} />
                  ) : panel === "browser" && id && !configuring ? (
                    <BrowserPanel L={L} conversationId={id} requestedSession={browserRequest} requestedUrl={pendingWebsite} onUrlConsumed={consumeWebsite} />
                  ) : panel === "activity" ? (
                    <TeamPanel workers={workers}
                      calls={snapshot?.calls?.filter((c) => c.runId === run?.id) ?? []}
                      active={!!snapshot?.calls?.some((c) => c.runId === run?.id && c.kind === "router" && c.state === "running")}
                      connected={connected}
                    />
                  ) : null}
                </ResourceWorkspace>
              ) : null}
            </div>
          </main>
        </div>
      </AssistantRuntimeProvider>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
