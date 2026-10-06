import { describe, expect, it } from "vitest";
import { parseRelayMessage, PROTOCOL_VERSION, relayMessageSchema } from "./index";

describe("relay protocol", () => {
  it("accepts a versioned daemon ready message", () => {
    expect(
      parseRelayMessage({
        type: "ready",
        protocolVersion: PROTOCOL_VERSION,
        daemonId: "daemon-01",
      }),
    ).toEqual({
      type: "ready",
      protocolVersion: 1,
      daemonId: "daemon-01",
    });
  });

  it("rejects unsupported versions and invalid daemon identities", () => {
    expect(
      relayMessageSchema.safeParse({
        type: "ready",
        protocolVersion: 2,
        daemonId: "../daemon",
      }).success,
    ).toBe(false);
  });
});
