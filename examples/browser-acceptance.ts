/** Isolated acceptance: real Chromium and local login site; choose fixture or native Codex models. */
import { createServer } from "node:http";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Runtime } from "../src/runtime.ts";
import { configSchema } from "../src/config.ts";
import { serve } from "../src/server.ts";
import type { ModelRequest } from "../src/model.ts";

const native = process.argv[2] === "native",
  root = resolve(process.argv[3] ?? ".local/browser-acceptance");
mkdirSync(join(root, "workspace"), { recursive: true });
const site = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://localhost"),
    signed = (req.headers.cookie ?? "").includes("demo_login=alice");
  const html = (body: string) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><html><head><title>Roppo browser lab</title><style>body{margin:0;background:#fafafa;color:#171717;font:18px system-ui}main{max-width:680px;margin:70px auto;padding:40px;border:1px solid #ddd;border-radius:16px;background:white}h1{font-size:30px}label{display:block;margin:22px 0}input{display:block;font:inherit;padding:12px;margin-top:8px;border:1px solid #aaa;border-radius:7px;width:85%}button,a{font:inherit;padding:12px 20px;border-radius:7px}button{background:#171717;color:white;border:0;cursor:pointer}output{margin-left:20px}</style></head><body><main>${body}</main></body></html>`,
    );
  };
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/login") {
    let raw = "";
    for await (const part of req) raw += part;
    const form = new URLSearchParams(raw),
      ok =
        form.get("username") === "demo" &&
        form.get("password") === "Roppo-demo-2026!";
    appendFileSync(
      join(root, "site-events.jsonl"),
      JSON.stringify({ event: "login", success: ok, at: Date.now() }) + "\n",
    );
    if (ok) {
      res.writeHead(303, {
        "set-cookie":
          "demo_login=alice; HttpOnly; Max-Age=86400; SameSite=Lax; Path=/",
        location: "/dashboard",
      });
      res.end();
      return;
    }
    res.writeHead(303, { location: "/login" });
    res.end();
    return;
  }
  if (url.pathname === "/dashboard" && !signed) {
    res.writeHead(302, { location: "/login" });
    res.end();
    return;
  }
  if (url.pathname === "/dashboard") {
    appendFileSync(
      join(root, "site-events.jsonl"),
      JSON.stringify({ event: "dashboard", at: Date.now() }) + "\n",
    );
    html(
      `<h1>Welcome, Alice</h1><p>Your sign-in is active.</p><label>Workspace note<input id="note" aria-label="Workspace note" oninput="localStorage.setItem('note',this.value)"></label><button id="increment" onclick="const n=Number(localStorage.getItem('count')||0)+1;localStorage.setItem('count',String(n));document.querySelector('output').textContent=String(n)">Add one</button><output id="count">0</output><script>document.querySelector('#note').value=localStorage.getItem('note')||'';document.querySelector('output').textContent=localStorage.getItem('count')||'0';</script>`,
    );
    return;
  }
  html(
    '<h1>Sign in to Browser Lab</h1><form method="post" action="/login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>',
  );
});
await new Promise<void>((r) =>
  site.listen(Number(process.env.ROPPO_BROWSER_SITE_PORT ?? 0), "127.0.0.1", r),
);
const siteUrl = "http://127.0.0.1:" + (site.address() as any).port;
const config = configSchema.parse({
  stateDir: join(root, "state"),
  port: Number(process.env.ROPPO_BROWSER_PORT ?? 0),
  work: { sandboxDriver: "disabled", network: false },
  turnTimeoutMs: 180000,
  execution: {
    router: { mode: "host", model: "gpt-6.1-terra", effort: "medium" },
    management: { enabled: true, maxWorkers: 4 },
    workers: [
      {
        id: "research",
        label: "Research",
        backend: "codex",
        model: "gpt-6.1-sol",
        effort: "high",
      },
      {
        id: "review",
        label: "Review",
        backend: "codex",
        model: "gpt-6.1-sol",
        effort: "high",
      },
    ],
  },
  sources: [
    {
      id: "local",
      kind: "local",
      cwd: join(root, "workspace"),
      allowedActors: ["operator"],
      workspace: { mode: "source" },
    },
  ],
});
const fixtureSessions = new Map<string, string>();
const fixture = {
  async run(r: ModelRequest) {
    const threadId = r.threadId ?? randomUUID(),
      turnId = randomUUID();
    r.onThread?.(threadId);
    r.onTurn?.(turnId);
    const tool = async (name: string, args: any) => {
      const result = await r.onTool!(name, args, randomUUID());
      if (!result.success) throw Error(result.contentItems[0]?.text);
      return JSON.parse(result.contentItems[0]!.text!);
    };
    if (r.role === "worker") {
      const existing = fixtureSessions.get(threadId);
      if (existing) {
        await tool("superagent_browser", {
          action: "snapshot",
          sessionId: existing,
          requestId: turnId + "-resume",
        });
        return {
          threadId,
          turnId,
          text: JSON.stringify({
            state: "waiting",
            summary: "Control returned; browser state refreshed.",
            reply: "",
            question: null,
            askedBy: null,
            handbacks: [],
          }),
        };
      }
      const profiles = await tool("superagent_browser", {
        action: "profiles",
        requestId: turnId + "-profiles",
      });
      const session = await tool("superagent_browser", {
        action: "open",
        url: siteUrl + "/dashboard",
        profileId: profiles.profiles[0]?.id,
        requestId: turnId + "-open",
      });
      fixtureSessions.set(threadId, session.id);
      await tool("superagent_browser", {
        action: "request_takeover",
        sessionId: session.id,
        requestId: turnId + "-handoff",
      });
      return {
        threadId,
        turnId,
        text: JSON.stringify({
          state: "waiting",
          summary: "Browser opened for user inspection.",
          reply: "",
          question: null,
          askedBy: null,
          handbacks: [],
        }),
      };
    }
    const input = JSON.parse(r.input);
    if (input.kind === "user_message") {
      const list = await tool("worker_manage", { action: "list" });
      for (const id of ["research", "review"])
        await tool("worker_manage", {
          action: "assign",
          id,
          revision: list.revision,
          requestId: turnId + "-" + id,
          text: "Open the browser lab for inspection.",
        });
    }
    return {
      threadId,
      turnId,
      text: JSON.stringify({
        reply:
          "The two Workers are opening independent browsers. You can inspect them in the browser panel.",
      }),
    };
  },
};
const runtime = new Runtime(config, native ? {} : { model: fixture }),
  host = await serve(runtime);
runtime.start();
const token = readFileSync(
    join(config.stateDir, "access-token"),
    "utf8",
  ).trim(),
  username = "browser-preview",
  password = "Roppo-preview-2026!";
const status: any = await fetch(host.url + "/account/status").then((r) =>
  r.json(),
);
const response = await fetch(
  host.url + (status.configured ? "/account/login" : "/account/setup"),
  {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      origin: host.url,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      status.configured
        ? { username, password, remember: true }
        : { username, displayName: "Alex", password, remember: true },
    ),
  },
);
if (!response.ok) throw Error("Acceptance account failed: " + response.status);
const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
writeFileSync(
  join(root, "browser.json"),
  JSON.stringify({
    base: host.url,
    url: host.url + "/chat?browser=open",
    site: siteUrl,
    username,
    password,
    cookie,
    native,
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    url: host.url + "/chat?browser=open",
    site: siteUrl,
    mode: native ? "native" : "fixture",
    info: join(root, "browser.json"),
  }),
);
async function close() {
  host.server.closeAllConnections();
  site.closeAllConnections();
  await Promise.all([
    new Promise<void>((r) => host.server.close(() => r())),
    new Promise<void>((r) => site.close(() => r())),
  ]);
  await host.closeRuntime();
}
process.once("SIGTERM", () => void close().then(() => process.exit(0)));
process.once("SIGINT", () => void close().then(() => process.exit(0)));
