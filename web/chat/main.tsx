import {chatUploadLimits} from '../../src/execution-limits.ts'
import {teamName} from './agent-avatar.tsx';
import {chatLocation} from './pending-links.ts';
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
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  useAuiState,
  useMessagePartText,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import {
  ArrowDown,
  Box,
  ListChecks,
  UsersRound,
  FileText,
  PanelRight,
  Inbox,
  GitCommitHorizontal,
  Menu,
  Settings,
  X,
  ChevronRight,
  LoaderCircle,
  Square,
  AlertCircle,
  Clock3,
  RefreshCw,
} from "lucide-react";
import type { ChatSessions } from "../../src/chat.ts";
import {DeliveryFileCard,DeliveryFileViewer,type DeliveryFile} from "../ui/delivery-files.tsx";
import {useWorkerDiffPreference} from './worker-diff-preference.ts';
import {WorkerFileDiff} from './worker-file-diff.tsx';
import {reportsForTranscript,type DiffTarget,type WorkerReports} from './worker-report-groups.ts';
import {ChatWorkbench,type BenchRequest} from './chat-workbench.tsx';
import {WorkbenchDemo} from './workbench-demo.tsx';
import {Dialog} from '../ui/overlays.tsx';
import {deliveryFile} from "./delivery-links.ts";
import {TeamOverview,SessionSchedules} from './team-view.tsx';

import {BrowserPanel,type BrowserOpenRequest} from './browser.tsx';
import {initialTeamPanel,type TeamTab} from './chat-panel-state.ts';
import {HeartbeatCard} from './heartbeat-card.tsx';
import type {ScheduleEdit} from '../../src/chat-schedules.ts';
import type {HeartbeatChange,HeartbeatStatus} from '../../src/heartbeat.ts';
import type {TaskExecutionDetail} from '../../src/chat-task-detail.ts';
import type {AcceptanceRetryResult} from '../../src/goal-acceptance.ts';
import type {ChatDelivery} from '../../src/chat-deliveries.ts';
import {WorkflowProvider,WorkflowCards,FileReviewCard,PlanReviewCard,RouterDecision,PendingTray,groupWorkflow,type ThinkingItem} from './workflow-cards.tsx';
import {useAppearanceMode} from './appearance-store.ts';
import './appearance-theme.css';
import {ComposerControls} from './composer-actions.tsx';
import {ChatTray} from '../ui/pending-requests.tsx';
import {ThinkingActivity} from './run-thinking.tsx';
import type {GetCommitHistory} from './commit-trail-panel.tsx';
import './run-components.css';
import {ContextCard, useCurrentContext} from './context-card.tsx';
import '../ui/theme.css';
import '../ui/components.css';
import '../ui/agent-components.css';
import '../ui/transitions.css';
import './workflow.css';
import { ChatMemberPicker, StudioRail, General } from "./studio-navigation.tsx";
import { SwitchView, switchView } from "../ui";
import { SidebarSeparator } from "./sidebar-separator.tsx";
import { usePanelPresence } from './panel-presence.ts';
import {lazy,Suspense} from "react";
const PluginMarketplace=lazy(()=>import("./plugin-marketplace.tsx").then(m=>({default:m.PluginMarketplace})));
const ConnectorsWorkspace=lazy(()=>import("./connectors.tsx").then(m=>({default:m.ConnectorsWorkspace})));
const AutomationWorkspace=lazy(()=>import("./automations.tsx").then(m=>({default:m.AutomationWorkspace})));
const WorkInbox=lazy(()=>import('./work-inbox.tsx').then(m=>({default:m.WorkInbox})));
const TaskProgress=lazy(()=>import('./task-progress.tsx').then(m=>({default:m.TaskProgress})));
const MethodLibrary=lazy(()=>import('./method-library.tsx').then(m=>({default:m.MethodLibrary})));
const WorkerTemplates=lazy(()=>import('./worker-templates.tsx').then(m=>({default:m.WorkerTemplates})));
import {WorkspaceTransportOwner} from './workspace-context.tsx';
const UsageStatisticsPage = lazy(() => import("./usage-statistics.tsx").then(module => ({default: module.UsageStatisticsPage})));
const CommitTrailPanel=lazy(()=>import("./commit-trail-panel.tsx"));
const TaskDetail=lazy(()=>import("./task-detail.tsx").then(m=>({default:m.TaskDetail})));
const FirstChatWelcome=lazy(()=>import("./chat-personalization.tsx").then(m=>({default:m.FirstChatWelcome})));
const ChatPersonalizationDialog=lazy(()=>import("./chat-personalization.tsx").then(m=>({default:m.ChatPersonalizationDialog})));
import {spaceRequest,clearChatDrafts,type ChatSpace} from './chat-settings.tsx';
import {parseSendShortcut,sendShortcutStorageKey,type SendShortcut} from './send-shortcut.ts';
import { Configuration } from "./configuration.tsx";
import {WorkspaceView,useWorkspaceViews} from './workspace-view.tsx';
import { AgentAvatar, RoppoAppearanceContext } from "./agent-avatar.tsx";
import type {ChatPersonalization,ChatPreferences} from '../../src/chat-personalization.ts';
import type {ChatArrival} from './chat-arrival.ts';
import {chatPersonalizationCopy} from './personalization-copy.ts';

import {useHandoffPlayer,type HandoffCursor} from './use-handoff.ts';
import {ChatCompanion} from "./companion.tsx";
import {companionStatus,pendingWaitLabel} from "./companion-state.ts";
import {InteractionProvider,MessageActions,MessageTimestamp,Reactions,QuotePreview,QuotedMessage,type DraftQuote} from './message-interactions.tsx';
import {useChatMotion} from './chat-motion.ts';
import type {ChatQuote,ChatQuoteView} from '../../src/chat-interactions.ts';
import {attachmentError,attachmentParts,createAttachmentAdapter,DraftAttachment,MessageAttachments} from './attachments.tsx';
import type {ChatAttachment} from '../../src/chat-attachments.ts';
import type {ChatSkillCatalog,ChatSkillRef} from '../../src/chat-skills.ts';
import {carryInitialDraft,draftKey,forgetPending,planBindingKey,planDraftKey,read,savedDraftSkill,savedPending,skillDraftKey,useMessageSend,write,type OutgoingMessage} from './message-send.ts';
const AppearanceSettings = lazy(() => import('./appearance-settings.tsx').then(module => ({default: module.AppearanceSettings})));
const RichMarkdown=lazy(()=>import("./markdown.tsx"));
import "../../src/ui/theme.css";
import "../../src/ui/typography.css";
import "./style.css";
import "./rich-content.css";
import "./navigation.css";
import "./chat-layout.css";
import "./team-view.css";
import "./task-detail.css";
import "./sidebar-resize.css";
import "./studio.css";
import "./settings-design.css";
import "./floating-chat.css";
import "./transcript-cards.css";
import { WorkspaceSettings, workspaceGroups } from "./workspace-settings.tsx";

type Snapshot = ReturnType<ChatSessions["view"]>;
type Conversation = Snapshot["conversation"];
type Ready = Snapshot["readiness"] & { user?: { displayName: string } };
type Worker = Snapshot["workers"][number];
type Language = "en" | "zh-CN";
type Arrivals = {conversationId:string;since:number;seen:Set<string>};
const quoteKey=(id:string|null)=>"roppo.chat.draft.quote."+(id??"new");
function savedQuote(id:string|null):DraftQuote|null {
  try{return JSON.parse(read(quoteKey(id),'null'))}catch{return null}
}
const quoteReference=(quote:DraftQuote|null):ChatQuote|undefined=>quote?{messageId:quote.messageId,...(quote.excerpt?{excerpt:quote.excerpt}:{})}:undefined;
class ApiError extends Error {
  constructor(readonly code: string, readonly status?:number) {
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
  if (!response.ok) throw new ApiError(result.code ?? "request_failed",response.status);
  return result;
}
const loadContext=(id:string,signal:AbortSignal)=>api<ReturnType<ChatSessions["contextUsage"]>>("/conversations/"+id+"/context",undefined,"GET",signal);
const readHeartbeat=(signal:AbortSignal)=>api<HeartbeatStatus>('/heartbeat',undefined,'GET',signal);
const changeHeartbeat=(change:HeartbeatChange)=>api<HeartbeatStatus>('/heartbeat',change,'PATCH',AbortSignal.timeout(8_000));
const Context = createContext({
  lang: "en" as Language,
  L: (en: string, zh: string) => en,
  workers: [] as Worker[],
  routerLabel: 'Roppo',
  openFile: (_file:ChatDelivery)=>{},
  previewFile: (_file:DeliveryFile)=>{},
  openAgent: (_id:string)=>{},
  inspectDiff: (_target:DiffTarget)=>{},
  run: null as Snapshot['run'],
  showTranscriptDetails: true,
  runMessageId: '',
  waitingLabel: '',
  arrivals: {since: Infinity, seen: new Set<string>()},
});
const useUI = () => useContext(Context);
function simpleChatMessage(message: Snapshot["messages"][number]) {
  if (message.handoff === "assignment") return false;
  return !message.recipient || message.handoff === "result" || !!message.deliveries?.length ||
    !!message.decision || !!message.fileReview;
}
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
    code==='skill_unavailable'?L('This skill is unavailable. Select a skill again or remove it from the draft.','这个技能已不可用。请重新选择，或从草稿中移除。'):
    code==='message_missing'?L('The original message is no longer available.','原消息已不可用。'):
    code==='artifact_unavailable'||code==='delivery_missing'?L('This file is no longer available here.','此文件在当前聊天中已不可用。'):
    code==='file_reveal_failed'?L('Finder could not show the file. You can download it from the file card.','Finder 未能定位文件，可以使用文件卡的下载按钮。'):
    code==='quote_changed'?L('The selected text changed. Please quote it again.','选中的内容已变化，请重新引用。'):
    code==='plan_closed'?L('This planning session has closed. Review the latest proposal.','该规划已结束，请查看最新方案。'):
    code==='plan_busy'?L('Roppo is preparing the next planning step. Your draft is saved.','Roppo 正在规划下一步，草稿已保留。'):
    code==='reaction_failed'?L('Reaction wasn’t saved. Try again.','表情未保存，请重试。'):
    code.startsWith("attachment_")?attachmentError(code,L):
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
function useArrival(id: string, createdAt: number) {
  const { arrivals } = useUI();
  const [fresh] = useState(() => createdAt >= arrivals.since && !arrivals.seen.has(id));
  useEffect(() => { arrivals.seen.add(id); }, [arrivals, id]);
  return fresh || undefined;
}
function Timestamp({ at, receipt }: { at: Date | number; receipt?: 'sending' | 'read' }) {
  const { lang,L } = useUI();
  const status=receipt==='sending'?L('Sending','发送中'):receipt==='read'?L('Read','已读'):undefined;
  return <MessageTimestamp at={at} lang={lang} L={L} status={status}/>;
}
function MessageSkill({skill}:{skill?:ChatSkillRef}){
  return skill?<span className="message-skill"><Box size={13}/><span>/{skill.name}</span></span>:null;
}
function runLabel(state: string, L: (en: string, zh: string) => string, waitingLabel:string) {
  if (state==='failed'||state==='blocked') return waitingLabel||L('Progress saved','进度已保留');
  return ({waiting:waitingLabel||L('Waiting for a task update','等待任务更新'),cancel_requested:L('Stopping…','正在停止…'),cancelled:L('Stopped','已停止')} as Record<string,string>)[state];
}
function UserMessage() {
  const { L, previewFile } = useUI(),
    id = useAuiState((s) => s.message.id),
    attachments = useAuiState((s) => s.message.metadata.custom?.attachments) as ChatAttachment[]|undefined,
    skill = useAuiState((s) => s.message.metadata.custom?.skill) as ChatSkillRef|undefined,
    hasText = useAuiState((s) => s.message.content.some(c=>c.type==='text'&&!!c.text)),
    createdAt = useAuiState((s) => s.message.createdAt),
    arrival = useArrival(id, createdAt.getTime());
  const inline=useAuiState(s=>s.message.metadata.custom?.inlineAnswer===true);
  const readReceipt=useAuiState(s=>s.message.metadata.custom?.readReceipt===true);
  const submission=useAuiState(s=>{
    const pending=s.message.submission;
    if(pending)return pending.id===s.thread.composer.submission?.id?'preparing':'dispatched';
  });
  // Roppo's outbox renders the message after the composer hands it off.
  if(submission==='dispatched')return null;
  if(inline)return <WorkflowCards anchor={id}/>;
  return (
    <>
      <MessagePrimitive.Root className="message user-message" data-arrival={arrival}>
        <UserQuote/>
        <div className="message-line" tabIndex={-1}>
          <div className="message-surface user-bubble">
            <MessageSkill skill={skill}/>
            <MessageAttachments files={attachments??[]} L={L} onPreview={previewFile}/>
            {hasText && <div data-message-body><MessagePrimitive.Parts components={{Text:Markdown}}/></div>}
          </div>
          <MessageActions id={id}/>
        </div>
        <Reactions id={id}/>
        <Timestamp at={createdAt} receipt={submission==='preparing'?'sending':readReceipt?'read':undefined}/>
      </MessagePrimitive.Root>
      <WorkflowCards anchor={id}/>
    </>
  );
}
function OutgoingBubble({message,retry,edit,draftHasContext}:{message:OutgoingMessage;retry:()=>void;edit:()=>void;draftHasContext:boolean}){
  const {L}=useUI();
  const canEdit=useAuiState(s=>!s.composer.text.trim()&&!s.composer.attachments.length);
  const {stage,input,files,quote,createdAt,skill}=message;
  const waiting=stage==='slow'||stage==='unconfirmed';
  const status=stage==='unconfirmed'?L('Delivery not confirmed yet.','还未确认送达。'):
    stage==='rejected'?(message.error==='plan_closed'?L('This plan has closed. Your draft was kept.','此规划已结束，草稿已保留。')
      :message.error==='plan_backend_unavailable'?L('Choose an API or Codex connection to plan first.','先规划需要 API 或 Codex 连接。')
        :L('Message not sent. Your draft is saved.','发送失败，草稿已保留。')):undefined;
  const receipt=status?undefined:stage==='accepted'?'read':'sending';
  return <div className="message user-message" data-outgoing={stage}>
    <QuotedMessage quote={quote??undefined}/>
    <div className="message-line"><div className="message-surface user-bubble">
      <MessageSkill skill={skill}/>
      {!!files.length&&<div className="message-attachments">{files.map(file=><span key={file.id} className="chat-attachment"><FileText size={22}/><span className="attachment-info"><strong>{file.name}</strong></span></span>)}</div>}
      {input.text&&<div>{input.text}</div>}
    </div></div>
    {(status||waiting)&&<div className="chat-send-status">{status&&<span role="status">{status}</span>}
      {waiting&&<button type="button" className="text-button" onClick={retry}>{L('Retry send','重试')}</button>}
      {stage==='rejected'&&<button type="button" className="text-button" disabled={!canEdit||draftHasContext} onClick={edit}>{L('Edit message','编辑消息')}</button>}
    </div>}
    <Timestamp at={createdAt} receipt={receipt}/>
  </div>;
}
function UserQuote(){const quote=useAuiState(s=>s.message.metadata.custom?.quote) as ChatQuoteView|undefined;return <QuotedMessage quote={quote}/>}
function ComposerAttachment(){const {L}=useUI();return <DraftAttachment L={L}/>}
function PlainText(){const {text}=useMessagePartText();return <span>{text}</span>}
function Markdown(){
  const { L } = useUI();
  const files = useAuiState(s => s.message.metadata.custom?.linkFiles) as ChatDelivery[] | undefined;
  return <Suspense fallback={<PlainText/>}><RichMarkdown L={L} files={files}/></Suspense>
}
function AssistantMessage() {
  const { L, run, runMessageId, waitingLabel, routerLabel, openFile,previewFile,openAgent,inspectDiff, showTranscriptDetails } = useUI(),
    deliveries=useAuiState(s=>s.message.metadata.custom?.deliveries) as ChatDelivery[]|undefined,
    workerReports=useAuiState(s=>s.message.metadata.custom?.workerReports) as WorkerReports|undefined,
    decision=useAuiState(s=>s.message.metadata.custom?.decision) as Snapshot["messages"][number]["decision"],
    fileReview=useAuiState(s=>s.message.metadata.custom?.fileReview) as (NonNullable<Snapshot["messages"][number]["fileReview"]> & {name:string})|undefined,
    id = useAuiState((s) => s.message.id),
    attachments = useAuiState((s) => s.message.metadata.custom?.attachments) as ChatAttachment[]|undefined,
    createdAt = useAuiState((s) => s.message.createdAt),
    arrival = useArrival(id, createdAt.getTime()),
    speaker = useAuiState((s) => s.message.metadata.custom?.speaker) as Snapshot["participants"][number]|undefined,
    recipient = useAuiState((s) => s.message.metadata.custom?.recipient) as Snapshot["participants"][number]|undefined,
    status = useAuiState((s) => s.message.status),
    commentary = useAuiState((s) => !!s.message.metadata.custom?.commentary),
    sharedImages = useAuiState((s) => !!s.message.metadata.custom?.sharedImages),
    hasText = useAuiState((s) =>
      s.message.content.some((c) => c.type === "text" && !!c.text),
    ),
    streaming = status?.type === "running",
    footerStatus = run && runMessageId === id ? runLabel(run.state,L,waitingLabel??'') : undefined;
  const continuedReview=useAuiState(s=>!!s.message.metadata.custom?.continuedReview);
  const proposal=useAuiState(s=>s.message.metadata.custom?.planProposal);
  const hasCard=!!(deliveries?.length||fileReview||decision||proposal);
  const patchReceipt=useAuiState(s=>s.message.metadata.custom?.workerPatchReceipt===true);
  if(patchReceipt && workerReports?.length)return <><div className="workflow-block worker-diff-standalone" data-message-id={id}>
    <WorkerFileDiff reports={workerReports} inspect={inspectDiff} openAgent={openAgent} L={L}/></div><WorkflowCards anchor={id}/></>;
  if ((streaming || commentary) && !hasText) return <WorkflowCards anchor={id}/>;
  let body: ReactNode;
  if (sharedImages) {
    body = hasText ? <div data-message-body><MessagePrimitive.Parts components={{ Text: Markdown }}/></div> : null;
  } else if (deliveries?.length) {
    body = <>{fileReview && <FileReviewCard id={id} name={fileReview.name} review={fileReview}/>} {deliveries.map(file => <DeliveryFileCard key={file.id} L={L} file={deliveryFile(file)} compactImage onOpen={()=>openFile(file)}/>)}</>;
  } else if (fileReview) {
    body = <FileReviewCard id={id} name={fileReview.name} review={fileReview}/>;
  } else if (decision) {
    body = <RouterDecision id={id} decision={decision}/>;
  } else if (proposal) {
    body = <PlanReviewCard id={id} confirmed={proposal==='confirmed'}><MessagePrimitive.Parts components={{ Text: Markdown }}/></PlanReviewCard>;
  } else {
    body = <div data-message-body><MessagePrimitive.Parts components={{ Text: Markdown }}/></div>;
  }
  return (
    <><MessagePrimitive.Root
      className="message assistant-message"
      data-commentary={commentary ? "true" : undefined}
      data-shared-images={sharedImages ? "true" : undefined}
      data-arrival={arrival}
      data-streaming={streaming ? "true" : undefined}
    >
      {!continuedReview && <div className="assistant-identity">
        <AgentAvatar id={speaker?.id} kind={speaker?.kind} size={32} />
        <strong>{speaker?.kind==='worker'?speaker.label:teamName(speaker?.label??routerLabel)}</strong>
        <Timestamp at={createdAt}/>
        {commentary ? <span className="output-state">
          {streaming && <span className="live-dot" />}{L("Task progress", "任务进度")}
        </span> : streaming && showTranscriptDetails ? (
          <span className="output-state">
            <span className="live-dot" />
            {L("Writing", "正在输出")}
          </span>
        ) : null}
      </div>}
      <div className="assistant-body">
        <div className={hasCard?"message-line message-card-line":"message-line"} tabIndex={-1}>
          <div className={hasCard?"message-surface":"message-surface assistant-bubble"}>
            {recipient ? <div className="addressed-message">
              <button type="button" className="chat-mention" onClick={()=>openAgent(recipient.id)}>@{recipient.kind==='router'?teamName(recipient.label):recipient.label}</button>{' '}{body}
            </div> : body}
            <MessageAttachments files={attachments??[]} L={L} onPreview={previewFile}/>
          </div>
          <MessageActions id={id}/>
        </div>
        {!!workerReports?.length && <WorkerFileDiff reports={workerReports} inspect={inspectDiff} openAgent={openAgent} L={L}/>}
        <Reactions id={id}/>
        {run && footerStatus && !(run.state==='waiting' && waitingLabel) ? <span className={'message-status ' + run.state} role="status"><StatusIcon state={run.state} />{footerStatus}</span> : status?.type === 'incomplete' ? <span className="message-status">{status.reason === 'cancelled' ? L('Output stopped','输出已停止') : L('Progress saved','进度已保留')}</span> : null}
      </div>
    </MessagePrimitive.Root><WorkflowCards anchor={id}/></>
  );
}
function StatusIcon({ state }: { state: string }) {
  return state === "waiting" ? (
    <Clock3 size={16} />
  ) : state === "cancelled" ? (
    <Square size={12} />
  ) : (
    <span className="idle-dot" />
  );
}
function ThinkingCalls({item,workers,live}:{item:ThinkingItem;workers:Worker[];live:boolean}){
  const {L,lang,routerLabel}=useUI();
  const arrival=useArrival('thinking:'+item.runId,item.at);
  return <ThinkingActivity calls={item.calls} runState={item.state} L={L} locale={lang} arrival={arrival} live={live}
    actor={id=>workers.find(w=>w.id===id)?.label??id??routerLabel}/>;
}
function Readiness({ ready }: { ready: Ready | null }) {
  const { L } = useUI();
  if (!ready || ready.ready) return null;
  const messages: Record<string, string> = {
    host_router_required: L(
      "Enable the workspace assistant to start chatting.",
      "启用工作区助手后即可对话。",
    ),
    host_paused: L("The host is paused.", "运行已暂停。"),
    local_source_required: L(
      "Add a local conversation entry.",
      "请添加本地会话入口。",
    ),
    model_credentials_missing: L(
      "Connect a model to start chatting.",
      "请连接对话模型。",
    ),
    model_unavailable: L(
      "Your chat model is unavailable.",
      "对话模型暂不可用。",
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
          L("Set up your assistant to begin.", "请先配置助手。")}
      </span>
      <a
        href={
          ready.code === "host_paused"
            ? "/configure#advanced/host"
            : ready.configurationUrl
        }
      >
        {L("Configure assistant", "配置助手")}
        <ChevronRight size={15} />
      </a>
    </div>
  );
}
function App() {
  const handoffCursor=useRef<HandoffCursor["current"]>(null);
  const chatArrivals = useRef<Arrivals>({conversationId:'',since:Infinity,seen:new Set()});

  const [route, setRoute] = useState(
    location.pathname + location.search + location.hash,
  );
  const [id, setId] = useState<string | null>(null),
    [display, setDisplay] = useState<ChatSpace["display"]>("group"),
    [detailMode, setDetailMode] = useState<ChatSpace["detailMode"]>("detailed"),
    [progressMode, setProgressMode] = useState<ChatSpace["progressMode"]>("completion"),
    [approvalMode,setApprovalMode] = useState<ChatSpace["approvalMode"]>(),
    [ready, setReady] = useState<Ready | null>(null);
  const [personalization,setPersonalization] = useState<ChatPersonalization>();
  const receivePersonalization=useCallback((next:ChatPersonalization)=>{
    setPersonalization(current=>!current||next.revision>=current.revision?next:current);
  },[]);
  const [setupDismissed,setSetupDismissed] = useState(false);
  const [editor,setEditor] = useState<{mode:'first'|'edit';open:boolean}>();
  const focusAfterSetup=useRef(false);
  const spaceVersion=useRef(0);
  const currentId=useRef(id);currentId.current=id;
  const sendTransport=useMemo<Parameters<typeof useMessageSend>[0]>(()=>({
    open:async signal=>{
      const {conversation}=await api<ChatSpace>('/space',{},'POST',signal);
      if(!conversation)throw new ApiError('conversation_missing');
      if(!signal.aborted)handoffCursor.current={id:conversation.id,sequence:conversation.sequence};
      return conversation.id;
    },
    post:(target,input,signal)=>api('/conversations/'+target+'/messages',input,'POST',signal),
    rejection:error=>error instanceof ApiError&&error.status&&error.status>=400&&error.status<500&&![408,429].includes(error.status)?error.code:undefined,
  }),[]);
  const adoptConversation=useCallback((target:string)=>{
    if(currentId.current)return;
    carryInitialDraft(target);
    spaceVersion.current++;
    setId(current=>current??target);
  },[]);
  const sends=useMessageSend(sendTransport,adoptConversation);
  const {recoverInitial,reset:resetSends}=sends;
  const lastReset=useRef(read('roppo.chat.reset'));
  const [navExpanded, setNavExpanded] = useState(read("roppo.navigation.expanded") !== "false");
  useEffect(() => write("roppo.navigation.expanded", String(navExpanded)), [navExpanded]);
  const [lang, setLang] = useState<Language>(
      read("agenthub.configuration.language") === "en" ? "en" : "zh-CN",
    );
  const [sendShortcut, setSendShortcut] = useState(() => parseSendShortcut(read(sendShortcutStorageKey)));
  const saveSendShortcut = (value: SendShortcut) => {
    write(sendShortcutStorageKey, value);
    setSendShortcut(value);
  };
  const dark = useAppearanceMode() === "dark";
  const L = useCallback(
    (en: string, zh: string) => (lang === "zh-CN" ? zh : en),
    [lang],
  );
  const saveApprovalMode = async (mode: ChatSpace["approvalMode"]) => {
    const saved = await spaceRequest({approvalMode: mode}, "PATCH");
    spaceVersion.current++;
    setApprovalMode(saved.approvalMode);
  };
  const saveDetailMode = async (mode: ChatSpace["detailMode"]) => {
    const saved = await spaceRequest({detailMode: mode}, "PATCH");
    spaceVersion.current++;
    setDetailMode(saved.detailMode);
  };
  const saveProgressMode = async (mode: ChatSpace["progressMode"]) => {
    const saved = await spaceRequest({progressMode: mode}, "PATCH");
    spaceVersion.current++;
    setProgressMode(saved.progressMode);
  };
  const refreshList = useCallback(async () => {
    const version=++spaceVersion.current,space=await spaceRequest();if(version!==spaceVersion.current)return;
    if(space.cleanup && lastReset.current!==space.cleanup.id){
      lastReset.current=space.cleanup.id;resetSends();
      if(read('roppo.chat.reset')!==space.cleanup.id){clearChatDrafts();write('roppo.chat.reset',space.cleanup.id)}
    }
    const linked=location.pathname==="/chat" ? chatLocation(location.hash) : undefined;
    if(!linked?.conversation&&space.conversation){
      recoverInitial(space.conversation.id);
      if(!currentId.current)carryInitialDraft(space.conversation.id);
    }
    setId(linked?.conversation || space.conversation?.id || null);setDisplay(space.display);setApprovalMode(space.approvalMode);
    setDetailMode(space.detailMode);
    setProgressMode(space.progressMode);
    receivePersonalization(space.personalization);
  }, [recoverInitial,resetSends,receivePersonalization]);
  function focusComposer() {
    if(location.pathname==='/chat')document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus({preventScroll:true});
  }
  function openPersonalization(mode:'first'|'edit') {
    if(personalization)setEditor({mode,open:true});
  }
  function closePersonalization() {
    setEditor(current=>current?{...current,open:false}:undefined);
  }
  async function savePersonalization(preferences:ChatPreferences,arrival?:ChatArrival) {
    if(!personalization)return;
    let next:ChatPersonalization;
    try{
      next=await api<ChatPersonalization>('/personalization',{action:'save',revision:personalization.revision,preferences},
        'POST',AbortSignal.timeout(12000));
    }catch(error){
      if(error instanceof ApiError&&error.code==='personalization_conflict')await refreshList().catch(()=>{});
      throw error;
    }
    focusAfterSetup.current=editor?.mode==='first';
    if(arrival&&location.pathname==='/chat'){
      await arrival(
        ()=>flushSync(()=>receivePersonalization(next)),
        dialog=>{
          if(!dialog?.open){closePersonalization();return}
          // The trace already owns the exit. Close the native layer without running a second one.
          flushSync(closePersonalization);
          dialog.close();
        },
      );
    }else{
      receivePersonalization(next);
      closePersonalization();
    }
  }
  function skipPersonalization() {
    setSetupDismissed(true);
    if(editor?.open){focusAfterSetup.current=true;closePersonalization()}
    else requestAnimationFrame(focusComposer);
    void api<ChatPersonalization>('/personalization',{action:'skip'},'POST',AbortSignal.timeout(6000))
      .then(receivePersonalization).catch(()=>{});
  }
  useEffect(()=>{const change=()=>void refreshList();window.addEventListener('roppo:chat-space',change);return()=>window.removeEventListener('roppo:chat-space',change)},[refreshList]);
  const navigate = useCallback((next: string | null) => {
    setId(next);
    const url = new URL("/chat", location.origin);
    if(location.pathname === "/chat" && location.hash === "#schedules") url.hash = "schedules";

    history.pushState(null, "", url);
    switchView("page",()=>setRoute(url.pathname + url.search + url.hash));
  }, []);
  useEffect(() => {
    const isLibrary = (hash: string) => hash === '#integrations' || /^#integrations\/library(?:\/|$)/.test(hash);
    let previousHash = location.hash;
    let previousPath = location.pathname;
    const sync = () => {
      if (location.hash === "#prompts/memory") history.replaceState(null, "", location.pathname + location.search + "#advanced/memory");
      if (location.pathname === "/configure" && location.hash === "#integrations/library/app") history.replaceState(null, "", "/configure#connectors");
      if (location.pathname === "/chat" && location.search && new URLSearchParams(location.search).get('browser') !== 'open')
        history.replaceState(null, "", "/chat" + location.hash);
      if (location.pathname === "/chat" && previousHash !== location.hash) void refreshList();
      const next = location.pathname + location.search + location.hash;
      // Filtering and opening library items update the same page, including its live search input.
      if ((previousPath === "/chat" && location.pathname === "/chat") || (isLibrary(previousHash) && isLibrary(location.hash))) setRoute(next);
      else switchView("page", () => setRoute(next));
      previousHash = location.hash;
      previousPath = location.pathname;
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
      const url = new URL(anchor.href);
      if (
        url.origin !== location.origin ||
        !["/configure", "/configure/", "/chat"].includes(url.pathname)
      )
        return;
      event.preventDefault();
      if (url.pathname === "/chat" && url.searchParams.get('browser') !== 'open') url.search = "";
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
  const readinessVersion = useRef(0);
  const refreshReady = useCallback(async () => {
    const version = ++readinessVersion.current;
    const next = await api<Ready>("/readiness");
    if (version === readinessVersion.current) setReady(next);
  }, []);
  useEffect(() => {
    const read = () => {
      refreshReady().catch(() => {});
      refreshList().catch(() => {});
    };
    read();
    const timer = setInterval(read, 10000);
    return () => {
      readinessVersion.current++;
      clearInterval(timer);
    };
  }, [refreshList, refreshReady]);
  useEffect(() => {
    document.documentElement.lang = lang;
    write("agenthub.configuration.language", lang);
  }, [lang, L]);
  useEffect(() => {
    const storage = (e: StorageEvent) => {
      if (e.key === "agenthub.configuration.language")
        setLang(e.newValue === "zh-CN" ? "zh-CN" : "en");
      if (e.key === sendShortcutStorageKey || e.key === null)
        setSendShortcut(parseSendShortcut(e.newValue));
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, []);
  return (
    <RoppoAppearanceContext value={personalization?.preferences?.appearance??'classic'}>
      <div
        id="announcer"
        className="sr-only"
        role="status"
        aria-live="polite"
      />
      <Chat
        handoffCursor={handoffCursor}
        arrivals={chatArrivals}
        sends={sends}
        key={id ?? "new"}
        {...{
          id,
          display,
          setDisplay,
          detailMode,
          saveDetailMode,
          progressMode,
          saveProgressMode,
          approvalMode,
          saveApprovalMode,
          ready,
          refreshReady,
          lang,
          L,
          dark,
          navigate,
          refreshList,
          setLang,
          sendShortcut,
          saveSendShortcut,
          route,
          navExpanded,
          setNavExpanded,
          preferences:personalization?.preferences,
          offerPersonalization:!!(personalization?.offer&&ready?.user&&!setupDismissed),
          openPersonalization:personalization?openPersonalization:undefined,
          skipPersonalization,
        }}
      />
      {editor&&personalization&&<Suspense fallback={null}>
        <ChatPersonalizationDialog open={editor.open} mode={editor.mode} state={personalization} L={L}
          onSave={savePersonalization} onSkip={skipPersonalization} onClose={closePersonalization}
          onAfterClose={()=>{
            setEditor(current=>current?.open?current:undefined);
            if(focusAfterSetup.current){focusAfterSetup.current=false;focusComposer()}
          }}/>
      </Suspense>}
    </RoppoAppearanceContext>
  );
}
type ChatProps = {
  handoffCursor:HandoffCursor;
  arrivals: React.RefObject<Arrivals>;
  sends: ReturnType<typeof useMessageSend>;
  navExpanded: boolean;
  setNavExpanded: (value: boolean) => void;
  display: ChatSpace["display"];
  detailMode: ChatSpace["detailMode"];
  saveDetailMode: (mode: ChatSpace["detailMode"]) => Promise<void>;
  progressMode: ChatSpace["progressMode"];
  saveProgressMode: (mode: ChatSpace["progressMode"]) => Promise<void>;
  approvalMode?: ChatSpace["approvalMode"];
  saveApprovalMode: (mode: ChatSpace["approvalMode"]) => Promise<void>;
  setDisplay: (value:ChatSpace["display"])=>void;
  preferences?: ChatPreferences;
  offerPersonalization: boolean;
  openPersonalization?: (mode:'first'|'edit')=>void;
  skipPersonalization: ()=>void;
  route: string;
  id: string | null;
  ready: Ready | null;
  lang: Language;
  L: (en: string, zh: string) => string;
  dark: boolean;
  navigate: (id: string | null) => void;
  refreshList: () => Promise<void>;
  refreshReady: () => Promise<void>;
  setLang: (v: Language) => void;
  sendShortcut: SendShortcut;
  saveSendShortcut: (value: SendShortcut) => void;
};

function Chat(p: ChatProps) {
  const {
    id,
    display,
    ready: boot,
    lang,
    L,
    dark,
    navigate,
    refreshList,
    setLang,
    route,
    navExpanded,
    setNavExpanded,
  } = p;
  const showTranscriptDetails = p.detailMode !== "simple";
  const configuring = !route.startsWith("/chat");
  const [trayOpen,setTrayOpen]=useState(()=>read('roppo.chat.pendingTray')==='open');
  const trayButton=useRef<HTMLButtonElement>(null);
  const [activityTrayOpen,setActivityTrayOpen]=useState(false);
  const activityButton=useRef<HTMLButtonElement>(null);
  const activityOpener=useRef<HTMLElement|null>(null);
  const loadCommitHistory=useCallback<GetCommitHistory>((target,signal)=>{
    const query=new URLSearchParams();
    if(id)query.set('conversation',id);
    if(target.repository)query.set('repository',target.repository);
    if(target.branch)query.set('branch',target.branch);
    return api('/commit-trail?'+query,undefined,'GET',signal);
  },[id]);
  const requestedItem=chatLocation(route.slice(route.indexOf('#')));
  const linkedItem=requestedItem?.conversation===id ? requestedItem?.item : undefined;
  const linkOrigin=useRef<HTMLAnchorElement|null>(null);
  const [linkVisit,setLinkVisit]=useState(0);
  const previousLinkedItem=useRef<string | undefined>(undefined);
  const readHistory=useCallback(<T,>(query:URLSearchParams,signal:AbortSignal)=>api<T>('/conversations/'+id+'/approval-history?'+query,undefined,'GET',signal),[id]);
  const clearSelection=()=>{
    if(chatLocation(location.hash)?.item){
      previousLinkedItem.current=undefined;
      history.replaceState(null,'','#conversation/'+id);
      window.dispatchEvent(new Event('hashchange'));
    }
  };
  const changeTray=(open:boolean)=>{
    if(!open)clearSelection();
    setTrayOpen(open);
    write('roppo.chat.pendingTray',open?'open':'closed');
  };
  const closeTray=()=>{
    changeTray(false);
    const origin=linkOrigin.current;
    const target=origin?.isConnected?origin:trayButton.current;
    target?.focus({preventScroll:true});
    if(target && document.activeElement!==target)requestAnimationFrame(()=>target.focus({preventScroll:true}));
    linkOrigin.current=null;
  };
  function closeActivityTray(restoreFocus=true){
    setActivityTrayOpen(false);
    const origin=activityOpener.current;
    activityOpener.current=null;
    if(restoreFocus)(origin?.isConnected?origin:activityButton.current)?.focus({preventScroll:true});
  }
  const panelKey = 'roppo.chat.team-panel.' + (id ?? 'new');
  const [initialPanel] = useState(() => initialTeamPanel(read(panelKey),
    read('roppo.resources.' + (id ?? 'new')), read('roppo.chat.panel.' + (id ?? 'new'))));
  const [panel,setTeamPanelOpen]=useState(false);
  const [contextOpen,setContextOpen]=useState(false);
  const [bench,setBench]=useState<BenchRequest|null>(null),[benchExpanded,setBenchExpanded]=useState(false);
  const benchSerial=useRef(0),benchOrigin=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(configuring){setTeamPanelOpen(false);setContextOpen(false);setBench(null);setBenchExpanded(false)}},[configuring]);
  const [teamTab,setTeamTab]=useState<TeamTab>(initialPanel.tab),[file,setFile]=useState<DeliveryFile|null>(null);
  function openBench(kind:BenchRequest['kind']='resume',target?:DiffTarget,browser?:BrowserOpenRequest){
    if(!bench)benchOrigin.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setTeamPanelOpen(false);setContextOpen(false);setBench({serial:++benchSerial.current,kind,target,browser});
    if(trayOpen)changeTray(false);if(activityTrayOpen)closeActivityTray(false);
  }
  function closeBench(){
    setBench(null);setBenchExpanded(false);
    restorePanelFocus(()=>benchOrigin.current?.isConnected?benchOrigin.current:teamButton.current);
  }
  const [selectedTask,setSelectedTask]=useState<string|null>(null);
  const taskOpener=useRef<HTMLButtonElement>(null);
  const loadTask=useCallback((task:string,signal:AbortSignal) =>
    api<TaskExecutionDetail>('/conversations/'+id+'/task-detail?'+new URLSearchParams({task}),undefined,'GET',signal),[id]);
  const retryAcceptance=useCallback((task:string,revision:number) =>
    api<AcceptanceRetryResult>('/conversations/'+id+'/task-acceptance',{task,revision}),[id]);
  useEffect(()=>{
    if(new URL(route,location.origin).searchParams.get('browser')==='open'||(id&&sessionStorage.getItem('roppo.open-browser')===id)){
      sessionStorage.removeItem('roppo.open-browser');
      setBench({serial:++benchSerial.current,kind:'browser'});
    }
  },[route,id]);
  const sessionView = useMemo(() => panel && !configuring ? {tab:teamTab,task:selectedTask} : null,
    [panel,configuring,teamTab,selectedTask]);
  const sessionPresence = usePanelPresence(sessionView);
  const displayedSession = sessionPresence.view;
  const shownTask = displayedSession?.task ?? null;
  const taskPresence = usePanelPresence(shownTask);
  const [pickerRequest,setPickerRequest]=useState(0);
  const creating = useRef(false);
  const openFirstBrowser = async () => {
    if (creating.current) return;
    creating.current = true;
    try {
      const conversation = (await spaceRequest({}, "POST")).conversation!;
      if (!alive.current || location.pathname !== "/chat") return;
      sessionStorage.setItem('roppo.open-browser',conversation.id);
      carryInitialDraft(conversation.id);
      await refreshList();
      if (alive.current && location.pathname === "/chat") navigate(conversation.id);
    } catch (error) {
      fail(error);
    } finally {
      creating.current = false;
    }
  };
  const showPanel = (open: boolean) => {
    if(open&&panelOverlay&&trayOpen)changeTray(false);
    if(open&&panelOverlay&&activityTrayOpen)closeActivityTray(false);
    setSelectedTask(null);
    if(open&&!panel)panelOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(open){setBench(null);setBenchExpanded(false);setContextOpen(false)}
    setTeamPanelOpen(open);
  };
  const hash = route.split("#")[1] || "general";
  const general = configuring && hash === "general";
  const appearance = configuring && hash === "appearance";
  const workView = configuring && (hash === 'attention' || hash === 'worker-templates' || hash === 'methods' || hash === 'execution-trace' || hash.startsWith('execution-trace/'));
  const workspaceIndex = configuring && hash === "workspace";
  const workspacePage = workspaceGroups(L).flatMap(group => group.items).find(item => hash === item.hash);
  const automationRoute=configuring&&hash==='automations';
  const marketRoute=configuring&&(hash==='integrations'||hash.startsWith('integrations/'));
  const connectorsRoute=configuring&&(hash==='connectors'||hash==='connectors/access');
  const usageStatisticsRoute = configuring && hash === 'tasks/statistics';
  const marketTools=hash==='integrations/tools';
  const views=useWorkspaceViews();
  const pluginId=configuring&&hash.startsWith('plugin/')?hash.slice(7):null;
  const currentView=views.find(view=>view.id===pluginId);
  const pageNames: Record<string, string> = {
    general: L("General", "通用"),
    attention: L("Needs my attention","待我处理"),
    methods: L("Reminders and methods","提醒与方法"),
    "worker-templates": L("Worker templates","Worker 模板"),
    "execution-trace": L("Task progress","任务进度"),
    appearance: L("Appearance", "外观"),
    team: L("Agent team","Agent 团队"),
    tasks: L("Activity", "运行记录"),
    "tasks/active": L("Activity", "运行记录"),
    "tasks/history": L("Activity", "运行记录"),
    "tasks/statistics": L("Usage statistics", "使用统计"),
    "advanced/memory": L("Memory","记忆"),
    "advanced/chat": L("Conversations and context", "对话与上下文"),
    "advanced/configuration": L("Run settings","运行配置"),
    workspace: L("Workspace settings","工作区设置"),
    "models/new": L("New model connection", "新建模型连接"),
    "connections/new": L("New entry", "新建接入"),
    automations: L("Event automations", "事件自动化"),
    execution: L("Model calls", "模型调用"),
    "execution/configuration": L("Agent team", "Agent 团队"),
    deployments: L("Deployments", "部署"),
    models: L("Model connections", "模型连接"),
    connections: L("Conversation entries", "会话入口"),
    integrations: L("Tools & MCP", "工具与 MCP"),
    connectors: L("Connectors", "连接器"),
    prompts: L("Behavior rules", "行为规则"),
    advanced: L("Settings", "设置"),
    usage: L("Usage guide", "使用指引"),
  };
  const pageTitle =
    currentView?.label[lang] ?? workspacePage?.name ??
    (hash.startsWith("execution/configuration/") ? pageNames["execution/configuration"] : undefined) ??
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
    [menu, setMenu] = useState(false),
    [selectedAgent, setSelectedAgent] = useState("router"),
    [panelOverlay, setPanelOverlay] = useState(false),
    [narrow, setNarrow] = useState(
      () => matchMedia("(max-width:800px)").matches,
    );
  const alive = useRef(true),
    fetchVersion = useRef(0),
    messagesRef = useRef<Snapshot["messages"]>([]),
    contextVersionRef = useRef(0),
    restoredPending = useRef<ReturnType<typeof savedPending>>(null),
    bodyRef = useRef<HTMLDivElement>(null),
    threadRef = useRef<HTMLDivElement>(null),
    panelOpener = useRef<HTMLElement|null>(null),
    teamButton = useRef<HTMLButtonElement>(null),
    menuButton = useRef<HTMLButtonElement>(null);
  const [quote,setQuote]=useState<DraftQuote|null>(()=>{
    const saved=savedPending(id),draft=read(draftKey(id));
    return savedQuote(id)??(saved&&!p.sends.has(saved.id)&&(!draft||draft.trim()===saved.text)?saved.draftQuote??null:null);
  }),[around,setAround]=useState<string>();
  const [skill,setSkill]=useState<ChatSkillRef|null>(()=>{
    const saved=savedPending(id),draft=read(draftKey(id));
    return savedDraftSkill(id)??(saved&&!p.sends.has(saved.id)&&(!draft||draft.trim()===saved.text)?saved.skill??null:null);
  });
  const [planDraft,setPlanDraft]=useState(()=>{
    const saved=savedPending(id);
    return read(planDraftKey(id))==='true'||!!(saved?.startPlan&&!p.sends.has(saved.id));
  });
  const planDraftCurrent=useRef(planDraft);
  const planningDraftId=useRef(read(planBindingKey(id))||savedPending(id)?.planningId||'');
  const clearDraftBinding=useCallback(()=>{
    planningDraftId.current='';write(planBindingKey(id),'');
  },[id]);
  const savePlanDraft=useCallback((value:boolean)=>{
    if(value)clearDraftBinding();
    planDraftCurrent.current=value;setPlanDraft(value);write(planDraftKey(id),value?'true':'');
  },[id,clearDraftBinding]);
  const skillCurrent=useRef(skill);
  const locateAfterLoad=useRef<string|null>(null),locateRequest=useRef(0),quoteCurrent=useRef(quote);quoteCurrent.current=quote;
  const queuedEnter=useRef<string|null>(null);
  const reactionWrites=useRef(new Map<string,{reactions:string[];promise:Promise<string[]>}>());
  const saveQuote=useCallback((value:DraftQuote|null)=>{quoteCurrent.current=value;setQuote(value);write(quoteKey(id),JSON.stringify(value))},[id]);
  useEffect(() => {
    const thread=threadRef.current, transcript=thread?.querySelector<HTMLElement>('.transcript');
    if(!thread||!transcript)return;
    const measure=()=>{
      if(!thread.clientWidth)return;
      thread.style.setProperty('--chat-scrollbar-gutter',(transcript.offsetWidth-transcript.clientWidth)/2+'px');
      const {paddingTop,paddingBottom}=getComputedStyle(transcript);
      const contentHeight=transcript.clientHeight-parseFloat(paddingTop)-parseFloat(paddingBottom);
      thread.style.setProperty('--chat-transcript-content-height',Math.max(0,contentHeight)+'px');
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
        setPanelOverlay(innerWidth <= 800 || entry.contentRect.width < 720);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const participants = (snapshot?.participants ?? [{id:"router",label:boot?.routerLabel??"Router",kind:"router" as const,latestMessage:null},...(boot?.workers??[]).map(w=>({id:w.id,label:w.label,kind:"worker" as const,latestMessage:null}))]).map(p=>p.kind==="router"?{...p,label:teamName(p.label)}:p);
  const uploadConversation=useRef<Promise<string>|null>(null),uploadConversationId=useRef(id),[loadingAttachments,setLoadingAttachments]=useState(!!id),[attachmentBlocked,setAttachmentBlocked]=useState(false);
  const saveSkill=useCallback((selected:ChatSkillRef|null)=>{
    skillCurrent.current=selected;
    setSkill(selected);
    write(skillDraftKey(id),JSON.stringify(selected));
    if(uploadConversationId.current&&uploadConversationId.current!==id)
      write(skillDraftKey(uploadConversationId.current),JSON.stringify(selected));
  },[id]);
  const loadSkills=useCallback((signal:AbortSignal)=>api<ChatSkillCatalog>(
    '/skills'+(id?'?'+new URLSearchParams({conversation:id}):''),undefined,'GET',signal,
  ),[id]);
  const ensureConversation=useCallback(()=>{
    if(id)return Promise.resolve(id);
    if(!uploadConversation.current)uploadConversation.current=spaceRequest({},'POST').then(space=>{const target=space.conversation!.id;uploadConversationId.current=target;p.handoffCursor.current={id:target,sequence:space.conversation!.sequence};write(draftKey(target),read(draftKey(null)));write(skillDraftKey(target),read(skillDraftKey(null),'null'));return target}).catch(error=>{uploadConversation.current=null;throw error});
    return uploadConversation.current;
  },[id]);
  const attachmentLanguage=useRef(L);attachmentLanguage.current=L;
  const attachmentAdapter=useMemo(()=>createAttachmentAdapter(ensureConversation,boot?.uploads.maxBytes??chatUploadLimits.maxBytes,(en,zh)=>attachmentLanguage.current(en,zh)),[ensureConversation,boot?.uploads.maxBytes]);
  const currentRouter = participants.find(a=>a.id===(snapshot?.routerId??"router"))!;
  const historicalWorker=snapshot?.tasks.find(t=>t.workerId===selectedAgent);
  const selected=participants.find(a=>a.id===selectedAgent)??(historicalWorker?{id:selectedAgent,label:selectedAgent,kind:'worker' as const,latestMessage:null}:currentRouter);
  const readonly = selected.kind === "worker";
  const showWorkerDiff=useWorkerDiffPreference();
  const participantFilter = readonly ? selected.id : undefined;
  const candidates = (snapshot?.messages ?? []).filter(message => {
    if (message.workerPatchReceipt) return !readonly || message.speaker?.id===selected.id;
    if (!showTranscriptDetails && !simpleChatMessage(message)) return false;
    if (readonly) return message.speaker?.id === selected.id || message.recipient?.id === selected.id;
    if (display === "group") return true;
    return !message.recipient && (
      message.role === "user" || !message.speaker || message.speaker.id === selected.id || !!message.deliveries?.length || !!message.imageShare
    );
  });
  const {byMessage:workerReports,groups:workbenchReports}=reportsForTranscript(snapshot?.messages??[],candidates);
  const visibleMessages=candidates.filter(m=>!m.workerPatchReceipt||(showWorkerDiff&&workerReports.has(m.id)));
  const latestMessage = showTranscriptDetails ? snapshot?.messages.at(-1) : visibleMessages.at(-1);
  const motion=useChatMotion(threadRef,(id??'new')+':'+selectedAgent+':'+(around??'latest'),!!around,latestMessage?.id);
  useEffect(()=>{const target=locateAfterLoad.current;if(!target||loading)return;const frame=requestAnimationFrame(()=>{if(motion.locate(target))locateAfterLoad.current=null});return()=>cancelAnimationFrame(frame)},[snapshot,loading,motion.locate]);
  const {confirm,has,hasAttachment,reset:resetSends}=p.sends;
  const outgoing=p.sends.messages.filter(m=>(m.conversationId===id||(!m.conversationId&&!requestedItem?.conversation))&&
    !snapshot?.messages.some(message=>message.clientMessageId===m.id));
  const localMessages=readonly||around?[]:outgoing;
  const outstanding=outgoing.find(m=>m.stage!=='accepted');
  const sending=!!outstanding;
  const accepted=outgoing.findLast(m=>m.stage==='accepted')?.id;
  const handoff=useHandoffPlayer(p.handoffCursor,id,snapshot,!configuring&&!around,participantFilter);
  const companionActor=handoff.event?.to??handoff.holder??selected;
  const companionWorker=companionActor.kind==="worker"?companionActor.id:undefined;
  const viewKey=JSON.stringify([id,participantFilter,around]),viewRef=useRef(viewKey);viewRef.current=viewKey;
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
  const welcome=!readonly&&!loading&&!snapshot?.messages.length&&!localMessages.length&&!running;
  const planning=snapshot?.conversation.id===id?snapshot?.planning??null:null;
  const livePlan=planning&&planning.state!=='approved'&&planning.state!=='cancelled'?planning:null;
  const activePlanId=useRef(livePlan?.id);activePlanId.current=livePlan?.id;
  const loadReferences=useCallback((query:string,signal:AbortSignal)=>
    api<ChatQuoteView[]>('/conversations/'+id+'/references?'+new URLSearchParams({q:query}),undefined,'GET',signal),[id]);
  const loadTeamContext=useCallback((signal:AbortSignal)=>
    api<ReturnType<ChatSessions['teamContext']>>('/conversations/'+id+'/team-context',undefined,'GET',signal),[id]);
  const firstChat=welcome&&p.offerPersonalization&&route==='/chat';
  const preferenceStarter=welcome&&p.preferences?.purpose&&p.preferences.purpose!=='general'
    ?chatPersonalizationCopy(L).purposes[p.preferences.purpose]:undefined;
  const routerCall = snapshot?.calls.findLast(call => call.runId === run?.id && call.kind === 'router');
  const teamUsageRevision=snapshot?.calls.filter(call=>call.kind==='worker').map(call=>[call.id,call.usageRevision,call.state].join(':')).join('|');
  const [usageRefresh, setUsageRefresh] = useState(0);
  const usage = useCurrentContext(configuring || readonly ? null : id, run?.id, ready?.model, ready?.backend,
    routerCall?.id, routerCall?.usageRevision, running || contextOpen, loadContext, usageRefresh);
  const arrivals = p.arrivals;
  if (snapshot && arrivals.current.conversationId !== snapshot.conversation.id) arrivals.current = {
    conversationId:snapshot.conversation.id, since:Date.now(), seen:new Set(snapshot.messages.map(m=>m.id)),
  };
  const runMessageId = !readonly ? snapshot?.messages.findLast(m => m.runId === run?.id && m.role === 'assistant' && !m.opening && !m.commentary && !m.imageShare && !m.recipient)?.id ?? '' : '';
  const waitingLabel=snapshot ? pendingWaitLabel(snapshot,L,participantFilter) : undefined;
  const standaloneStatus = run && !(run.state==='waiting' && waitingLabel) && !readonly && !runMessageId
    ? runLabel(run.state,L,waitingLabel??'') : undefined;
  const fail = (e: unknown) => {
    if (alive.current)
      setError(e instanceof ApiError ? e.code : "network_error");
  };
  const revealFile=(file:DeliveryFile)=>{
    if(file.revealHref)void api(file.revealHref.slice('/api/chat'.length),{}).catch(fail);
  };
  const openFile=(item:ChatDelivery)=>{
    const link=deliveryFile(item);
    if(link.revealHref&&link.preview!=='image')revealFile(link);
    else setFile(link);
  };
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!id) return;
    const version = ++fetchVersion.current;
    const query=new URLSearchParams({withPending:'1'});if(participantFilter)query.set('participant',participantFilter);if(around)query.set('around',around);
    const oldest = messagesRef.current[0]?.sequence;
    if (oldest) query.set("decisionsFrom", String(oldest));
    const data = await api<Snapshot>("/conversations/" + id + "?"+query,undefined,"GET",signal);
    if (signal?.aborted || !alive.current || version !== fetchVersion.current) return;
    if (data.conversation.contextVersion < contextVersionRef.current) return;
    const sameContext = data.conversation.contextVersion === contextVersionRef.current;
    contextVersionRef.current = data.conversation.contextVersion;
    const older = (sameContext ? messagesRef.current : []).filter(
      (m) => m.sequence < (data.messages[0]?.sequence ?? Infinity),
    );
    const updates=new Map((data.earlierCards??[]).map(card=>[card.id,card]));
    const messages = [...older.map(m=>updates.has(m.id)?{...m,...updates.get(m.id)}:m), ...data.messages].map(m=>reactionWrites.current.has(m.id)?{...m,reactions:reactionWrites.current.get(m.id)!.reactions}:m);
    messagesRef.current = messages;
    // A history page can arrive while this refresh is in flight.
    const newlyLoadedRuns = new Set(older.filter(m => oldest == null || m.sequence < oldest).map(m => m.runId));
    setSnapshot(previous => {
      const decisions = new Map(data.decisions.map(q => [q.id, q]));
      if (previous?.conversation.id === id && newlyLoadedRuns.size) {
        for (const q of previous.decisions) {
          if (newlyLoadedRuns.has(q.runId) && !decisions.has(q.id)) decisions.set(q.id,q);
        }
      }
      const olderRuns=new Set(older.map(m=>m.runId));
      const cached=previous?.conversation.id===id?previous.approvals.filter(a=>olderRuns.has(a.runId) && a.state!=='pending'):[];
      const approvals=[...new Map([...cached,...data.approvals].map(a=>[a.id,a])).values()];
      return {...data, messages, approvals, decisions:[...decisions.values()], hasMore:messages[0]?.sequence === 1 ? false : data.hasMore};
    });
    setLoading(false);
    const received=new Set(messages.flatMap(m=>m.clientMessageId?[m.clientMessageId]:[]));
    confirm(id,received);
    const saved = savedPending(id);
    if (saved && received.has(saved.id)) {
      forgetPending(id,saved.id);
      if (read(draftKey(id)) === saved.text) write(draftKey(id), "");
    }
  }, [id, participantFilter, around, confirm]);
  const refreshCurrent=useRef(refresh);refreshCurrent.current=refresh;
  useEffect(()=>{
    if(!id||!accepted||readonly||around)return;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);
    // The message is already accepted. The conversation stream and poll retry this read.
    void refreshCurrent.current(signal).catch(()=>{});
    return ()=>controller.abort();
  },[id,accepted,readonly,around]);
  useEffect(() => {
    alive.current = true;
    messagesRef.current=[];contextVersionRef.current=0;setLoading(!!id);setSnapshot(s=>s?{...s,messages:[]}:s);
    if (!id) {
      setConnected(true);
      return () => {
        alive.current = false;
      };
    }
    const lifetime = new AbortController();
    let source: EventSource | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000, reads = 0;
    let failingSince: number | undefined;
    const stop = () => {
      lifetime.abort();
      clearTimeout(poll);
      clearTimeout(retry);
      source?.close();
    };
    const reset = () => {
      stop();
      clearChatDrafts();
      resetSends();
      restoredPending.current = null;
      window.dispatchEvent(new Event("roppo:chat-space"));
    };
    const load = async () => {
      if (lifetime.signal.aborted) return;
      clearTimeout(poll);
      const read = ++reads;
      const current = () => !lifetime.signal.aborted && read === reads;
      try {
        await refresh(AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)]));
        if (current()) {
          failingSince = undefined;
          setConnected(true);
        }
      } catch (e) {
        if (!current()) return;
        if (e instanceof ApiError && e.code === "conversation_reset") {
          reset();
        } else if (e instanceof ApiError && e.code === "conversation_missing") {
          stop();
          setLoading(false);
          setConnected(true);
          fail(e);
        } else {
          const now = performance.now();
          failingSince ??= now;
          if (now - failingSince >= 1500) {
            setConnected(false);
            setLoading(false);
          }
        }
      } finally {
        if (current()) poll = setTimeout(load, failingSince === undefined ? 8000 : 2000);
      }
    };
    const connect = () => {
      if (lifetime.signal.aborted) return;
      clearTimeout(retry);
      source?.close();
      const connection = new EventSource(
        "/api/chat/conversations/" + id + "/events",
      );
      source = connection;
      const active = () => !lifetime.signal.aborted && source === connection;
      const lost = () => {
        if (!active()) return;
        connection.close();
        source = undefined;
        retry = setTimeout(connect, retryDelay);
        retryDelay = Math.min(8000, retryDelay * 2);
        void load();
      };
      connection.onopen = () => {
        if (active()) {
          retryDelay = 1000;
          void load();
        }
      };
      connection.addEventListener("change", () => {
        if (active()) void load();
      });
      connection.addEventListener("reset", () => { if (active()) reset(); });
      connection.addEventListener("reconnect", lost);
      connection.onerror = lost;
    };
    const resume = () => {
      if (!source || source.readyState === EventSource.CLOSED) connect();
      void load();
    };
    const visible = () => { if (document.visibilityState === "visible") resume(); };
    resume();
    window.addEventListener("offline", load);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      fetchVersion.current++;
      stop();
      window.removeEventListener("offline", load);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, refresh, resetSends]);
  const blocks=groupWorkflow(snapshot,visibleMessages,display,participantFilter,showTranscriptDetails);

  const continuedReviews=new Set(visibleMessages.filter((m,i)=>{
    const before=visibleMessages[i-1];
    return m.fileReview && before?.role==='assistant' && before.runId===m.runId && before.speaker?.id===m.speaker?.id && !before.recipient && !before.commentary && !before.imageShare;
  }).map(m=>m.id));
  const inlineAnswers = new Set<string>();
  for (const block of blocks.values()) {
    for (const item of block) {
      if (item.kind === 'question' && item.question.answerMessageId) inlineAnswers.add(item.question.answerMessageId);
    }
  }
  for (const message of visibleMessages) {
    if (message.decision?.answer && message.decision.replyRunId && !message.decision.closed)
      inlineAnswers.add('user:'+message.decision.replyRunId);
  }

  const awaitingReply = new Set(snapshot?.replyRunIds);
  if (run?.state==='queued'||run?.state==='running') awaitingReply.add(run.id);
  for (const message of snapshot?.messages ?? []) {
    if (message.role==='assistant' && !message.recipient && !message.commentary && !message.imageShare && message.opening!=='received') awaitingReply.delete(message.runId);
  }

  const runtime = useExternalStoreRuntime({
    isRunning: !readonly && !!reply,
    isLoading: loading,
    isSendDisabled: disabled,
    adapters:{attachments:attachmentAdapter},
    activeRunId: reply?.runId,
    messages: visibleMessages,
    convertMessage: (m): ThreadMessageLike => ({
      id: m.id,
      role: m.role,
      createdAt: new Date(m.createdAt),
      metadata: { custom: {
        workerPatchReceipt:m.workerPatchReceipt,workerReports:workerReports.get(m.id),
        readReceipt: m.role==='user' && !readonly && !around && awaitingReply.has(m.runId),
        commentary: m.commentary,
        sharedImages: !!m.imageShare,
        linkFiles: m.role === 'assistant' ? snapshot?.deliveries.filter(file =>
          file.createdAt <= m.createdAt && (m.ticketId ? file.ticketId === m.ticketId : file.runId === m.runId)
        ) : undefined,
        continuedReview:continuedReviews.has(m.id),speaker: m.speaker, recipient: showTranscriptDetails ? m.recipient : undefined, attachments: m.attachments, deliveries: m.deliveries,
        inlineAnswer:inlineAnswers.has(m.id) && around!==m.id && !m.attachments?.length && !m.skill, ticketId: m.ticketId, decision:m.decision, planProposal:m.planProposal, fileReview:m.fileReview && {...m.fileReview,name:m.text}, quote: m.quote, skill:m.skill, reactions: m.reactions, agentReactions: m.agentReactions,
      } },
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
      const files=message.attachments??[],attachments=files.map(a=>a.id),sentQuote=quoteCurrent.current;
      const sentSkill=skillCurrent.current??undefined;
      const planningId=planningDraftId.current||livePlan?.id;
      const startPlan=planDraftCurrent.current&&!planningId?true:undefined;
      if ((!text&&!attachments.length) || sending || readonly) return;
      if(!p.sends.begin({
        conversationId:id??uploadConversationId.current,files,quote:sentQuote,skill:sentSkill,
        input:{text,attachments,quote:quoteReference(sentQuote),skillId:sentSkill?.id,startPlan,planningId,locale:navigator.language||lang,
          timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,openingLocale:lang},
      }))return;
      setError("");
      if(sentQuote)saveQuote(null);
      if(sentSkill)saveSkill(null);
      if(planDraftCurrent.current)savePlanDraft(false);
      clearDraftBinding();
      if(around)setAround(undefined);
      motion.latest();
    },
    hasEarlier: snapshot?.hasMore ?? false,
    onLoadEarlier: async () => {
      if (!id || !snapshot?.messages.length) return;
      const version=viewRef.current;
      const data = await api<Snapshot>(
        "/conversations/" +
          id +
          "/messages?before=" +
          snapshot.messages[0]!.sequence + (participantFilter ? "&participant="+encodeURIComponent(participantFilter) : ""),
      );
      if (!alive.current||version!==viewRef.current||data.conversation.contextVersion!==contextVersionRef.current) return;
      const ids = new Set(messagesRef.current.map((m) => m.id));
      const messages = [
        ...data.messages.filter((m) => !ids.has(m.id)),
        ...messagesRef.current,
      ];
      messagesRef.current = messages;
      setSnapshot((s) => (s ? { ...s, messages, approvals:[...new Map([...data.approvals,...s.approvals].map(a=>[a.id,a])).values()], decisions:[...new Map([...data.decisions,...s.decisions].map(q=>[q.id,q])).values()], hasMore: data.hasMore } : s));
    },
  });
  const editOutgoing=async(messageId:string)=>{
    const composer=runtime.thread.composer;
    if(composer.getState().text.trim()||composer.getState().attachments.length||quoteCurrent.current||skillCurrent.current)return;
    const message=p.sends.edit(messageId);
    if(!message)return;
    composer.setText(message.input.text);
    saveQuote(message.quote);
    saveSkill(message.skill??null);
    savePlanDraft(message.input.startPlan===true);
    planningDraftId.current=message.input.planningId??'';write(planBindingKey(id),planningDraftId.current);
    for(const file of message.files)await composer.addAttachment(file);
    if(message.error)setError(message.error);
    threadRef.current?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();
  };
  useEffect(()=>{
    if(disabled||queuedEnter.current===null)return;
    const requested=queuedEnter.current;queuedEnter.current=null;
    if(runtime.thread.composer.getState().text===requested)runtime.thread.composer.send();
  },[disabled,runtime]);
  useEffect(()=>{
    if(!id)return;
    let active=true;
    api<{attachments:ChatAttachment[]}>("/conversations/"+id+"/attachments").then(async result=>{
      for(const file of result.attachments)if(active&&!hasAttachment(file.id)&&!runtime.thread.composer.getState().attachments.some(a=>a.id===file.id))await runtime.thread.composer.addAttachment(attachmentParts(file));
    }).catch(fail).finally(()=>{if(active)setLoadingAttachments(false)});
    return()=>{active=false};
  },[runtime,id,hasAttachment]);
  useEffect(() => {
    const saved=savedPending(id);
    restoredPending.current=saved&&!has(saved.id)?saved:null;
    runtime.thread.composer.setText(read(draftKey(id))||restoredPending.current?.text||'');
    return runtime.thread.composer.subscribe(() => {
      const composer=runtime.thread.composer.getState(),text=composer.text;write(draftKey(id),text);
      // The assistant runtime may clear the textarea before calling onNew.
      // Keep a planning draft bound until submission or an explicit clear in the editor.
      if((text.trim()||composer.attachments.length)&&activePlanId.current&&!planningDraftId.current){
        planningDraftId.current=activePlanId.current;write(planBindingKey(id),activePlanId.current);
      }
      setAttachmentBlocked(composer.attachments.some(a=>a.status.type==='running'||a.status.type==='incomplete'));
      if(uploadConversationId.current&&uploadConversationId.current!==id)write(draftKey(uploadConversationId.current),text);
    });
  }, [runtime, id, has]);
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
    const saved = restoredPending.current;
    if (
      saved &&
      snapshot?.messages.some((m) => m.clientMessageId === saved.id)
    ) {
      restoredPending.current = null;
      if(JSON.stringify(quoteReference(quote)??null)===JSON.stringify(saved.quote??null))saveQuote(null);
      const restoredText=runtime.thread.composer.getState().text===saved.text;
      if(restoredText&&saved.skill&&skillCurrent.current?.id===saved.skill.id)saveSkill(null);
      if(restoredText&&saved.startPlan)savePlanDraft(false);
      if(restoredText&&saved.planningId)clearDraftBinding();
      for(const [index,file] of [...runtime.thread.composer.getState().attachments.entries()].reverse())
        if(saved.attachments?.includes(file.id))void runtime.thread.composer.getAttachmentByIndex(index).remove();
      if (restoredText)
        runtime.thread.composer.setText("");
    }
  }, [snapshot, runtime]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !e.defaultPrevented && !document.querySelector("dialog[open]")) {
        if (menu) {
          closeNavigation();
        } else if (activityTrayOpen && !configuring && !(panel && panelOverlay)) {
          closeActivityTray();
        } else if (panel && selectedTask && !configuring) {
          backToTasks();
        } else if (trayOpen && !configuring && !(panel && panelOverlay)) {
          closeTray();
        } else if (bench && !configuring) {
          closeBench();
        } else if (panel) {
          closePanel();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, panel, bench, panelOverlay, closeNavigation, trayOpen, activityTrayOpen, configuring, selectedTask]);
  useEffect(() => {
    if (narrow && menu)
      document
        .querySelector<HTMLElement>('#function-navigation button, #function-navigation a')
        ?.focus();
  }, [narrow, menu]);
  const current = snapshot?.conversation;
  const pendingCards=snapshot?.conversation.id===id?(snapshot?.pendingCards??[]):[];
  const trayVisible=trayOpen&&!configuring&&!(panelOverlay&&panel);
  const trayView = useMemo(() => trayVisible ? { linkedItem, linkVisit } : null, [trayVisible, linkedItem, linkVisit]);
  const trayPresence = usePanelPresence<NonNullable<typeof trayView>, HTMLDivElement>(trayView, '#pending-tray');
  const displayedTray = trayPresence.view;
  const displayedPendingItem = displayedTray?.linkedItem;
  const activityTrayVisible=activityTrayOpen&&!configuring&&!(panelOverlay&&panel);
  const activityPresence=usePanelPresence<string,HTMLDivElement>(activityTrayVisible ? id??'new' : null,'#activity-tray');
  useEffect(()=>{
    if(activityTrayVisible)document.getElementById('activity-tray')?.focus({preventScroll:true});
  },[activityTrayVisible]);
  const openActivityTray=(origin:HTMLElement|null)=>{
    if(trayOpen)changeTray(false);
    if(panelOverlay&&panel)showPanel(false);
    activityOpener.current=origin;
    setActivityTrayOpen(true);
  };
  useEffect(()=>{
    if(linkedItem){
      closeActivityTray(false);
      changeTray(true);
      if(panelOverlay&&panel)showPanel(false);
    }else if(previousLinkedItem.current){
      setTrayOpen(false);
      write('roppo.chat.pendingTray','closed');
    }
    previousLinkedItem.current=linkedItem;
  },[linkedItem]);
  const toggleTray=()=>{
    linkOrigin.current=null;
    if(!trayVisible)closeActivityTray(false);
    if(!trayVisible&&panelOverlay&&panel)showPanel(false);
    changeTray(!trayVisible);
    if(!trayVisible)requestAnimationFrame(()=>document.getElementById('pending-tray')?.focus({preventScroll:true}));
  };
  const selectAgent=(agentId:string)=>{locateRequest.current++;locateAfterLoad.current=null;setAround(undefined);setSelectedAgent(agentId);setContextOpen(false)};
  function restorePanelFocus(target: () => HTMLElement | null | undefined) {
    const previous = document.activeElement;
    requestAnimationFrame(() => {
      if (document.activeElement === previous || document.activeElement === document.body)
        target()?.focus({preventScroll: true});
    });
  }
  function closePanel() {
    showPanel(false);
    restorePanelFocus(() => panelOpener.current?.isConnected ? panelOpener.current : teamButton.current);
  }
  function backToTasks() {
    setSelectedTask(null);
    restorePanelFocus(() => taskOpener.current?.isConnected ? taskOpener.current : document.getElementById('team-tab-activity'));
  }
  const readAgent=(agentId:string)=>{selectAgent(agentId);showPanel(false);requestAnimationFrame(()=>threadRef.current?.querySelector<HTMLElement>('.worker-readonly button,.composer-input')?.focus({preventScroll:true}))};
  const quoteMessage=(value:DraftQuote)=>{
    saveQuote(value);selectAgent(currentRouter.id);
    requestAnimationFrame(()=>threadRef.current?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus({preventScroll:true}));
  };
  const locateMessage=async(messageId:string)=>{
    const version=++locateRequest.current;
    locateAfterLoad.current=null;
    if(motion.locate(messageId))return;
    try{
      const data=await api<Snapshot>('/conversations/'+id+'?around='+encodeURIComponent(messageId));
      if(!alive.current||version!==locateRequest.current)return;
      const message=data.messages.find(m=>m.id===messageId);
      if(!message)throw new ApiError("message_missing");
      const participant=message.speaker?.kind==='worker'?message.speaker.id:message.recipient?.kind==='worker'?message.recipient.id:currentRouter.id;
      locateAfterLoad.current=messageId;
      if(display==='agents'||readonly)setSelectedAgent(participant);
      setAround(messageId);
    }catch(e){if(version===locateRequest.current)fail(e)}
  };
  const reactMessage=(messageId:string,emoji:string)=>{
    const previous=reactionWrites.current.get(messageId),message=messagesRef.current.find(m=>m.id===messageId);if(!message||!id)return;
    const reactions=new Set(previous?.reactions??message.reactions??[]),active=!reactions.has(emoji);
    if(active)reactions.add(emoji);else reactions.delete(emoji);
    const update={reactions:[...reactions],promise:Promise.resolve(message.reactions??[])};
    reactionWrites.current.set(messageId,update);
    messagesRef.current=messagesRef.current.map(m=>m.id===messageId?{...m,reactions:update.reactions}:m);
    setSnapshot(s=>s?{...s,messages:messagesRef.current}:s);
    update.promise=(previous?.promise??Promise.resolve(message.reactions??[])).then(async confirmed=>{
      try{confirmed=(await api<{reactions:string[]}>('/conversations/'+id+'/reactions',{messageId,emoji,active,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone})).reactions}catch{if(alive.current)setError('reaction_failed')}
      if(reactionWrites.current.get(messageId)===update){
        reactionWrites.current.delete(messageId);
        messagesRef.current=messagesRef.current.map(m=>m.id===messageId?{...m,reactions:confirmed}:m);
        if(alive.current){setSnapshot(s=>s?{...s,messages:messagesRef.current}:s);await refreshCurrent.current().catch(fail)}
      }
      return confirmed;
    });
  };
  const closeSchedules=()=>{
    history.replaceState(null,'',id?'/chat#conversation/'+id:'/chat');
    window.dispatchEvent(new Event('roppo:navigation'));
  };
  const changeSchedule=async(planId:string,expectedRevision:number,patch:ScheduleEdit)=>{
    try{await api('/conversations/'+id+'/schedules',{id:planId,expectedRevision,operationId:crypto.randomUUID(),...patch},'PATCH')}finally{await refresh()}
  };
  const latestMessages=()=>{locateRequest.current++;locateAfterLoad.current=null;if(around)setAround(undefined);motion.latest()};
  return (
    <Context.Provider
      value={{
        lang,
        L,
        workers,
        routerLabel:currentRouter.label,
        openFile,previewFile:setFile,openAgent:readAgent,inspectDiff:target=>openBench('diff',target),
        run: showTranscriptDetails ? run ?? null : null,
        runMessageId,waitingLabel:waitingLabel??'',
        showTranscriptDetails,
        arrivals:arrivals.current,
      }}
    >
      <WorkflowProvider value={{L,blocks,readonly:readonly||!!snapshot?.conversation.archived,conversation:id??'',pendingIds:new Set(pendingCards.map(c=>c.id)),actor:id=>participants.find(p=>p.id===id)?.label??id,thinking:item=><ThinkingCalls item={item} workers={workers} live={connected&&!around}/>,
        planning,
        confirmPlan:async messageId=>{try{await api('/conversations/'+id+'/planning',{action:'confirm',messageId});motion.latest()}finally{await refresh()}},
        revisePlan:()=>threadRef.current?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus(),
        decide:async(messageId,answer)=>{try{await api('/conversations/'+id+'/decisions',{messageId,answer,locale:navigator.language||lang,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});if(matchMedia('(max-width:600px)').matches)closeTray()}finally{await refresh()}},
        answerWorker:body=>api('/conversations/'+id+'/decisions',body),refresh,
        readDraft:(messageId)=>api('/conversations/'+id+'/file-reviews?message='+encodeURIComponent(messageId)),
        reviewFile:async(messageId,state)=>{try{await api('/conversations/'+id+'/file-reviews',{messageId,state});closeTray()}finally{await refresh()}},
        authorize:async(request,value)=>{try{await api('/conversations/'+id+'/approvals',{id:request,value});if(typeof value==='string'||matchMedia('(max-width:600px)').matches)closeTray()}finally{await refresh()}}
      }}><AssistantRuntimeProvider runtime={runtime}>
        <InteractionProvider L={L} messages={snapshot?.messages??[]} reply={quoteMessage} react={reactMessage} locate={messageId=>void locateMessage(messageId)}>
        <div
          className={
            "chat-shell studio-shell" +
            (menu ? " menu-open" : "") +
            (displayedSession ? " team-open" : "") +
            (configuring && navExpanded ? " functions-expanded" : "") +
            (configuring ? " management-mode" : " floating-chat") +
            (display === "group" ? " conversation-list-hidden" : "")
          }
        >
          <a className="skip-link" href="#conversation">
            {configuring
              ? L("Skip to content", "跳转到内容")
              : L("Skip to conversation", "跳转到对话")}
          </a>
          {configuring && <StudioRail L={L} hash={hash} expanded={navExpanded} expand={setNavExpanded}
            mobile={narrow} open={menu} close={closeNavigation}
            views={views.map(v=>({id:v.id,label:v.label[lang]}))}
            user={boot?.user?.displayName || L("Local account","本地账户")}/>}
          {configuring && menu ? (
            <button
              className="nav-scrim"
              aria-label={L("Close navigation", "关闭导航")}
              onClick={closeNavigation}
            />
          ) : null}
          <main
            className="chat-main"
            data-settings-view={configuring ? hash : undefined}
            id="conversation"
            tabIndex={-1}
            inert={configuring && narrow && menu}
          >
            {configuring && (!connectorsRoute || narrow) ? <header className="chat-header">
              <button
                className="icon-button mobile-menu"
                ref={menuButton}
                onClick={() => setMenu(true)}
                aria-label={L("Open navigation", "打开导航")}
                aria-expanded={menu}
                aria-controls="function-navigation"
              >
                <Menu size={20} />
              </button>
              {!connectorsRoute && <div className="studio-breadcrumb">
                <span>{L("Settings","设置")}</span><ChevronRight size={14}/>
                {workspacePage && <><a href="/configure#workspace">{L("Workspace settings","工作区设置")}</a><ChevronRight size={14}/></>}
                {hash === "advanced/chat" && <><a href="/configure#general">{L("General", "通用")}</a><ChevronRight size={14}/></>}
                <strong>{pageTitle}</strong>
              </div>}
            </header> : null}
            <SwitchView scope="page"><div className="workspace-page-stage" data-route={route}>
            {workspaceIndex && <WorkspaceSettings L={L}/>}
            {general?<General onDisplayChange={p.setDisplay} openWorkspaces={()=>{history.pushState(null,"","/configure#advanced/host");window.dispatchEvent(new Event("roppo:navigation"));setPickerRequest(v=>v+1)}} lang={lang} setLang={setLang} display={display} L={L}
              detailMode={p.detailMode} onDetailModeChange={p.saveDetailMode}
              progressMode={p.progressMode} onProgressModeChange={p.saveProgressMode}
              sendShortcut={p.sendShortcut} onSendShortcutChange={p.saveSendShortcut}
              onPersonalize={p.openPersonalization?()=>p.openPersonalization?.('edit'):undefined}/>:null}
            {workView && <div className="general-scroll roppo-ui"><Suspense fallback={<p role="status">{L('Loading…','正在读取…')}</p>}><WorkspaceTransportOwner language={lang}>
              {hash==='attention'?<WorkInbox language={lang} L={L}/>:hash==='methods'?<MethodLibrary language={lang} L={L}/>:hash==='worker-templates'?<WorkerTemplates language={lang}/>:<TaskProgress key={hash} language={lang} L={L} requested={hash.split('/')[1]??''}/>}
            </WorkspaceTransportOwner></Suspense></div>}
            {appearance && <Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading appearance…", "正在读取外观设置…")}</div>}><AppearanceSettings L={L}/></Suspense>}
            {marketRoute?<Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading plugins…","正在加载插件…")}</div>}><PluginMarketplace route={hash} language={lang}/></Suspense>:null}
            {connectorsRoute?<Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading connectors…","正在读取连接器…")}</div>}><ConnectorsWorkspace key={hash} language={lang} initialTab={hash==='connectors/access'?'connected':'available'}/></Suspense>:null}
            {automationRoute?<Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading automations…","正在加载自动化…")}</div>}><AutomationWorkspace language={lang}/></Suspense>:null}
            {usageStatisticsRoute && <Suspense fallback={<div className="workspace-view-placeholder" role="status">{L("Loading usage statistics…", "正在读取使用统计…")}</div>}>
              <UsageStatisticsPage language={lang}/>
            </Suspense>}
            <Configuration
              visible={configuring&&!workView&&!general&&!appearance&&!workspaceIndex&&!automationRoute&&!connectorsRoute&&!usageStatisticsRoute&&!pluginId&&(!marketRoute||marketTools)}
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
              <div className="conversation-lane" inert={!!bench && (panelOverlay||benchExpanded)}>
                <div className="chat-float chat-float-start roppo-ui">
                  <a href="/configure#general" className="icon-button" aria-label={L("Settings","设置")} title={L("Settings","设置")}><Settings size={19}/></a>
                  {display === "agents" && <ChatMemberPicker L={L} participants={participants} selected={selected.id} select={readAgent}/>}
                </div>
                <ChatCompanion visible={!configuring} actor={companionActor} event={handoff.event} onFinish={handoff.finish}
                  status={companionStatus(snapshot,L,{participantId:companionWorker,connected,loading:loading&&!localMessages.length})} L={L}
                  panelOpen={panel} onOpen={()=>showPanel(!panel)}/>
                <div className="chat-float chat-float-end">
                  <button ref={trayButton} type="button" className={'icon-button pending-trigger'+(trayVisible?' selected':'')}
                    aria-label={L('Pending requests','待处理事项')+(pendingCards.length?' · '+pendingCards.length:'')}
                    title={L('Pending requests','待处理事项')} aria-expanded={trayVisible} aria-controls="pending-tray" onClick={toggleTray}>
                    <Inbox size={19}/>{pendingCards.length>0&&<span className="pending-badge" aria-hidden="true">{pendingCards.length>99?'99+':pendingCards.length}</span>}
                  </button>
                  <button ref={activityButton} type="button" className="icon-button"
                    aria-label={L('Work activity','工作动态')} title={L('Work activity','工作动态')}
                    aria-expanded={activityTrayVisible} aria-controls="activity-tray"
                    onClick={()=>activityTrayVisible?closeActivityTray():openActivityTray(activityButton.current)}>
                    <GitCommitHorizontal size={19} aria-hidden="true"/>
                  </button>
                  <button
                    ref={teamButton}
                    className={"icon-button" + (bench ? " selected" : "")}
                    onClick={() => bench?closeBench():openBench()}
                    aria-label={L("Workspace panel", "工作区面板")}
                    title={L("Workspace panel", "工作区面板")}
                    aria-expanded={!!bench}
                    aria-controls="chat-workbench"
                  >
                    <PanelRight size={19} />
                  </button>
                </div>
                {displayedTray&&<div ref={trayPresence.ref} className="tray-presence" data-closing={trayPresence.closing||undefined}
                  inert={trayPresence.closing} aria-hidden={trayPresence.closing||undefined}>
                  <button type="button" className="pending-backdrop" tabIndex={-1} aria-label={L('Close pending panel','关闭待处理面板')} onClick={closeTray}/>
                  <PendingTray key={(id??'')+':'+displayedTray.linkVisit} read={readHistory} clearSelection={clearSelection}
                  cards={pendingCards} selectedId={displayedPendingItem} loading={!!id && (loading || snapshot?.conversation.id !== id)} close={closeTray}/></div>}
                {activityPresence.view!==null&&<div ref={activityPresence.ref} className="tray-presence"
                  data-closing={activityPresence.closing||undefined} inert={activityPresence.closing} aria-hidden={activityPresence.closing||undefined}>
                  <button type="button" className="pending-backdrop" tabIndex={-1} aria-label={L('Close work activity','关闭工作动态')} onClick={()=>closeActivityTray()}/>
                  <ChatTray id="activity-tray" heading={L('Work activity','工作动态')} icon={<GitCommitHorizontal size={17} aria-hidden="true"/>}
                    closeLabel={L('Hide work activity','隐藏工作动态')} close={()=>closeActivityTray()}>
                    <Suspense fallback={<p className="pending-empty" role="status">{L('Loading commits…','正在读取提交记录…')}</p>}>
                      <CommitTrailPanel key={activityPresence.view} load={loadCommitHistory} active={!activityPresence.closing} locale={lang} L={L}/>
                    </Suspense>
                  </ChatTray>
                </div>}
                <ThreadPrimitive.Root
                  onClickCapture={event=>{
                    const target=event.target;
                    if(!(target instanceof Element)||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
                    const link=target.closest<HTMLAnchorElement>('a.pending-action-link');
                    if(link){linkOrigin.current=link;setLinkVisit(n=>n+1);changeTray(true)}
                  }}
                  ref={threadRef}
                  className="thread"
                  data-welcome={welcome || undefined}
                  inert={panelOverlay && panel}
                >
                  <ThreadPrimitive.Viewport className="transcript" autoScroll={false} scrollToBottomOnRunStart={false} scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false}>
                    <div className="transcript-inner">
                      <ThreadPrimitive.LoadEarlier className="load-earlier">
                        {L("Load earlier messages", "加载更早的消息")}
                      </ThreadPrimitive.LoadEarlier>
                      {loading && !localMessages.length ? (
                        <div className="loading" role="status">
                          <LoaderCircle size={22} className="spin" />
                          {L("Loading conversation", "正在加载会话")}
                        </div>
                      ) : null}
                      {!localMessages.length&&<ThreadPrimitive.Empty>
                        {firstChat?<Suspense fallback={null}>
                          <FirstChatWelcome L={L} start={()=>p.openPersonalization?.('first')} skip={p.skipPersonalization}/>
                        </Suspense>:<div className="empty-state">
                          {readonly?<AgentAvatar id={selected.id} kind="worker" size={64}/>:null}
                          <h1>
                            {readonly ? L("No collaboration messages yet", "暂无协作消息")
                              : p.preferences?.name ? L("What shall we work on, "+p.preferences.name+"?",p.preferences.name+"，今天想做什么？")
                              : L("What shall we work on?", "今天想做什么？")}
                          </h1>
                        </div>}
                      </ThreadPrimitive.Empty>}
                      <ThreadPrimitive.Messages
                        components={{ UserMessage, AssistantMessage }}
                      />
                      {localMessages.map(message=><OutgoingBubble key={message.id} message={message} draftHasContext={!!quote||!!skill}
                        retry={()=>p.sends.retry(message.id)} edit={()=>void editOutgoing(message.id).catch(fail)}/>)}
                      <WorkflowCards anchor="pending"/>
                      {showTranscriptDetails&&run&&standaloneStatus?<div className="run-activity" aria-live="polite">
                        <div className={"run-status "+run.state}><StatusIcon state={run.state}/><span>{standaloneStatus}</span></div>
                      </div>:null}
                    </div>
                  </ThreadPrimitive.Viewport>
                  <div className="composer-area">
                    <button type="button" className="scroll-bottom" data-visible={!motion.atBottom||!!around} tabIndex={!motion.atBottom||around?0:-1} aria-hidden={motion.atBottom&&!around} aria-label={L("Scroll to latest", "回到最新消息")} onClick={latestMessages}>
                      <ArrowDown size={16}/>{motion.unread?<span>{L('New messages','有新消息')}</span>:around?<span>{L('Back to latest','回到最新')}</span>:null}
                    </button>
                    {error ? (
                      <ErrorNotice code={error} clear={() => setError("")} />
                    ) : null}
                    {!connected ? (
                      <div className="connection-state" role="status">
                        <RefreshCw size={14} />
                        {L(
                          "Can’t update the conversation. Reconnecting…",
                          "暂时无法更新对话，正在重连…",
                        )}
                      </div>
                    ) : null}
                    {import.meta.env.VITE_WORKBENCH_PREVIEW==='1'&&id&&!readonly&&<WorkbenchDemo conversation={id} refresh={()=>refresh()} L={L}/>}
                    <Readiness ready={ready} />
                    {livePlan&&!readonly&&!snapshot?.conversation.archived&&<div className="planning-status">
                      <span role="status">{livePlan.state==='review'?L('Send a message to revise the plan.','发送消息可修改方案。'):
                        livePlan.state==='question'?L('Answer the question to continue planning.','回答问题后继续拟定方案。'):
                        livePlan.state==='failed'?L('Planning stopped. Send a message to try again.','方案生成中断，可发送消息重试。'):
                        L('Preparing the plan…','正在拟定方案…')}</span>
                      <button type="button" className="text-button" onClick={async ()=>{
                        try{await api('/conversations/'+id+'/planning',{action:'cancel',planId:livePlan.id});savePlanDraft(false)}
                        catch(error){setError(error instanceof ApiError?error.code:'plan_closed')}
                        finally{await refresh()}
                      }}>{L('Cancel plan','取消规划')}</button>
                    </div>}
                    {readonly ? <div className="composer worker-readonly"><textarea disabled rows={1} aria-label={L("Message "+currentRouter.label+" to continue", "请与 "+currentRouter.label+" 对话")} placeholder={L("Message "+currentRouter.label+" to continue", "请与 "+currentRouter.label+" 对话")}/><button onClick={()=>selectAgent(currentRouter.id)}>{L("Message "+currentRouter.label, "前往 "+currentRouter.label)}</button></div> : <ComposerPrimitive.AttachmentDropzone asChild disabled={sending||loadingAttachments||!ready?.ready}><ComposerPrimitive.Root className="composer">
                      <QuotePreview quote={quote} L={L} onClear={()=>saveQuote(null)}/>
                      <div className="composer-attachments"><ComposerPrimitive.Attachments components={{Attachment:ComposerAttachment}}/></div>
                      <ComposerControls visible={!configuring} L={L} sendShortcut={p.sendShortcut} sending={outstanding?.stage==='sending'} router={currentRouter.label}
                        model={ready?.model || ready?.backend} modelBackend={ready?.backend} mode={p.approvalMode} usage={usage}
                        loadSkills={loadSkills} skill={skill} onSkillChange={saveSkill}
                        loadReferences={id ? loadReferences : undefined} onReference={quoteMessage}
                        planDraft={planDraft} onPlanDraft={savePlanDraft} planning={!!livePlan}
                        onDraftCleared={clearDraftBinding}
                        uploadDisabled={sending || loadingAttachments || !ready?.ready}
                        onContext={() => setContextOpen(true)}
                        onUsageOpen={() => setUsageRefresh(value => value + 1)}
                        onCommitTrail={openActivityTray} saveMode={p.saveApprovalMode}
                        onModelSaved={id ? refresh : p.refreshReady}
                        onEnter={text => {
                          if ((sending || loading || loadingAttachments) && text.trim()) { queuedEnter.current = text; return }
                          runtime.thread.composer.send();
                        }}/>
                    </ComposerPrimitive.Root></ComposerPrimitive.AttachmentDropzone>}
                  </div>
                  {welcome ? <div className="starter-actions">
                    {[
                      preferenceStarter?{Icon:ListChecks,label:preferenceStarter.starter,text:preferenceStarter.prompt}
                        :{Icon:ListChecks,label:L("Make a checklist","整理清单"),text:L("Prepare a launch checklist grouped by owner.","把发布前的检查项按负责人整理成一份清单。")},
                      {Icon:UsersRound,label:L("Meet the team","查看分工"),text:L("Which Agents are in this workspace and what can they do?","我的团队里有哪些 Agent？各自负责什么？")},
                      {Icon:FileText,label:L("Draft a brief","起草简报"),text:L("Draft a short progress brief for this release.","帮我起草一份发布进度简报。")}
                    ].map(({Icon,label,text})=><button key={label} onClick={()=>{runtime.thread.composer.setText(text);threadRef.current?.querySelector<HTMLTextAreaElement>('.composer-input')?.focus()}}><Icon size={16}/>{label}</button>)}
                  </div>:null}
                </ThreadPrimitive.Root>
              </div>
              {!configuring&&<ChatWorkbench key={id??'new'} request={bench} conversation={id??undefined} reports={workbenchReports} overlay={panelOverlay}
                expanded={benchExpanded} setExpanded={setBenchExpanded} close={closeBench} createConversation={openFirstBrowser} L={L}/>}
              {displayedSession && <aside ref={sessionPresence.ref} id="session-panel" aria-label={L('Session panel', '会话面板')}
                data-closing={sessionPresence.closing||undefined} inert={sessionPresence.closing} aria-hidden={sessionPresence.closing||undefined}
                className="session-panel chat-inspector team-drawer task-drawer">
                <SidebarSeparator pane="panel" controls="session-panel" label={L("Session panel","会话面板")}/>
                <div className="task-drawer-stack">
                  <div className="task-drawer-layer task-overview-layer" data-inactive={!!shownTask||undefined} inert={!!shownTask} aria-hidden={!!shownTask||undefined}>
                  <TeamOverview active={!sessionPresence.closing} snapshot={snapshot} participants={participants} routerLabel={currentRouter.label} lang={lang} L={L}
                  heartbeat={<HeartbeatCard lang={lang} L={L} read={readHeartbeat} change={changeHeartbeat}/>}
                  tab={displayedSession.tab} focusOnOpen setTab={setTeamTab}
                  close={closePanel} select={readAgent} openFile={openFile}
                  browsers={<BrowserPanel L={L} conversationId={id??undefined} routerLabel={teamName(currentRouter.label)}
                    openInWorkbench={browser=>openBench('browser',undefined,browser)} createConversation={openFirstBrowser}/>}
                  openTask={id ? (activity,source)=>{
                    taskOpener.current=source;
                    setSelectedTask(activity.id);
                  } : undefined}
                  locateMessage={messageId=>{if(panelOverlay)showPanel(false);requestAnimationFrame(()=>void locateMessage(messageId))}}
                  changeSchedule={changeSchedule}
                  />
                  </div>
                  {id && taskPresence.view && <Suspense fallback={<div className="task-drawer-layer task-run-scroll"><p className="task-run-note" role="status">{L('Loading task history…','正在读取任务记录…')}</p></div>}>
                    <TaskDetail key={taskPresence.view} id={taskPresence.view} load={loadTask} retryAcceptance={retryAcceptance}
                    active={!sessionPresence.closing&&!taskPresence.closing} closing={taskPresence.closing}
                    layerRef={taskPresence.ref} back={backToTasks} close={closePanel} locale={lang} L={L} selectAgent={readAgent}
                    agentName={id=>id ? participants.find(agent=>agent.id===id)?.label??id : teamName(currentRouter.label)}/>
                  </Suspense>}
                </div>
              </aside>}
            </div>
            </div></SwitchView>
          </main>
        </div>
        <Dialog open={route==='/chat#schedules'} onClose={closeSchedules} title={L('Scheduled tasks','定时任务')} closeLabel={L('Close','关闭')}>
          {route==='/chat#schedules'&&<SessionSchedules {...{snapshot,lang,L,changeSchedule,openFile}} locateMessage={message=>{closeSchedules();void locateMessage(message)}}
            heartbeat={<HeartbeatCard lang={lang} L={L} read={readHeartbeat} change={changeHeartbeat}/>}/>}
        </Dialog>
        <Dialog open={contextOpen&&!configuring} onClose={()=>setContextOpen(false)} title={L('Context usage','上下文用量')} closeLabel={L('Close','关闭')}>
          {contextOpen&&<ContextCard current={usage} L={L} focusOnReveal loadTeam={id?loadTeamContext:undefined} teamRevision={teamUsageRevision}
            workerLabel={workerId=>workers.find(worker=>worker.id===workerId)?.label} taskLabel={ticketId=>snapshot?.tasks.find(task=>task.id===ticketId)?.title}
            onClose={()=>setContextOpen(false)}/>}
        </Dialog>
        {file?<DeliveryFileViewer key={file.href} file={file} L={L} onClose={()=>setFile(null)} onReveal={file.revealHref?()=>revealFile(file):undefined}/>:null}
        </InteractionProvider>
      </AssistantRuntimeProvider></WorkflowProvider>
    </Context.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
