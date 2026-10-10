import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { ConnectorCommand } from "@silvermoon-relay/protocol";
import type { ConnectorRouter } from "@silvermoon-relay/rpc";
import WebSocket from "ws";
import type { AgentAdapter, AgentAdapterEvent } from "./adapter.js";

export interface SilvermoonConnectorOptions {
  relayUrl: string;
  token: string;
  connectorId: string;
  displayName: string;
  adapter: AgentAdapter;
  heartbeatMs?: number;
  eventBufferLimit?: number;
  log?: (message: string) => void;
}

type ConnectorClient = ReturnType<typeof createTRPCClient<ConnectorRouter>>;
type ConnectorWsClient = ReturnType<typeof createWSClient>;

function connectorSocketUrl(relayUrl: string, connectorId: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Relay URL must use http, https, ws, or wss.");
  }
  url.pathname = `/v1/connectors/${encodeURIComponent(connectorId)}/connect`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function authenticatedWebSocket(
  token: string,
  connectorId: string,
): typeof globalThis.WebSocket {
  class AuthenticatedWebSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols ?? [], {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Silvermoon-Connector-Id": connectorId,
        },
      });
    }
  }
  return AuthenticatedWebSocket as unknown as typeof globalThis.WebSocket;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SilvermoonConnector {
  private readonly heartbeatMs: number;
  private readonly eventBufferLimit: number;
  private readonly log: (message: string) => void;
  private client: ConnectorClient | null = null;
  private wsClient: ConnectorWsClient | null = null;
  private commandSubscription: { unsubscribe(): void } | null = null;
  private adapterUnsubscribe: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private running = false;
  private commandQueue = Promise.resolve();
  private readonly pendingEvents: AgentAdapterEvent[] = [];

  constructor(private readonly options: SilvermoonConnectorOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 20_000;
    this.eventBufferLimit = options.eventBufferLimit ?? 1_000;
    this.log = options.log ?? ((message) => console.log(message));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.adapterUnsubscribe = this.options.adapter.subscribe((event) => {
      void this.publishEvent(event);
    });

    this.wsClient = createWSClient({
      url: connectorSocketUrl(
        this.options.relayUrl,
        this.options.connectorId,
      ),
      WebSocket: authenticatedWebSocket(
        this.options.token,
        this.options.connectorId,
      ),
      keepAlive: {
        enabled: true,
        intervalMs: 20_000,
        pongTimeoutMs: 5_000,
      },
      onOpen: () => void this.onOpen(),
      onClose: () => {
        this.connected = false;
        this.log("Relay connection closed; tRPC will reconnect.");
      },
      onError: () => {
        this.log("Relay WebSocket reported a connection error.");
      },
    });
    this.client = createTRPCClient<ConnectorRouter>({
      links: [wsLink({ client: this.wsClient })],
    });
    this.commandSubscription = this.client.commands.subscribe(undefined, {
      onData: (command) => {
        this.commandQueue = this.commandQueue
          .then(() => this.executeCommand(command))
          .catch((error: unknown) => {
            this.log(`Command queue failed: ${errorMessage(error)}`);
          });
      },
      onError: (error) => {
        this.log(`Command subscription failed: ${error.message}`);
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.connected = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.commandSubscription?.unsubscribe();
    this.commandSubscription = null;
    this.adapterUnsubscribe?.();
    this.adapterUnsubscribe = null;
    this.wsClient?.close();
    this.wsClient = null;
    this.client = null;
    await this.options.adapter.close?.();
  }

  private async onOpen(): Promise<void> {
    const client = this.client;
    if (!client || !this.running) return;
    try {
      const welcome = await client.register.mutate({
        connectorId: this.options.connectorId,
        displayName: this.options.displayName,
        agent: this.options.adapter.agent,
        capabilities: this.options.adapter.capabilities,
      });
      const sessions = await this.options.adapter.listSessions();
      await client.syncSessions.mutate({ sessions });
      this.connected = true;
      this.log(
        `Relay accepted ${welcome.connectorId} as ${welcome.connectionId}.`,
      );
      await this.flushPendingEvents();
      if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => {
          void this.sendHeartbeat();
        }, this.heartbeatMs);
      }
    } catch (error) {
      this.connected = false;
      this.log(`Connector registration failed: ${errorMessage(error)}`);
    }
  }

  private async executeCommand(command: ConnectorCommand): Promise<void> {
    const client = this.client;
    if (!client) return;
    await client.commandAccepted.mutate({ commandId: command.commandId });
    try {
      if (command.type === "sessions.list") {
        const sessions = await this.options.adapter.listSessions();
        await client.syncSessions.mutate({
          commandId: command.commandId,
          sessions,
        });
        return;
      }
      if (command.type === "session.create") {
        const session = await this.options.adapter.createSession({
          prompt: command.prompt,
          ...(command.title === undefined ? {} : { title: command.title }),
        });
        await client.sessionUpdated.mutate(session);
        await client.commandCompleted.mutate({
          commandId: command.commandId,
          outcome: "succeeded",
          session,
        });
        return;
      }
      await this.options.adapter.sendMessage({
        sessionId: command.sessionId,
        message: command.message,
      });
      await client.commandCompleted.mutate({
        commandId: command.commandId,
        outcome: "succeeded",
      });
    } catch (error) {
      await client.commandCompleted.mutate({
        commandId: command.commandId,
        outcome: "failed",
        error: {
          code: "copilot-command-failed",
          message: errorMessage(error).slice(0, 2_048),
        },
      });
    }
  }

  private async publishEvent(event: AgentAdapterEvent): Promise<void> {
    if (!this.connected || !this.client) {
      this.bufferEvent(event);
      return;
    }
    try {
      if (event.type === "session.updated") {
        await this.client.sessionUpdated.mutate(event.session);
      } else {
        await this.client.sessionEvent.mutate(event.event);
      }
    } catch (error) {
      this.bufferEvent(event);
      this.log(`Session event upload failed: ${errorMessage(error)}`);
    }
  }

  private bufferEvent(event: AgentAdapterEvent): void {
    if (this.pendingEvents.length >= this.eventBufferLimit) {
      this.pendingEvents.shift();
      this.log("Event buffer full; dropped the oldest transient observation.");
    }
    this.pendingEvents.push(event);
  }

  private async flushPendingEvents(): Promise<void> {
    while (this.connected && this.pendingEvents.length) {
      const event = this.pendingEvents.shift();
      if (event) await this.publishEvent(event);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.connected || !this.client) return;
    try {
      await this.client.heartbeat.mutate({
        observedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.connected = false;
      this.log(`Heartbeat failed: ${errorMessage(error)}`);
    }
  }
}
