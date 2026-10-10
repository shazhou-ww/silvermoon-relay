import type {
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionMetadata,
} from "@github/copilot-sdk";
import { describe, expect, it, vi } from "vitest";
import type { AgentAdapterEvent } from "./adapter.js";
import { CopilotAgentAdapter } from "./copilot-adapter.js";

class FakeSession {
  readonly sent: string[] = [];
  private listener: ((event: SessionEvent) => void) | null = null;

  constructor(readonly sessionId: string) {}

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

  async disconnect(): Promise<void> {}

  emit(event: SessionEvent): void {
    this.listener?.(event);
  }
}

class FakeClient {
  readonly session = new FakeSession("session-new");
  started = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<Error[]> {
    return [];
  }

  async listSessions(): Promise<SessionMetadata[]> {
    return [{
      sessionId: "session-existing",
      startTime: new Date("2026-10-10T00:00:00.000Z"),
      modifiedTime: new Date("2026-10-10T00:01:00.000Z"),
      summary: "Existing work",
      isRemote: false,
    }];
  }

  async createSession(_config: SessionConfig): Promise<FakeSession> {
    return this.session;
  }

  async resumeSession(
    sessionId: string,
    _config: ResumeSessionConfig,
  ): Promise<FakeSession> {
    return new FakeSession(sessionId);
  }
}

describe("CopilotAgentAdapter", () => {
  it("lists, creates, and streams GitHub Copilot sessions", async () => {
    const client = new FakeClient();
    const adapter = new CopilotAgentAdapter({ client });
    const events: AgentAdapterEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.listSessions()).resolves.toContainEqual(
      expect.objectContaining({
        id: "session-existing",
        title: "Existing work",
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
    });
    const sequences = events
      .filter((event) => event.type === "session.event")
      .map((event) => event.event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);

    await adapter.close();
  });
});
