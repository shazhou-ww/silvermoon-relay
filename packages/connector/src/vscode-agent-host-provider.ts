import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
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
  chatReducer,
  sessionReducer,
  type ChatAction,
  type ChatState,
  type SessionAction,
  type SessionChatSummary,
  type SessionState,
  type SessionSummary,
  type StringOrMarkdown,
  type ToolCallState,
  type Turn,
} from "@microsoft/agent-host-protocol";
import {
  AhpClient,
  TransportError,
  type AhpTransport,
  type JsonRpcMessage,
  type Subscription,
  type SubscriptionEvent,
  type TransportFrame,
} from "@microsoft/agent-host-protocol/client";
import type {
  AgentSession,
  AgentSessionEvent,
  SessionStatus,
} from "@silvermoon-ai/protocol";
import WebSocket from "ws";
import type { AgentAdapterEvent } from "./adapter.js";
import type { AgentHostSessionProvider } from "./agent-host-provider.js";

const ROOT_CHANNEL = "ahp-root://";
const REGISTRY_SCHEMA_VERSION = 2;
const DEFAULT_REFRESH_INTERVAL_MS = 10_000;
const AHP_REQUEST_TIMEOUT_MS = 15_000;
const AHP_CONNECT_TIMEOUT_MS = 5_000;
const MAX_HISTORY_PAGES = 1_000;
const COPILOT_PROVIDER = "copilotcli";
const STATUS_IDLE = 1;
const STATUS_ERROR = 2;
const STATUS_IN_PROGRESS = 8;
const STATUS_INPUT_NEEDED = 16;
const STATUS_ARCHIVED = 64;

type AgentHostEndpointAddress =
  | { type: "socket"; path: string }
  | { type: "tcp"; host: string; port: number };

export interface AgentHostEndpointMetadata {
  schemaVersion: 2;
  type: "editor" | "standalone";
  pid: number;
  instanceId: string;
  protocolVersion: string;
  connectionToken: string;
  endpoint: AgentHostEndpointAddress;
  quality?: string;
  tunnelName?: string;
}

export interface VsCodeAgentHostProviderOptions {
  userDataDirectory?: string;
  refreshIntervalMs?: number;
  log?: (message: string) => void;
}

interface HostedSessionBinding {
  connection: AgentHostConnection;
  resource: string;
  chatResource?: string;
  summary: SessionSummary;
  session: AgentSession;
}

interface EventDraft extends Omit<AgentSessionEvent, "sequence" | "sessionId"> {
  sortOrder: number;
}

type TurnResponsePart = Turn["responseParts"][number];

interface TrackedSession {
  resource: string;
  state: SessionState;
  subscription: Subscription;
}

interface TrackedChat {
  resource: string;
  sessionId: string;
  state: ChatState;
  subscription: Subscription;
  waiters: Set<() => void>;
  dispatches: AgentHostDispatchAcknowledger;
}

interface PendingDispatch {
  resolve(): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class AgentHostDispatchAcknowledger {
  private readonly pending = new Map<number, PendingDispatch>();

  constructor(private readonly timeoutMs = AHP_REQUEST_TIMEOUT_MS) {}

  wait(clientSequence: number, actionType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(clientSequence);
        reject(new Error(
          `Timed out waiting for Agent Host to acknowledge ${actionType}.`,
        ));
      }, this.timeoutMs);
      this.pending.set(clientSequence, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });
    });
  }

  settle(
    clientSequence: number,
    actionType: string,
    rejectionReason?: string,
  ): boolean {
    const pending = this.pending.get(clientSequence);
    if (!pending) return false;
    this.pending.delete(clientSequence);
    if (rejectionReason) {
      pending.reject(new Error(
        `Agent Host rejected ${actionType}: ${rejectionReason}`,
      ));
    } else {
      pending.resolve();
    }
    return true;
  }

  reject(clientSequence: number, error: Error): void {
    const pending = this.pending.get(clientSequence);
    if (!pending) return;
    this.pending.delete(clientSequence);
    pending.reject(error);
  }

  rejectAll(reason: string): void {
    for (const [clientSequence, pending] of this.pending) {
      this.pending.delete(clientSequence);
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Agent Host dispatch failed: ${reason}`));
    }
  }
}

interface ConnectionCallbacks {
  onCatalogChanged(connection: AgentHostConnection): void;
  onEvent(connection: AgentHostConnection, event: AgentAdapterEvent): void;
  onClosed(connection: AgentHostConnection, error?: Error): void;
}

interface PendingRead {
  resolve(frame: TransportFrame | null): void;
  reject(error: Error): void;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/([?&]tkn=)[^&\s]+/giu, "$1***")
    .replace(/[\r\n]+/gu, " ");
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

function boundedContent(value: string, maxLength: number): string | null {
  return value.trim() ? value.slice(0, maxLength) : null;
}

function stringOrMarkdown(value: StringOrMarkdown): string {
  return typeof value === "string" ? value : value.markdown;
}

function validTimestamp(value: string): string | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function completionTimestamp(startedAt: string, duration?: number): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return new Date().toISOString();
  const boundedDuration = Number.isFinite(duration) && duration !== undefined
    ? Math.max(0, duration)
    : 0;
  return new Date(start + boundedDuration).toISOString();
}

function eventId(parts: string[]): string {
  const readable = `ahp:${parts.join(":")}`;
  if (readable.length <= 256) return readable;
  return `ahp:${createHash("sha256").update(readable).digest("hex")}`;
}

function sequenceFor(timestamp: string, previous: number): number {
  const milliseconds = Date.parse(timestamp);
  const base = (Number.isFinite(milliseconds) ? milliseconds : Date.now())
    * 1_000 + 500;
  return Math.max(base, previous + 1);
}

function sessionIdFromResource(resource: string): string | null {
  try {
    const url = new URL(resource);
    const id = decodeURIComponent(url.pathname).replace(/^\/+/u, "");
    return id && !id.includes("/") && id.length <= 256 ? id : null;
  } catch {
    return null;
  }
}

function subsessionId(parentSessionId: string, resource: string): string | null {
  try {
    if (new URL(resource).protocol !== "ahp-chat:") return null;
  } catch {
    return null;
  }
  return `ahp-chat:${
    createHash("sha256")
      .update(parentSessionId)
      .update("\0")
      .update(resource)
      .digest("hex")
  }`;
}

function sessionStatus(status: number | undefined): SessionStatus {
  if (status === undefined) return "unknown";
  if ((status & STATUS_ARCHIVED) !== 0) return "closed";
  if ((status & STATUS_INPUT_NEEDED) !== 0) return "waiting";
  if ((status & STATUS_IN_PROGRESS) !== 0) return "running";
  if ((status & STATUS_ERROR) !== 0) return "failed";
  if ((status & STATUS_IDLE) !== 0) return "idle";
  return "unknown";
}

function isArchivedStatus(status: number | undefined): boolean {
  return status !== undefined && (status & STATUS_ARCHIVED) !== 0;
}

function defaultChatResource(summary: SessionSummary): string | undefined {
  return summary.defaultChat ?? summary.chats?.at(0)?.resource;
}

function canSendToChat(chat: SessionChatSummary | undefined): boolean {
  return !isArchivedStatus(chat?.status)
    && chat?.interactivity !== ChatInteractivity.ReadOnly
    && chat?.interactivity !== ChatInteractivity.Hidden;
}

function isSupportedProtocolVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 1 || (major === 0 && minor === 10);
}

function sameSession(left: AgentSession, right: AgentSession): boolean {
  return left.id === right.id
    && left.title === right.title
    && left.status === right.status
    && left.nativeStatus === right.nativeStatus
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.lastMessagePreview === right.lastMessagePreview
    && left.parentSessionId === right.parentSessionId
    && left.canSendMessage === right.canSendMessage;
}

function preferredBinding(
  left: HostedSessionBinding,
  right: HostedSessionBinding,
): HostedSessionBinding {
  const leftActive = (left.summary.status & STATUS_IN_PROGRESS) !== 0;
  const rightActive = (right.summary.status & STATUS_IN_PROGRESS) !== 0;
  if (leftActive !== rightActive) return rightActive ? right : left;
  return Date.parse(right.summary.modifiedAt)
      > Date.parse(left.summary.modifiedAt)
    ? right
    : left;
}

export function agentHostSummaryToSession(
  summary: SessionSummary,
): AgentSession | null {
  const id = sessionIdFromResource(summary.resource);
  const createdAt = validTimestamp(summary.createdAt);
  const updatedAt = validTimestamp(summary.modifiedAt);
  if (!id || !createdAt || !updatedAt) return null;
  const chatResource = defaultChatResource(summary);
  const defaultChat = summary.chats?.find(
    (chat) => chat.resource === chatResource,
  );
  return {
    id,
    parentSessionId: null,
    title: boundedText(summary.title, 256),
    status: sessionStatus(summary.status),
    nativeStatus: summary.status === undefined ? null : String(summary.status),
    createdAt,
    updatedAt,
    lastMessagePreview: boundedText(summary.activity ?? summary.title, 512),
    canSendMessage: isArchivedStatus(summary.status)
      || summary.chats?.length === 0
      ? false
      : canSendToChat(defaultChat),
  };
}

export interface AgentHostSubsession {
  resource: string;
  session: AgentSession;
}

export function agentHostSummaryToSubsessions(
  summary: SessionSummary,
  parent: AgentSession,
): AgentHostSubsession[] {
  const defaultResource = defaultChatResource(summary);
  const subsessions: AgentHostSubsession[] = [];
  for (const chat of summary.chats ?? []) {
    if (
      chat.resource === defaultResource
      || chat.interactivity === ChatInteractivity.Hidden
    ) {
      continue;
    }
    const id = subsessionId(parent.id, chat.resource);
    if (!id) continue;
    subsessions.push({
      resource: chat.resource,
      session: {
        id,
        parentSessionId: parent.id,
        title: boundedText(chat.title, 256),
        status: sessionStatus(chat.status),
        nativeStatus: chat.status === undefined ? null : String(chat.status),
        createdAt: parent.createdAt,
        updatedAt: parent.updatedAt,
        lastMessagePreview: null,
        canSendMessage: canSendToChat(chat),
      },
    });
  }
  return subsessions;
}

function toolEventDraft(
  turnId: string,
  toolCall: ToolCallState,
  createdAt: string,
  partIndex: number,
): EventDraft {
  const completed = "success" in toolCall;
  const cancelled = !completed && toolCall.status === "cancelled";
  const waiting = !completed && !cancelled && [
    "pending-confirmation",
    "pending-result-confirmation",
    "auth-required",
  ].includes(toolCall.status);
  const state = completed || cancelled
    ? (cancelled ? "cancelled" : toolCall.success ? "succeeded" : "failed")
    : waiting
    ? "waiting"
    : toolCall.status === "running"
    ? "running"
    : "started";
  const displayName = toolCall.displayName || toolCall.toolName || "Tool";
  const completionText = completed
    ? boundedText(stringOrMarkdown(toolCall.pastTenseMessage), 65_536)
    : null;
  return {
    id: eventId([
      turnId,
      "tool",
      toolCall.toolCallId,
      completed || cancelled ? "complete" : "start",
    ]),
    type: "tool",
    text: completionText
      ?? `${displayName} ${state === "started" ? "started" : state}`,
    data: {
      toolName: displayName,
      internalToolName: toolCall.toolName,
      toolCallId: toolCall.toolCallId,
      state,
      turnId,
      partId: toolCall.toolCallId,
      partIndex,
      partKind: "tool",
      update: "snapshot",
    },
    createdAt,
    sortOrder: partIndex + 1,
  };
}

function responsePartId(
  part: TurnResponsePart,
  partIndex: number,
): string {
  if (part.kind === "markdown" || part.kind === "reasoning") return part.id;
  if (part.kind === "toolCall") return part.toolCall.toolCallId;
  if (part.kind === "inputRequest") return part.request.id;
  return `${part.kind}:${partIndex}`;
}

function responsePartEventDraft(
  turnId: string,
  part: TurnResponsePart,
  createdAt: string,
  partIndex: number,
  eventSuffix?: string,
): EventDraft | null {
  const partId = responsePartId(part, partIndex);
  const idParts = [turnId, "part", partId];
  if (eventSuffix) idParts.push(eventSuffix);

  if (part.kind === "markdown") {
    const text = boundedContent(part.content, 65_536);
    return text
      ? {
          id: eventId(idParts),
          type: "message",
          role: "assistant",
          text,
          data: {
            turnId,
            partId,
            partIndex,
            partKind: "markdown",
            update: "snapshot",
          },
          createdAt,
          sortOrder: partIndex + 1,
        }
      : null;
  }
  if (part.kind === "toolCall") {
    const draft = toolEventDraft(
      turnId,
      part.toolCall,
      createdAt,
      partIndex,
    );
    return eventSuffix ? { ...draft, id: eventId(idParts) } : draft;
  }
  if (part.kind === "systemNotification") {
    const text = boundedContent(stringOrMarkdown(part.content), 65_536);
    return text
      ? {
          id: eventId(idParts),
          type: "message",
          role: "system",
          text,
          data: {
            turnId,
            partId,
            partIndex,
            partKind: "system",
            update: "snapshot",
          },
          createdAt,
          sortOrder: partIndex + 1,
        }
      : null;
  }
  if (part.kind === "inputRequest") {
    const questions = part.request.questions ?? [];
    const answeredText = part.response === ChatInputResponseKind.Accept
      && questions.length === 1
      ? part.request.answers?.[questions[0].id]
      : undefined;
    const answer = answeredText?.state === ChatInputAnswerState.Submitted
      && answeredText.value.kind === ChatInputAnswerValueKind.Text
      ? boundedContent(answeredText.value.value, 65_536)
      : null;
    const prompt = boundedContent(
      part.request.message
        ?? questions.map((question) => question.message).join("\n"),
      65_536,
    );
    const text = answer ?? prompt;
    return text
      ? {
          id: eventId(idParts),
          type: "message",
          role: answer ? "user" : "assistant",
          text,
          data: {
            turnId,
            partId,
            partIndex,
            partKind: "request",
            update: "snapshot",
            inputRequestId: part.request.id,
          },
          createdAt,
          sortOrder: partIndex + 1,
        }
      : null;
  }
  if (part.kind === "error") {
    return {
      id: eventId(idParts),
      type: "error",
      text: boundedEventText(part.error.message),
      data: {
        turnId,
        partId,
        partIndex,
        partKind: "error",
        update: "snapshot",
        errorType: part.error.errorType,
      },
      createdAt,
      sortOrder: partIndex + 1,
    };
  }
  return null;
}

function turnEventDrafts(
  turn: Turn,
  fallbackTimestamp: string,
): EventDraft[] {
  const startedAt = validTimestamp(turn.startedAt ?? "")
    ?? validTimestamp(fallbackTimestamp)
    ?? new Date().toISOString();
  const completedAt = completionTimestamp(startedAt, turn.duration);
  const drafts: EventDraft[] = [];
  const message = boundedContent(turn.message.text, 65_536);
  if (message) {
    drafts.push({
      id: eventId([turn.id, "user"]),
      type: "message",
      role: turn.message.origin.kind === MessageKind.User ? "user" : "system",
      text: message,
      data: {
        turnId: turn.id,
        partId: "request",
        partIndex: 0,
        partKind: "request",
        update: "snapshot",
      },
      createdAt: startedAt,
      sortOrder: 0,
    });
  }

  for (const [partIndex, part] of turn.responseParts.entries()) {
    const draft = responsePartEventDraft(
      turn.id,
      part,
      completedAt,
      partIndex,
    );
    if (draft) drafts.push(draft);
  }
  return drafts;
}

export function agentHostChatHistoryToEvents(
  sessionId: string,
  state: ChatState,
): AgentSessionEvent[] {
  const drafts = state.turns.flatMap((turn) =>
    turnEventDrafts(turn, state.modifiedAt)
  );
  if (state.activeTurn) {
    const startedAt = validTimestamp(state.activeTurn.startedAt)
      ?? validTimestamp(state.modifiedAt)
      ?? new Date().toISOString();
    const message = boundedContent(state.activeTurn.message.text, 65_536);
    if (message) {
      drafts.push({
        id: eventId([state.activeTurn.id, "user"]),
        type: "message",
        role: state.activeTurn.message.origin.kind === MessageKind.User
          ? "user"
          : "system",
        text: message,
        data: {
          turnId: state.activeTurn.id,
          partId: "request",
          partIndex: 0,
          partKind: "request",
          update: "snapshot",
        },
        createdAt: startedAt,
        sortOrder: 0,
      });
    }
    for (
      const [partIndex, part] of state.activeTurn.responseParts.entries()
    ) {
      const draft = responsePartEventDraft(
        state.activeTurn.id,
        part,
        state.modifiedAt,
        partIndex,
      );
      if (draft) drafts.push(draft);
    }
  }

  drafts.sort((left, right) => {
    const timestampDifference =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return timestampDifference || left.sortOrder - right.sortOrder
      || left.id.localeCompare(right.id);
  });

  let previousSequence = 0;
  return drafts.map(({ sortOrder: _sortOrder, ...draft }) => {
    const sequence = sequenceFor(draft.createdAt, previousSequence);
    previousSequence = sequence;
    return {
      ...draft,
      sessionId,
      sequence,
    };
  });
}

export function createAgentHostMessageAction(
  state: Pick<ChatState, "activeTurn">,
  message: string,
  id = randomUUID(),
  startedAt = new Date().toISOString(),
): ChatAction {
  const openInputRequests = state.activeTurn?.responseParts.filter(
    (part): part is Extract<
      TurnResponsePart,
      { kind: ResponsePartKind.InputRequest }
    > =>
      part.kind === ResponsePartKind.InputRequest
      && part.response === undefined,
  ) ?? [];
  if (openInputRequests.length > 0) {
    if (openInputRequests.length !== 1) {
      throw new Error(
        "Agent Host session has multiple open input requests.",
      );
    }
    const request = openInputRequests[0].request;
    const questions = request.questions ?? [];
    if (
      questions.length !== 1
      || questions[0].kind !== ChatInputQuestionKind.Text
    ) {
      throw new Error(
        "Agent Host session requires structured input that cannot be answered with a follow-up message.",
      );
    }
    const question = questions[0];
    if (
      (question.min !== undefined && message.length < question.min)
      || (question.max !== undefined && message.length > question.max)
    ) {
      throw new Error(
        "Follow-up message does not satisfy the Agent Host input requirements.",
      );
    }
    return {
      type: ActionType.ChatInputCompleted,
      requestId: request.id,
      response: ChatInputResponseKind.Accept,
      answers: {
        [question.id]: {
          state: ChatInputAnswerState.Submitted,
          value: {
            kind: ChatInputAnswerValueKind.Text,
            value: message,
          },
        },
      },
    };
  }
  const userMessage = {
    text: message,
    origin: { kind: MessageKind.User },
  };
  if (state.activeTurn) {
    return {
      type: ActionType.ChatPendingMessageSet,
      kind: PendingMessageKind.Queued,
      id,
      message: userMessage,
    };
  }
  return {
    type: ActionType.ChatTurnStarted,
    turnId: id,
    startedAt,
    message: userMessage,
  };
}

function parseEndpointEntry(raw: unknown): AgentHostEndpointMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (
    entry.schemaVersion !== REGISTRY_SCHEMA_VERSION
    || (entry.type !== "editor" && entry.type !== "standalone")
    || !Number.isSafeInteger(entry.pid)
    || (entry.pid as number) <= 0
    || typeof entry.instanceId !== "string"
    || !entry.instanceId
    || typeof entry.protocolVersion !== "string"
    || !isSupportedProtocolVersion(entry.protocolVersion)
    || typeof entry.connectionToken !== "string"
    || !entry.connectionToken
    || !entry.endpoint
    || typeof entry.endpoint !== "object"
  ) {
    return null;
  }

  const endpoint = entry.endpoint as Record<string, unknown>;
  let parsedEndpoint: AgentHostEndpointAddress;
  if (
    endpoint.type === "socket"
    && typeof endpoint.path === "string"
    && endpoint.path
  ) {
    parsedEndpoint = { type: "socket", path: endpoint.path };
  } else if (
    endpoint.type === "tcp"
    && typeof endpoint.host === "string"
    && ["localhost", "127.0.0.1", "::1"].includes(
      endpoint.host.toLowerCase(),
    )
    && Number.isSafeInteger(endpoint.port)
    && (endpoint.port as number) > 0
    && (endpoint.port as number) <= 65_535
  ) {
    parsedEndpoint = {
      type: "tcp",
      host: endpoint.host,
      port: endpoint.port as number,
    };
  } else {
    return null;
  }

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    type: entry.type,
    pid: entry.pid as number,
    instanceId: entry.instanceId,
    protocolVersion: entry.protocolVersion,
    connectionToken: entry.connectionToken,
    endpoint: parsedEndpoint,
    ...(typeof entry.quality === "string"
      ? { quality: entry.quality }
      : {}),
    ...(typeof entry.tunnelName === "string"
      ? { tunnelName: entry.tunnelName }
      : {}),
  };
}

function endpointKey(entry: AgentHostEndpointMetadata): string {
  return `${entry.type}:${entry.pid}:${entry.instanceId}`;
}

function endpointFileName(entry: AgentHostEndpointMetadata): string {
  const input = `${entry.type}\0${entry.pid}\0${entry.instanceId}`;
  return `${createHash("sha256").update(input).digest("hex")}.json`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function resolveVsCodeUserDataDirectory(
  explicit?: string,
  environment: NodeJS.ProcessEnv = process.env,
  currentPlatform: NodeJS.Platform = process.platform,
  homeDirectory = homedir(),
): string {
  if (explicit) return explicit;
  if (environment.VSCODE_PORTABLE) {
    return join(environment.VSCODE_PORTABLE, "user-data");
  }
  if (environment.VSCODE_APPDATA) {
    return join(environment.VSCODE_APPDATA, "Code");
  }
  if (currentPlatform === "win32") {
    const appData = environment.APPDATA
      ?? join(environment.USERPROFILE ?? homeDirectory, "AppData", "Roaming");
    return join(appData, "Code");
  }
  if (currentPlatform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "Code");
  }
  if (currentPlatform === "linux") {
    return join(environment.XDG_CONFIG_HOME ?? join(homeDirectory, ".config"), "Code");
  }
  throw new Error(`VS Code Agent Host discovery is unsupported on ${currentPlatform}.`);
}

export async function discoverAgentHostEndpoints(
  userDataDirectory: string,
  log: (message: string) => void = () => {},
): Promise<AgentHostEndpointMetadata[]> {
  const registryDirectory = join(
    userDataDirectory,
    "agent-host",
    "local-endpoint",
  );
  const entriesDirectory = join(registryDirectory, "entries");
  const discovered: AgentHostEndpointMetadata[] = [];

  try {
    const legacy = await readJson(join(registryDirectory, "metadata.json"));
    if (Array.isArray(legacy)) {
      for (const raw of legacy) {
        const parsed = parseEndpointEntry(raw);
        if (parsed) discovered.push(parsed);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log(`Could not read the legacy Agent Host registry: ${errorMessage(error)}`);
    }
  }

  try {
    const files = await readdir(entriesDirectory, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const parsed = parseEndpointEntry(
          await readJson(join(entriesDirectory, file.name)),
        );
        if (!parsed) {
          log(`Ignored malformed Agent Host endpoint entry ${file.name}.`);
          continue;
        }
        if (file.name !== endpointFileName(parsed)) {
          log(`Ignored misnamed Agent Host endpoint entry ${file.name}.`);
          continue;
        }
        discovered.push(parsed);
      } catch (error) {
        log(
          `Could not read Agent Host endpoint entry ${file.name}: ${
            errorMessage(error)
          }`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log(`Could not enumerate Agent Host endpoints: ${errorMessage(error)}`);
    }
  }

  const live = new Map<string, AgentHostEndpointMetadata>();
  for (const entry of discovered) {
    if (processIsAlive(entry.pid)) live.set(endpointKey(entry), entry);
  }
  return [...live.values()];
}

class AgentHostWebSocketTransport implements AhpTransport {
  private readonly inbox: TransportFrame[] = [];
  private readonly waiters: PendingRead[] = [];
  private closed = false;
  private error: TransportError | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        this.deliver({
          kind: "binary",
          data: new Uint8Array(raw as Buffer),
        });
      } else {
        this.deliver({ kind: "text", text: raw.toString() });
      }
    });
    socket.on("error", (error) => {
      this.error = new TransportError(
        "io",
        `Agent Host WebSocket error: ${errorMessage(error)}`,
        { cause: error },
      );
      this.drainWithError(this.error);
    });
    socket.on("close", (code) => {
      this.closed = true;
      if (code === 1_000 || code === 1_005) {
        this.drainWithNull();
        return;
      }
      this.error = new TransportError(
        "closed",
        `Agent Host WebSocket closed with code ${code}.`,
      );
      this.drainWithError(this.error);
    });
  }

  static connect(
    entry: AgentHostEndpointMetadata,
  ): Promise<AgentHostWebSocketTransport> {
    return new Promise((resolve, reject) => {
      const token = encodeURIComponent(entry.connectionToken);
      const address = entry.endpoint.type === "socket"
        ? `ws://localhost/?tkn=${token}`
        : `ws://${
          entry.endpoint.host.includes(":")
            ? `[${entry.endpoint.host}]`
            : entry.endpoint.host
        }:${entry.endpoint.port}/?tkn=${token}`;
      const endpoint = entry.endpoint;
      const options = endpoint.type === "socket"
        ? { createConnection: () => createConnection(endpoint.path) }
        : {};
      const socket = new WebSocket(address, options);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.close();
        reject(new TransportError("io", "Agent Host connection timed out."));
      }, AHP_CONNECT_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("open", onOpen);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.off("unexpected-response", onUnexpectedResponse);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(new AgentHostWebSocketTransport(socket));
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.on("error", () => {});
        reject(
          new TransportError(
            "io",
            `Agent Host connection failed: ${errorMessage(error)}`,
            { cause: error },
          ),
        );
      };
      const onClose = (code: number) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new TransportError(
            "closed",
            `Agent Host connection closed before initialization (${code}).`,
          ),
        );
      };
      const onUnexpectedResponse = (
        _request: unknown,
        response: { statusCode?: number },
      ) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.on("error", () => {});
        reject(
          new TransportError(
            "io",
            `Agent Host rejected the WebSocket upgrade (${
              response.statusCode ?? "unknown status"
            }).`,
          ),
        );
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.once("unexpected-response", onUnexpectedResponse);
    });
  }

  send(message: JsonRpcMessage | string): void {
    if (this.closed) throw new TransportError("closed", "Transport is closed.");
    if (this.error) throw this.error;
    this.socket.send(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }

  recv(): Promise<TransportFrame | null> {
    if (this.error) return Promise.reject(this.error);
    const frame = this.inbox.shift();
    if (frame) return Promise.resolve(frame);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  close(): void {
    if (
      this.socket.readyState === WebSocket.OPEN
      || this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }

  private deliver(frame: TransportFrame): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(frame);
    else this.inbox.push(frame);
  }

  private drainWithError(error: Error): void {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private drainWithNull(): void {
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
  }
}

class AgentHostConnection {
  private readonly client: AhpClient;
  private readonly clientId: string;
  private readonly rootSubscription: Subscription;
  private readonly sessionChannels = new Map<
    string,
    Promise<TrackedSession>
  >();
  private readonly chatChannels = new Map<string, Promise<TrackedChat>>();
  private readonly lastSequence = new Map<string, number>();
  private catalogByResource = new Map<string, SessionSummary>();
  private rootEventsDuringRefresh: SubscriptionEvent[] | null = null;
  private nextClientSequence = 1;
  private closed = false;

  private constructor(
    readonly entry: AgentHostEndpointMetadata,
    client: AhpClient,
    clientId: string,
    rootSubscription: Subscription,
    private readonly callbacks: ConnectionCallbacks,
    private readonly log: (message: string) => void,
  ) {
    this.client = client;
    this.clientId = clientId;
    this.rootSubscription = rootSubscription;
  }

  static async open(
    entry: AgentHostEndpointMetadata,
    callbacks: ConnectionCallbacks,
    log: (message: string) => void,
  ): Promise<AgentHostConnection> {
    const transport = await AgentHostWebSocketTransport.connect(entry);
    const client = new AhpClient(transport, {
      requestTimeoutMs: AHP_REQUEST_TIMEOUT_MS,
      subscriptionBuffer: 4_096,
    });
    client.connect();
    const rootSubscription = client.attachSubscription(ROOT_CHANNEL);
    const clientId = `silvermoon-connector-${randomUUID()}`;
    try {
      await client.initialize({
        clientId,
        protocolVersions: [entry.protocolVersion],
        initialSubscriptions: [ROOT_CHANNEL],
      });
    } catch (error) {
      await client.shutdown();
      throw error;
    }
    const connection = new AgentHostConnection(
      entry,
      client,
      clientId,
      rootSubscription,
      callbacks,
      log,
    );
    await connection.refreshCatalog(false);
    void connection.consumeRoot();
    return connection;
  }

  get key(): string {
    return endpointKey(this.entry);
  }

  get catalog(): ReadonlyMap<string, SessionSummary> {
    return this.catalogByResource;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async refreshCatalog(notify = true): Promise<void> {
    const bufferedEvents: SubscriptionEvent[] = [];
    this.rootEventsDuringRefresh = bufferedEvents;
    const sessions: SessionSummary[] = [];
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
        const result = await this.client.request("listSessions", {
          channel: ROOT_CHANNEL,
          limit: 500,
          ...(cursor ? { cursor } : {}),
        });
        sessions.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
        if (page === MAX_HISTORY_PAGES - 1) {
          throw new Error(
            "Agent Host session catalog exceeded the page limit.",
          );
        }
      }
      this.catalogByResource = new Map(
        sessions.map((summary) => [summary.resource, summary]),
      );
      for (const event of bufferedEvents) this.applyRootEvent(event, false);
    } finally {
      if (this.rootEventsDuringRefresh === bufferedEvents) {
        this.rootEventsDuringRefresh = null;
      }
    }
    if (notify) this.callbacks.onCatalogChanged(this);
  }

  async sendMessage(
    sessionId: string,
    resource: string,
    message: string,
    selectedChatResource?: string,
  ): Promise<void> {
    const session = await this.ensureSession(resource);
    const chatResource = selectedChatResource
      ?? session.state.defaultChat
      ?? session.state.chats.at(0)?.resource;
    if (!chatResource) {
      throw new Error(`Agent Host session has no writable chat: ${sessionId}`);
    }
    const chat = await this.ensureChat(sessionId, chatResource);
    await this.dispatchChatAction(
      chat,
      createAgentHostMessageAction(chat.state, message),
    );
  }

  async loadSessionHistory(
    sessionId: string,
    resource: string,
    selectedChatResource?: string,
  ): Promise<AgentSessionEvent[]> {
    const session = await this.ensureSession(resource);
    const chatResource = selectedChatResource
      ?? session.state.defaultChat
      ?? session.state.chats.at(0)?.resource;
    if (!chatResource) return [];
    const chat = await this.ensureChat(sessionId, chatResource);
    await this.loadAllTurns(chat);
    const events = agentHostChatHistoryToEvents(sessionId, chat.state);
    const last = events.at(-1)?.sequence;
    if (last !== undefined) {
      this.lastSequence.set(
        sessionId,
        Math.max(this.lastSequence.get(sessionId) ?? 0, last),
      );
    }
    return events;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.rootSubscription.close();
    await this.client.shutdown();
  }

  private async consumeRoot(): Promise<void> {
    try {
      for await (const event of this.rootSubscription) {
        this.rootEventsDuringRefresh?.push(event);
        this.applyRootEvent(event, true);
      }
      if (!this.closed) this.callbacks.onClosed(this);
    } catch (error) {
      if (!this.closed) {
        this.callbacks.onClosed(
          this,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }

  private applyRootEvent(
    event: SubscriptionEvent,
    notify: boolean,
  ): void {
    if (event.type === "sessionAdded") {
      this.catalogByResource.set(
        event.params.summary.resource,
        event.params.summary,
      );
    } else if (event.type === "sessionRemoved") {
      this.catalogByResource.delete(event.params.session);
    } else if (event.type === "sessionSummaryChanged") {
      const current = this.catalogByResource.get(event.params.session);
      if (!current) return;
      this.catalogByResource.set(event.params.session, {
        ...current,
        ...event.params.changes,
        resource: current.resource,
        provider: current.provider,
        createdAt: current.createdAt,
      });
    } else {
      return;
    }
    if (notify) this.callbacks.onCatalogChanged(this);
  }

  private ensureSession(resource: string): Promise<TrackedSession> {
    const existing = this.sessionChannels.get(resource);
    if (existing) return existing;
    const pending = this.openSession(resource).catch((error) => {
      this.sessionChannels.delete(resource);
      throw error;
    });
    this.sessionChannels.set(resource, pending);
    return pending;
  }

  private async openSession(resource: string): Promise<TrackedSession> {
    const { result, subscription } = await this.client.subscribe(resource);
    if (!result.snapshot) {
      await subscription.close();
      throw new Error(`Agent Host returned no session snapshot for ${resource}.`);
    }
    const tracked: TrackedSession = {
      resource,
      state: result.snapshot.state as SessionState,
      subscription,
    };
    void this.consumeSession(tracked);
    return tracked;
  }

  private async consumeSession(tracked: TrackedSession): Promise<void> {
    try {
      for await (const event of tracked.subscription) {
        if (event.type !== "action") continue;
        if (!event.params.action.type.startsWith("session/")) continue;
        tracked.state = sessionReducer(
          tracked.state,
          event.params.action as SessionAction,
          (message) => this.log(`Agent Host session reducer: ${message}`),
        );
      }
    } catch (error) {
      if (!this.closed) {
        this.log(
          `Agent Host session subscription failed: ${errorMessage(error)}`,
        );
      }
    }
  }

  private ensureChat(
    sessionId: string,
    resource: string,
  ): Promise<TrackedChat> {
    const existing = this.chatChannels.get(resource);
    if (existing) return existing;
    const pending = this.openChat(sessionId, resource).catch((error) => {
      this.chatChannels.delete(resource);
      throw error;
    });
    this.chatChannels.set(resource, pending);
    return pending;
  }

  private async openChat(
    sessionId: string,
    resource: string,
  ): Promise<TrackedChat> {
    const { result, subscription } = await this.client.subscribe(resource);
    if (!result.snapshot) {
      await subscription.close();
      throw new Error(`Agent Host returned no chat snapshot for ${resource}.`);
    }
    const tracked: TrackedChat = {
      resource,
      sessionId,
      state: result.snapshot.state as ChatState,
      subscription,
      waiters: new Set(),
      dispatches: new AgentHostDispatchAcknowledger(),
    };
    void this.consumeChat(tracked);
    return tracked;
  }

  private async consumeChat(tracked: TrackedChat): Promise<void> {
    try {
      for await (const event of tracked.subscription) {
        if (event.type !== "action") continue;
        if (!event.params.action.type.startsWith("chat/")) continue;
        this.settleDispatch(tracked, event);
        if (event.params.rejectionReason) continue;
        tracked.state = chatReducer(
          tracked.state,
          event.params.action as ChatAction,
          (message) => this.log(`Agent Host chat reducer: ${message}`),
        );
        const waiters = [...tracked.waiters];
        tracked.waiters.clear();
        for (const waiter of waiters) waiter();
        this.publishChatAction(tracked, event);
      }
    } catch (error) {
      if (!this.closed) {
        this.log(`Agent Host chat subscription failed: ${errorMessage(error)}`);
      }
      tracked.dispatches.rejectAll(errorMessage(error));
      return;
    }
    tracked.dispatches.rejectAll("chat subscription closed");
  }

  private dispatchChatAction(
    tracked: TrackedChat,
    action: ChatAction,
  ): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Agent Host connection is closed."));
    }
    const clientSequence = this.nextClientSequence++;
    const acknowledgement = tracked.dispatches.wait(
      clientSequence,
      action.type,
    );
    try {
      this.client.dispatch(tracked.resource, action, clientSequence);
    } catch (error) {
      tracked.dispatches.reject(
        clientSequence,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return acknowledgement;
  }

  private settleDispatch(
    tracked: TrackedChat,
    event: Extract<SubscriptionEvent, { type: "action" }>,
  ): void {
    const origin = event.params.origin;
    if (!origin || origin.clientId !== this.clientId) return;
    tracked.dispatches.settle(
      origin.clientSeq,
      event.params.action.type,
      event.params.rejectionReason,
    );
  }

  private async loadAllTurns(chat: TrackedChat): Promise<void> {
    for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
      const cursor = chat.state.turnsNextCursor;
      if (!cursor) return;
      await this.client.request("fetchTurns", {
        channel: chat.resource,
        cursor,
      });
      if (chat.state.turnsNextCursor === cursor) {
        await this.waitForHistoryCursor(chat, cursor);
      }
      if (chat.state.turnsNextCursor === cursor) {
        throw new Error("Agent Host history cursor did not advance.");
      }
    }
    throw new Error("Agent Host history exceeded the page limit.");
  }

  private waitForHistoryCursor(
    chat: TrackedChat,
    cursor: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chat.waiters.delete(onChange);
        reject(new Error("Timed out waiting for Agent Host history."));
      }, AHP_REQUEST_TIMEOUT_MS);
      const onChange = () => {
        if (chat.state.turnsNextCursor === cursor) {
          chat.waiters.add(onChange);
          return;
        }
        clearTimeout(timeout);
        resolve();
      };
      onChange();
    });
  }

  private publishChatAction(
    tracked: TrackedChat,
    event: Extract<SubscriptionEvent, { type: "action" }>,
  ): void {
    const action = event.params.action;
    if (action.type === ActionType.ChatTurnStarted) {
      const text = boundedContent(action.message.text, 65_536);
      if (!text) return;
      this.publishEvent(tracked.sessionId, {
        id: eventId([action.turnId, "user"]),
        type: "message",
        role: action.message.origin.kind === MessageKind.User
          ? "user"
          : "system",
        text,
        data: {
          turnId: action.turnId,
          partId: "request",
          partIndex: 0,
          partKind: "request",
          update: "snapshot",
        },
        createdAt: validTimestamp(action.startedAt)
          ?? new Date().toISOString(),
        sortOrder: 0,
      });
      return;
    }
    if (
      action.type === ActionType.ChatInputRequested
      || action.type === ActionType.ChatInputAnswerChanged
      || action.type === ActionType.ChatInputCompleted
    ) {
      const turn = tracked.state.activeTurn;
      if (!turn) return;
      const requestId = action.type === ActionType.ChatInputRequested
        ? action.request.id
        : action.requestId;
      const partIndex = turn.responseParts.findIndex(
        (part) =>
          part.kind === ResponsePartKind.InputRequest
          && part.request.id === requestId,
      );
      if (partIndex < 0) return;
      const draft = responsePartEventDraft(
        turn.id,
        turn.responseParts[partIndex],
        new Date().toISOString(),
        partIndex,
        `update:${event.params.serverSeq}`,
      );
      if (draft) this.publishEvent(tracked.sessionId, draft);
      return;
    }
    if (
      action.type === ActionType.ChatResponsePart
      || action.type === ActionType.ChatDelta
      || action.type === ActionType.ChatReasoning
    ) {
      const turn = tracked.state.activeTurn;
      if (!turn || turn.id !== action.turnId) return;
      const partId = action.type === ActionType.ChatResponsePart
        ? responsePartId(action.part, turn.responseParts.length - 1)
        : action.partId;
      const partIndex = turn.responseParts.findIndex(
        (part, index) => responsePartId(part, index) === partId,
      );
      if (partIndex < 0) return;
      const draft = responsePartEventDraft(
        action.turnId,
        turn.responseParts[partIndex],
        new Date().toISOString(),
        partIndex,
        `update:${event.params.serverSeq}`,
      );
      if (draft) this.publishEvent(tracked.sessionId, draft);
      return;
    }
    if (action.type === ActionType.ChatToolCallStart) {
      const turn = tracked.state.activeTurn;
      const partIndex = turn?.responseParts.findIndex(
        (part) =>
          part.kind === "toolCall"
          && part.toolCall.toolCallId === action.toolCallId,
      ) ?? -1;
      const toolCall = this.findToolCall(
        tracked.state,
        action.turnId,
        action.toolCallId,
      );
      if (toolCall) {
        this.publishEvent(
          tracked.sessionId,
          toolEventDraft(
            action.turnId,
            toolCall,
            new Date().toISOString(),
            Math.max(0, partIndex),
          ),
        );
      }
      return;
    }
    if (action.type === ActionType.ChatToolCallComplete) {
      const toolCall = this.findToolCall(
        tracked.state,
        action.turnId,
        action.toolCallId,
      );
      if (toolCall) {
        const turn = tracked.state.activeTurn?.id === action.turnId
          ? tracked.state.activeTurn
          : tracked.state.turns.find((item) => item.id === action.turnId);
        const partIndex = turn?.responseParts.findIndex(
          (part) =>
            part.kind === "toolCall"
            && part.toolCall.toolCallId === action.toolCallId,
        ) ?? -1;
        this.publishEvent(
          tracked.sessionId,
          toolEventDraft(
            action.turnId,
            toolCall,
            new Date().toISOString(),
            Math.max(0, partIndex),
          ),
        );
      }
      return;
    }
    if (
      action.type === ActionType.ChatTurnComplete
      || action.type === ActionType.ChatTurnCancelled
      || action.type === ActionType.ChatError
    ) {
      const turn = tracked.state.turns.find(
        (item) => item.id === action.turnId,
      );
      if (turn) {
        for (const draft of turnEventDrafts(turn, tracked.state.modifiedAt)) {
          this.publishEvent(tracked.sessionId, draft);
        }
      } else if (action.type === ActionType.ChatError) {
        this.publishEvent(tracked.sessionId, {
          id: eventId([action.turnId, "error"]),
          type: "error",
          text: boundedEventText(action.part.error.message),
          data: { errorType: action.part.error.errorType },
          createdAt: new Date().toISOString(),
          sortOrder: 0,
        });
      }
      return;
    }
    if (
      action.type === ActionType.ChatActivityChanged
      && action.activity
    ) {
      const activeTurn = tracked.state.activeTurn;
      const partId = `activity:${event.params.serverSeq}`;
      this.publishEvent(tracked.sessionId, {
        id: eventId([
          this.entry.instanceId,
          "activity",
          String(event.params.serverSeq),
        ]),
        type: "activity",
        text: boundedEventText(action.activity),
        ...(activeTurn
          ? {
              data: {
                turnId: activeTurn.id,
                partId,
                partIndex: activeTurn.responseParts.length,
                partKind: "activity" as const,
                update: "snapshot" as const,
              },
            }
          : {}),
        createdAt: new Date().toISOString(),
        sortOrder: 0,
      });
    }
  }

  private findToolCall(
    state: ChatState,
    turnId: string,
    toolCallId: string,
  ): ToolCallState | null {
    const turn = state.activeTurn?.id === turnId
      ? state.activeTurn
      : state.turns.find((item) => item.id === turnId);
    const part = turn?.responseParts.find(
      (item) =>
        item.kind === "toolCall" && item.toolCall.toolCallId === toolCallId,
    );
    return part?.kind === "toolCall" ? part.toolCall : null;
  }

  private publishEvent(sessionId: string, draft: EventDraft): void {
    const previous = this.lastSequence.get(sessionId) ?? 0;
    const sequence = sequenceFor(draft.createdAt, previous);
    this.lastSequence.set(sessionId, sequence);
    const { sortOrder: _sortOrder, ...event } = draft;
    this.callbacks.onEvent(this, {
      type: "session.event",
      event: {
        ...event,
        sessionId,
        sequence,
      },
    });
  }
}

export class VsCodeAgentHostProvider implements AgentHostSessionProvider {
  private readonly listeners = new Set<
    (event: AgentAdapterEvent) => void
  >();
  private readonly connections = new Map<string, AgentHostConnection>();
  private readonly sessions = new Map<string, HostedSessionBinding>();
  private readonly userDataDirectory: string;
  private readonly refreshIntervalMs: number;
  private readonly log: (message: string) => void;
  private refreshPromise: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private closed = false;

  constructor(options: VsCodeAgentHostProviderOptions = {}) {
    this.userDataDirectory = resolveVsCodeUserDataDirectory(
      options.userDataDirectory,
    );
    this.refreshIntervalMs = options.refreshIntervalMs
      ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.log = options.log ?? ((message) => console.error(message));
  }

  async listSessions(): Promise<AgentSession[]> {
    await this.refresh(this.initialized);
    this.initialized = true;
    this.startRefreshTimer();
    return [...this.sessions.values()]
      .map((binding) => binding.session)
      .sort((left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      );
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async sendMessage(input: {
    sessionId: string;
    message: string;
  }): Promise<void> {
    const binding = await this.requireSession(input.sessionId);
    if (binding.session.canSendMessage === false) {
      throw new Error(`VS Code Agent Host session is read-only: ${input.sessionId}`);
    }
    await binding.connection.sendMessage(
      input.sessionId,
      binding.resource,
      input.message,
      binding.chatResource,
    );
  }

  async loadSessionHistory(
    sessionId: string,
  ): Promise<AgentSessionEvent[]> {
    const binding = await this.requireSession(sessionId);
    return binding.connection.loadSessionHistory(
      sessionId,
      binding.resource,
      binding.chatResource,
    );
  }

  subscribe(listener: (event: AgentAdapterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.sessions.clear();
    await Promise.all(connections.map((connection) => connection.close()));
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer || this.refreshIntervalMs <= 0) return;
    this.refreshTimer = setInterval(() => {
      void this.refresh(true).catch((error: unknown) => {
        this.log(`Agent Host refresh failed: ${errorMessage(error)}`);
      });
    }, this.refreshIntervalMs);
    this.refreshTimer.unref();
  }

  private async requireSession(
    sessionId: string,
  ): Promise<HostedSessionBinding> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    await this.refresh(true);
    const refreshed = this.sessions.get(sessionId);
    if (!refreshed) {
      throw new Error(`VS Code Agent Host session not found: ${sessionId}`);
    }
    return refreshed;
  }

  private async refresh(emitChanges: boolean): Promise<void> {
    if (this.closed) return;
    if (this.refreshPromise) {
      await this.refreshPromise;
      if (emitChanges) this.rebuildSessions(true);
      return;
    }
    this.refreshPromise = this.refreshConnections(emitChanges);
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshConnections(emitChanges: boolean): Promise<void> {
    const endpoints = await discoverAgentHostEndpoints(
      this.userDataDirectory,
      this.log,
    );
    const desired = new Map(
      endpoints.map((entry) => [endpointKey(entry), entry]),
    );
    for (const [key, connection] of this.connections) {
      if (desired.has(key) && !connection.isClosed) continue;
      this.connections.delete(key);
      await connection.close();
    }

    const callbacks: ConnectionCallbacks = {
      onCatalogChanged: () => this.rebuildSessions(true),
      onEvent: (connection, event) => {
        if (event.type === "session.event") {
          const binding = this.sessions.get(event.event.sessionId);
          if (binding?.connection !== connection) return;
        }
        this.emit(event);
      },
      onClosed: (connection, error) => {
        if (this.connections.get(connection.key) !== connection) return;
        this.connections.delete(connection.key);
        if (error) {
          this.log(
            `Agent Host connection for PID ${connection.entry.pid} closed: ${
              errorMessage(error)
            }`,
          );
        }
        this.rebuildSessions(true);
        void connection.close().catch((closeError: unknown) => {
          this.log(
            `Could not close Agent Host PID ${connection.entry.pid}: ${
              errorMessage(closeError)
            }`,
          );
        });
      },
    };

    await Promise.all(
      endpoints.map(async (entry) => {
        const key = endpointKey(entry);
        const existing = this.connections.get(key);
        if (existing) {
          try {
            await existing.refreshCatalog(false);
          } catch (error) {
            this.log(
              `Could not refresh Agent Host PID ${entry.pid}: ${
                errorMessage(error)
              }`,
            );
            this.connections.delete(key);
            await existing.close();
          }
          return;
        }
        try {
          const connection = await AgentHostConnection.open(
            entry,
            callbacks,
            this.log,
          );
          if (this.closed) {
            await connection.close();
            return;
          }
          this.connections.set(key, connection);
        } catch (error) {
          this.log(
            `Could not connect to Agent Host PID ${entry.pid} (AHP ${
              entry.protocolVersion
            }): ${errorMessage(error)}`,
          );
        }
      }),
    );
    this.rebuildSessions(emitChanges);
  }

  private rebuildSessions(emitChanges: boolean): void {
    const next = new Map<string, HostedSessionBinding>();
    for (const connection of this.connections.values()) {
      for (const summary of connection.catalog.values()) {
        if (
          summary.provider !== COPILOT_PROVIDER
        ) {
          continue;
        }
        const session = agentHostSummaryToSession(summary);
        if (!session) {
          this.log(
            `Ignored invalid Agent Host session summary from PID ${
              connection.entry.pid
            }.`,
          );
          continue;
        }
        const candidates: HostedSessionBinding[] = [{
          connection,
          resource: summary.resource,
          summary,
          session,
        }];
        for (
          const subsession of agentHostSummaryToSubsessions(summary, session)
        ) {
          candidates.push({
            connection,
            resource: summary.resource,
            chatResource: subsession.resource,
            summary,
            session: subsession.session,
          });
        }
        for (const candidate of candidates) {
          const current = next.get(candidate.session.id);
          next.set(
            candidate.session.id,
            current ? preferredBinding(current, candidate) : candidate,
          );
        }
      }
    }

    if (emitChanges) {
      for (const [sessionId, binding] of next) {
        const previous = this.sessions.get(sessionId);
        if (!previous || !sameSession(previous.session, binding.session)) {
          this.emit({ type: "session.updated", session: binding.session });
        }
      }
      const now = new Date().toISOString();
      const activeConnections = new Set(this.connections.values());
      for (const [sessionId, binding] of this.sessions) {
        if (next.has(sessionId)) continue;
        if (
          isArchivedStatus(binding.summary.status)
          && activeConnections.has(binding.connection)
        ) {
          next.set(sessionId, binding);
          continue;
        }
        this.emit({
          type: "session.updated",
          session: {
            ...binding.session,
            status: "gone",
            updatedAt: now,
          },
        });
      }
    }

    this.sessions.clear();
    for (const [sessionId, binding] of next) {
      this.sessions.set(sessionId, binding);
    }
  }

  private emit(event: AgentAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
