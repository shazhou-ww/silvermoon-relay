import { daemonIdSchema } from "@silvermoon-relay/protocol";
import { authenticate } from "./auth";
export { DaemonSession } from "./daemon-session";

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "silvermoon-relay", status: "ok" });
    }

    if (request.method !== "GET" || url.pathname !== "/v1/daemon/connect") {
      return jsonError(404, "not-found");
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonError(426, "websocket-upgrade-required");
    }

    const user = await authenticate(request, env.DB);
    if (!user) {
      return jsonError(401, "unauthorized");
    }

    const daemonId = daemonIdSchema.safeParse(
      request.headers.get("x-silvermoon-daemon-id"),
    );
    if (!daemonId.success) {
      return jsonError(400, "invalid-daemon-id");
    }

    const registration = await env.DB.prepare(
      `INSERT INTO daemons (id, user_id, last_seen_at)
       VALUES (?1, ?2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
       WHERE user_id = excluded.user_id`,
    )
      .bind(daemonId.data, user.id)
      .run();
    if (registration.meta.changes !== 1) {
      return jsonError(409, "daemon-owner-conflict");
    }

    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.set("x-silvermoon-user-id", user.id);
    headers.set("x-silvermoon-daemon-id", daemonId.data);

    return env.DAEMON_SESSIONS.getByName(
      `${user.id}:${daemonId.data}`,
    ).fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;
