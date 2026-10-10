import { connectorIdSchema } from "@silvermoon-ai/protocol";
import { handleApi } from "./api";
import { authenticate } from "./auth";
import type { AppEnv } from "./env";
import { completeOAuth, beginOAuth } from "./oauth";
export { ConnectorSession as DaemonSession } from "./connector-session";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function connectConnector(
  request: Request,
  env: AppEnv,
  context: ExecutionContext,
  requestedConnectorId?: string,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "websocket-upgrade-required");
  }
  const connection = await authenticate(request, env, context);
  if (!connection) return jsonError(401, "unauthorized");

  const connectorId = connectorIdSchema.safeParse(
    requestedConnectorId
      ?? request.headers.get("x-silvermoon-connector-id")
      ?? request.headers.get("x-silvermoon-daemon-id"),
  );
  if (!connectorId.success) return jsonError(400, "invalid-connector-id");

  const registration = await env.DB.prepare(
    `INSERT INTO connectors
      (user_id, id, display_name, capabilities_json, connection_token_id,
       status, last_seen_at)
     VALUES (
       ?1,
       ?2,
       ?2,
       '{"listSessions":false,"createSession":false,"sendMessage":false,"streamEvents":false}',
       ?3,
       'online',
       CURRENT_TIMESTAMP
     )
     ON CONFLICT (user_id, id) DO UPDATE SET
       connection_token_id = excluded.connection_token_id,
       status = 'online',
       last_seen_at = CURRENT_TIMESTAMP
     WHERE user_id = excluded.user_id`,
  )
    .bind(connection.userId, connectorId.data, connection.tokenId)
    .run();
  if (registration.meta.changes !== 1) {
    return jsonError(409, "connector-owner-conflict");
  }

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-silvermoon-user-id", connection.userId);
  headers.set("x-silvermoon-token-id", connection.tokenId);
  headers.set("x-silvermoon-connector-id", connectorId.data);
  return env.DAEMON_SESSIONS.getByName(
    `${connection.userId}:${connectorId.data}`,
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

    const connectorMatch = /^\/v1\/connectors\/([^/]+)\/connect$/u
      .exec(url.pathname);
    if (request.method === "GET" && connectorMatch) {
      let connectorId: string;
      try {
        connectorId = decodeURIComponent(connectorMatch[1]);
      } catch {
        return jsonError(400, "invalid-connector-id");
      }
      return connectConnector(request, env, context, connectorId);
    }

    if (request.method === "GET" && url.pathname === "/v1/daemon/connect") {
      return connectConnector(request, env, context);
    }
    return jsonError(404, "not-found");
  },
} satisfies ExportedHandler<AppEnv>;
