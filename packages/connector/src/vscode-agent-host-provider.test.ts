import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionType,
  ChatInputAnswerState,
  ChatInputAnswerValueKind,
  ChatInputQuestionKind,
  ChatInputResponseKind,
  ChatInteractivity,
  MessageKind,
  PendingMessageKind,
  ResponsePartKind,
  SessionStatus,
  ToolCallConfirmationReason,
  ToolCallStatus,
  TurnState,
  type ChatState,
  type SessionSummary,
} from "@microsoft/agent-host-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  AgentHostDispatchAcknowledger,
  agentHostChatHistoryToEvents,
  agentHostSummaryToSession,
  agentHostSummaryToSubsessions,
  createAgentHostMessageAction,
  discoverAgentHostEndpoints,
  resolveVsCodeUserDataDirectory,
  type AgentHostEndpointMetadata,
  VsCodeAgentHostProvider,
} from "./vscode-agent-host-provider.js";

function endpointFileName(entry: AgentHostEndpointMetadata): string {
  return `${createHash("sha256").update(
    `${entry.type}\0${entry.pid}\0${entry.instanceId}`,
  ).digest("hex")}.json`;
}

function chatState(active = false): ChatState {
  return {
    resource: "ahp-chat:/session-1/default",
    title: "Default",
    status: active ? SessionStatus.InProgress : SessionStatus.Idle,
    modifiedAt: "2026-10-10T00:00:03.000Z",
    turns: [{
      id: "turn-1",
      startedAt: "2026-10-10T00:00:00.000Z",
      duration: 2_000,
      message: {
        text: "What changed?",
        origin: { kind: MessageKind.User },
      },
      responseParts: [{
        kind: ResponsePartKind.Markdown,
        id: "part-1",
        content: "The connector changed.",
      }],
      usage: undefined,
      state: TurnState.Complete,
    }],
    ...(active
      ? {
        activeTurn: {
          id: "turn-2",
          startedAt: "2026-10-10T00:00:03.000Z",
          message: {
            text: "Keep going",
            origin: { kind: MessageKind.User },
          },
          responseParts: [],
          usage: undefined,
        },
      }
      : {}),
  };
}

describe("VS Code Agent Host mapping", () => {
  it("maps status bitsets and stable session identifiers", () => {
    const summary: SessionSummary = {
      resource: "copilotcli:/session-active",
      provider: "copilotcli",
      title: "Active work",
      activity: "Waiting for approval",
      status: SessionStatus.InputNeeded | SessionStatus.IsRead,
      createdAt: "2026-10-10T00:00:00.000Z",
      modifiedAt: "2026-10-10T00:01:00.000Z",
    };
    expect(agentHostSummaryToSession(summary)).toEqual({
      id: "session-active",
      parentSessionId: null,
      title: "Active work",
      status: "waiting",
      nativeStatus: String(SessionStatus.InputNeeded | SessionStatus.IsRead),
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:01:00.000Z",
      lastMessagePreview: "Waiting for approval",
      canSendMessage: true,
    });
    expect(agentHostSummaryToSession({
      ...summary,
      resource: "not a resource",
    })).toBeNull();
  });

  it("maps visible non-default chats to stable subsessions", () => {
    const summary: SessionSummary = {
      resource: "copilotcli:/session-parent",
      provider: "copilotcli",
      title: "Parent work",
      status: SessionStatus.InProgress,
      createdAt: "2026-10-10T00:00:00.000Z",
      modifiedAt: "2026-10-10T00:01:00.000Z",
      defaultChat: "ahp-chat:/session-parent/default",
      chats: [{
        resource: "ahp-chat:/session-parent/default",
        title: "Default",
        status: SessionStatus.InProgress,
      }, {
        resource: "ahp-chat:/session-parent/worker",
        title: "Investigate tests",
        status: SessionStatus.InProgress,
        interactivity: ChatInteractivity.ReadOnly,
      }, {
        resource: "ahp-chat:/session-parent/internal",
        title: "Internal worker",
        interactivity: ChatInteractivity.Hidden,
      }, {
        resource: "ahp-chat:/session-parent/archived",
        title: "Archived worker",
        status: SessionStatus.Idle | SessionStatus.IsArchived,
      }],
    };
    const parent = agentHostSummaryToSession(summary);
    expect(parent).not.toBeNull();

    const subsessions = agentHostSummaryToSubsessions(summary, parent!);
    expect(subsessions).toEqual([{
      resource: "ahp-chat:/session-parent/worker",
      session: {
        id: expect.stringMatching(/^ahp-chat:[0-9a-f]{64}$/u),
        parentSessionId: "session-parent",
        title: "Investigate tests",
        status: "running",
        nativeStatus: String(SessionStatus.InProgress),
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:01:00.000Z",
        lastMessagePreview: null,
        canSendMessage: false,
      },
    }]);
    expect(agentHostSummaryToSubsessions(summary, parent!)[0].session.id)
      .toBe(subsessions[0].session.id);
  });

  it("treats the first catalog chat as the default when none is designated", () => {
    const summary: SessionSummary = {
      resource: "copilotcli:/session-parent",
      provider: "copilotcli",
      title: "Parent work",
      status: SessionStatus.Idle,
      createdAt: "2026-10-10T00:00:00.000Z",
      modifiedAt: "2026-10-10T00:01:00.000Z",
      chats: [{
        resource: "ahp-chat:/session-parent/first",
        title: "First",
      }, {
        resource: "ahp-chat:/session-parent/second",
        title: "Second",
      }],
    };
    const parent = agentHostSummaryToSession(summary);
    expect(parent).not.toBeNull();
    expect(agentHostSummaryToSubsessions(summary, parent!)).toHaveLength(1);
    expect(agentHostSummaryToSubsessions(summary, parent!)[0].session.title)
      .toBe("Second");
  });

  it("maps complete and active turns without exposing partial assistant text", () => {
    const events = agentHostChatHistoryToEvents("session-1", chatState(true));
    expect(events).toEqual([
      expect.objectContaining({
        id: "ahp:turn-1:user",
        role: "user",
        text: "What changed?",
      }),
      expect.objectContaining({
        id: "ahp:turn-1:part:part-1",
        role: "assistant",
        text: "The connector changed.",
        data: expect.objectContaining({
          turnId: "turn-1",
          partId: "part-1",
          partIndex: 0,
          partKind: "markdown",
        }),
      }),
      expect.objectContaining({
        id: "ahp:turn-2:user",
        role: "user",
        text: "Keep going",
      }),
    ]);
    expect(events.every(
      (event, index) =>
        index === 0 || events[index - 1].sequence < event.sequence,
    )).toBe(true);
  });

  it("preserves interleaved response-part order and tool identity", () => {
    const base = chatState();
    const turn = base.turns[0];
    const events = agentHostChatHistoryToEvents("session-1", {
      ...base,
      turns: [{
        ...turn,
        responseParts: [{
          kind: ResponsePartKind.Markdown,
          id: "markdown-intro",
          content: "I will inspect the connector.",
        }, {
          kind: ResponsePartKind.ToolCall,
          toolCall: {
            status: ToolCallStatus.Completed,
            toolCallId: "tool-1",
            toolName: "read_file",
            displayName: "Read file",
            invocationMessage: "Reading connector.ts",
            confirmed: ToolCallConfirmationReason.NotNeeded,
            success: true,
            pastTenseMessage: "Read connector.ts",
          },
        }, {
          kind: ResponsePartKind.ToolCall,
          toolCall: {
            status: ToolCallStatus.PendingConfirmation,
            toolCallId: "tool-2",
            toolName: "run_terminal",
            displayName: "Run terminal",
            invocationMessage: "Run focused checks",
          },
        }, {
          kind: ResponsePartKind.Markdown,
          id: "markdown-result",
          content: "The connector is ready.",
        }, {
          kind: ResponsePartKind.SystemNotification,
          content: "Background verification completed.",
        }],
      }],
    });

    expect(events.map((event) => ({
      role: event.role,
      type: event.type,
      text: event.text,
      partId: event.data?.partId,
      partIndex: event.data?.partIndex,
      partKind: event.data?.partKind,
      state: event.data?.state,
    }))).toEqual([
      {
        role: "user",
        type: "message",
        text: "What changed?",
        partId: "request",
        partIndex: 0,
        partKind: "request",
        state: undefined,
      },
      {
        role: "assistant",
        type: "message",
        text: "I will inspect the connector.",
        partId: "markdown-intro",
        partIndex: 0,
        partKind: "markdown",
        state: undefined,
      },
      {
        role: undefined,
        type: "tool",
        text: "Read connector.ts",
        partId: "tool-1",
        partIndex: 1,
        partKind: "tool",
        state: "succeeded",
      },
      {
        role: undefined,
        type: "tool",
        text: "Run terminal waiting",
        partId: "tool-2",
        partIndex: 2,
        partKind: "tool",
        state: "waiting",
      },
      {
        role: "assistant",
        type: "message",
        text: "The connector is ready.",
        partId: "markdown-result",
        partIndex: 3,
        partKind: "markdown",
        state: undefined,
      },
      {
        role: "system",
        type: "message",
        text: "Background verification completed.",
        partId: "systemNotification:4",
        partIndex: 4,
        partKind: "system",
        state: undefined,
      },
    ]);
  });

  it("starts idle chats and queues messages behind active turns", () => {
    expect(createAgentHostMessageAction(
      chatState(false),
      "Continue",
      "message-1",
      "2026-10-10T00:00:04.000Z",
    )).toEqual({
      type: ActionType.ChatTurnStarted,
      turnId: "message-1",
      startedAt: "2026-10-10T00:00:04.000Z",
      message: {
        text: "Continue",
        origin: { kind: MessageKind.User },
      },
    });
    expect(createAgentHostMessageAction(
      chatState(true),
      "Do this next",
      "message-2",
    )).toEqual({
      type: ActionType.ChatPendingMessageSet,
      kind: PendingMessageKind.Queued,
      id: "message-2",
      message: {
        text: "Do this next",
        origin: { kind: MessageKind.User },
      },
    });
  });

  it("answers a single open text input instead of queueing behind it", () => {
    const state = chatState(true);
    state.activeTurn!.responseParts = [{
      kind: ResponsePartKind.InputRequest,
      request: {
        id: "input-1",
        message: "What should I do next?",
        questions: [{
          id: "answer-1",
          kind: ChatInputQuestionKind.Text,
          message: "Next instruction",
          required: true,
        }],
      },
    }];

    expect(createAgentHostMessageAction(
      state,
      "Continue with the focused tests",
    )).toEqual({
      type: ActionType.ChatInputCompleted,
      requestId: "input-1",
      response: ChatInputResponseKind.Accept,
      answers: {
        "answer-1": {
          state: ChatInputAnswerState.Submitted,
          value: {
            kind: ChatInputAnswerValueKind.Text,
            value: "Continue with the focused tests",
          },
        },
      },
    });
  });

  it("rejects follow-ups that cannot satisfy structured input", () => {
    const state = chatState(true);
    state.activeTurn!.responseParts = [{
      kind: ResponsePartKind.InputRequest,
      request: {
        id: "input-1",
        questions: [{
          id: "answer-1",
          kind: ChatInputQuestionKind.Boolean,
          message: "Approve?",
        }],
      },
    }];

    expect(() => createAgentHostMessageAction(state, "yes")).toThrow(
      "requires structured input",
    );
  });

  it("projects resolved text input as a durable user message", () => {
    const state = chatState(true);
    state.activeTurn!.responseParts = [{
      kind: ResponsePartKind.InputRequest,
      request: {
        id: "input-1",
        message: "What should I do next?",
        questions: [{
          id: "answer-1",
          kind: ChatInputQuestionKind.Text,
          message: "Next instruction",
        }],
        answers: {
          "answer-1": {
            state: ChatInputAnswerState.Submitted,
            value: {
              kind: ChatInputAnswerValueKind.Text,
              value: "Continue with the focused tests",
            },
          },
        },
      },
      response: ChatInputResponseKind.Accept,
    }];

    expect(agentHostChatHistoryToEvents("session-1", state)).toContainEqual(
      expect.objectContaining({
        id: "ahp:turn-2:part:input-1",
        role: "user",
        text: "Continue with the focused tests",
        data: expect.objectContaining({
          inputRequestId: "input-1",
          partKind: "request",
        }),
      }),
    );
  });
});

describe("VS Code Agent Host dispatch acknowledgements", () => {
  it("resolves accepted dispatches and rejects server rejections", async () => {
    const acknowledgements = new AgentHostDispatchAcknowledger();
    const accepted = acknowledgements.wait(1, "chat/inputCompleted");
    expect(acknowledgements.settle(1, "chat/inputCompleted")).toBe(true);
    await expect(accepted).resolves.toBeUndefined();

    const rejected = acknowledgements.wait(2, "chat/inputCompleted");
    expect(acknowledgements.settle(
      2,
      "chat/inputCompleted",
      "input request is no longer open",
    )).toBe(true);
    await expect(rejected).rejects.toThrow(
      "input request is no longer open",
    );
  });

  it("rejects dispatches that are never acknowledged", async () => {
    vi.useFakeTimers();
    try {
      const acknowledgements = new AgentHostDispatchAcknowledger(10);
      const pending = acknowledgements.wait(1, "chat/pendingMessageSet");
      const rejection = expect(pending).rejects.toThrow(
        "Timed out waiting for Agent Host",
      );
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VS Code Agent Host discovery", () => {
  it("resolves portable, environment, and platform defaults", () => {
    expect(resolveVsCodeUserDataDirectory(
      "D:\\custom-code-data",
      {},
      "win32",
      "C:\\Users\\test",
    )).toBe("D:\\custom-code-data");
    expect(resolveVsCodeUserDataDirectory(
      undefined,
      { VSCODE_PORTABLE: "D:\\CodePortable" },
      "win32",
      "C:\\Users\\test",
    )).toBe(join("D:\\CodePortable", "user-data"));
    expect(resolveVsCodeUserDataDirectory(
      undefined,
      { XDG_CONFIG_HOME: "/tmp/config" },
      "linux",
      "/home/test",
    )).toBe(join("/tmp/config", "Code"));
  });

  it("ignores malformed, misnamed, and stale registry entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "silvermoon-agent-host-"));
    const entries = join(root, "agent-host", "local-endpoint", "entries");
    const token = "registry-secret-token";
    const valid: AgentHostEndpointMetadata = {
      schemaVersion: 2,
      type: "editor",
      pid: process.pid,
      instanceId: "valid-instance",
      protocolVersion: "0.10.0",
      connectionToken: token,
      endpoint: {
        type: "socket",
        path: "\\\\.\\pipe\\silvermoon-test",
      },
    };
    const stale: AgentHostEndpointMetadata = {
      ...valid,
      pid: 2_147_483_647,
      instanceId: "stale-instance",
    };
    const unsupported = {
      ...valid,
      instanceId: "unsupported-instance",
      protocolVersion: "0.9.0",
    };
    const logs: string[] = [];
    try {
      await mkdir(entries, { recursive: true });
      await Promise.all([
        writeFile(
          join(entries, endpointFileName(valid)),
          JSON.stringify(valid),
        ),
        writeFile(
          join(entries, endpointFileName(stale)),
          JSON.stringify(stale),
        ),
        writeFile(
          join(entries, endpointFileName(unsupported)),
          JSON.stringify(unsupported),
        ),
        writeFile(
          join(entries, "misnamed.json"),
          JSON.stringify({ ...valid, instanceId: "misnamed-instance" }),
        ),
        writeFile(
          join(entries, "malformed.json"),
          JSON.stringify({ connectionToken: token }),
        ),
      ]);

      await expect(discoverAgentHostEndpoints(
        root,
        (message) => logs.push(message),
      )).resolves.toEqual([valid]);
      expect(logs.join("\n")).not.toContain(token);
      expect(logs).toEqual(expect.arrayContaining([
        expect.stringContaining("misnamed"),
        expect.stringContaining("malformed"),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not expose endpoint tokens in connection errors", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Could not allocate a test TCP port.");
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    const root = await mkdtemp(join(tmpdir(), "silvermoon-agent-host-"));
    const entries = join(root, "agent-host", "local-endpoint", "entries");
    const token = "endpoint-token-that-must-not-leak";
    const entry: AgentHostEndpointMetadata = {
      schemaVersion: 2,
      type: "editor",
      pid: process.pid,
      instanceId: "unreachable-instance",
      protocolVersion: "0.10.0",
      connectionToken: token,
      endpoint: {
        type: "tcp",
        host: "127.0.0.1",
        port: address.port,
      },
    };
    const logs: string[] = [];
    const provider = new VsCodeAgentHostProvider({
      userDataDirectory: root,
      refreshIntervalMs: 0,
      log: (message) => logs.push(message),
    });
    try {
      await mkdir(entries, { recursive: true });
      await writeFile(
        join(entries, endpointFileName(entry)),
        JSON.stringify(entry),
      );
      await expect(provider.listSessions()).resolves.toEqual([]);
      expect(logs.join("\n")).not.toContain(token);
      expect(logs).toContainEqual(
        expect.stringContaining("Could not connect to Agent Host"),
      );
    } finally {
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
