import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Runtime } from "./runtime.ts";
import {
  browserAction,
  profileInput,
  credentialInput,
} from "./browser-contract.ts";

const client = z.string().uuid(),
  lease = z.object({ client, epoch: z.number().int().min(0) }).strict();
const inputEvent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      x: z.number().min(0).max(10000),
      y: z.number().min(0).max(10000),
    })
    .strict(),
  z
    .object({
      type: z.literal("wheel"),
      deltaY: z.number().int().min(-3000).max(3000),
      deltaX: z.number().int().min(-3000).max(3000),
    })
    .strict(),
  z
    .object({ type: z.literal("text"), text: z.string().min(1).max(4000) })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      key: z
        .string()
        .regex(
          /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|[a-z])$/,
        ),
    })
    .strict(),
]);
export async function browserRequest(
  host: Runtime,
  user: string,
  req: IncomingMessage,
  res: ServerResponse,
  body: () => Promise<any>,
  stillAuthorized: () => boolean,
) {
  const url = new URL(req.url!, "http://localhost"),
    path = url.pathname,
    manager = host.browser;
  const send = (value: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const clientId = url.searchParams.has("client")
    ? client.parse(url.searchParams.get("client"))
    : undefined;
  if (path === "/api/browser" && req.method === "GET") {
    const conversationId=url.searchParams.has('conversation')?z.string().uuid().parse(url.searchParams.get('conversation')):undefined
    if(conversationId)host.chat.view(conversationId,user)
    send(manager.list(user, clientId, conversationId));
    return;
  }
  if (path === "/api/browser/profiles" && req.method === "POST") {
    send(manager.saveProfile(user, profileInput.parse(await body())), 201);
    return;
  }
  const profile = path.match(
    /^\/api\/browser\/profiles\/([a-f0-9-]{36})(?:\/(open))?$/,
  );
  if (profile && req.method === "POST") {
    const id = z.string().uuid().parse(profile[1]);
    if (profile[2] === "open") {
      const input = z
        .object({ client, conversationId:z.string().uuid().optional() })
        .strict()
        .parse(await body());
      if(input.conversationId)host.chat.view(input.conversationId,user)
      send(await manager.openPersonal(user, id, input.client,input.conversationId));
    } else
      send(manager.saveProfile(user, profileInput.parse(await body()), id));
    return;
  }
  if (path === "/api/browser/accounts" && req.method === "POST") {
    send(
      manager.saveCredential(user, credentialInput.parse(await body())),
      201,
    );
    return;
  }
  const account = path.match(
    /^\/api\/browser\/accounts\/([a-f0-9-]{36})(?:\/(remove))?$/,
  );
  if (account && req.method === "POST") {
    const id = z.string().uuid().parse(account[1]);
    if (account[2]) {
      manager.removeCredential(user, id);
      send({ removed: true });
    } else
      send(
        manager.saveCredential(user, credentialInput.parse(await body()), id),
      );
    return;
  }
  const session = path.match(
    /^\/api\/browser\/sessions\/([a-f0-9-]{36})(?:\/(stream|takeover|release|renew|action|input|close))?$/,
  );
  if (session) {
    const id = z.string().uuid().parse(session[1]),
      action = session[2];
    if (!action && req.method === "GET") {
      send(await manager.inspect(user, id, clientId));
      return;
    }
    if (action === "stream" && req.method === "GET") {
      const unsubscribe = await manager.subscribe(user, id);
      if (res.destroyed) {
        unsubscribe();
        return;
      }
      res.on("close", unsubscribe);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.flushHeaders();
      let seq = 0,
        ticks = 0;
      const push = () => {
        if (res.destroyed || res.writableEnded) return;
        if (!stillAuthorized() || res.writableLength > 2_000_000) {
          res.end();
          return;
        }
        try {
          const frame = manager.frame(user, id);
          if (frame && frame.seq !== seq) {
            seq = frame.seq;
            res.write("event: frame\ndata: " + JSON.stringify(frame) + "\n\n");
          }
          if (ticks++ % 20 === 0)
            res.write(
              "event: status\ndata: " +
                JSON.stringify({ connected: manager.streamStatus(user, id) }) +
                "\n\n",
            );
        } catch {
          res.write("event: closed\ndata: {}\n\n");
          res.end();
        }
      };
      const timer = setInterval(push, 150);
      timer.unref();
      res.on("close", () => clearInterval(timer));
      push();
      return;
    }
    if (req.method === "POST") {
      const raw = await body();
      if (action === "takeover") {
        const input = z
          .object({ client, force: z.boolean().default(false) })
          .strict()
          .parse(raw);
        send(await manager.takeover(user, id, input.client, input.force));
        return;
      }
      if (action === "action") {
        const input = lease
          .extend({ operation: browserAction })
          .strict()
          .parse(raw);
        send(
          await manager.action(
            user,
            id,
            input.client,
            input.epoch,
            input.operation,
          ),
        );
        return;
      }
      if (action === "input") {
        const input = lease.extend({ event: inputEvent }).strict().parse(raw);
        send(
          await manager.input(user, id, input.client, input.epoch, input.event),
        );
        return;
      }
      const input = lease.parse(raw);
      if (action === "release") {
        send(await manager.release(user, id, input.client, input.epoch));
        return;
      }
      if (action === "renew") {
        send(manager.renew(user, id, input.client, input.epoch));
        return;
      }
      if (action === "close") {
        send(await manager.closeOwned(user, id, input.client, input.epoch));
        return;
      }
    }
  }
  send({ code: "not_found" }, 404);
}
