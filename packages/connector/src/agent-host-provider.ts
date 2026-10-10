import type {
  AgentSession,
  AgentSessionEvent,
} from "@silvermoon-ai/protocol";
import type { AgentAdapterEvent } from "./adapter.js";

export interface AgentHostSessionProvider {
  listSessions(): Promise<AgentSession[]>;
  hasSession(sessionId: string): boolean;
  sendMessage(input: {
    sessionId: string;
    message: string;
  }): Promise<void>;
  loadSessionHistory(sessionId: string): Promise<AgentSessionEvent[]>;
  subscribe(listener: (event: AgentAdapterEvent) => void): () => void;
  close(): Promise<void> | void;
}
