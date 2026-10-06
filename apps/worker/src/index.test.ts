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
          "x-silvermoon-daemon-id": "daemon-01",
        },
      },
    );
    expect(upgraded.status).toBe(101);
    const socket = upgraded.webSocket!;
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", resolve, { once: true });
    });
    socket.accept();

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
          "x-silvermoon-daemon-id": "daemon-02",
        },
      },
    );
    expect(rejected.status).toBe(401);
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
});
