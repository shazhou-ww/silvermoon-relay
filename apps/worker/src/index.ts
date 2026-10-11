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
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "websocket-upgrade-required");
  }
  const connection = await authenticate(request, env, context);
  if (!connection) return jsonError(401, "unauthorized");

  const registration = await env.DB.prepare(
    `UPDATE connectors SET connection_token_id = ?1
     WHERE user_id = ?2 AND id = ?3`,
  )
    .bind(connection.tokenId, connection.userId, connection.deviceId)
    .run();
  if (registration.meta.changes !== 1) {
    return jsonError(409, "device-registration-missing");
  }

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-silvermoon-user-id", connection.userId);
  headers.set("x-silvermoon-token-id", connection.tokenId);
  headers.set("x-silvermoon-connector-id", connection.deviceId);
  headers.set("x-silvermoon-device-name", connection.displayName);
  return env.DAEMON_SESSIONS.getByName(
    connection.tokenId,
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
      return connectConnector(request, env, context);
    }

    if (
      request.method === "GET"
      && (url.pathname === "/v1/connect"
        || url.pathname === "/v1/daemon/connect")
    ) {
      return connectConnector(request, env, context);
    }
    return jsonError(404, "not-found");
  },
} satisfies ExportedHandler<AppEnv>;
