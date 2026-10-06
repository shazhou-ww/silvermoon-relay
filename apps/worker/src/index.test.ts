import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const validToken = "test-token-with-production-like-entropy";

describe("relay worker", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        access_token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS daemons (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        display_name TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, id)
      )`,
    ).run();

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(validToken),
    );
    const tokenHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, access_token_hash) VALUES (?1, ?2)",
    )
      .bind("user-01", tokenHash)
      .run();
  });

  it("reports its health without authentication", async () => {
    const response = await SELF.fetch("https://relay.silvermoon.work/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "silvermoon-relay",
      status: "ok",
    });
  });

  it("requires a WebSocket upgrade before authentication", async () => {
    const response = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
    );

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toEqual({
      error: "websocket-upgrade-required",
    });
  });

  it("rejects an invalid access token without echoing it", async () => {
    const token = "invalid-test-token";
    const response = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${token}`,
          upgrade: "websocket",
          "x-silvermoon-daemon-id": "daemon-01",
        },
      },
    );

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(token);
  });

  it("rejects an invalid daemon identity after authentication", async () => {
    const response = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${validToken}`,
          upgrade: "websocket",
          "x-silvermoon-daemon-id": "../daemon",
        },
      },
    );

    expect(response.status).toBe(400);
  });

  it("upgrades an authenticated daemon through its deterministic namespace", async () => {
    const first = env.DAEMON_SESSIONS.idFromName("user-01:daemon-01");
    const second = env.DAEMON_SESSIONS.idFromName("user-01:daemon-01");
    expect(first.equals(second)).toBe(true);

    const response = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${validToken}`,
          upgrade: "websocket",
          "x-silvermoon-daemon-id": "daemon-01",
        },
      },
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    const socket = response.webSocket;
    if (!socket) {
      throw new Error("Expected an upgraded WebSocket");
    }
    const ready = new Promise<MessageEvent>((resolve) => {
      socket.addEventListener("message", resolve, { once: true });
    });
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });
    socket.accept();
    await expect(ready).resolves.toMatchObject({
      data: expect.stringContaining('"type":"relay.ready"'),
    });
    socket.close(1000, "test complete");
    await closed;
  });
});
