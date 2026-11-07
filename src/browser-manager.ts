import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Runtime } from "./runtime.ts";
import type { WorkOwner } from "./work.ts";
import { workerProfiles } from "./worker-pool.ts";
import {
  AgentBrowserDriver,
  type BrowserDriver,
  type DriverSession,
} from "./browser-driver.ts";
import { BrowserVault } from "./browser-vault.ts";
import {
  BrowserError,
  browserAction,
  browserUrl,
  type BrowserProfile,
  type BrowserAction,
  type BrowserToolInput,
  type BrowserFrame,
} from "./browser-contract.ts";

type Control = "worker" | "human" | "paused" | "handoff" | "ended";
interface Session extends DriverSession {
  user: string;
  profileId?: string;
  personal: boolean;
  owner?: WorkOwner;
  workerId?: string;
  conversationId?: string;
  control: Control;
  epoch: number;
  revision: number;
  client?: string;
  leaseUntil: number;
  ended: boolean;
  closing: boolean;
  tabs: { id: string; index: number; url: string; title: string; active?: boolean }[];
  url: string;
  title: string;
  updatedAt: number;
  watchers: number;
  ready: boolean;
  initialization?: Promise<void>;
  queue: Promise<unknown>;
  controller: AbortController;
  frame?: BrowserFrame;
  stopFrames?: () => void;
  streaming?: boolean;
  closePromise?: Promise<void>;
  secrets: Set<string>;
}
interface Receipt {
  fingerprint: string;
  state: "running" | "complete" | "uncertain";
  result?: unknown;
}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const cleanUrl = (value: string) => {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "about:blank";
  } catch {
    return "about:blank";
  }
};

/** Login snapshots contain only the requested site's cookies and origin storage. */
export function stateForOrigin(state: any, url: string) {
  const target = new URL(url),
    hostname = target.hostname;
  return {
    cookies: (Array.isArray(state.cookies) ? state.cookies : []).filter(
      (c: any) => {
        const domain = String(c.domain ?? "").replace(/^\./, "");
        return (
          domain && (hostname === domain || hostname.endsWith("." + domain))
        );
      },
    ),
    origins: (Array.isArray(state.origins) ? state.origins : []).filter(
      (o: any) => o.origin === target.origin,
    ),
  };
}

export class BrowserManager {
  private sessions = new Map<string, Session>();
  private opening = new Map<string, Promise<Session>>();
  private calls = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown> }
  >();
  private root: string;
  private vault?: BrowserVault;
  private closing = false;
  private recovery: Promise<unknown>;
  private timer: ReturnType<typeof setInterval>;
  readonly driver: BrowserDriver;
  constructor(
    private host: Runtime,
    driver?: BrowserDriver,
  ) {
    this.root = join(host.config.stateDir, "browser");
    this.driver =
      driver ?? new AgentBrowserDriver(this.root, host.config.browser);
    const abandoned = host.store
      .list<any>("browser-session")
      .filter((row) => row.active);
    this.recovery = Promise.allSettled(
      abandoned.map(async (row) => {
        await this.driver.close(row);
        if (!row.personal)
          rmSync(row.directory, { recursive: true, force: true });
        host.store.put("browser-session", row.id, {
          ...row,
          active: false,
          interrupted: true,
        });
      }),
    );
    for (const row of host.store.list<any>("browser-receipt"))
      if (row.state === "running")
        host.store.put("browser-receipt", row.id, {
          ...row,
          state: "uncertain",
          result: undefined,
        });
    this.timer = setInterval(() => {
      for (const s of this.sessions.values()) {
        if (s.owner && !s.ended && !host.validWork(s.owner)) {
          s.ended = true;
          if (s.control === "worker") void this.closeSession(s).catch(() => {});
        }
        if (s.control === "human" && s.leaseUntil < Date.now()) {
          s.control = "paused";
          s.client = undefined;
          s.epoch++;
        }
        if (
          Date.now() - s.updatedAt > host.config.browser.idleMs &&
          s.control !== "human"
        )
          void this.closeSession(s).catch(() => {});
      }
    }, 10000);
    this.timer.unref();
  }
  private getVault() {
    return (this.vault ??= new BrowserVault(
      join(this.root, "vault"),
      this.host.config.browser.keyEnv,
    ));
  }
  private enabled() {
    if (this.closing || !this.host.config.browser.enabled)
      throw new BrowserError("browser_disabled", "Browser access is disabled.");
  }
  private principal(owner: WorkOwner) {
    if (!this.host.validWork(owner))
      throw new BrowserError(
        "browser_assignment_ended",
        "This assignment no longer owns a browser.",
      );
    const run = this.host.store.get<any>("run", owner.ticketId),
      options = run?.agentOptions?.browser;
    if (options?.enabled === false)
      throw new BrowserError(
        "browser_disabled",
        "Browser access is disabled for this Worker.",
      );
    const assignment = this.host.store.get<any>(
        "worker-assignment",
        owner.ticketId,
      ),
      chatRun =
        assignment?.parentTrigger &&
        this.host.store.get<any>("chat-run", assignment.parentTrigger),
      conversation =
        chatRun &&
        this.host.store.get<any>("chat-conversation", chatRun.conversationId);
    return {
      user: conversation?.owner ?? "host",
      workerId: run?.workerId ?? assignment?.workerId ?? "",
      conversationId: conversation?.id,
      maxTabs: options?.maxTabs ?? 8,
    };
  }
  private profile(id: string, user: string) {
    const p = this.host.store.get<BrowserProfile>("browser-profile", id);
    if (!p || p.owner !== user)
      throw new BrowserError(
        "browser_profile_missing",
        "Browser profile not found.",
        404,
      );
    return p;
  }
  private authorizeProfile(id: string, user: string, worker?: string) {
    const p = this.profile(id, user);
    if (worker !== undefined && !p.allowedWorkers.includes(worker))
      throw new BrowserError(
        "browser_profile_denied",
        "This Worker cannot use this browser profile.",
        403,
      );
    return p;
  }
  private visible(s: Session, user: string) {
    if (s.user !== user && s.user !== "host")
      throw new BrowserError(
        "browser_missing",
        "Browser session not found.",
        404,
      );
    return s;
  }
  private session(id: string, user: string) {
    const s = this.sessions.get(id);
    if (!s || s.closing || !s.ready)
      throw new BrowserError(
        "browser_missing",
        "Browser session is closed.",
        404,
      );
    return this.visible(s, user);
  }
  private workerSession(id: string, owner: WorkOwner) {
    const principal = this.principal(owner),
      s = this.session(id, principal.user);
    if (
      !s.owner ||
      s.owner.ticketId !== owner.ticketId ||
      s.owner.assignmentId !== owner.assignmentId ||
      s.owner.agentId !== owner.agentId
    )
      throw new BrowserError(
        "browser_owner",
        "Browser belongs to a different assignment.",
        403,
      );
    if (s.profileId)
      this.authorizeProfile(s.profileId, principal.user, principal.workerId);
    return s;
  }
  private enqueue<T>(s: Session, action: () => Promise<T>): Promise<T> {
    const next = s.queue.catch(() => {}).then(action);
    s.queue = next.catch(() => {});
    return next;
  }
  private view(s: Session, client?: string) {
    return {
      id: s.id,
      profileId: s.profileId,
      personal: s.personal,
      workerId: s.workerId,
      conversationId: s.conversationId,
      control: s.control,
      epoch: s.epoch,
      revision: s.revision,
      controlledByYou: s.control === "human" && s.client === client,
      ended: s.ended,
      tabs: s.tabs,
      url: s.url,
      title: s.title,
      updatedAt: s.updatedAt,
      frameAt: s.frame?.at,
      streaming: !!s.streaming,
    };
  }
  list(user: string, client?: string, conversationId?: string) {
    const profiles = this.host.store
      .list<BrowserProfile>("browser-profile")
      .filter((p) => p.owner === user);
    return {
      enabled: this.host.config.browser.enabled,
      profiles,
      credentials: this.getVault().list(user),
      sessions: [...this.sessions.values()]
        .filter(
          (s) =>
            s.ready && !s.closing && (s.user === user || s.user === "host") && (!conversationId || s.conversationId === conversationId),
        )
        .map((s) => this.view(s, client)),
      workers: workerProfiles(this.host.config).map((w) => ({
        id: w.id,
        label: w.label ?? w.id,
        enabled: w.browser?.enabled !== false,
      })),
    };
  }
  saveProfile(
    user: string,
    input: { name: string; allowedWorkers: string[] },
    id: string = randomUUID(),
  ) {
    this.enabled();
    const old = this.host.store.get<BrowserProfile>("browser-profile", id);
    if (old) this.profile(id, user);
    const ids = new Set(workerProfiles(this.host.config).map((w) => w.id));
    if (input.allowedWorkers.some((id) => !ids.has(id)))
      throw new BrowserError(
        "browser_worker_missing",
        "Worker is no longer available.",
      );
    const p: BrowserProfile = {
      id,
      owner: user,
      ...input,
      tabs: old?.tabs ?? ["about:blank"],
      activeTab: old?.activeTab ?? 0,
      updatedAt: Date.now(),
    };
    this.host.store.put("browser-profile", id, p);
    return p;
  }
  saveCredential(
    user: string,
    input: {
      profileId: string;
      label: string;
      url: string;
      username: string;
      password: string;
    },
    id?: string,
  ) {
    this.profile(input.profileId, user);
    return this.getVault().save(
      user,
      { ...input, url: new URL(input.url).href },
      id,
    );
  }
  removeCredential(user: string, id: string) {
    this.getVault().remove(user, id);
  }
  private async capture(s: Session, signal?: AbortSignal) {
    const data = await this.driver.run(s, ["tab", "list"], signal);
    s.tabs = (data.tabs ?? []).map((t: any, i: number) => ({
      id: t.tabId,
      index: t.index ?? i,
      url: cleanUrl(t.url ?? "about:blank"),
      title: String(t.title ?? "").slice(0, 200),
      active: t.active === true,
    }));
    const active = s.tabs.find((t) => t.active) ?? s.tabs[0];
    if (s.url !== (active?.url ?? "about:blank")) s.revision++;
    s.url = active?.url ?? "about:blank";
    s.title = active?.title ?? "";
    s.updatedAt = Date.now();
    if (s.personal && s.profileId) {
      const p = this.profile(s.profileId, s.user);
      this.host.store.put("browser-profile", p.id, {
        ...p,
        tabs: s.tabs.map((t) => t.url),
        activeTab: s.tabs.findIndex((t) => t.active),
        updatedAt: s.updatedAt,
      });
    }
  }
  private async create(
    user: string,
    personal: boolean,
    profileId?: string,
    owner?: WorkOwner,
    url = "about:blank",
  ) {
    this.enabled();
    browserUrl.parse(url);
    await this.recovery;
    this.enabled();
    if (this.sessions.size >= this.host.config.browser.maxSessions)
      throw new BrowserError(
        "browser_capacity",
        "Close an idle browser before opening another.",
      );
    const principal = owner ? this.principal(owner) : undefined;
    const p = profileId
      ? this.authorizeProfile(profileId, user, principal?.workerId)
      : undefined;
    const id = randomUUID(),
      directory = join(
        this.root,
        personal ? "profiles" : "tasks",
        personal && p ? p.id : id,
      );
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const s: Session = {
      id,
      directory,
      user,
      personal,
      profileId,
      owner,
      workerId: principal?.workerId,
      conversationId: principal?.conversationId,
      control: personal ? "paused" : "worker",
      epoch: 0,
      revision: 0,
      leaseUntil: 0,
      ended: false,
      closing: false,
      tabs: [],
      url: "about:blank",
      title: "",
      updatedAt: Date.now(),
      watchers: 0,
      ready: false,
      queue: Promise.resolve(),
      controller: new AbortController(),
      secrets: new Set(),
    };
    this.sessions.set(id, s);
    this.host.store.put("browser-session", id, {
      id,
      directory,
      personal,
      profileId,
      user,
      active: true,
    });
    s.initialization = (async () => {
      // Reap only our previous daemon for this exact personal profile before reopening it.
      if (personal && p)
        for (const old of this.host.store
          .list<any>("browser-session")
          .filter(
            (row) =>
              row.id !== id &&
              row.personal &&
              row.profileId === p.id &&
              row.user === user &&
              row.active,
          )) {
          await this.driver.close({ id: old.id, directory });
          this.host.store.put("browser-session", old.id, {
            ...old,
            active: false,
          });
        }
      await this.driver.run(s, ["open", "about:blank"], s.controller.signal);
      if (!personal && p && url !== "about:blank") {
        const source = await this.openPersonalSession(user, p.id);
        const state = await this.enqueue(source, () => {
          this.authorizeProfile(p.id, user, principal!.workerId);
          return this.driver.state(source, source.controller.signal);
        });
        await this.driver.load(
          s,
          stateForOrigin(state, url),
          s.controller.signal,
        );
      }
      const urls = personal && p ? p.tabs.slice(0, 8) : [url];
      for (let i = 0; i < urls.length; i++)
        await this.driver.run(
          s,
          i ? ["tab", "new", cleanUrl(urls[i]!)] : ["open", cleanUrl(urls[i]!)],
          s.controller.signal,
        );
      if (personal && p && p.activeTab !== undefined && p.activeTab >= 0) {
        const restored=await this.driver.run(s,["tab","list"],s.controller.signal);
        const tabId=restored.tabs?.[p.activeTab]?.tabId;
        if(tabId)await this.driver.run(s,["tab",tabId],s.controller.signal);
      }
      if (owner) {
        this.principal(owner);
        if (profileId)
          this.authorizeProfile(profileId, user, principal!.workerId);
      }
      await this.capture(s, s.controller.signal);
      if (s.closing)
        throw new BrowserError(
          "browser_cancelled",
          "Browser was closed while opening.",
        );
      s.ready = true;
    })();
    try {
      await s.initialization;
      return s;
    } catch (error) {
      await this.closeSession(s).catch(() => {});
      throw error;
    }
  }
  private openPersonalSession(
    user: string,
    profileId: string,
  ): Promise<Session> {
    this.profile(profileId, user);
    const live = [...this.sessions.values()].find(
      (s) =>
        s.personal &&
        s.user === user &&
        s.profileId === profileId &&
        !s.closing,
    );
    const key = user + ":" + profileId,
      pending = this.opening.get(key);
    if (pending) return pending;
    if (live) return Promise.resolve(live);
    const promise = this.create(user, true, profileId).finally(() =>
      this.opening.delete(key),
    );
    this.opening.set(key, promise);
    return promise;
  }
  private receiveFrame(s: Session, frame: BrowserFrame) {
    if (!s.closing) s.frame = { ...frame, seq: (s.frame?.seq ?? 0) + 1 };
  }
  async openPersonal(user: string, profileId: string, client: string, conversationId?: string) {
    const s = await this.openPersonalSession(user, profileId);
    if(conversationId){
      if(s.conversationId && s.conversationId!==conversationId)throw new BrowserError('browser_profile_in_use','This browser is open in another conversation. Create another browser or close it there first.')
      s.conversationId=conversationId
    }
    if (s.control === "paused") await this.takeover(user, s.id, client);
    return this.view(s, client);
  }
  async takeover(user: string, id: string, client: string, force = false) {
    const s = this.session(id, user);
    if (s.control === "human" && s.client === client) {
      s.leaseUntil = Date.now() + 90000;
      return this.view(s, client);
    }
    if (
      s.control === "handoff" ||
      (s.control === "human" && s.leaseUntil > Date.now() && !force)
    )
      throw new BrowserError(
        "browser_control_busy",
        "This browser is controlled in another window.",
      );
    s.control = "handoff";
    s.epoch++;
    const epoch = s.epoch;
    await this.enqueue(s, async () => {
      if (s.closing || s.epoch !== epoch)
        throw new BrowserError(
          "browser_control_changed",
          "Browser control changed.",
        );
      s.control = "human";
      s.client = client;
      s.leaseUntil = Date.now() + 90000;
      s.revision++;
      s.updatedAt = Date.now();
    });
    return this.view(s, client);
  }
  private human(s: Session, client: string, epoch: number) {
    if (
      s.control !== "human" ||
      s.client !== client ||
      s.epoch !== epoch ||
      s.leaseUntil < Date.now()
    )
      throw new BrowserError(
        "browser_control_required",
        "Take control of this browser before interacting.",
      );
    s.leaseUntil = Date.now() + 90000;
    s.updatedAt = Date.now();
  }
  renew(user: string, id: string, client: string, epoch: number) {
    const s = this.session(id, user);
    this.human(s, client, epoch);
    return this.view(s, client);
  }
  async release(user: string, id: string, client: string, epoch: number) {
    const s = this.session(id, user);
    this.human(s, client, epoch);
    s.control = "handoff";
    s.epoch++;
    await this.enqueue(s, async () => {
      s.client = undefined;
      s.revision++;
      s.control = s.personal ? "paused" : s.ended ? "ended" : "worker";
      s.updatedAt = Date.now();
    });
    if (s.owner && !s.ended && this.host.validWork(s.owner))
      this.host.engine.note(
        s.owner.ticketId,
        "The user returned browser control. Read a fresh browser snapshot before continuing; old element references have expired.",
      );
    return this.view(s, client);
  }
  async subscribe(user: string, id: string) {
    const s = this.session(id, user);
    s.watchers++;
    try {
      await this.enqueue(s, () => this.ensureFrames(s));
    } catch (error) {
      s.watchers--;
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      s.watchers--;
      if (!s.watchers) {
        s.stopFrames?.();
        s.stopFrames = undefined;
        s.streaming = false;
      }
    };
  }
  private async ensureFrames(s: Session) {
    if (s.closing || !s.watchers || s.streaming) return;
    s.stopFrames?.();
    s.stopFrames = await this.driver.frames(
      s,
      (frame) => this.receiveFrame(s, frame),
      (connected) => {
        s.streaming = connected;
      },
    );
    if (s.closing || !s.watchers) {
      s.stopFrames();
      s.streaming = false;
    }
  }
  frame(user: string, id: string) {
    return this.session(id, user).frame;
  }
  streamStatus(user: string, id: string) {
    return !!this.session(id, user).streaming;
  }
  async inspect(user: string, id: string, client?: string) {
    const s = this.session(id, user);
    return this.enqueue(s, async () => {
      await this.capture(s, s.controller.signal);
      await this.ensureFrames(s);
      return this.view(s, client);
    });
  }
  async action(
    user: string,
    id: string,
    client: string,
    epoch: number,
    input: BrowserAction,
  ) {
    const s = this.session(id, user);
    this.human(s, client, epoch);
    return this.enqueue(s, async () => {
      this.human(s, client, epoch);
      await this.perform(s, input, () => this.human(s, client, epoch));
      return this.view(s, client);
    });
  }
  async input(
    user: string,
    id: string,
    client: string,
    epoch: number,
    event: {
      type: "click" | "wheel" | "text" | "key";
      x?: number;
      y?: number;
      deltaY?: number;
      deltaX?: number;
      text?: string;
      key?: string;
    },
  ) {
    const s = this.session(id, user);
    this.human(s, client, epoch);
    return this.enqueue(s, async () => {
      const guard = () => this.human(s, client, epoch);
      guard();
      if (event.type === "click") {
        for (const args of [
          [
            "mouse",
            "move",
            String(Math.round(event.x!)),
            String(Math.round(event.y!)),
          ],
          ["mouse", "down", "left"],
          ["mouse", "up", "left"],
        ]) {
          guard();
          await this.driver.run(s, args, s.controller.signal);
        }
      } else if (
        event.type === "key" &&
        /^(Control|Meta)\+a$/.test(event.key ?? "")
      )
        await this.driver.evaluate(
          s,
          `(()=>{const e=document.activeElement;if(e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA')&&typeof e.select==='function')e.select();else document.execCommand('selectAll')})()`,
          s.controller.signal,
        );
      else if (event.type === "wheel")
        await this.driver.run(
          s,
          [
            "mouse",
            "wheel",
            String(event.deltaY ?? 0),
            String(event.deltaX ?? 0),
          ],
          s.controller.signal,
        );
      else if (event.type === "key")
        await this.driver.run(s, ["press", event.key!], s.controller.signal);
      else
        await this.driver.evaluate(
          s,
          `document.execCommand('insertText',false,${JSON.stringify(event.text ?? "")})`,
          s.controller.signal,
        );
      s.revision++;
      await this.capture(s, s.controller.signal);
      return this.view(s, client);
    });
  }
  private async perform(s: Session, input: BrowserAction, guard: () => void) {
    guard();
    const signal = s.controller.signal;
    if (
      ["click", "fill", "press"].includes(input.action) &&
      input.revision !== s.revision
    )
      throw new BrowserError(
        "browser_stale_snapshot",
        "The page or control changed. Read a fresh snapshot.",
      );
    const max = s.owner ? this.principal(s.owner).maxTabs : 8;
    if (input.action === "new_tab" && s.tabs.length >= max)
      throw new BrowserError(
        "browser_tab_limit",
        "This browser has reached its tab limit.",
      );
    if (["select_tab","close_tab"].includes(input.action) && !s.tabs.some(tab=>tab.id===input.tab))
      throw new BrowserError("browser_tab_missing","This tab has closed. Refresh the page state.");
    if (input.action === "request_takeover") {
      s.control = "paused";
      s.epoch++;
      return;
    }
    if (input.action === "login") {
      const credential = this.getVault().read(s.user, input.credentialId!);
      if (credential.profileId !== s.profileId)
        throw new BrowserError(
          "browser_account_denied",
          "Saved account belongs to a different browser profile.",
          403,
        );
      const origin = new URL(credential.url).origin;
      if (new URL(s.url).origin !== origin)
        await this.driver.run(s, ["open", credential.url], signal);
      guard();
      s.secrets.add(credential.password);
      // Sent over stdin, never process argv. No password or form values in the result.
      const outcome = await this.driver.evaluate(
        s,
        `(()=>{if(location.origin!==${JSON.stringify(origin)})return {filled:false};const visible=e=>!!e&&e.getClientRects().length&&!e.disabled;const passwords=[...document.querySelectorAll('input[type="password"]')].filter(visible);if(passwords.length!==1)return {filled:false};const p=passwords[0],form=p.form,root=form||document;const u=[...root.querySelectorAll('input[autocomplete="username"],input[type="email"],input[type="text"]')].find(visible);if(!u)return {filled:false};const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(u,${JSON.stringify(credential.username)});u.dispatchEvent(new Event('input',{bubbles:true}));u.dispatchEvent(new Event('change',{bubbles:true}));set.call(p,${JSON.stringify(credential.password)});p.dispatchEvent(new Event('input',{bubbles:true}));p.dispatchEvent(new Event('change',{bubbles:true}));p.focus();return {filled:true}})()`,
        signal,
      );
      if (!outcome?.filled)
        throw new BrowserError(
          "browser_login_form",
          "Could not identify the login form. Take control to finish signing in.",
        );
    } else {
      const actions: Record<string, string[]> = {
        navigate: ["open", input.url!],
        snapshot: ["snapshot", "-i"],
        click: ["click", input.ref!],
        fill: ["fill", input.ref!, input.text!],
        press: ["press", input.key!],
        scroll: ["scroll", input.direction!, String(input.amount ?? 500)],
        new_tab: ["tab", "new", input.url!],
        select_tab: ["tab", String(input.tab)],
        close_tab: ["tab", "close", String(input.tab)],
        back: ["back"],
        forward: ["forward"],
        reload: ["reload"],
      };
      if (input.action !== "snapshot")
        await this.driver.run(s, actions[input.action]!, signal);
    }
    if (input.action !== "snapshot") s.revision++;
    await this.capture(s, signal);
  }
  private async snapshot(s: Session) {
    const result = await this.driver.run(
      s,
      ["snapshot", "-c"],
      s.controller.signal,
    );
    s.revision++;
    let text = String(result.snapshot ?? "");
    // Saved credentials may appear in reflected page content. Never project them into model history.
    for (const secret of s.secrets)
      if (secret) text = text.split(secret).join("[hidden]");
    let resultText = JSON.stringify({
      ...this.view(s),
      snapshot: text.slice(0, 40000),
    });
    for (const secret of s.secrets)
      if (secret)
        resultText = resultText
          .split(JSON.stringify(secret).slice(1, -1))
          .join("[hidden]");
    return JSON.parse(resultText);
  }
  async tool(owner: WorkOwner, input: BrowserToolInput): Promise<unknown> {
    this.enabled();
    const p = this.principal(owner);
    const key = hash([
        owner.ticketId,
        owner.assignmentId,
        owner.agentId ?? "",
        input.requestId,
      ]),
      fingerprint = hash(input);
    const current = this.calls.get(key);
    if (current) {
      if (current.fingerprint !== fingerprint)
        throw new BrowserError(
          "browser_request_reused",
          "requestId was reused with different input.",
        );
      return current.promise;
    }
    const saved = this.host.store.get<Receipt>("browser-receipt", key);
    if (saved) {
      if (saved.fingerprint !== fingerprint)
        throw new BrowserError(
          "browser_request_reused",
          "requestId was reused with different input.",
        );
      const profileId = (saved.result as any)?.profileId ?? input.profileId;
      if (profileId) this.authorizeProfile(profileId, p.user, p.workerId);
      if (saved.state !== "complete")
        throw new BrowserError(
          "browser_uncertain",
          "Previous browser action has an uncertain result. Inspect the page; do not repeat the write.",
        );
      return saved.result;
    }
    const promise = (async () => {
      if (input.action === "profiles")
        return {
          profiles: this.host.store
            .list<BrowserProfile>("browser-profile")
            .filter(
              (v) =>
                v.owner === p.user && v.allowedWorkers.includes(p.workerId),
            )
            .map((v) => ({
              id: v.id,
              name: v.name,
              accounts: this.getVault()
                .list(p.user)
                .filter((a) => a.profileId === v.id)
                .map(({ id, label, url }) => ({ id, label, url })),
            })),
        };
      if (input.action === "open") {
        this.record(key, fingerprint, "running");
        try {
          const s = await this.create(
            p.user,
            false,
            input.profileId,
            owner,
            input.url ?? "about:blank",
          );
          const value = await this.snapshot(s);
          this.record(key, fingerprint, "complete", value);
          return value;
        } catch (error) {
          this.record(key, fingerprint, "uncertain");
          throw error;
        }
      }
      if (!input.sessionId)
        throw new BrowserError(
          "browser_session_required",
          "sessionId is required for this browser action.",
          400,
        );
      const s = this.workerSession(input.sessionId, owner),
        epoch = s.epoch;
      if (s.control !== "worker")
        throw new BrowserError(
          "browser_human_control",
          "Browser is waiting for the user. Continue only after control is returned.",
        );
      return this.enqueue(s, async () => {
        const guard = () => {
          this.workerSession(s.id, owner);
          if (s.control !== "worker" || s.epoch !== epoch)
            throw new BrowserError(
              "browser_control_changed",
              "Browser control changed. Read a fresh snapshot after the user returns control.",
            );
        };
        guard();
        if (input.action === "close") {
          this.record(key, fingerprint, "running");
          await this.closeSession(s, false);
          const result = { closed: true };
          this.record(key, fingerprint, "complete", result);
          return result;
        }
        const { sessionId, profileId, requestId, ...args } = input,
          action = browserAction.parse(args);
        // Validation and ownership failures are retryable with the same requestId; only execution is receipted.
        if (
          ["click", "fill", "press"].includes(action.action) &&
          action.revision !== s.revision
        )
          throw new BrowserError(
            "browser_stale_snapshot",
            "Read a fresh snapshot before acting.",
          );
        this.record(key, fingerprint, "running");
        try {
          await this.perform(s, action, guard);
          const result =
            action.action === "request_takeover"
              ? this.view(s)
              : await this.snapshot(s);
          this.record(key, fingerprint, "complete", result);
          return result;
        } catch (error) {
          this.record(key, fingerprint, "uncertain");
          throw error;
        }
      });
    })().finally(() => this.calls.delete(key));
    this.calls.set(key, { fingerprint, promise });
    return promise;
  }
  private record(
    id: string,
    fingerprint: string,
    state: Receipt["state"],
    result?: unknown,
  ) {
    this.host.store.put("browser-receipt", id, {
      id,
      fingerprint,
      state,
      ...(result !== undefined ? { result } : {}),
    });
  }
  async closeOwned(user: string, id: string, client: string, epoch: number) {
    const s = this.session(id, user);
    if (s.control === "human") this.human(s, client, epoch);
    else if (s.control === "handoff")
      throw new BrowserError(
        "browser_control_busy",
        "Browser is changing control.",
      );
    await this.closeSession(s);
    return { closed: true };
  }
  private closeSession(s: Session, drain = true): Promise<void> {
    if (s.closePromise) return s.closePromise;
    s.closing = true;
    s.epoch++;
    s.controller.abort();
    s.stopFrames?.();
    return (s.closePromise = (async () => {
      await s.initialization?.catch(() => {});
      s.stopFrames?.();
      if (drain) await s.queue.catch(() => {});
      try {
        await this.driver.close(s);
        if (!s.personal) rmSync(s.directory, { recursive: true, force: true });
        const row = this.host.store.get<any>("browser-session", s.id);
        this.host.store.put("browser-session", s.id, { ...row, active: false });
      } finally {
        this.sessions.delete(s.id);
      }
    })());
  }
  endAssignment(ticketId: string, assignmentId: string) {
    for (const s of this.sessions.values())
      if (
        s.owner?.ticketId === ticketId &&
        s.owner.assignmentId === assignmentId
      ) {
        s.ended = true;
        s.epoch++;
        if (["human", "paused", "handoff"].includes(s.control)) {
          s.control = "paused";
          s.client = undefined;
        } else void this.closeSession(s).catch(() => {});
      }
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.recovery;
    await Promise.allSettled(
      [...this.sessions.values()].map((s) => this.closeSession(s)),
    );
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.calls.values()].map((c) => c.promise));
  }
}
