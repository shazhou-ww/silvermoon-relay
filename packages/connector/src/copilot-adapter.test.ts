import type {
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionMetadata,
} from "@github/copilot-sdk";
import { agentSessionSchema } from "@silvermoon-ai/protocol";
import { describe, expect, it, vi } from "vitest";
import type { AgentAdapterEvent } from "./adapter.js";
import type { AgentHostSessionProvider } from "./agent-host-provider.js";
import { CopilotAgentAdapter } from "./copilot-adapter.js";

class FakeSession {
  readonly sent: string[] = [];
  private listener: ((event: SessionEvent) => void) | null = null;

  constructor(
    readonly sessionId: string,
    private readonly history: SessionEvent[] = [],
  ) {}

  async send(options: { prompt: string }): Promise<string> {
    this.sent.push(options.prompt);
    return crypto.randomUUID();
  }

  on(listener: (event: SessionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  async getEvents(): Promise<SessionEvent[]> {
    return this.history;
  }

  async disconnect(): Promise<void> {}

  emit(event: SessionEvent): void {
    this.listener?.(event);
  }
}

class FakeClient {
  readonly session = new FakeSession("session-new");
  readonly existingSession = new FakeSession("session-existing", [
    {
      id: "history-user",
      parentId: null,
      timestamp: "2026-10-10T00:00:00.000Z",
      type: "user.message",
      data: { content: "Existing question" },
    } as SessionEvent,
    {
      id: "history-assistant",
      parentId: "history-user",
      timestamp: "2026-10-10T00:00:01.000Z",
      type: "assistant.message",
      data: { content: "Existing answer" },
    } as SessionEvent,
    {
      id: "history-idle",
      parentId: "history-assistant",
      timestamp: "2026-10-10T00:00:02.000Z",
      type: "session.idle",
      data: {},
    } as SessionEvent,
    {
      id: "history-error",
      parentId: "history-idle",
      timestamp: "2026-10-10T00:00:03.000Z",
      type: "session.error",
      data: {
        errorType: "historical-error",
        message: "A historical failure",
      },
    } as SessionEvent,
  ]);
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<Error[]> {
    return [];
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return [
      {
        sessionId: "session-existing",
        startTime: new Date("2026-10-10T00:00:00.000Z"),
        modifiedTime: new Date("2026-10-10T00:01:00.000Z"),
        summary: "Existing work",
        isRemote: false,
      },
      {
        sessionId: "session-long-summary",
        startTime: new Date("2026-10-10T00:00:00.000Z"),
        modifiedTime: new Date("2026-10-10T00:01:00.000Z"),
        summary: "x".repeat(600),
        isRemote: false,
      },
    ];
  }

  async createSession(_config: SessionConfig): Promise<FakeSession> {
    return this.session;
  }

  async resumeSession(
    sessionId: string,
    _config: ResumeSessionConfig,
  ): Promise<FakeSession> {
    if (sessionId === this.existingSession.sessionId) {
      return this.existingSession;
    }
    return new FakeSession(sessionId);
  }
}

class FakeAgentHostProvider implements AgentHostSessionProvider {
  readonly sent: Array<{ sessionId: string; message: string }> = [];
  readonly historyRequests: string[] = [];
  closed = false;
  private readonly listeners = new Set<
    (event: AgentAdapterEvent) => void
  >();
  private readonly sessions = new Map([
    [
      "session-existing",
      {
        id: "session-existing",
        title: "Live existing work",
        status: "running" as const,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:05:00.000Z",
        lastMessagePreview: "Working in VS Code",
      },
    ],
    [
      "session-live-only",
      {
        id: "session-live-only",
        title: "Live only",
        status: "waiting" as const,
        createdAt: "2026-10-10T00:02:00.000Z",
        updatedAt: "2026-10-10T00:06:00.000Z",
        lastMessagePreview: "Needs input",
      },
    ],
  ]);

  async listSessions() {
    return [...this.sessions.values()];
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async sendMessage(input: {
    sessionId: string;
    message: string;
  }): Promise<void> {
    this.sent.push(input);
  }

  async loadSessionHistory(sessionId: string) {
    this.historyRequests.push(sessionId);
    return [{
      id: "ahp-history",
      sessionId,
      sequence: 1,
      type: "message" as const,
      role: "assistant" as const,
      text: "Live history",
      createdAt: "2026-10-10T00:05:00.000Z",
    }];
  }

  subscribe(listener: (event: AgentAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    for (const listener of this.listeners) {
      listener({
        type: "session.updated",
        session: {
          ...session,
          status: "gone",
          updatedAt: "2026-10-10T00:10:00.000Z",
        },
      });
    }
  }
}

describe("CopilotAgentAdapter", () => {
  it("lists, creates, and streams GitHub Copilot sessions", async () => {
    const client = new FakeClient();
    const adapter = new CopilotAgentAdapter({
      client,
      agentHostProvider: false,
    });
    const events: AgentAdapterEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.listSessions()).resolves.toContainEqual(
      expect.objectContaining({
        id: "session-existing",
        title: "Existing work",
      }),
    );
    const sessions = await adapter.listSessions();
    expect(() => agentSessionSchema.array().parse(sessions)).not.toThrow();
    expect(sessions.find((session) => session.id === "session-long-summary"))
      .toMatchObject({
        title: "x".repeat(256),
        lastMessagePreview: "x".repeat(512),
      });
    const history = await adapter.loadSessionHistory("session-existing");
    expect(history).toEqual([
      expect.objectContaining({
        id: "history-user",
        sessionId: "session-existing",
        role: "user",
        text: "Existing question",
      }),
      expect.objectContaining({
        id: "history-assistant",
        sessionId: "session-existing",
        role: "assistant",
        text: "Existing answer",
      }),
      expect.objectContaining({
        id: "history-idle",
        sessionId: "session-existing",
        status: "idle",
      }),
      expect.objectContaining({
        id: "history-error",
        sessionId: "session-existing",
        type: "error",
      }),
    ]);
    expect(
      history.every(
        (event, index) =>
          index === 0 || history[index - 1].sequence < event.sequence,
      ),
    ).toBe(true);
    await expect(adapter.listSessions()).resolves.toContainEqual(
      expect.objectContaining({
        id: "session-existing",
        status: "idle",
      }),
    );
    const created = await adapter.createSession({
      title: "Investigate CI",
      prompt: "Fix the failing check.",
    });
    expect(created).toMatchObject({
      id: "session-new",
      status: "running",
    });
    expect(client.session.sent).toEqual(["Fix the failing check."]);

    client.session.emit({
      id: "event-1",
      parentId: null,
      timestamp: "2026-10-10T00:02:00.000Z",
      type: "assistant.message",
      data: { content: "The generated worker types are stale." },
    } as SessionEvent);
    client.session.emit({
      id: "event-2",
      parentId: "event-1",
      timestamp: "2026-10-10T00:02:01.000Z",
      type: "tool.execution_start",
      data: {
        arguments: {},
        toolCallId: "tool-call-1",
        toolName: "powershell",
      },
    } as SessionEvent);
    client.session.emit({
      id: "event-3",
      parentId: "event-2",
      timestamp: "2026-10-10T00:02:01.000Z",
      type: "tool.execution_complete",
      data: {
        success: true,
        toolCallId: "tool-call-1",
      },
    } as SessionEvent);
    client.session.emit({
      id: "event-4",
      parentId: "event-3",
      timestamp: "2026-10-10T00:02:02.000Z",
      type: "session.title_changed",
      data: { title: "y".repeat(600) },
    } as SessionEvent);
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        type: "session.event",
        event: expect.objectContaining({
          id: "event-1",
          role: "assistant",
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: "session.event",
        event: expect.objectContaining({
          id: "event-3",
          text: "powershell succeeded",
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: "session.updated",
        session: expect.objectContaining({
          title: "y".repeat(256),
        }),
      }));
    });
    const sequences = events
      .filter((event) => event.type === "session.event")
      .map((event) => event.event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);

    await adapter.close();
  });

  it("merges live Agent Host sessions and falls back to persisted sessions", async () => {
    const client = new FakeClient();
    const agentHostProvider = new FakeAgentHostProvider();
    const adapter = new CopilotAgentAdapter({ client, agentHostProvider });
    const events: AgentAdapterEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    const sessions = await adapter.listSessions();
    expect(sessions.filter((session) => session.id === "session-existing"))
      .toEqual([
        expect.objectContaining({
          title: "Live existing work",
          status: "running",
        }),
      ]);
    expect(sessions).toContainEqual(expect.objectContaining({
      id: "session-live-only",
      status: "waiting",
    }));

    await expect(adapter.loadSessionHistory("session-live-only")).resolves
      .toEqual([
        expect.objectContaining({
          id: "ahp-history",
          text: "Live history",
        }),
      ]);
    await adapter.sendMessage({
      sessionId: "session-existing",
      message: "Queue this",
    });
    expect(agentHostProvider.sent).toEqual([{
      sessionId: "session-existing",
      message: "Queue this",
    }]);

    agentHostProvider.disconnect("session-existing");
    expect(events.at(-1)).toEqual({
      type: "session.updated",
      session: expect.objectContaining({
        id: "session-existing",
        title: "Existing work",
        status: "idle",
      }),
    });
    await adapter.sendMessage({
      sessionId: "session-existing",
      message: "Continue from disk",
    });
    expect(client.existingSession.sent).toEqual(["Continue from disk"]);

    agentHostProvider.disconnect("session-live-only");
    expect(events.at(-1)).toEqual({
      type: "session.updated",
      session: expect.objectContaining({
        id: "session-live-only",
        status: "gone",
      }),
    });

    await adapter.close();
    expect(agentHostProvider.closed).toBe(true);
  });
});
