import { DurableObject } from "cloudflare:workers";
import {
  connectorCommandSchema,
  connectorIdSchema,
  type AgentSession,
  type AgentSessionEvent,
  type ConnectorCommand,
  type ConnectorId,
  PROTOCOL_VERSION,
} from "@silvermoon-relay/protocol";
import {
  connectorRouter,
  type ConnectorRpcContext,
} from "@silvermoon-relay/rpc";
import { acceptTRPCWebSocket } from "./trpc-websocket";

interface ConnectionAttachment {
  connectionId: string;
  connectorId: ConnectorId;
  tokenId: string;
  userId: string;
  socket: WebSocket;
}

interface CommandWaiter {
  connectionId: string;
  resolve(command: ConnectorCommand | null): void;
}

type RegistrationInput = Parameters<ConnectorRpcContext["register"]>[0];
type CommandCompletion = Parameters<
  ConnectorRpcContext["commandCompleted"]
>[0];

function eventPreview(event: AgentSessionEvent): string | null {
  if (!event.text) return null;
  return event.text.length <= 512
    ? event.text
    : `${event.text.slice(0, 509)}...`;
}

export class ConnectorSession extends DurableObject<Env> {
  private readonly connections = new Set<ConnectionAttachment>();
  private readonly commandWaiters = new Set<CommandWaiter>();

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get("x-silvermoon-user-id");
    const tokenId = request.headers.get("x-silvermoon-token-id");
    const connectorIdResult = connectorIdSchema.safeParse(
      request.headers.get("x-silvermoon-connector-id"),
    );
    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      || !userId
      || !tokenId
      || !connectorIdResult.success
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    for (const connection of this.connections) {
      this.cancelCommandWaiters(connection.connectionId);
      connection.socket.close(4009, "replaced by a newer connector connection");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      connectorId: connectorIdResult.data,
      tokenId,
      userId,
      socket: server,
    };
    this.connections.add(attachment);
    server.addEventListener("close", () => {
      void this.connectionClosed(attachment);
    });

    acceptTRPCWebSocket(request, server, {
      router: connectorRouter,
      createContext: () => this.createRpcContext(attachment),
      onError: ({ error, path }) => {
        console.error(JSON.stringify({
          event: "connector.rpc.error",
          connectorId: attachment.connectorId,
          path,
          code: error.code,
          message: error.message,
        }));
      },
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async dispatchCommand(
    value: ConnectorCommand,
  ): Promise<{ delivered: boolean }> {
    const command = connectorCommandSchema.parse(value);
    const waiter = [...this.commandWaiters].at(-1);
    if (!waiter) return { delivered: false };
    waiter.resolve(command);
    return { delivered: true };
  }

  async revokeToken(tokenId: string): Promise<number> {
    let closed = 0;
    for (const connection of this.connections) {
      if (connection.tokenId !== tokenId) continue;
      connection.socket.close(4003, "connection token revoked");
      closed += 1;
    }
    return closed;
  }

  private createRpcContext(
    attachment: ConnectionAttachment,
  ): ConnectorRpcContext {
    return {
      connectorId: attachment.connectorId,
      register: (input) => this.register(attachment, input),
      heartbeat: () => this.touchConnector(attachment),
      syncSessions: async (sessions, commandId) => {
        await Promise.all(
          sessions.map((session) => this.upsertSession(attachment, session)),
        );
        if (commandId) {
          await this.completeCommand(
            attachment,
            commandId,
            "succeeded",
          );
        }
      },
      commandAccepted: (commandId) =>
        this.commandAccepted(attachment, commandId),
      commandCompleted: async (input) => {
        if (input.session) {
          await this.upsertSession(attachment, input.session);
        }
        await this.completeCommand(
          attachment,
          input.commandId,
          input.outcome,
          input.error,
        );
      },
      sessionUpdated: (session) =>
        this.upsertSession(attachment, session),
      sessionEvent: (event) => this.storeEvent(attachment, event),
      commands: (signal) => this.commandStream(attachment, signal),
    };
  }

  private async register(
    attachment: ConnectionAttachment,
    input: RegistrationInput,
  ): ReturnType<ConnectorRpcContext["register"]> {
    if (input.connectorId !== attachment.connectorId) {
      throw new Error("Authenticated connector ID does not match registration.");
    }
    await this.env.DB.prepare(
      `UPDATE connectors SET display_name = ?1, agent_name = ?2,
        agent_version = ?3, capabilities_json = ?4, status = 'online',
        connected_at = CURRENT_TIMESTAMP, disconnected_at = NULL,
        last_seen_at = CURRENT_TIMESTAMP
       WHERE user_id = ?5 AND id = ?6`,
    )
      .bind(
        input.displayName,
        input.agent.name,
        input.agent.version ?? null,
        JSON.stringify(input.capabilities),
        attachment.userId,
        attachment.connectorId,
      )
      .run();
    return {
      protocolVersion: PROTOCOL_VERSION,
      connectionId: attachment.connectionId,
      connectorId: attachment.connectorId,
    };
  }

  private async touchConnector(
    attachment: ConnectionAttachment,
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE connectors SET last_seen_at = CURRENT_TIMESTAMP, status = 'online'
       WHERE user_id = ?1 AND id = ?2`,
    )
      .bind(attachment.userId, attachment.connectorId)
      .run();
  }

  private async commandAccepted(
    attachment: ConnectionAttachment,
    commandId: string,
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE connector_commands SET status = 'accepted',
        accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2 AND connector_id = ?3
         AND status IN ('queued', 'sent')`,
    )
      .bind(commandId, attachment.userId, attachment.connectorId)
      .run();
  }

  private async *commandStream(
    attachment: ConnectionAttachment,
    signal: AbortSignal,
  ): AsyncGenerator<ConnectorCommand> {
    while (!signal.aborted) {
      const command = await new Promise<ConnectorCommand | null>((resolve) => {
        const waiter: CommandWaiter = {
          connectionId: attachment.connectionId,
          resolve: (value) => {
          this.commandWaiters.delete(waiter);
          signal.removeEventListener("abort", aborted);
          resolve(value);
          },
        };
        const aborted = () => waiter.resolve(null);
        this.commandWaiters.add(waiter);
        signal.addEventListener("abort", aborted, { once: true });
      });
      if (!command) return;
      await this.markCommandSent(command.commandId);
      yield command;
    }
  }

  private async markCommandSent(commandId: string): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE connector_commands SET status = 'sent',
        sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND status = 'queued'`,
    )
      .bind(commandId)
      .run();
  }

  private async upsertSession(
    attachment: ConnectionAttachment,
    session: AgentSession,
  ): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO agent_sessions
        (user_id, connector_id, id, title, status, created_at, updated_at,
         last_activity_at, last_message_preview)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
       ON CONFLICT (user_id, connector_id, id) DO UPDATE SET
         title = excluded.title,
         status = excluded.status,
         updated_at = excluded.updated_at,
         last_activity_at = excluded.last_activity_at,
         last_message_preview = COALESCE(
           excluded.last_message_preview,
           agent_sessions.last_message_preview
         )`,
    )
      .bind(
        attachment.userId,
        attachment.connectorId,
        session.id,
        session.title,
        session.status,
        session.createdAt,
        session.updatedAt,
        session.lastMessagePreview,
      )
      .run();
  }

  private async storeEvent(
    attachment: ConnectionAttachment,
    event: AgentSessionEvent,
  ): Promise<void> {
    await this.env.DB.batch([
      this.env.DB.prepare(
        `INSERT INTO agent_sessions
          (user_id, connector_id, id, title, status, created_at, updated_at,
           last_activity_at, last_message_preview)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?5, ?5, ?6)
         ON CONFLICT (user_id, connector_id, id) DO UPDATE SET
           status = COALESCE(?7, agent_sessions.status),
           updated_at = ?5,
           last_activity_at = ?5,
           last_message_preview = COALESCE(?6, agent_sessions.last_message_preview)`,
      ).bind(
        attachment.userId,
        attachment.connectorId,
        event.sessionId,
        event.status ?? "unknown",
        event.createdAt,
        eventPreview(event),
        event.status ?? null,
      ),
      this.env.DB.prepare(
        `INSERT INTO agent_session_events
          (user_id, connector_id, session_id, event_id, sequence, type, role,
           content, data_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT (user_id, connector_id, session_id, event_id)
         DO NOTHING`,
      ).bind(
        attachment.userId,
        attachment.connectorId,
        event.sessionId,
        event.id,
        event.sequence,
        event.type,
        event.role ?? null,
        event.text ?? null,
        event.data ? JSON.stringify(event.data) : null,
        event.createdAt,
      ),
    ]);
  }

  private async completeCommand(
    attachment: ConnectionAttachment,
    commandId: string,
    outcome: "succeeded" | "failed",
    error?: CommandCompletion["error"],
  ): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE connector_commands SET status = ?1, error_code = ?2,
        error_message = ?3, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?4 AND user_id = ?5 AND connector_id = ?6`,
    )
      .bind(
        outcome,
        error?.code ?? null,
        error?.message ?? null,
        commandId,
        attachment.userId,
        attachment.connectorId,
      )
      .run();
  }

  private async connectionClosed(
    attachment: ConnectionAttachment,
  ): Promise<void> {
    this.cancelCommandWaiters(attachment.connectionId);
    this.connections.delete(attachment);
    if (
      [...this.connections].some(
        (connection) =>
          connection.connectorId === attachment.connectorId
          && connection.userId === attachment.userId,
      )
    ) {
      return;
    }
    await this.env.DB.prepare(
      `UPDATE connectors SET status = 'offline',
        disconnected_at = CURRENT_TIMESTAMP,
        last_seen_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND id = ?2`,
    )
      .bind(attachment.userId, attachment.connectorId)
      .run();
  }

  private cancelCommandWaiters(connectionId: string): void {
    for (const waiter of this.commandWaiters) {
      if (waiter.connectionId === connectionId) waiter.resolve(null);
    }
  }
}
