import {
  approveAll,
  CopilotClient,
  type CopilotSession,
  type ResumeSessionConfig,
  type SessionConfig,
  type SessionEvent,
  type SessionMetadata,
} from "@github/copilot-sdk";
import type {
  AgentSession,
  AgentSessionEvent,
  SessionStatus,
} from "@silvermoon-relay/protocol";
import type { AgentAdapter, AgentAdapterEvent } from "./adapter.js";

interface CopilotSessionHandle {
  readonly sessionId: string;
  send(options: { prompt: string }): Promise<string>;
  getEvents(): Promise<SessionEvent[]>;
  on(handler: (event: SessionEvent) => void): () => void;
  disconnect(): Promise<void>;
}

interface CopilotClientHandle {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  listSessions(): Promise<SessionMetadata[]>;
  createSession(config: SessionConfig): Promise<CopilotSessionHandle>;
  resumeSession(
    sessionId: string,
    config: ResumeSessionConfig,
  ): Promise<CopilotSessionHandle>;
}

interface ActiveSession {
  session: CopilotSessionHandle;
  summary: AgentSession;
  unsubscribe: () => void;
  lastSequence: number;
  toolNames: Map<string, string>;
}

export interface CopilotAgentAdapterOptions {
  workingDirectory?: string;
  baseDirectory?: string;
  model?: string;
  approveAllPermissions?: boolean;
  client?: CopilotClientHandle;
  log?: (message: string) => void;
}

function boundedText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedEventText(value: string): string {
  return value.slice(0, 65_536);
}

function metadataSummary(metadata: SessionMetadata): AgentSession {
  return {
    id: metadata.sessionId,
    title: boundedText(metadata.summary, 256),
    status: "idle",
    createdAt: metadata.startTime.toISOString(),
    updatedAt: metadata.modifiedTime.toISOString(),
    lastMessagePreview: boundedText(metadata.summary, 512),
  };
}

function sequenceFor(timestamp: string, previous: number): number {
  const milliseconds = Date.parse(timestamp);
  const base = (Number.isFinite(milliseconds) ? milliseconds : Date.now())
    * 1_000;
  return Math.max(base, previous + 1);
}

export class CopilotAgentAdapter implements AgentAdapter {
  readonly agent = {
    name: "GitHub Copilot",
  } as const;
  readonly capabilities = {
    listSessions: true,
    createSession: true,
    sendMessage: true,
    streamEvents: true,
  } as const;

  private readonly client: CopilotClientHandle;
  private readonly listeners = new Set<(event: AgentAdapterEvent) => void>();
  private readonly active = new Map<string, ActiveSession>();
  private readonly log: (message: string) => void;
  private started = false;

  constructor(private readonly options: CopilotAgentAdapterOptions = {}) {
    this.client = options.client ?? new CopilotClient({
      workingDirectory: options.workingDirectory,
      baseDirectory: options.baseDirectory,
      clientInfo: {
        applicationName: "silvermoon-connector",
        integrationName: "github-copilot-sdk",
      },
    });
    this.log = options.log ?? ((message) => console.error(message));
  }

  async listSessions(): Promise<AgentSession[]> {
    await this.ensureStarted();
    const sessions = await this.client.listSessions();
    return sessions.map((metadata) =>
      this.active.get(metadata.sessionId)?.summary ?? metadataSummary(metadata)
    );
  }

  async createSession(input: {
    prompt: string;
    title?: string;
  }): Promise<AgentSession> {
    await this.ensureStarted();
    const session = await this.client.createSession(this.sessionConfig());
    const now = new Date().toISOString();
    const summary: AgentSession = {
      id: session.sessionId,
      title: input.title ?? null,
      status: "running",
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: input.prompt.slice(0, 512),
    };
    this.attach(session, summary);
    this.emit({ type: "session.updated", session: summary });
    await session.send({ prompt: input.prompt });
    return summary;
  }

  async sendMessage(input: {
    sessionId: string;
    message: string;
  }): Promise<void> {
    await this.ensureStarted();
    const active = await this.activeSession(input.sessionId);
    this.updateSummary(active, {
      status: "running",
      updatedAt: new Date().toISOString(),
      lastMessagePreview: input.message.slice(0, 512),
    });
    await active.session.send({ prompt: input.message });
  }

  async loadSessionHistory(
    sessionId: string,
  ): Promise<AgentSessionEvent[]> {
    await this.ensureStarted();
    const active = await this.activeSession(sessionId);
    const result: AgentSessionEvent[] = [];
    let previousSequence = 0;
    for (const event of await active.session.getEvents()) {
      const mapped = this.mapCopilotEvent(active, event, false);
      if (!mapped) continue;
      const sequence = sequenceFor(event.timestamp, previousSequence);
      previousSequence = sequence;
      result.push({
        ...mapped,
        sessionId,
        sequence,
      });
    }
    active.lastSequence = Math.max(active.lastSequence, previousSequence);
    this.emit({ type: "session.updated", session: active.summary });
    return result;
  }

  subscribe(listener: (event: AgentAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    for (const active of this.active.values()) {
      active.unsubscribe();
    }
    this.active.clear();
    if (!this.started) return;
    const errors = await this.client.stop();
    this.started = false;
    for (const error of errors) {
      this.log(`Copilot shutdown error: ${error.message}`);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    await this.client.start();
    this.started = true;
  }

  private async activeSession(sessionId: string): Promise<ActiveSession> {
    const existing = this.active.get(sessionId);
    if (existing) return existing;
    const metadata = await this.client.listSessions();
    const found = metadata.find((item) => item.sessionId === sessionId);
    if (!found) throw new Error(`Copilot session not found: ${sessionId}`);
    const session = await this.client.resumeSession(
      sessionId,
      this.resumeConfig(),
    );
    return this.attach(session, metadataSummary(found));
  }

  private sessionConfig(): SessionConfig {
    return {
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.approveAllPermissions
        ? { onPermissionRequest: approveAll }
        : {}),
    };
  }

  private resumeConfig(): ResumeSessionConfig {
    return {
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.approveAllPermissions
        ? { onPermissionRequest: approveAll }
        : {}),
    };
  }

  private attach(
    session: CopilotSessionHandle,
    summary: AgentSession,
  ): ActiveSession {
    const existing = this.active.get(session.sessionId);
    existing?.unsubscribe();
    const active: ActiveSession = {
      session,
      summary,
      unsubscribe: () => {},
      lastSequence: 0,
      toolNames: new Map(),
    };
    active.unsubscribe = session.on((event) => {
      this.handleCopilotEvent(active, event);
    });
    this.active.set(session.sessionId, active);
    return active;
  }

  private handleCopilotEvent(
    active: ActiveSession,
    event: SessionEvent,
  ): void {
    const sessionEvent = this.mapCopilotEvent(active, event, true);
    if (!sessionEvent) return;
    const sequence = sequenceFor(event.timestamp, active.lastSequence);
    active.lastSequence = sequence;
    this.emit({
      type: "session.event",
      event: {
        ...sessionEvent,
        sessionId: active.session.sessionId,
        sequence,
      },
    });
  }

  private mapCopilotEvent(
    active: ActiveSession,
    event: SessionEvent,
    publishSummary: boolean,
  ): Omit<AgentSessionEvent, "sequence" | "sessionId"> | null {
    const updatedAt = event.timestamp;
    let status: SessionStatus | undefined;
    let sessionEvent: Omit<AgentSessionEvent, "sequence" | "sessionId"> | null =
      null;

    switch (event.type) {
      case "user.message":
        status = "running";
        sessionEvent = {
          id: event.id,
          type: "message",
          role: "user",
          text: boundedEventText(event.data.content),
          createdAt: event.timestamp,
        };
        break;
      case "assistant.message":
        sessionEvent = {
          id: event.id,
          type: "message",
          role: "assistant",
          text: boundedEventText(event.data.content),
          createdAt: event.timestamp,
        };
        break;
      case "assistant.intent":
        sessionEvent = {
          id: event.id,
          type: "activity",
          text: boundedEventText(event.data.intent),
          createdAt: event.timestamp,
        };
        break;
      case "tool.execution_start":
        active.toolNames.set(event.data.toolCallId, event.data.toolName);
        sessionEvent = {
          id: event.id,
          type: "tool",
          text: `Started ${event.data.toolName}`,
          data: {
            toolName: event.data.toolName,
            toolCallId: event.data.toolCallId,
            state: "started",
          },
          createdAt: event.timestamp,
        };
        break;
      case "tool.execution_complete":
        {
          const toolName = event.data.toolDescription?.name
            ?? active.toolNames.get(event.data.toolCallId)
            ?? "Tool";
          active.toolNames.delete(event.data.toolCallId);
        sessionEvent = {
          id: event.id,
          type: "tool",
          text: `${toolName} ${event.data.success ? "succeeded" : "failed"}`,
          data: {
            toolName,
            toolCallId: event.data.toolCallId,
            state: event.data.success ? "succeeded" : "failed",
          },
          createdAt: event.timestamp,
        };
        }
        break;
      case "session.error":
        status = "failed";
        sessionEvent = {
          id: event.id,
          type: "error",
          text: boundedEventText(event.data.message),
          data: { errorType: event.data.errorType },
          createdAt: event.timestamp,
        };
        break;
      case "session.idle":
        status = "idle";
        sessionEvent = {
          id: event.id,
          type: "status",
          status,
          text: "Session is idle",
          createdAt: event.timestamp,
        };
        break;
      case "session.title_changed":
        this.updateSummary(active, {
          title: boundedText(event.data.title, 256),
          updatedAt,
        }, publishSummary);
        return null;
      case "session.shutdown":
        status = "closed";
        break;
      default:
        return null;
    }

    if (status) {
      this.updateSummary(active, { status, updatedAt }, publishSummary);
    } else {
      this.updateSummary(active, { updatedAt }, publishSummary);
    }
    return sessionEvent;
  }

  private updateSummary(
    active: ActiveSession,
    updates: Partial<AgentSession>,
    publish = true,
  ): void {
    active.summary = { ...active.summary, ...updates };
    if (publish) {
      this.emit({ type: "session.updated", session: active.summary });
    }
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export type { CopilotSession };
