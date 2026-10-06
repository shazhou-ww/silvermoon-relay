import { DurableObject } from "cloudflare:workers";
import {
  daemonReadySchema,
  type DaemonId,
  PROTOCOL_VERSION,
} from "@silvermoon-relay/protocol";

interface SocketAttachment {
  connectionId: string;
  daemonId: DaemonId;
  userId: string;
}

export class DaemonSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS connections (
          connection_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          daemon_id TEXT NOT NULL,
          connected_at INTEGER NOT NULL,
          disconnected_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS accepted_requests (
          request_id TEXT PRIMARY KEY,
          payload_hash TEXT NOT NULL,
          accepted_at INTEGER NOT NULL
        );
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get("x-silvermoon-user-id");
    const daemonIdResult = daemonReadySchema.shape.daemonId.safeParse(
      request.headers.get("x-silvermoon-daemon-id"),
    );
    if (!userId || !daemonIdResult.success) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connectionId = crypto.randomUUID();
    const attachment: SocketAttachment = {
      connectionId,
      daemonId: daemonIdResult.data,
      userId,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [daemonIdResult.data]);

    this.ctx.storage.sql.exec(
      `INSERT INTO connections
        (connection_id, user_id, daemon_id, connected_at)
       VALUES (?, ?, ?, ?)`,
      connectionId,
      userId,
      daemonIdResult.data,
      Date.now(),
    );

    server.send(
      JSON.stringify({
        type: "relay.ready",
        protocolVersion: PROTOCOL_VERSION,
        daemonId: daemonIdResult.data,
      }),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    if (typeof message !== "string") {
      socket.send(JSON.stringify({ type: "error", reason: "unsupported" }));
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      socket.send(JSON.stringify({ type: "error", reason: "invalid-json" }));
      return;
    }

    const ready = daemonReadySchema.safeParse(value);
    if (!ready.success || ready.data.daemonId !== attachment.daemonId) {
      socket.send(JSON.stringify({ type: "error", reason: "invalid-message" }));
      return;
    }

    socket.send(JSON.stringify({ type: "ready.ack", daemonId: ready.data.daemonId }));
  }

  webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    socket.close(code, reason);
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    this.ctx.storage.sql.exec(
      "UPDATE connections SET disconnected_at = ? WHERE connection_id = ?",
      Date.now(),
      attachment.connectionId,
    );
    console.log(
      JSON.stringify({
        event: "daemon.disconnected",
        daemonId: attachment.daemonId,
        wasClean,
      }),
    );
  }
}
