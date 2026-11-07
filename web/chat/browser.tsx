import { useEffect, useRef, useState } from "react";
import {
  Globe,
  Plus,
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  KeyRound,
  Settings2,
  Hand,
  Play,
  LoaderCircle,
  Trash2,
  Save,
  Power,
} from "lucide-react";
import type { BrowserManager } from "../../src/browser-manager.ts";
import type { BrowserAction } from "../../src/browser-contract.ts";
import {browserPoint} from './browser-geometry.ts';
import "./browser.css";

type State = ReturnType<BrowserManager["list"]>;
type Session = State["sessions"][number];
type Frame = { data: string; width: number; height: number; seq: number };
type L = (en: string, zh: string) => string;
// Stable while moving between conversations or reopening the panel; unique per document/window.
const browserClient = crypto.randomUUID();
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/browser" + path, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.code ?? "network_error");
  return data;
}
const messages: Record<string, [string, string]> = {
  browser_profile_in_use: ["This browser is open in another conversation. Create another browser, or close it there first.","此浏览器正在另一会话中使用。请创建另一个浏览器，或先在原会话中关闭。"],
  browser_control_busy: [
    "Another window controls this browser.",
    "另一个窗口正在控制此浏览器。",
  ],
  browser_control_required: ["Take control to interact.", "请先接管浏览器。"],
  browser_control_changed: [
    "Control changed. Refresh and try again.",
    "控制权已变更，请刷新后重试。",
  ],
  browser_stale_snapshot: [
    "The page changed. Refresh before continuing.",
    "页面已变化，请刷新后继续。",
  ],
  browser_command_failed: [
    "The browser action failed. Inspect the page before retrying.",
    "浏览器操作失败，请检查页面后再重试。",
  ],
  browser_uncertain: [
    "The result is uncertain. Check the page before repeating this action.",
    "操作结果未确认，请检查页面，避免重复提交。",
  ],
  browser_unavailable: [
    "Browser engine unavailable. Check the host installation.",
    "浏览器引擎不可用，请检查宿主安装。",
  ],
  browser_login_form: [
    "Could not identify the sign-in form. You can sign in manually.",
    "未能识别登录表单，可以手动登录。",
  ],
  browser_disabled: ["Browser access is disabled.", "浏览器访问已关闭。"],
  browser_capacity: [
    "Close an idle browser to continue.",
    "请关闭闲置浏览器后再继续。",
  ],
  browser_missing: ["This browser has closed.", "此浏览器已关闭。"],
  browser_key_invalid: [
    "Saved accounts could not be unlocked.",
    "无法解锁已保存的账号。",
  ],
  validation_error: ["Check the entered fields.", "请检查填写内容。"],
};

  const Button = ({
    label,
    children,
    onClick,
    disabled = false,
  }: {
    label: string;
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button
      className="icon-button"
      title={label}
      aria-label={label}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );

export function BrowserPanel({L,conversationId,requestedUrl='',onUrlConsumed}: {L:L;conversationId:string;requestedUrl?:string;onUrlConsumed?:()=>void}) {
  const client = browserClient;
  const [data, setData] = useState<State | null>(null),
    [selected, setSelected] = useState(()=>{try{return sessionStorage.getItem('roppo.browser.selected.'+conversationId)||''}catch{return ''}}),
    [frame, setFrame] = useState<Frame | null>(null),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [address, setAddress] = useState(""),
    [dialog, setDialog] = useState<"profile" | "accounts" | null>(null);
  const [profileId, setProfileId] = useState(""),
    [profileName, setProfileName] = useState(""),
    [grants, setGrants] = useState<string[]>([]);
  const [accountId, setAccountId] = useState(""),
    [accountProfile, setAccountProfile] = useState(""),
    [label, setLabel] = useState(""),
    [loginUrl, setLoginUrl] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  useEffect(()=>{if(selected)try{sessionStorage.setItem('roppo.browser.selected.'+conversationId,selected)}catch{}},[selected,conversationId]);
  const active = useRef(true),
    sessionRef = useRef<Session | undefined>(undefined),
    loading = useRef(false),
    inputGeneration = useRef(0),
    image = useRef<HTMLImageElement>(null),
    keyboard = useRef<HTMLTextAreaElement>(null),
    compose = useRef(false),
    inputQueue = useRef<Promise<unknown>>(Promise.resolve()),
    dialogRef = useRef<HTMLDialogElement>(null),
    triggerRef = useRef<HTMLElement | null>(null);
  const session = data?.sessions.find((s) => s.id === selected),
    profile = data?.profiles.find((p) => p.id === session?.profileId),
    controlled = !!session?.controlledByYou && connected;
  sessionRef.current = session;
  const fail = (e: unknown) => {
    if (active.current)
      setError(e instanceof Error ? e.message : "network_error");
  };
  const refresh = async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const next = await request<State>("?client=" + client + "&conversation=" + conversationId);
      if (active.current) setData(next);
    } catch (e) {
      fail(e);
    } finally {
      loading.current = false;
    }
  };
  const update = (value: Session) => {
    if (active.current)
      setData((old) =>
        old
          ? {
              ...old,
              sessions: old.sessions.some((s) => s.id === value.id)
                ? old.sessions.map((s) => (s.id === value.id ? value : s))
                : [...old.sessions, value],
            }
          : old,
      );
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (data && !data.sessions.some((s) => s.id === selected))
      setSelected(data.sessions[0]?.id ?? "");
  }, [data, selected]);
  useEffect(() => {
    setAddress(session?.url === "about:blank" ? "" : (session?.url ?? ""));
  }, [session?.url, selected]);
  useEffect(() => {
    setFrame(null);
    setConnected(false);
    if (!selected) return;
    let current = true;
    const source = new EventSource(
      "/api/browser/sessions/" + selected + "/stream",
    );
    source.addEventListener("frame", (event) => {
      if (active.current && current) {
        setFrame(JSON.parse((event as MessageEvent).data));
        setConnected(true);
      }
    });
    source.addEventListener("status", (event) => {
      if (active.current && current)
        setConnected(JSON.parse((event as MessageEvent).data).connected);
    });
    source.addEventListener("closed", () => {
      source.close();
      setConnected(false);
      void refresh();
    });
    source.onerror = () => {if(current)setConnected(false)};
    let inspecting = false;
    const inspect = async () => {
      if (inspecting) return;
      inspecting = true;
      try {
        {
          const value = await request<Session>(
            "/sessions/" + selected + "?client=" + client,
          );
          if (current) update(value);
        }
      } catch (e) {
        fail(e);
      } finally {
        inspecting = false;
      }
    };
    void inspect();
    const timer = setInterval(() => void inspect(), 5000);
    return () => {
      current = false;
      source.close();
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => {
    if (!session?.controlledByYou) return;
    const timer = setInterval(
      () =>
        void request<Session>("/sessions/" + session.id + "/renew", {
          client,
          epoch: session.epoch,
        })
          .then(update)
          .catch(fail),
      20000,
    );
    return () => clearInterval(timer);
  }, [session?.id, session?.epoch, session?.controlledByYou]);
  useEffect(() => {
    if (!dialog) return;
    triggerRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.showModal();
    return () => triggerRef.current?.focus();
  }, [dialog]);
  const openProfile = (id: string) =>
    act(async () => {
      const value = await request<Session>("/profiles/" + id + "/open", {
        client,conversationId,
      });
      update(value);
      setSelected(value.id);
    });
  const operation = (operation: Partial<BrowserAction>) =>
    act(async () => {
      const s = sessionRef.current;
      if (!s) return;
      update(
        await request<Session>("/sessions/" + s.id + "/action", {
          client,
          epoch: s.epoch,
          operation: {
            ...operation,
            ...(["click", "fill", "press"].includes(operation.action ?? "")
              ? { revision: s.revision }
              : {}),
          },
        }),
      );
    });
  const handledUrl = useRef('');
  useEffect(() => {
    if (!requestedUrl) { handledUrl.current = ''; return; }
    // A launcher request must not navigate a Worker's active page or bypass its lease.
    if (!session?.personal || !controlled || busy || handledUrl.current === requestedUrl) return;
    handledUrl.current = requestedUrl;
    onUrlConsumed?.();
    void operation({ action: 'new_tab', url: requestedUrl });
  }, [requestedUrl, session?.id, session?.personal, controlled, busy]);
  const input = (event: unknown) => {
    const captured = sessionRef.current;
    if (!captured?.controlledByYou || !connected) return;
    const generation = inputGeneration.current;
    inputQueue.current = inputQueue.current
      .catch(() => {})
      .then(async () => {
        if (
          generation !== inputGeneration.current ||
          !active.current ||
          sessionRef.current?.id !== captured.id ||
          sessionRef.current?.epoch !== captured.epoch
        )
          return;
        try {
          update(
            await request<Session>("/sessions/" + captured.id + "/input", {
              client,
              epoch: captured.epoch,
              event,
            }),
          );
        } catch (e) {
          inputGeneration.current++;
          fail(e);
        }
      });
  };
  const newProfile = () => {
    setProfileId("");
    setProfileName(L("Personal browser", "个人浏览器"));
    setGrants([]);
    setDialog("profile");
  };
  const accounts = () => {
    setAccountId("");
    setAccountProfile(session?.profileId ?? data?.profiles[0]?.id ?? "");
    setLabel("");
    setLoginUrl(session?.url === "about:blank" ? "" : (session?.url ?? ""));
    setUsername("");
    setPassword("");
    setDialog("accounts");
  };
  const closeDialog = () => {
    setPassword("");
    setDialog(null);
  };
  const labelFor = (s: Session) =>
    s.personal
      ? (data?.profiles.find((p) => p.id === s.profileId)?.name ??
        L("My browser", "我的浏览器"))
      : (data?.workers.find((w) => w.id === s.workerId)?.label ?? "Worker") +
        " · " +
        (s.title || L("Browser", "浏览器"));
  return (
    <aside
      className="browser-panel" aria-label={L("Browser", "浏览器")} id="browser-panel">
      <div className="browser-select">
        <select
          aria-label={L("Browser session", "浏览器会话")}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="" disabled>
            {L("Choose a browser", "选择浏览器")}
          </option>
          {data?.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {labelFor(s)}
            </option>
          ))}
        </select>
        <Button
          label={L("New browser profile", "新建浏览器资料")}
          onClick={newProfile}
          disabled={busy}
        >
          <Plus size={17} />
        </Button>
        <Button
          label={L("Saved accounts", "已保存账号")}
          onClick={accounts}
          disabled={!data?.profiles.length}
        >
          <KeyRound size={17} />
        </Button>
        <Button
          label={L("Browser profile settings", "浏览器资料设置")}
          onClick={() => {
            if (profile) {
              setProfileId(profile.id);
              setProfileName(profile.name);
              setGrants(profile.allowedWorkers);
              setDialog("profile");
            }
          }}
          disabled={!profile}
        >
          <Settings2 size={17} />
        </Button>
      </div>
      {!!data?.profiles.length && (
        <div className="browser-profiles">
          {data.profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => void openProfile(p.id)}
              disabled={busy}
            >
              <Globe size={12} />
              {p.name}
            </button>
          ))}
        </div>
      )}
      {error && !dialog && (
        <div className="browser-error" role="alert">
          <span>
            {messages[error]
              ? L(...messages[error]!)
              : L("Unable to complete this operation.", "未能完成此操作。")}
          </span>
          <Button
            label={L("Dismiss error", "关闭提示")}
            onClick={() => setError("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {requestedUrl && (!session?.personal || !controlled) ? (
        <div className="browser-pending-site" role="status">
          <span>{L('Choose a personal browser to open this website.', '选择个人浏览器以打开此网站。')}</span>
          <strong title={requestedUrl}>{requestedUrl}</strong>
          <Button label={L('Cancel opening website','取消打开网站')} onClick={()=>onUrlConsumed?.()}><X size={14}/></Button>
        </div>
      ) : null}
      {session ? (
        <>
          <form
            className="browser-address"
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim())
                void operation({
                  action: "navigate",
                  url: /^https?:\/\//.test(address)
                    ? address
                    : "https://" + address,
                });
            }}
          >
            <Button
              label={L("Back", "后退")}
              onClick={() => void operation({ action: "back" })}
              disabled={!controlled || busy}
            >
              <ArrowLeft size={15} />
            </Button>
            <Button
              label={L("Forward", "前进")}
              onClick={() => void operation({ action: "forward" })}
              disabled={!controlled || busy}
            >
              <ArrowRight size={15} />
            </Button>
            <Button
              label={L("Reload", "重新加载")}
              onClick={() => void operation({ action: "reload" })}
              disabled={!controlled || busy}
            >
              <RotateCw size={15} />
            </Button>
            <input
              aria-label={L("Website address", "网站地址")}
              placeholder={L("Enter a website", "输入网址")}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!controlled || busy}
            />
            <Button
              label={L("Close this browser", "关闭此浏览器")}
              onClick={() =>
                void act(async () => {
                  await request("/sessions/" + session.id + "/close", {
                    client,
                    epoch: session.epoch,
                  });
                  setSelected("");
                })
              }
              disabled={
                busy ||
                (session.control === "human" && !session.controlledByYou)
              }
            >
              <Power size={15} />
            </Button>
          </form>
          <div
            className="browser-tabs"
            role="tablist"
            aria-label={L("Browser tabs", "浏览器标签页")}
          >
            {session.tabs.map((t) => (
              <div key={t.index} className={t.active ? "active" : ""}>
                <button
                  role="tab"
                  aria-selected={!!t.active}
                  disabled={!controlled || busy}
                  onClick={() =>
                    void operation({ action: "select_tab", tab: t.id })
                  }
                >
                  {t.url === 'about:blank' ? L("New tab", "新标签页") : t.title || L("New tab", "新标签页")}
                </button>
                <button
                  aria-label={
                    L("Close tab", "关闭标签页") +
                    " " +
                    (t.url === "about:blank" ? L("New tab", "\u65b0\u6807\u7b7e\u9875") : t.title || String(t.index + 1))
                  }
                  disabled={!controlled || busy}
                  onClick={() =>
                    void operation({ action: "close_tab", tab: t.id })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <Button
              label={L("New tab", "新建标签页")}
              onClick={() =>
                void operation({ action: "new_tab", url: "about:blank" })
              }
              disabled={!controlled || busy}
            >
              <Plus size={15} />
            </Button>
          </div>
          <div
            className={"browser-viewport" + (controlled ? " controlled" : "")}
            onPointerDown={(e) => {
              if (!controlled || !frame || !image.current) return;
              e.preventDefault();
              keyboard.current?.focus();
              const point=browserPoint({x:e.clientX,y:e.clientY},image.current.getBoundingClientRect(),{width:image.current.naturalWidth,height:image.current.naturalHeight},frame.width);
              if(point)input({type:'click',...point});
            }}
            onWheel={(e) => {
              if (controlled)
                input({
                  type: "wheel",
                  deltaY: Math.round(Math.max(-3000, Math.min(3000, e.deltaY))),
                  deltaX: Math.round(Math.max(-3000, Math.min(3000, e.deltaX))),
                });
            }}
          >
            {frame ? (
              <img
                ref={image}
                src={"data:image/jpeg;base64," + frame.data}
                alt={L("Live browser page", "浏览器实时页面")}
                draggable={false}
              />
            ) : (
              <div className="browser-loading">
                <LoaderCircle size={24} className="spin" />
                {L("Connecting to browser", "正在连接浏览器")}
              </div>
            )}
            {!connected && frame && (
              <div className="browser-disconnected">
                {L("Browser disconnected", "浏览器连接已断开")}
              </div>
            )}
            <textarea
              className="browser-keyboard"
              aria-label={L("Browser keyboard input", "浏览器键盘输入")}
              aria-description={L("Press F6 to focus the address bar", "\u6309 F6 \u56de\u5230\u5730\u5740\u680f")}
              ref={keyboard}
              disabled={!controlled}
              onCompositionStart={() => {
                compose.current = true;
              }}
              onCompositionEnd={(e) => {
                compose.current = false;
                if (e.currentTarget.value)
                  input({ type: "text", text: e.currentTarget.value });
                e.currentTarget.value = "";
              }}
              onChange={(e) => {
                if (!compose.current && e.target.value) {
                  input({ type: "text", text: e.target.value });
                  e.target.value = "";
                }
              }}
              onKeyDown={(e) => {
                if (compose.current || e.nativeEvent.isComposing) return;
                if(e.key === "F6"){e.preventDefault();e.stopPropagation();document.querySelector<HTMLInputElement>(".browser-address input")?.focus();return;}
                if (
                  [
                    "Enter",
                    "Tab",
                    "Escape",
                    "Backspace",
                    "Delete",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                    "Home",
                    "End",
                    "PageUp",
                    "PageDown",
                  ].includes(e.key) ||
                  ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  input({
                    type: "key",
                    key:
                      (e.ctrlKey ? "Control+" : "") +
                      (e.metaKey ? "Meta+" : "") +
                      (e.shiftKey ? "Shift+" : "") +
                      (e.key.length === 1 ? e.key.toLowerCase() : e.key),
                  });
                }
              }}
            />
          </div>
          <footer className="browser-control">
            <span>
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <span
                  className={
                    "browser-status-dot" + (connected ? " connected" : "")
                  }
                />
              )}{" "}
              {session.controlledByYou
                ? L("You have control", "由你控制")
                : session.control === "worker"
                  ? L("Worker has control", "由 Worker 控制")
                  : session.control === "handoff"
                    ? L("Handing over…", "正在交接…")
                    : session.ended
                      ? L("Task ended", "任务已结束")
                      : L("Waiting for takeover", "等待接管")}
            </span>
            {session.controlledByYou ? (
              <button
                className="browser-primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await inputQueue.current;
                    update(
                      await request<Session>(
                        "/sessions/" + session.id + "/release",
                        { client, epoch: session.epoch },
                      ),
                    );
                  })
                }
              >
                <Play size={14} />
                {session.personal || session.ended
                  ? L("Release control", "结束操作")
                  : L("Return to Worker", "交还 Worker")}
              </button>
            ) : (
              <button
                className="browser-primary"
                disabled={busy || session.control === "handoff"}
                onClick={() =>
                  void act(async () =>
                    update(
                      await request<Session>(
                        "/sessions/" + session.id + "/takeover",
                        { client, force: session.control === "human" },
                      ),
                    ),
                  )
                }
              >
                <Hand size={14} />
                {session.control === "human"
                  ? L("Take over here", "转移控制到此窗口")
                  : L("Take control", "接管")}
              </button>
            )}
          </footer>
        </>
      ) : (
        <div className="browser-empty">
          <Globe size={34} />
          <h2>{L("Your browser, ready for work", "你的浏览器，随时可用")}</h2>
          <button
            className="browser-primary"
            disabled={busy || data?.enabled === false}
            onClick={newProfile}
          >
            <Plus size={16} />
            {L("Create browser", "创建浏览器")}
          </button>
          {!data && <LoaderCircle size={18} className="spin" />}
        </div>
      )}
      {dialog && (
        <dialog
          ref={dialogRef}
          className="browser-dialog"
          onCancel={closeDialog}
          onKeyDown={e=>e.stopPropagation()}
          aria-labelledby="browser-dialog-title"
        >
          <header>
            <h2 id="browser-dialog-title">
              {dialog === "profile"
                ? L("Browser profile", "浏览器资料")
                : L("Saved accounts", "已保存账号")}
            </h2>
            <Button label={L("Close", "关闭")} onClick={closeDialog}>
              <X size={18} />
            </Button>
          </header>
          {error && (
            <div className="browser-error" role="alert">
              {messages[error]
                ? L(...messages[error]!)
                : L("Unable to complete this operation.", "未能完成此操作。")}
            </div>
          )}
          {dialog === "profile" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const p = await request<State["profiles"][number]>(
                    "/profiles" + (profileId ? "/" + profileId : ""),
                    { name: profileName, allowedWorkers: grants },
                  );
                  closeDialog();
                  const s = await request<Session>(
                    "/profiles/" + p.id + "/open",
                    { client,conversationId },
                  );
                  update(s);
                  setSelected(s.id);
                });
              }}
            >
              <label>
                {L("Name", "名称")}
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>
                  {L(
                    "Workers allowed to use these sign-ins",
                    "可使用此浏览器登录信息的 Worker",
                  )}
                </legend>
                {data?.workers.map((w) => (
                  <label className="browser-grant" key={w.id}>
                    <input
                      type="checkbox"
                      checked={grants.includes(w.id)}
                      onChange={(e) =>
                        setGrants(
                          e.target.checked
                            ? [...grants, w.id]
                            : grants.filter((id) => id !== w.id),
                        )
                      }
                    />
                    {w.label}
                  </label>
                ))}
              </fieldset>
              <div className="browser-dialog-actions">
                <button type="button" onClick={closeDialog}>
                  {L("Cancel", "取消")}
                </button>
                <button className="browser-primary" disabled={busy}>
                  <Save size={14} />
                  {L("Save", "保存")}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="browser-account-list">
                {data?.credentials.map((a) => (
                  <div key={a.id}>
                    <button
                      onClick={() => {
                        setAccountId(a.id);
                        setAccountProfile(a.profileId);
                        setLabel(a.label);
                        setLoginUrl(a.url);
                        setUsername(a.username);
                        setPassword("");
                      }}
                    >
                      <strong>{a.label}</strong>
                      <span>{a.username}</span>
                    </button>
                    {session?.profileId === a.profileId && (
                      <button
                        disabled={!controlled || busy}
                        onClick={() => {
                          closeDialog();
                          void operation({
                            action: "login",
                            credentialId: a.id,
                          });
                        }}
                      >
                        {L("Fill", "填入")}
                      </button>
                    )}
                    <Button
                      label={
                        L("Delete saved account", "删除已保存账号") +
                        " " +
                        a.label
                      }
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await request("/accounts/" + a.id + "/remove", {});
                          if (accountId === a.id) {
                            setAccountId("");
                            setPassword("");
                          }
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await request(
                      "/accounts" + (accountId ? "/" + accountId : ""),
                      {
                        profileId: accountProfile,
                        label,
                        url: loginUrl,
                        username,
                        password,
                      },
                    );
                    setPassword("");
                    setAccountId("");
                    setLabel("");
                    setUsername("");
                  });
                }}
              >
                <label>
                  {L("Browser profile", "浏览器资料")}
                  <select
                    required
                    value={accountProfile}
                    onChange={(e) => setAccountProfile(e.target.value)}
                  >
                    {data?.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {L("Account name", "账号名称")}
                  <input
                    required
                    maxLength={80}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label>
                  {L("Sign-in URL", "登录网址")}
                  <input
                    required
                    type="url"
                    value={loginUrl}
                    onChange={(e) => setLoginUrl(e.target.value)}
                  />
                </label>
                <label>
                  {L("Username", "用户名")}
                  <input
                    required
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label>
                  {accountId
                    ? L("New password", "新密码")
                    : L("Password", "密码")}
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <div className="browser-dialog-actions">
                  {accountId && (
                    <button
                      type="button"
                      onClick={() => {
                        setAccountId("");
                        setLabel("");
                        setUsername("");
                        setPassword("");
                      }}
                    >
                      {L("Add another", "添加其他账号")}
                    </button>
                  )}
                  <button className="browser-primary" disabled={busy}>
                    <Save size={14} />
                    {accountId
                      ? L("Update account", "更新账号")
                      : L("Save account", "保存账号")}
                  </button>
                </div>
              </form>
            </>
          )}
        </dialog>
      )}
    </aside>
  );
}
