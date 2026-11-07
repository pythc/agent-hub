import { z } from "zod";

export class BrowserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export const browserUrl = z
  .string()
  .max(8000)
  .refine((value) => {
    if (value === "about:blank") return true;
    try {
      const u = new URL(value);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS URL without embedded credentials");
export const browserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    command: z.string().min(1).optional(),
    executablePath: z.string().min(1).optional(),
    maxSessions: z.number().int().min(1).max(20).default(8),
    timeoutMs: z.number().int().min(1000).max(120000).default(20000),
    idleMs: z.number().int().min(60000).default(900000),
    keyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
  })
  .strict()
  .prefault({});
export const browserOptionsSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxTabs: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export const profileInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    allowedWorkers: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/))
      .max(10)
      .default([]),
  })
  .strict();
export const credentialInput = z
  .object({
    profileId: z.string().uuid(),
    label: z.string().trim().min(1).max(80),
    url: browserUrl.refine((v) => v !== "about:blank"),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(4000),
  })
  .strict();
export const browserAction = z
  .object({
    action: z.enum([
      "navigate",
      "snapshot",
      "click",
      "fill",
      "press",
      "scroll",
      "new_tab",
      "select_tab",
      "close_tab",
      "back",
      "forward",
      "reload",
      "login",
      "request_takeover",
    ]),
    url: browserUrl.optional(),
    ref: z
      .string()
      .regex(/^@?e\d+$/)
      .optional(),
    text: z.string().max(10000).optional(),
    key: z.string().min(1).max(80).optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    amount: z.number().int().min(1).max(5000).optional(),
    tab: z.string().regex(/^t\d+$/).optional(),
    credentialId: z.string().uuid().optional(),
    revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const required: Record<string, string[]> = {
      navigate: ["url"],
      new_tab: ["url"],
      click: ["ref", "revision"],
      fill: ["ref", "text", "revision"],
      press: ["key", "revision"],
      scroll: ["direction"],
      select_tab: ["tab"],
      close_tab: ["tab"],
      login: ["credentialId"],
    };
    for (const field of required[v.action] ?? [])
      if ((v as any)[field] === undefined)
        c.addIssue({
          code: "custom",
          path: [field],
          message: "Required for " + v.action,
        });
  });
export type BrowserAction = z.infer<typeof browserAction>;
export const browserToolSchema = z
  .object({
    action: z.enum([
      "profiles",
      "open",
      "navigate",
      "snapshot",
      "click",
      "fill",
      "press",
      "scroll",
      "new_tab",
      "select_tab",
      "close_tab",
      "back",
      "forward",
      "reload",
      "login",
      "request_takeover",
      "close",
    ]),
    sessionId: z.string().uuid().optional(),
    profileId: z.string().uuid().optional(),
    url: browserUrl.optional(),
    ref: z
      .string()
      .regex(/^@?e\d+$/)
      .optional(),
    text: z.string().max(10000).optional(),
    key: z.string().max(80).optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    amount: z.number().int().min(1).max(5000).optional(),
    tab: z.string().regex(/^t\d+$/).optional(),
    credentialId: z.string().uuid().optional(),
    revision: z.number().int().min(0).optional(),
    requestId: z.string().min(1).max(200),
  })
  .strict();
export type BrowserToolInput = z.infer<typeof browserToolSchema>;
export const browserToolDefinition = {
  name: "superagent_browser",
  description:
    "Use an isolated real browser owned by this assignment. profiles lists granted login profiles and saved account IDs; open creates a session (optional profileId copies authorized login state for the URL). snapshot returns current refs and revision. click/fill/press MUST use that revision; refresh after a stale reference or human handoff. login fills a sign-in form using a saved credential ID without revealing its password; inspect the returned snapshot and explicitly submit if appropriate. request_takeover lets the user operate this browser. While human control is active, wait for the user; never bypass it. Reuse requestId only for identical input; uncertain actions must be reconciled by reading the page, never blindly repeated.",
  validator: browserToolSchema,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: browserToolSchema.shape.action.options },
      sessionId: { type: "string" },
      profileId: { type: "string" },
      url: { type: "string" },
      ref: {
        type: "string",
        description: "Element ref from this session snapshot, e.g. @e3",
      },
      text: { type: "string" },
      key: { type: "string" },
      direction: { type: "string", enum: ["up", "down", "left", "right"] },
      amount: { type: "integer" },
      tab: { type: "string", description: "Stable tab id from tabs, such as t1. Never use a positional index." },
      credentialId: { type: "string" },
      revision: {
        type: "integer",
        description: "Revision returned by the most recent snapshot",
      },
      requestId: { type: "string" },
    },
    required: ["action", "requestId"],
  },
} as const;
export interface BrowserProfile {
  id: string;
  owner: string;
  name: string;
  allowedWorkers: string[];
  tabs: string[];
  activeTab?: number;
  updatedAt: number;
}
export interface CredentialMeta {
  id: string;
  owner: string;
  profileId: string;
  label: string;
  url: string;
  username: string;
  updatedAt: number;
}
export interface BrowserFrame {
  data: string;
  width: number;
  height: number;
  at: number;
  seq: number;
}
