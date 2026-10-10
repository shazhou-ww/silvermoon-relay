import { describe, expect, it } from "vitest";
import {
  agentSessionEventSchema,
  connectorCapabilitiesSchema,
  connectorCommandSchema,
  connectorIdSchema,
  PROTOCOL_VERSION,
} from "./index";

describe("relay protocol", () => {
  it("accepts connector identities and complete capability sets", () => {
    expect(connectorIdSchema.parse("studio-laptop")).toBe("studio-laptop");
    expect(connectorCapabilitiesSchema.parse({
      listSessions: true,
      createSession: true,
      sendMessage: true,
      streamEvents: true,
    })).toEqual({
      listSessions: true,
      createSession: true,
      sendMessage: true,
      streamEvents: true,
    });
  });

  it("validates session commands and rejects blank prompts", () => {
    expect(
      connectorCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: "Inspect the failing build",
      }).success,
    ).toBe(true);
    expect(
      connectorCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: " ",
      }).success,
    ).toBe(false);
  });

  it("validates session activity observations", () => {
    expect(
      agentSessionEventSchema.safeParse({
        id: "event-1",
        sessionId: "session-1",
        sequence: 1,
        type: "message",
        role: "assistant",
        text: "Work is complete.",
        createdAt: "2026-10-10T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects unsupported versions and invalid connector identities", () => {
    expect(
      connectorCommandSchema.safeParse({
        type: "sessions.list",
        protocolVersion: 1,
        commandId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(connectorIdSchema.safeParse("../connector").success).toBe(false);
  });
});
