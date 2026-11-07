import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { z } from "zod";
import {
  BrowserError,
  browserConfigSchema,
  type BrowserFrame,
} from "./browser-contract.ts";

export interface DriverSession {
  id: string;
  directory: string;
}
export interface BrowserDriver {
  version(): Promise<string>;
  run(
    session: DriverSession,
    args: string[],
    signal?: AbortSignal,
    input?: string,
  ): Promise<any>;
  evaluate(
    session: DriverSession,
    expression: string,
    signal?: AbortSignal,
  ): Promise<any>;
  state(session: DriverSession, signal?: AbortSignal): Promise<any>;
  load(session: DriverSession, state: any, signal?: AbortSignal): Promise<void>;
  frames(
    session: DriverSession,
    callback: (frame: BrowserFrame) => void,
    status?: (connected: boolean) => void,
  ): Promise<() => void>;
  close(session: DriverSession): Promise<void>;
}

/** Fixed command adapter. No shell, no ambient agent-browser config, no attachment to user Chrome. */
export class AgentBrowserDriver implements BrowserDriver {
  private configFile: string;
  private env: NodeJS.ProcessEnv;
  private executable: string | undefined;
  private binary: string;
  private prefix: string[];
  constructor(
    private root: string,
    private options: z.infer<typeof browserConfigSchema>,
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.configFile = join(root, "driver.json");
    writeFileSync(this.configFile, "{}", { mode: 0o600 });
    this.env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) => !k.startsWith("AGENT_BROWSER_"),
      ),
    );
    this.env.AGENT_BROWSER_IDLE_TIMEOUT_MS = String(options.idleMs + 60000);
    this.executable =
      options.executablePath ??
      (process.platform === "darwin" &&
      existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined);
    const packageRoot = dirname(
      createRequire(import.meta.url).resolve("agent-browser/package.json"),
    );
    const platform =
      process.platform === "win32"
        ? "win32"
        : process.platform === "linux" &&
            !(process.report?.getReport() as any)?.header?.glibcVersionRuntime
          ? "linux-musl"
          : process.platform;
    // Invoke the native binary directly so timeout/cancellation terminates the actual CLI process.
    this.binary =
      options.command ??
      join(
        packageRoot,
        "bin",
        `agent-browser-${platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
      );
    this.prefix = [];
  }
  private exec(
    args: string[],
    signal?: AbortSignal,
    input?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(
          new BrowserError(
            "browser_cancelled",
            "Browser operation was cancelled.",
          ),
        );
        return;
      }
      const child = spawn(this.binary, [...this.prefix, ...args], {
        cwd: this.root,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "",
        settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(output);
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(
          new BrowserError(
            "browser_uncertain",
            "Browser operation interrupted; inspect the page before repeating it.",
          ),
        );
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(
          new BrowserError(
            "browser_uncertain",
            "Browser operation timed out; inspect the page before repeating it.",
          ),
        );
      }, this.options.timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.length > 4_000_000) {
          child.kill("SIGKILL");
          finish(
            new BrowserError(
              "browser_output_limit",
              "Browser result exceeded the limit.",
            ),
          );
        }
      });
      child.stderr.resume(); // Diagnostics can contain page content or typed secrets; never forward them.
      child.stdin.on("error", () => {});
      child.on("error", () =>
        finish(
          new BrowserError(
            "browser_unavailable",
            "Browser engine is unavailable. Install agent-browser and its Chrome runtime.",
          ),
        ),
      );
      child.on("close", (code) =>
        finish(
          code === 0
            ? undefined
            : new BrowserError(
                "browser_command_failed",
                "Browser operation failed. Refresh the page state before retrying.",
              ),
        ),
      );
      child.stdin.end(input);
    });
  }
  async version() {
    return (await this.exec(["--version"])).trim();
  }
  async run(
    s: DriverSession,
    args: string[],
    signal?: AbortSignal,
    input?: string,
  ) {
    const raw = await this.exec(
      [
        "--config",
        this.configFile,
        "--session",
        "roppo-" + s.id,
        "--profile",
        s.directory,
        ...(this.executable ? ["--executable-path", this.executable] : []),
        "--json",
        ...args,
      ],
      signal,
      input,
    );
    let result: any;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new BrowserError(
        "browser_protocol",
        "Browser returned an unreadable response.",
      );
    }
    if (!result.success)
      throw new BrowserError(
        "browser_command_failed",
        "Browser operation failed. Refresh the page state before retrying.",
      );
    return result.data;
  }
  async evaluate(s: DriverSession, expression: string, signal?: AbortSignal) {
    return (await this.run(s, ["eval", "--stdin"], signal, expression)).result;
  }
  async state(s: DriverSession, signal?: AbortSignal) {
    const file = join(this.root, "state-" + randomUUID() + ".json");
    try {
      await this.run(s, ["state", "save", file], signal);
      return JSON.parse(readFileSync(file, "utf8"));
    } finally {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  async load(s: DriverSession, state: any, signal?: AbortSignal) {
    const file = join(this.root, "state-" + randomUUID() + ".json");
    writeFileSync(file, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    try {
      await this.run(s, ["state", "load", file], signal);
    } finally {
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  async frames(
    s: DriverSession,
    callback: (frame: BrowserFrame) => void,
    onStatus?: (connected: boolean) => void,
  ) {
    const status = await this.run(s, ["stream", "status"]);
    if (
      !Number.isInteger(status.port) ||
      status.port < 1 ||
      status.port > 65535
    )
      throw new BrowserError(
        "browser_stream",
        "Browser stream is unavailable.",
      );
    const socket = new WebSocket("ws://127.0.0.1:" + status.port, {
      origin: "http://127.0.0.1",
      maxPayload: 4_000_000,
    });
    let seq = 0;
    socket.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (
          m.type === "frame" &&
          typeof m.data === "string" &&
          m.data.length < 3_000_000
        )
          callback({
            data: m.data,
            width: m.metadata.deviceWidth,
            height: m.metadata.deviceHeight,
            at: Date.now(),
            seq: ++seq,
          });
      } catch {}
    });
    socket.on("error", () => {});
    socket.on("close", () => onStatus?.(false));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(
          new BrowserError(
            "browser_stream",
            "Could not connect to the browser stream.",
          ),
        );
      }, 5000);
      socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", () => {
        clearTimeout(timer);
        reject(
          new BrowserError(
            "browser_stream",
            "Could not connect to the browser stream.",
          ),
        );
      });
    });
    onStatus?.(true);
    return () => socket.terminate();
  }
  async close(s: DriverSession) {
    await this.run(s, ["close"]);
  }
}
