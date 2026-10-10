import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionType,
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
import { describe, expect, it } from "vitest";
import {
  agentHostChatHistoryToEvents,
  agentHostSummaryToSession,
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
      title: "Active work",
      status: "waiting",
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:01:00.000Z",
      lastMessagePreview: "Waiting for approval",
    });
    expect(agentHostSummaryToSession({
      ...summary,
      resource: "not a resource",
    })).toBeNull();
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
