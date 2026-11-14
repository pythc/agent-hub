import { afterEach, it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Runtime } from "../src/runtime.ts";
import { configSchema } from "../src/config.ts";
import { BrowserVault } from "../src/browser-vault.ts";
import { stateForOrigin } from "../src/browser-manager.ts";
import { BrowserError, type BrowserFrame } from "../src/browser-contract.ts";
import type { BrowserDriver, DriverSession } from "../src/browser-driver.ts";
import type { WorkOwner } from "../src/work.ts";
import type { Model } from "../src/model.ts";
import { serve } from "../src/server.ts";
import type { Server } from "node:http";

const screenshotBytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=","base64");

class Driver implements BrowserDriver {
  tabs = new Map<string, any[]>();
  calls: { id: string; args: string[] }[] = [];
  closed: string[] = [];
  loaded: any[] = [];
  scripts: string[] = [];
  gate?: () => Promise<void>;
  openGate?: () => Promise<void>;
  screenshotGate?: () => Promise<void>;
  fail = false;
  snapshotText = '- button "Continue" [ref=e1]';
  async version() {
    return "fixture";
  }
  async run(s: DriverSession, args: string[], signal?: AbortSignal) {
    this.calls.push({ id: s.id, args });
    signal?.throwIfAborted();
    if (args[0] === "click") {
      if (this.gate) await this.gate();
      if (this.fail) throw new BrowserError("browser_uncertain", "Lost result");
    }
    if (args[0] === "open" && this.openGate) {
      const gate = this.openGate;
      this.openGate = undefined;
      await gate();
      signal?.throwIfAborted();
    }
    if (args[0] === "open")
      this.tabs.set(s.id, [
        { tabId: "t1", index: 0, url: args[1], title: "Page", active: true },
      ]);
    if (args[0] === "tab" && args[1] === "new")
      this.tabs
        .get(s.id)!
        .push({ tabId: "t2", index: 1, url: args[2], title: "Second" });
    if (args[0] === "tab" && args[1] === "list")
      return { tabs: this.tabs.get(s.id) ?? [] };
    if (args[0] === "snapshot") return { snapshot: this.snapshotText };
    if (args[0] === "screenshot") {
      await this.screenshotGate?.();
      writeFileSync(args[1]!,screenshotBytes);
    }
    return {};
  }
  async evaluate(_: DriverSession, expression: string) {
    this.scripts.push(expression);
    return { filled: true };
  }
  async state() {
    return {
      cookies: [
        { domain: "example.com", name: "session", value: "known-login" },
      ],
      origins: [{ origin: "https://example.com", localStorage: [] }],
    };
  }
  async load(_: DriverSession, value: any) {
    this.loaded.push(value);
  }
  async frames(
    _: DriverSession,
    callback: (f: BrowserFrame) => void,
    status?: (c: boolean) => void,
  ) {
    callback({
      data: "frame",
      width: 1280,
      height: 720,
      seq: 1,
      at: Date.now(),
    });
    status?.(true);
    return () => status?.(false);
  }
  async close(s: DriverSession) {
    this.closed.push(s.id);
  }
}
const roots: string[] = [],
  hosts: Runtime[] = [],
  servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  for (const h of hosts.splice(0)) await h.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const model: Model = {
  async run(r) {
    return {
      threadId: "fixture",
      turnId: randomUUID(),
      text: JSON.stringify(
        r.ephemeral
          ? {
              action: "accept",
              title: "Browser work",
              scope: "Use browser",
              reason: "requested",
              rules: [],
            }
          : {
              state: "waiting",
              summary: "Waiting",
              reply: "",
              question: null,
              handbacks: [],
            },
      ),
    };
  },
};
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "roppo-browser-"));
  roots.push(root);
  const driver = new Driver();
  const config = configSchema.parse({
    stateDir: join(root, "state"),
    port: 0,
    work: { sandboxDriver: "disabled" },
    execution: {
      workers: [
        { id: "one", backend: "codex" },
        { id: "two", backend: "codex" },
      ],
    },
    sources: [
      {
        id: "local",
        kind: "local",
        cwd: root,
        allowedActors: ["alice"],
        workspace: { mode: "source" },
      },
    ],
  });
  const host = new Runtime(config, { model, browserDriver: driver });
  hosts.push(host);
  host.receive("local", "alice", {
    id: "one",
    thread: "topic",
    text: "Use browser",
    addressed: true,
  });
  for (let i = 0; i < 200; i++) {
    await host.tick();
    await new Promise((r) => setTimeout(r, 2));
    if (host.status().tickets[0]?.run?.phase === "idle") break;
  }
  const ticket = host.store.tickets.list()[0]!,
    owner: WorkOwner = {
      ticketId: ticket.id,
      assignmentId: ticket.assignments.at(-1)!.id,
      cwd: root,
      sandbox: "read-only",
      depth: 0,
    };
  const run = host.store.get<any>("run", owner.ticketId);
  host.store.put("run", owner.ticketId, { ...run, workerId: "one" });
  // Bind this synthetic assignment to a real conversation owner for profile-grant tests.
  host.store.put("worker-assignment", owner.ticketId, {
    ticketId: owner.ticketId,
    parentTrigger: "browser-chat-run",
    workerId: "one",
  });
  host.store.put("chat-run", "browser-chat-run", {
    conversationId: "browser-conversation",
  });
  host.store.put("chat-conversation", "browser-conversation", {
    id: "browser-conversation",
    owner: "alice",
  });
  return { host, root, driver, owner, config };
}
const open = (h: Runtime, o: WorkOwner, profileId?: string) =>
  h.browser.tool(o, {
    action: "open",
    url: "https://example.com",
    profileId,
    requestId: randomUUID(),
  }) as Promise<any>;

it("exports an owned PNG attachment once and retains it when the browser closes",async()=>{
  const {host,owner,driver}=await fixture(),s=await open(host,owner);
  const input={action:"screenshot" as const,sessionId:s.id,requestId:"capture",fullPage:true};
  const result:any=await host.browser.tool(owner,input);
  expect(readFileSync(result.screenshot.path)).toEqual(screenshotBytes);
  expect(statSync(result.screenshot.path).mode&0o777).toBe(0o400);
  expect(host.store.get("asset",result.screenshot.id)).toEqual(result.screenshot);
  expect(result.screenshot).toMatchObject({ticketId:owner.ticketId,assignmentId:owner.assignmentId,mime:"image/png",sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(await host.browser.tool(owner,input)).toEqual(result);
  expect(driver.calls.filter(c=>c.args[0]==="screenshot")).toHaveLength(1);
  expect(driver.calls.find(c=>c.args[0]==="screenshot")!.args).toEqual(["screenshot",result.screenshot.path,"--full"]);
  await expect(host.browser.tool({...owner,assignmentId:"old"},input)).rejects.toThrow("no longer");
  await host.browser.tool(owner,{action:"close",sessionId:s.id,requestId:"close"});
  expect(readFileSync(result.screenshot.path)).toEqual(screenshotBytes);
});

it("does not publish a screenshot after browser control changes",async()=>{
  const {host,owner,driver}=await fixture(),s=await open(host,owner);
  let release!:()=>void,started!:()=>void;
  const begin=new Promise<void>(r=>{started=r});
  driver.screenshotGate=()=>{started();return new Promise<void>(r=>{release=r})};
  const captured=host.browser.tool(owner,{action:"screenshot",sessionId:s.id,requestId:"capture"}).catch(e=>e);
  await begin;
  const human=host.browser.takeover("alice",s.id,randomUUID());
  release();
  expect(await captured).toMatchObject({code:"browser_control_changed"});
  await human;
  expect(host.store.list("asset")).toHaveLength(0);
  const path=driver.calls.find(c=>c.args[0]==="screenshot")!.args[1]!;
  expect(()=>statSync(path)).toThrow();
  await expect(host.browser.tool(owner,{action:"screenshot",sessionId:s.id,requestId:"new-capture"})).rejects.toThrow("waiting for the user");
});

it("gives Workers separate real-driver sessions and fences cross-assignment and subagent IDs", async () => {
  const { host, owner, driver } = await fixture(),
    a = await open(host, owner),
    b = await open(host, owner);
  expect(a.id).not.toBe(b.id);
  expect(driver.tabs.size).toBe(2);
  await expect(
    host.browser.tool(
      { ...owner, assignmentId: "old" },
      { action: "snapshot", sessionId: a.id, requestId: "stale" },
    ),
  ).rejects.toThrow("no longer");
  await expect(
    host.browser.tool(
      { ...owner, agentId: "unowned" },
      { action: "snapshot", sessionId: a.id, requestId: "child" },
    ),
  ).rejects.toThrow("no longer");
  await expect(host.browser.inspect("other", a.id)).rejects.toThrow(
    "not found",
  );
  expect(host.browser.list("other").sessions).toHaveLength(0);
});

it("projects only the current user's browser control metadata without page or vault content", async () => {
  const {host,driver}=await fixture();
  const alice=host.browser.saveProfile('alice',{name:'Alice private profile',allowedWorkers:[]});
  const bob=host.browser.saveProfile('bob',{name:'Bob private profile',allowedWorkers:[]});
  const a=await host.browser.openPersonal('alice',alice.id,randomUUID());
  const b=await host.browser.openPersonal('bob',bob.id,randomUUID());
  const calls=driver.calls.length;
  expect(host.browser.controlSummary('alice')).toEqual({total:1,items:[{id:a.id,workerId:undefined,control:'human'}]});
  expect(host.browser.controlSummary('alice').items.some(s=>s.id===b.id)).toBe(false);
  expect(host.browser.controlSummary('other')).toEqual({total:0,items:[]});
  expect(JSON.stringify(host.browser.controlSummary('alice'))).not.toMatch(/url|title|profile|credential|cookie|known-login/);
  expect(driver.calls.length).toBe(calls);
});
it("rejects disabled browser grants at the common WorkerTools entry point", async () => {
  const { host, owner } = await fixture(),
    run = host.store.get<any>("run", owner.ticketId);
  host.store.put("run", owner.ticketId, {
    ...run,
    agentOptions: { browser: { enabled: false } },
  });
  await expect(
    host.workerTools.call(owner, "superagent_browser", {
      action: "profiles",
      requestId: "disabled",
    }),
  ).rejects.toThrow("disabled");
});
it("copies only authorized origin state and rechecks revoked profile grants", async () => {
  const { host, owner, driver } = await fixture(),
    profile = host.browser.saveProfile("alice", {
      name: "Work",
      allowedWorkers: [],
    });
  await expect(open(host, owner, profile.id)).rejects.toThrow("cannot use");
  host.browser.saveProfile(
    "alice",
    { name: "Work", allowedWorkers: ["one"] },
    profile.id,
  );
  const session = await open(host, owner, profile.id);
  expect(driver.loaded[0].cookies[0].value).toBe("known-login");
  host.browser.saveProfile(
    "alice",
    { name: "Work", allowedWorkers: [] },
    profile.id,
  );
  await expect(
    host.browser.tool(owner, {
      action: "snapshot",
      sessionId: session.id,
      requestId: "revoked",
    }),
  ).rejects.toThrow("cannot use");
  expect(
    stateForOrigin(
      {
        cookies: [
          { domain: ".example.com" },
          { domain: "notexample.com" },
          { domain: "evil.example.com" },
        ],
        origins: [
          { origin: "https://example.com" },
          { origin: "https://other.com" },
        ],
      },
      "https://example.com",
    ),
  ).toEqual({
    cookies: [{ domain: ".example.com" }],
    origins: [{ origin: "https://example.com" }],
  });
});
it("drains an executing command, rejects queued stale commands, and gives one human exclusive control", async () => {
  const { host, owner, driver } = await fixture(),
    s = await open(host, owner),
    client = randomUUID();
  let resolve!: () => void, started!: () => void;
  const begin = new Promise<void>((r) => (started = r));
  driver.gate = () => {
    started();
    return new Promise((r) => (resolve = r));
  };
  const running = host.browser.tool(owner, {
    action: "click",
    sessionId: s.id,
    ref: "@e1",
    revision: s.revision,
    requestId: "running",
  });
  await begin;
  const queued = host.browser
    .tool(owner, {
      action: "click",
      sessionId: s.id,
      ref: "@e1",
      revision: s.revision,
      requestId: "queued",
    })
    .catch((e) => e);
  const takeover = host.browser.takeover("alice", s.id, client);
  expect(host.browser.list("alice").sessions[0]?.control).toBe("handoff");
  resolve();
  await running;
  expect(await queued).toMatchObject({ code: "browser_control_changed" });
  const human = await takeover;
  await expect(
    host.browser.takeover("alice", s.id, randomUUID()),
  ).rejects.toThrow("another window");
  await expect(
    host.browser.tool(owner, {
      action: "snapshot",
      sessionId: s.id,
      requestId: "while-human",
    }),
  ).rejects.toThrow("waiting for the user");
  await expect(
    host.browser.input("alice", s.id, "other", human.epoch, {
      type: "text",
      text: "wrong",
    }),
  ).rejects.toThrow("Take control");
  await host.browser.input("alice", s.id, client, human.epoch, {
    type: "text",
    text: "human input",
  });
  await host.browser.release("alice", s.id, client, human.epoch);
  await expect(
    host.browser.tool(owner, {
      action: "click",
      sessionId: s.id,
      ref: "@e1",
      revision: s.revision,
      requestId: "old-ref",
    }),
  ).rejects.toThrow("fresh snapshot");
  expect(driver.calls.filter((c) => c.args[0] === "click")).toHaveLength(1);
});
it("expires a human lease into paused control, never automatically resuming Worker writes", async () => {
  const { host, owner } = await fixture(),
    s = await open(host, owner),
    client = randomUUID(),
    human = await host.browser.takeover("alice", s.id, client);
  const internal = (host.browser as any).sessions.get(s.id);
  internal.leaseUntil = Date.now() - 1;
  await expect(
    host.browser.input("alice", s.id, client, human.epoch, {
      type: "text",
      text: "late",
    }),
  ).rejects.toThrow("Take control");
  const next = await host.browser.takeover("alice", s.id, randomUUID());
  expect(next.epoch).toBeGreaterThan(human.epoch);
});
it("deduplicates simultaneous browser mutations and does not replay uncertain actions", async () => {
  const { host, owner, driver } = await fixture(),
    s = await open(host, owner),
    args = {
      action: "click" as const,
      sessionId: s.id,
      ref: "@e1",
      revision: s.revision,
      requestId: "once",
    };
  const [a, b] = await Promise.all([
    host.browser.tool(owner, args),
    host.browser.tool(owner, args),
  ]);
  expect(a).toEqual(b);
  expect(driver.calls.filter((c) => c.args[0] === "click")).toHaveLength(1);
  await expect(
    host.browser.tool(owner, { ...args, ref: "@e2" }),
  ).rejects.toThrow("reused");
  const fresh: any = await host.browser.tool(owner, {
    action: "snapshot",
    sessionId: s.id,
    requestId: "read",
  });
  driver.fail = true;
  const unknown = { ...args, revision: fresh.revision, requestId: "uncertain" };
  await expect(host.browser.tool(owner, unknown)).rejects.toThrow(
    "Lost result",
  );
  await expect(host.browser.tool(owner, unknown)).rejects.toThrow(
    "uncertain result",
  );
  expect(driver.calls.filter((c) => c.args[0] === "click")).toHaveLength(2);
});
it("keeps passwords encrypted, scopes them to profiles, and fills them only inside the driver", async () => {
  const { host, owner, driver, root } = await fixture(),
    p = host.browser.saveProfile("alice", {
      name: "Work",
      allowedWorkers: ["one"],
    }),
    s = await open(host, owner, p.id),
    password = "Synthetic-password-7!";
  const account = host.browser.saveCredential("alice", {
    profileId: p.id,
    label: "Demo",
    url: "https://example.com/login",
    username: "demo",
    password,
  });
  expect(JSON.stringify(account)).not.toContain(password);
  expect(
    readFileSync(join(root, "state/browser/vault/credentials.json"), "utf8"),
  ).not.toContain(password);
  expect(
    statSync(join(root, "state/browser/vault/vault.key")).mode & 0o077,
  ).toBe(0);
  const result = await host.browser.tool(owner, {
    action: "login",
    sessionId: s.id,
    credentialId: account.id,
    requestId: "login",
  });
  expect(driver.scripts[0]).toContain(password);
  expect(driver.calls.every((c) => !JSON.stringify(c).includes(password))).toBe(
    true,
  );
  expect(JSON.stringify(result)).not.toContain(password);
  expect(JSON.stringify(host.store.list("browser-receipt"))).not.toContain(
    password,
  );
  const other = host.browser.saveProfile("alice", {
      name: "Other",
      allowedWorkers: ["one"],
    }),
    another = await open(host, owner, other.id);
  await expect(
    host.browser.tool(owner, {
      action: "login",
      sessionId: another.id,
      credentialId: account.id,
      requestId: "wrong-account",
    }),
  ).rejects.toThrow("different browser profile");
  host.browser.removeCredential("alice", account.id);
  expect(host.browser.list("alice").credentials).toHaveLength(0);
});
it("vault survives restart and fails closed when its key is missing or changed", async () => {
  const root = mkdtempSync(join(tmpdir(), "roppo-vault-"));
  roots.push(root);
  const vault = new BrowserVault(root),
    input = {
      profileId: randomUUID(),
      label: "Site",
      url: "https://example.com",
      username: "demo",
      password: "PrivateSynthetic",
    };
  const meta = vault.save("alice", input),
    restored = new BrowserVault(root);
  expect(restored.read("alice", meta.id).password).toBe(input.password);
  expect(() => restored.read("bob", meta.id)).toThrow("not found");
  restored.save("alice", { ...input, password: "Replacement" }, meta.id);
  expect(new BrowserVault(root).read("alice", meta.id).password).toBe(
    "Replacement",
  );
  unlinkSync(join(root, "vault.key"));
  expect(() => new BrowserVault(root)).toThrow("original browser vault key");
});
it("revokes assignment capabilities and closes only that assignment browser", async () => {
  const { host, owner, driver } = await fixture(),
    s = await open(host, owner),
    p = host.browser.saveProfile("alice", {
      name: "Personal",
      allowedWorkers: [],
    }),
    personal = await host.browser.openPersonal("alice", p.id, randomUUID());
  await host.stop(owner.ticketId);
  for (let i = 0; i < 100 && !driver.closed.includes(s.id); i++)
    await new Promise((r) => setTimeout(r, 1));
  expect(driver.closed).toContain(s.id);
  expect(driver.closed).not.toContain(personal.id);
  expect(
    host.browser.list("alice").sessions.some((v) => v.id === personal.id),
  ).toBe(true);
  await expect(
    host.browser.tool(owner, {
      action: "snapshot",
      sessionId: s.id,
      requestId: "late",
    }),
  ).rejects.toThrow();
  expect(personal.personal).toBe(true);
});
it("HTTP browser routes require authentication and same-origin writes; password responses are metadata only", async () => {
  const { host } = await fixture(),
    server = await serve(host);
  servers.push(server.server);
  const token = readFileSync(
      join(host.config.stateDir, "access-token"),
      "utf8",
    ).trim(),
    headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    };
  expect((await fetch(server.url + "/api/browser")).status).toBe(401);
  const response = await fetch(server.url + "/api/browser/profiles", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Web", allowedWorkers: [] }),
  });
  expect(response.status).toBe(201);
  const p: any = await response.json();
  const bad = await fetch(server.url + "/api/browser/profiles", {
    method: "POST",
    headers: { ...headers, origin: "https://elsewhere.example" },
    body: JSON.stringify({ name: "Bad" }),
  });
  expect(bad.status).toBe(403);
  const save = await fetch(server.url + "/api/browser/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      profileId: p.id,
      label: "Demo",
      url: "https://example.com/login",
      username: "alice",
      password: "SecretSynthetic",
    }),
  });
  expect(save.status).toBe(201);
  expect(await save.text()).not.toContain("SecretSynthetic");
  expect(
    await fetch(server.url + "/api/browser", { headers }).then((r) => r.text()),
  ).not.toContain("SecretSynthetic");
});

it("does not expose or operate a browser until initialization completes", async () => {
  const { host, owner, driver } = await fixture();
  let release!: () => void, started!: () => void;
  const began = new Promise<void>((r) => (started = r));
  driver.openGate = () => {
    started();
    return new Promise((r) => (release = r));
  };
  const pending = open(host, owner);
  await began;
  expect(host.browser.list("alice").sessions).toHaveLength(0);
  const internal = [...(host.browser as any).sessions.values()][0];
  await expect(host.browser.inspect("alice", internal.id)).rejects.toThrow(
    "closed",
  );
  release();
  const session = await pending;
  expect(host.browser.list("alice").sessions[0]?.id).toBe(session.id);
});
it("closing while a browser starts cancels initialization before the final driver close", async () => {
  const { host, owner, driver } = await fixture();
  let release!: () => void, started!: () => void;
  const began = new Promise<void>((r) => (started = r));
  driver.openGate = () => {
    started();
    return new Promise((r) => (release = r));
  };
  const pending = open(host, owner).catch((e) => e);
  await began;
  const closing = host.browser.close();
  release();
  await closing;
  expect(await pending).toBeInstanceOf(Error);
  expect(host.browser.list("alice").sessions).toHaveLength(0);
  expect(driver.closed).toHaveLength(1);
});
it("force transfer invalidates the previous window and normalizes scaled mouse coordinates", async () => {
  const { host, owner, driver } = await fixture(),
    s = await open(host, owner),
    a = randomUUID(),
    b = randomUUID(),
    first = await host.browser.takeover("alice", s.id, a),
    second = await host.browser.takeover("alice", s.id, b, true);
  expect(() => host.browser.renew("alice", s.id, a, first.epoch)).toThrow(
    "Take control",
  );
  await expect(
    host.browser.input("alice", s.id, a, first.epoch, {
      type: "text",
      text: "old",
    }),
  ).rejects.toThrow("Take control");
  await host.browser.input("alice", s.id, b, second.epoch, {
    type: "click",
    x: 100.4,
    y: 221.8,
  });
  expect(driver.calls.find((c) => c.args[0] === "mouse")?.args).toEqual([
    "mouse",
    "move",
    "100",
    "222",
  ]);
});
it("redacts reflected saved passwords from snapshots and stored receipts", async () => {
  const { host, owner, driver } = await fixture(),
    p = host.browser.saveProfile("alice", {
      name: "Web",
      allowedWorkers: ["one"],
    }),
    s = await open(host, owner, p.id),
    password = 'quoted-"-secret';
  const a = host.browser.saveCredential("alice", {
    profileId: p.id,
    label: "Site",
    url: "https://example.com/login",
    username: "demo",
    password,
  });
  driver.snapshotText = "Page reflected " + password;
  const result = await host.browser.tool(owner, {
    action: "login",
    sessionId: s.id,
    credentialId: a.id,
    requestId: "reflected",
  });
  expect((result as any).snapshot).toContain("[hidden]");
  expect(JSON.stringify(host.store.list("browser-receipt"))).not.toContain(
    JSON.stringify(password).slice(1, -1),
  );
});
it("rejects modified vault keys without overwriting saved entries", () => {
  const root = mkdtempSync(join(tmpdir(), "roppo-vault-"));
  roots.push(root);
  const vault = new BrowserVault(root),
    entry = vault.save("alice", {
      profileId: randomUUID(),
      label: "Site",
      url: "https://example.com",
      username: "demo",
      password: "Secret",
    });
  const original = readFileSync(join(root, "credentials.json"));
  writeFileSync(join(root, "vault.key"), Buffer.alloc(32, 1));
  expect(() => new BrowserVault(root).read("alice", entry.id)).toThrow(
    "cannot be decrypted",
  );
  expect(readFileSync(join(root, "credentials.json"))).toEqual(original);
});
it("retains browser defaults when a Worker overrides only its tab limit", async () => {
  const { mergeOptions } = await import("../src/agent-options.ts");
  expect(
    mergeOptions(
      { browser: { enabled: false, maxTabs: 2 } },
      { browser: { maxTabs: 4 } },
    ).browser,
  ).toEqual({ enabled: false, maxTabs: 4 });
});

it("streams only while watched and reconnects with monotonically increasing frame sequence", async () => {
  const { host, owner } = await fixture(),
    s = await open(host, owner);
  expect(host.browser.streamStatus("alice", s.id)).toBe(false);
  const stop = await host.browser.subscribe("alice", s.id),
    first = host.browser.frame("alice", s.id)!.seq;
  const secondWatcher = await host.browser.subscribe("alice", s.id);
  stop();
  expect(host.browser.streamStatus("alice", s.id)).toBe(true);
  secondWatcher();
  expect(host.browser.streamStatus("alice", s.id)).toBe(false);
  const resumed = await host.browser.subscribe("alice", s.id);
  expect(host.browser.frame("alice", s.id)!.seq).toBeGreaterThan(first);
  resumed();
});
it("records bounded browser action metadata without account arguments", async () => {
  const { host, owner } = await fixture();
  await host.workerTools.call(owner, "superagent_browser", {
    action: "profiles",
    requestId: "catalog",
  });
  expect(
    host.activity.list().find((c) => c.name === "superagent_browser"),
  ).toMatchObject({ action: "browser:profiles", state: "completed" });
});
it("marks interrupted receipts uncertain on host recovery and never replays them", async () => {
  const { host, config, driver, owner } = await fixture(),
    s = await open(host, owner);
  const args = {
    action: "snapshot" as const,
    sessionId: s.id,
    requestId: "interrupted",
  };
  await host.browser.tool(owner, args);
  const receipt = host.store
    .list<any>("browser-receipt")
    .find((r) => r.result?.id === s.id && r.result.revision > s.revision)!;
  host.store.put("browser-receipt", receipt.id, {
    ...receipt,
    state: "running",
    result: undefined,
  });
  await host.close();
  hosts.splice(hosts.indexOf(host), 1);
  const restored = new Runtime(config, { model, browserDriver: driver });
  hosts.push(restored);
  expect(restored.store.get<any>("browser-receipt", receipt.id)?.state).toBe(
    "uncertain",
  );
  const count = driver.calls.length;
  await expect(restored.browser.tool(owner, args)).rejects.toThrow("uncertain");
  expect(driver.calls).toHaveLength(count);
});

it("uses stable engine tab IDs and rejects closed tab references", async () => {
  const { host, owner, driver } = await fixture(),
    s = await open(host, owner);
  const next: any = await host.browser.tool(owner, {
    action: "new_tab",
    sessionId: s.id,
    url: "https://example.com/other",
    requestId: "new-tab",
  });
  expect(next.tabs.map((t: any) => t.id)).toEqual(["t1", "t2"]);
  await host.browser.tool(owner, {
    action: "select_tab",
    sessionId: s.id,
    tab: "t2",
    requestId: "select",
  });
  expect(
    driver.calls.some(
      (c) => JSON.stringify(c.args) === JSON.stringify(["tab", "t2"]),
    ),
  ).toBe(true);
  await expect(
    host.browser.tool(owner, {
      action: "close_tab",
      sessionId: s.id,
      tab: "t99",
      requestId: "closed",
    }),
  ).rejects.toThrow("tab has closed");
});

it("keeps personal and Worker browser lists scoped to each conversation and refuses a shared writable profile", async () => {
  const { host, owner } = await fixture(),
    client = randomUUID(),
    profile = host.browser.saveProfile("alice", {
      name: "Personal",
      allowedWorkers: ["one"],
    });
  const a = await host.browser.openPersonal(
    "alice",
    profile.id,
    client,
    "conversation-a",
  );
  expect(
    host.browser
      .list("alice", client, "conversation-a")
      .sessions.map((s) => s.id),
  ).toEqual([a.id]);
  expect(host.browser.list("alice", client, "conversation-b").sessions).toEqual(
    [],
  );
  await expect(
    host.browser.openPersonal("alice", profile.id, client, "conversation-b"),
  ).rejects.toMatchObject({ code: "browser_profile_in_use" });
  const p2 = host.browser.saveProfile("alice", {
      name: "Second",
      allowedWorkers: [],
    }),
    b = await host.browser.openPersonal(
      "alice",
      p2.id,
      client,
      "conversation-b",
    );
  const worker = await open(host, owner, profile.id);
  expect(
    host.browser
      .list("alice", client, "browser-conversation")
      .sessions.map((s) => s.id),
  ).toEqual([worker.id]);
  expect(
    host.browser
      .list("alice", client, "conversation-b")
      .sessions.map((s) => s.id),
  ).toEqual([b.id]);
  await host.browser.closeOwned("alice", a.id, client, a.epoch);
  expect(
    (
      await host.browser.openPersonal(
        "alice",
        profile.id,
        client,
        "conversation-b",
      )
    ).conversationId,
  ).toBe("conversation-b");
});
it("atomically binds a newly opened profile when two conversations race", async () => {
  const { host } = await fixture(),
    p = host.browser.saveProfile("alice", { name: "Race", allowedWorkers: [] }),
    client = randomUUID();
  const results = await Promise.allSettled(
    ["a", "b"].map((id) =>
      host.browser.openPersonal("alice", p.id, client, id),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(host.browser.list("alice", client).sessions).toHaveLength(1);
});

it('checks conversation ownership before filtering or opening browser sessions over HTTP',async()=>{
  const {host}=await fixture();host.config.execution.router={mode:'host'}
  const c=host.chat.create('local-operator'),foreign=host.chat.create('someone-else'),server=await serve(host);servers.push(server.server)
  const headers={authorization:'Bearer '+readFileSync(join(host.config.stateDir,'access-token'),'utf8').trim(),'content-type':'application/json'},client=randomUUID()
  const profile=host.browser.saveProfile('local-operator',{name:'Scoped',allowedWorkers:[]})
  const call=(path:string,data?:unknown)=>fetch(server.url+'/api/browser'+path,{headers,...(data?{method:'POST',body:JSON.stringify(data)}:{})})
  expect((await call('?conversation='+foreign.id)).status).toBe(404)
  expect((await call('/profiles/'+profile.id+'/open',{client,conversationId:foreign.id})).status).toBe(404)
  expect(host.browser.list('local-operator').sessions).toHaveLength(0)
  expect((await call('/profiles/'+profile.id+'/open',{client,conversationId:c.id})).status).toBe(200)
  const listing:any=await (await call('?conversation='+c.id)).json();expect(listing.sessions).toHaveLength(1);expect(listing.sessions[0].conversationId).toBe(c.id)
})
