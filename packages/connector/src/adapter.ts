import type {
  AgentDescriptor,
  AgentSession,
  AgentSessionEvent,
  ConnectorCapabilities,
} from "@silvermoon-relay/protocol";

export type AgentAdapterEvent =
  | { type: "session.updated"; session: AgentSession }
  | { type: "session.event"; event: AgentSessionEvent };

export interface AgentAdapter {
  readonly agent: AgentDescriptor;
  readonly capabilities: ConnectorCapabilities;
  listSessions(): Promise<AgentSession[]>;
  createSession(input: {
    prompt: string;
    title?: string;
  }): Promise<AgentSession>;
  sendMessage(input: {
    sessionId: string;
    message: string;
  }): Promise<void>;
  loadSessionHistory(sessionId: string): Promise<AgentSessionEvent[]>;
  subscribe(listener: (event: AgentAdapterEvent) => void): () => void;
  close?(): Promise<void> | void;
}
