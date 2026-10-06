import { daemonIdSchema } from "@silvermoon-relay/protocol";
import { handleApi } from "./api";
import { authenticate } from "./auth";
import type { AppEnv } from "./env";
import { completeOAuth, beginOAuth } from "./oauth";
export { DaemonSession } from "./daemon-session";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function connectDaemon(
  request: Request,
  env: AppEnv,
  context: ExecutionContext,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "websocket-upgrade-required");
  }
  const connection = await authenticate(request, env, context);
  if (!connection) return jsonError(401, "unauthorized");

  const daemonId = daemonIdSchema.safeParse(
    request.headers.get("x-silvermoon-daemon-id"),
  );
  if (!daemonId.success) return jsonError(400, "invalid-daemon-id");

  const registration = await env.DB.prepare(
    `INSERT INTO daemons (id, user_id, connection_token_id, last_seen_at)
     VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       connection_token_id = excluded.connection_token_id,
       last_seen_at = CURRENT_TIMESTAMP
     WHERE user_id = excluded.user_id`,
  )
    .bind(daemonId.data, connection.userId, connection.tokenId)
    .run();
  if (registration.meta.changes !== 1) {
    return jsonError(409, "daemon-owner-conflict");
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO daemon_token_bindings
      (user_id, connection_token_id, daemon_id)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(connection.userId, connection.tokenId, daemonId.data)
    .run();

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-silvermoon-user-id", connection.userId);
  headers.set("x-silvermoon-token-id", connection.tokenId);
  headers.set("x-silvermoon-daemon-id", daemonId.data);
  return env.DAEMON_SESSIONS.getByName(
    `${connection.userId}:${daemonId.data}`,
  ).fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env, context): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "silvermoon-relay", status: "ok" });
    }

    const authMatch = /^\/auth\/(google|microsoft|github)\/(start|callback)$/u
      .exec(url.pathname);
    if (request.method === "GET" && authMatch) {
      return authMatch[2] === "start"
        ? beginOAuth(request, env, authMatch[1])
        : completeOAuth(request, env, authMatch[1]);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, context);
    }

    if (request.method === "GET" && url.pathname === "/v1/daemon/connect") {
      return connectDaemon(request, env, context);
    }
    return jsonError(404, "not-found");
  },
} satisfies ExportedHandler<AppEnv>;
