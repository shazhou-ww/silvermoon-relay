import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "./env";
import { authenticate } from "./auth";
import { beginOAuth, linkIdentity, validateOidcClaims } from "./oauth";
import { createSession, setSessionCookies } from "./session";
import { createToken, rotateToken } from "./tokens";

const appEnv = env as AppEnv;

async function createSchema(): Promise<void> {
  const statements = [
    `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE external_identities (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, provider_subject)
    )`,
    `CREATE TABLE browser_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      csrf_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT
    )`,
    `CREATE TABLE oauth_transactions (
      state_hash TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL,
      session_user_id TEXT,
      initiator_hash TEXT NOT NULL,
      sealed_context TEXT NOT NULL,
      return_to TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    )`,
    `CREATE TABLE connection_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      token_hint TEXT NOT NULL,
      label TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'daemon:connect',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      replaced_by_id TEXT
    )`,
    `CREATE TABLE daemons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      display_name TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      connection_token_id TEXT,
      UNIQUE (user_id, id)
    )`,
    `CREATE TABLE daemon_token_bindings (
      user_id TEXT NOT NULL,
      connection_token_id TEXT NOT NULL,
      daemon_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, connection_token_id, daemon_id)
    )`,
    `CREATE TABLE connectors (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      agent_name TEXT,
      agent_version TEXT,
      capabilities_json TEXT NOT NULL DEFAULT
        '{"listSessions":false,"createSession":false,"sendMessage":false,"streamEvents":false}',
      status TEXT NOT NULL DEFAULT 'offline',
      connection_token_id TEXT,
      connected_at TEXT,
      disconnected_at TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, id)
    )`,
    `CREATE TABLE agent_sessions (
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      last_message_preview TEXT,
      parent_session_id TEXT,
      can_send_message INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, connector_id, id)
    )`,
    `CREATE TABLE agent_session_events (
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      role TEXT,
      content TEXT,
      data_json TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, connector_id, session_id, event_id),
      UNIQUE (user_id, connector_id, session_id, sequence)
    )`,
    `CREATE TABLE connector_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      type TEXT NOT NULL,
      session_id TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      accepted_at TEXT,
      completed_at TEXT
    )`,
  ];
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

function sessionHeaders(values: { token: string; csrf: string }): HeadersInit {
  return {
    "content-type": "application/json",
    cookie: `sm_session=${values.token}; sm_csrf=${values.csrf}`,
    origin: "https://silvermoon.work",
    "x-csrf-token": values.csrf,
  };
}

describe("relay identity and token service", () => {
  let session: { token: string; csrf: string };

  beforeAll(async () => {
    await createSchema();
    await env.DB.prepare(
      `INSERT INTO users (id, display_name) VALUES ('user-01', 'Test User')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO external_identities
        (provider, provider_subject, user_id, email, email_verified)
       VALUES ('github', '12345', 'user-01', 'test@example.com', 1)`,
    ).run();
    session = await createSession(
      "user-01",
      new Request("https://relay.silvermoon.work", {
        headers: { "user-agent": "Vitest" },
      }),
      appEnv,
    );
  });

  it("reports health and requires a WebSocket upgrade", async () => {
    const health = await SELF.fetch("https://relay.silvermoon.work/health");
    expect(health.status).toBe(200);
    const connect = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
    );
    expect(connect.status).toBe(426);
  });

  it.each(["google", "microsoft", "github"] as const)(
    "starts %s OAuth with PKCE and state",
    async (provider) => {
      const response = await beginOAuth(
        new Request(`https://relay.silvermoon.work/auth/${provider}/start`),
        appEnv,
        provider,
      );
      expect(response.status).toBe(302);
      const redirect = new URL(response.headers.get("location")!);
      expect(redirect.searchParams.get("state")).toHaveLength(43);
      expect(redirect.searchParams.get("code_challenge")).toHaveLength(43);
      expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
      expect(redirect.searchParams.get("redirect_uri")).toBe(
        `https://relay.silvermoon.work/auth/${provider}/callback`,
      );
      expect(response.headers.getSetCookie()[0]).toContain("sm_oauth=");
      expect(response.headers.getSetCookie()[0]).toContain("HttpOnly");
      if (provider !== "github") {
        expect(redirect.searchParams.get("nonce")).toHaveLength(43);
      }
    },
  );

  it("validates OIDC nonce and Microsoft consumer tenant", () => {
    expect(() =>
      validateOidcClaims(
        { sub: "subject", nonce: "nonce", tid: "wrong" },
        "nonce",
        "microsoft",
      )
    ).toThrow("consumer account");
    expect(() =>
      validateOidcClaims(
        {
          sub: "subject",
          nonce: "nonce",
          tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
        },
        "nonce",
        "microsoft",
      )
    ).not.toThrow();
    expect(() =>
      validateOidcClaims({ sub: "subject", nonce: "other" }, "nonce", "google")
    ).toThrow("nonce");
  });

  it("rejects an OAuth callback not bound to the initiating browser", async () => {
    const started = await beginOAuth(
      new Request("https://relay.silvermoon.work/auth/google/start", {
        headers: { "cf-connecting-ip": "192.0.2.20" },
      }),
      appEnv,
      "google",
    );
    const state = new URL(started.headers.get("location")!).searchParams.get("state");
    const callback = await SELF.fetch(
      `https://relay.silvermoon.work/auth/google/callback?state=${state}&code=fake`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      "authError=oauth-browser-mismatch",
    );
  });

  it("requires an allowed origin and valid CSRF for mutations", async () => {
    const unknownOrigin = await SELF.fetch(
      "https://relay.silvermoon.work/api/tokens",
      { headers: { origin: "https://evil.example" } },
    );
    expect(unknownOrigin.status).toBe(403);

    const missingCsrf = await SELF.fetch(
      "https://relay.silvermoon.work/api/tokens",
      {
        method: "POST",
        headers: {
          cookie: `sm_session=${session.token}; sm_csrf=${session.csrf}`,
          origin: "https://silvermoon.work",
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "Daemon" }),
      },
    );
    expect(missingCsrf.status).toBe(403);
  });

  it("sets hardened browser session cookies", () => {
    const response = setSessionCookies(
      Response.json({ ok: true }),
      session,
      appEnv,
    );
    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(cookies[1]).toContain("Domain=.silvermoon.work");
    expect(cookies[1]).toContain("SameSite=Strict");
  });

  it("shows a connection token once and authenticates a daemon", async () => {
    const created = await SELF.fetch(
      "https://relay.silvermoon.work/api/tokens",
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ label: "Test daemon", expiresInDays: 30 }),
      },
    );
    expect(created.status).toBe(201);
    const body = await created.json<{
      token: string;
      metadata: { id: string; tokenHint: string };
    }>();
    expect(body.token).toMatch(/^smr1_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/u);

    const listed = await SELF.fetch(
      "https://relay.silvermoon.work/api/tokens",
      { headers: sessionHeaders(session) },
    );
    const listText = await listed.text();
    expect(listText).not.toContain(body.token);
    expect(listText).toContain(body.metadata.tokenHint);

    const upgraded = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${body.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "x-silvermoon-daemon-id": "daemon-02",
        },
      },
    );
    expect(upgraded.status).toBe(101);
    const socket = upgraded.webSocket!;
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });
    socket.accept();

    const other = await createToken(appEnv, "user-01", { label: "Other daemon" });
    const otherUpgrade = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${other.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "x-silvermoon-daemon-id": "daemon-01",
        },
      },
    );
    expect(otherUpgrade.status).toBe(101);
    const otherSocket = otherUpgrade.webSocket!;
    otherSocket.accept();

    const revoked = await SELF.fetch(
      `https://relay.silvermoon.work/api/tokens/${body.metadata.id}`,
      { method: "DELETE", headers: sessionHeaders(session) },
    );
    expect(revoked.status).toBe(200);
    await expect(closed).resolves.toMatchObject({ code: 4003 });

    const rejected = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${body.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "x-silvermoon-daemon-id": "daemon-03",
        },
      },
    );
    expect(rejected.status).toBe(401);

    const acknowledged = new Promise<MessageEvent>((resolve) => {
      otherSocket.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as {
          id?: number;
          result?: { type?: string };
        };
        if (frame.id === 1 && frame.result?.type === "data") resolve(event);
      });
    });
    otherSocket.send(JSON.stringify({
      id: 1,
      method: "mutation",
      params: {
        path: "heartbeat",
        input: { observedAt: new Date().toISOString() },
      },
    }));
    await expect(acknowledged).resolves.toBeDefined();
    otherSocket.close(1000, "test complete");
  });

  it("prevents removing the final login identity", async () => {
    const response = await SELF.fetch(
      "https://relay.silvermoon.work/api/identities/github",
      { method: "DELETE", headers: sessionHeaders(session) },
    );
    expect(response.status).toBe(409);
  });

  it("links by provider subject without merging matching email", async () => {
    await env.DB.prepare("INSERT INTO users (id) VALUES ('user-03')").run();
    await linkIdentity(appEnv, "user-03", "google", {
      subject: "google-subject",
      email: "test@example.com",
      emailVerified: true,
      displayName: "Another User",
      avatarUrl: null,
    });
    const linked = await env.DB.prepare(
      `SELECT user_id FROM external_identities
       WHERE provider = 'google' AND provider_subject = 'google-subject'`,
    ).first<{ user_id: string }>();
    expect(linked?.user_id).toBe("user-03");
    await expect(
      linkIdentity(appEnv, "user-01", "google", {
        subject: "google-subject",
        email: "test@example.com",
        emailVerified: true,
        displayName: "Conflict",
        avatarUrl: null,
      }),
    ).rejects.toThrow("another user");
  });

  it("isolates token operations by user", async () => {
    await env.DB.prepare("INSERT INTO users (id) VALUES ('user-02')").run();
    const foreign = await createToken(appEnv, "user-02", { label: "Foreign" });
    const response = await SELF.fetch(
      `https://relay.silvermoon.work/api/tokens/${foreign.metadata.id}`,
      { method: "DELETE", headers: sessionHeaders(session) },
    );
    expect(response.status).toBe(404);
  });

  it("rotates a token atomically and preserves its expiry", async () => {
    const original = await createToken(appEnv, "user-01", {
      label: "Rotating",
      expiresInDays: 14,
    });
    const replacement = await rotateToken(
      appEnv,
      "user-01",
      original.metadata.id,
    );
    expect(replacement.token).not.toBe(original.token);
    expect(replacement.metadata.expiresAt).toBe(original.metadata.expiresAt);
    const rows = await env.DB.prepare(
      `SELECT id, revoked_at, replaced_by_id FROM connection_tokens
       WHERE id IN (?1, ?2) ORDER BY id`,
    )
      .bind(original.metadata.id, replacement.metadata.id)
      .all<{ id: string; revoked_at: string | null; replaced_by_id: string | null }>();
    const previous = rows.results.find((row) => row.id === original.metadata.id);
    const next = rows.results.find((row) => row.id === replacement.metadata.id);
    expect(previous?.revoked_at).not.toBeNull();
    expect(previous?.replaced_by_id).toBe(replacement.metadata.id);
    expect(next?.revoked_at).toBeNull();
  });

  it("rejects an expired connection token", async () => {
    const expired = await createToken(appEnv, "user-01", {
      label: "Expired",
      expiresInDays: 1,
    });
    await env.DB.prepare(
      "UPDATE connection_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
    )
      .bind(expired.metadata.id)
      .run();
    const response = await SELF.fetch(
      "https://relay.silvermoon.work/v1/daemon/connect",
      {
        headers: {
          authorization: `Bearer ${expired.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "x-silvermoon-daemon-id": "expired-daemon",
        },
      },
    );
    expect(response.status).toBe(401);
  });

  it("validates token labels and expiration bounds", async () => {
    await expect(
      createToken(appEnv, "user-01", { label: "", expiresInDays: 30 }),
    ).rejects.toThrow("invalid-label");
    await expect(
      createToken(appEnv, "user-01", {
        label: "Too long",
        expiresInDays: 366,
      }),
    ).rejects.toThrow("invalid-expiry");
  });

  it("accepts tokens during a pepper rotation window", async () => {
    const existing = await createToken(appEnv, "user-01", {
      label: "Pepper rotation",
    });
    const rotatingEnv = {
      ...appEnv,
      DB: env.DB,
      CONNECTION_TOKEN_PEPPER: "new-test-pepper",
      CONNECTION_TOKEN_PEPPER_PREVIOUS: appEnv.CONNECTION_TOKEN_PEPPER,
    } as AppEnv;
    const authenticated = await authenticate(
      new Request("https://relay.silvermoon.work/v1/daemon/connect", {
        headers: { authorization: `Bearer ${existing.token}` },
      }),
      rotatingEnv,
    );
    expect(authenticated).toMatchObject({ userId: "user-01" });
  });

  it("routes session commands through an online connector and stores activity", async () => {
    const connectorToken = await createToken(appEnv, "user-01", {
      label: "Studio connector",
    });
    const upgraded = await SELF.fetch(
      "https://relay.silvermoon.work/v1/connectors/studio-laptop/connect",
      {
        headers: {
          authorization: `Bearer ${connectorToken.token}`,
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      },
    );
    expect(upgraded.status).toBe(101);
    const socket = upgraded.webSocket!;
    socket.accept();

    interface TrpcFrame {
      id?: number;
      result?: {
        type?: string;
        data?: unknown;
      };
      error?: unknown;
    }
    const frames: TrpcFrame[] = [];
    socket.addEventListener("message", (event) => {
      frames.push(JSON.parse(String(event.data)) as TrpcFrame);
    });
    const sendRpc = (
      id: number,
      method: "mutation" | "subscription",
      path: string,
      input: unknown,
    ) => {
      socket.send(JSON.stringify({
        id,
        method,
        params: { path, input },
      }));
    };
    const waitForData = async (
      id: number,
      predicate: (value: unknown) => boolean = () => true,
    ): Promise<unknown> => {
      let found: TrpcFrame | undefined;
      await expect.poll(() => {
        found = frames.find(
          (frame) =>
            frame.id === id
            && frame.result?.type === "data"
            && predicate(frame.result.data),
        );
        return found;
      }).toBeDefined();
      return found?.result?.data;
    };

    const now = new Date().toISOString();
    const staleCommandId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO connector_commands
        (id, user_id, connector_id, type, session_id, payload_json, status)
       VALUES (?1, 'user-01', 'studio-laptop', 'session.history',
        'stale-session', '{}', 'accepted')`,
    )
      .bind(staleCommandId)
      .run();
    sendRpc(1, "mutation", "register", {
      connectorId: "studio-laptop",
      displayName: "Studio laptop",
      agent: { name: "Test agent", version: "1.0.0" },
      capabilities: {
        listSessions: true,
        createSession: true,
        sendMessage: true,
        streamEvents: true,
      },
    });
    await waitForData(1);
    await expect.poll(async () =>
      env.DB.prepare(
        `SELECT status, error_code FROM connector_commands WHERE id = ?1`,
      )
        .bind(staleCommandId)
        .first()
    ).toMatchObject({
      status: "failed",
      error_code: "connector-reconnected",
    });
    sendRpc(2, "mutation", "syncSessions", {
      sessions: [{
        id: "session-child",
        parentSessionId: "session-existing",
        title: "Read-only child",
        status: "running",
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: null,
        canSendMessage: false,
      }, {
        id: "session-existing",
        title: "Existing session",
        status: "idle",
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: "Ready to continue",
      }],
    });
    await waitForData(2);
    sendRpc(3, "subscription", "commands", null);
    await expect.poll(() =>
      frames.some(
        (frame) => frame.id === 3 && frame.result?.type === "started",
      )
    ).toBe(true);

    await expect.poll(async () => {
      const response = await SELF.fetch(
        "https://relay.silvermoon.work/api/connectors",
        { headers: sessionHeaders(session) },
      );
      const connectors = await response.json<Array<{
        id: string;
        status: string;
        sessionCount: number;
      }>>();
      return connectors.find((item) => item.id === "studio-laptop");
    }).toMatchObject({ status: "online", sessionCount: 2 });

    const sessionList = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions",
      { headers: sessionHeaders(session) },
    );
    expect(await sessionList.json()).toContainEqual(expect.objectContaining({
      id: "session-child",
      parentSessionId: "session-existing",
      canSendMessage: false,
    }));
    const readOnlyMessage = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-child/messages",
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ message: "Can I change this?" }),
      },
    );
    expect(readOnlyMessage.status).toBe(409);
    expect(await readOnlyMessage.json()).toEqual({
      error: "session-read-only",
    });

    const historySync = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-existing/events/sync",
      {
        method: "POST",
        headers: sessionHeaders(session),
      },
    );
    expect(historySync.status).toBe(202);
    const historyCommand = await waitForData(
      3,
      (value) =>
        !!value
        && typeof value === "object"
        && "type" in value
        && value.type === "session.history",
    ) as Record<string, unknown>;
    expect(historyCommand).toMatchObject({
      type: "session.history",
      sessionId: "session-existing",
    });
    const historyCommandId = String(historyCommand.commandId);
    const duplicateHistorySync = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-existing/events/sync",
      {
        method: "POST",
        headers: sessionHeaders(session),
      },
    );
    expect(duplicateHistorySync.status).toBe(202);
    expect(
      await duplicateHistorySync.json<{
        command: { id: string; status: string };
      }>(),
    ).toMatchObject({
      command: {
        id: historyCommandId,
        status: "sent",
      },
    });
    sendRpc(4, "mutation", "commandAccepted", {
      commandId: historyCommandId,
    });
    sendRpc(5, "mutation", "sessionEvents", {
      events: [{
        id: "history-event-1",
        sessionId: "session-existing",
        sequence: 1,
        type: "message",
        role: "user",
        text: "Load the local history.",
        createdAt: now,
      }, {
        id: "history-event-2",
        sessionId: "session-existing",
        sequence: 2,
        type: "message",
        role: "assistant",
        text: "Loaded from local history.",
        data: {
          turnId: "turn-history-1",
          partId: "markdown-1",
          partIndex: 0,
          partKind: "markdown",
          update: "snapshot",
        },
        createdAt: now,
      }],
    });
    await waitForData(5);
    sendRpc(6, "mutation", "commandCompleted", {
      commandId: historyCommandId,
      outcome: "succeeded",
    });
    await waitForData(6);
    const historyEvents = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-existing/events",
      { headers: sessionHeaders(session) },
    );
    expect(
      await historyEvents.json<{ events: Array<{ id: string }> }>(),
    ).toMatchObject({
      events: [
        expect.objectContaining({ id: "history-event-1" }),
        expect.objectContaining({
          id: "history-event-2",
          data: {
            turnId: "turn-history-1",
            partId: "markdown-1",
            partIndex: 0,
            partKind: "markdown",
            update: "snapshot",
          },
        }),
      ],
    });
    const currentHistorySync = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-existing/events/sync",
      {
        method: "POST",
        headers: sessionHeaders(session),
      },
    );
    expect(currentHistorySync.status).toBe(200);
    expect(await currentHistorySync.json()).toMatchObject({
      command: null,
      synced: true,
    });
    expect(
      await env.DB.prepare(
        `SELECT status FROM agent_sessions
         WHERE user_id = 'user-01' AND connector_id = 'studio-laptop'
           AND id = 'session-existing'`,
      ).first<{ status: string }>(),
    ).toMatchObject({ status: "idle" });
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM connector_commands
         WHERE user_id = 'user-01' AND connector_id = 'studio-laptop'
           AND session_id = 'session-existing' AND type = 'session.history'`,
      ).first<{ count: number }>(),
    ).toMatchObject({ count: 1 });

    const create = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions",
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({
          title: "Investigate CI",
          prompt: "Find the failing check and fix it.",
        }),
      },
    );
    expect(create.status).toBe(202);
    const createCommand = await waitForData(
      3,
      (value) =>
        !!value
        && typeof value === "object"
        && "type" in value
        && value.type === "session.create",
    ) as Record<string, unknown>;
    expect(createCommand).toMatchObject({
      type: "session.create",
      title: "Investigate CI",
    });
    const createCommandId = String(createCommand.commandId);
    sendRpc(7, "mutation", "commandAccepted", {
      commandId: createCommandId,
    });
    sendRpc(8, "mutation", "commandCompleted", {
      commandId: createCommandId,
      outcome: "succeeded",
      session: {
        id: "session-new",
        title: "Investigate CI",
        status: "running",
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: "Find the failing check and fix it.",
      },
    });
    await waitForData(8);

    await expect.poll(async () => {
      const response = await SELF.fetch(
        "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions",
        { headers: sessionHeaders(session) },
      );
      const sessions = await response.json<Array<{ id: string }>>();
      return sessions.some((item) => item.id === "session-new");
    }).toBe(true);
    const continued = await SELF.fetch(
      "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-new/messages",
      {
        method: "POST",
        headers: sessionHeaders(session),
        body: JSON.stringify({ message: "Show me the test output." }),
      },
    );
    expect(continued.status).toBe(202);
    const messageCommand = await waitForData(
      3,
      (value) =>
        !!value
        && typeof value === "object"
        && "type" in value
        && value.type === "session.message",
    ) as Record<string, unknown>;
    expect(messageCommand).toMatchObject({
      type: "session.message",
      sessionId: "session-new",
      message: "Show me the test output.",
    });
    sendRpc(9, "mutation", "sessionEvent", {
        id: "event-1",
        sessionId: "session-new",
        sequence: 1,
        type: "message",
        role: "assistant",
        text: "The worker type generation check is stale.",
        createdAt: new Date().toISOString(),
    });
    await waitForData(9);

    await expect.poll(async () => {
      const response = await SELF.fetch(
        "https://relay.silvermoon.work/api/connectors/studio-laptop/sessions/session-new/events",
        { headers: sessionHeaders(session) },
      );
      const body = await response.json<{ events: Array<{ id: string }> }>();
      return body.events;
    }).toContainEqual(expect.objectContaining({ id: "event-1" }));

    socket.close(1000, "test complete");
  });
});
