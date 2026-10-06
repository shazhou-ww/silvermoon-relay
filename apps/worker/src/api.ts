import type { AppEnv } from "./env";
import {
  clearSessionCookies,
  readSession,
  verifyCsrf,
} from "./session";
import {
  createToken,
  listTokens,
  revokeToken,
  rotateToken,
} from "./tokens";
import {
  isAllowedOrigin,
  json,
  withCors,
} from "./http";

interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface IdentityRow {
  provider: string;
  email: string | null;
  email_verified: number;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string;
}

function response(
  request: Request,
  env: AppEnv,
  value: unknown,
  init: ResponseInit = {},
): Response {
  const result = withCors(json(value, init), request, env);
  result.headers.set("cache-control", "no-store");
  return result;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new Error("json-required");
  }
  const body = await request.json<unknown>();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid-json");
  }
  return body as Record<string, unknown>;
}

async function notifyTokenRevocation(
  env: AppEnv,
  userId: string,
  tokenId: string,
): Promise<void> {
  const daemons = await env.DB.prepare(
    `SELECT daemon_id AS id FROM daemon_token_bindings
     WHERE user_id = ?1 AND connection_token_id = ?2`,
  )
    .bind(userId, tokenId)
    .all<{ id: string }>();
  await Promise.all(
    daemons.results.map(({ id }) =>
      env.DAEMON_SESSIONS.getByName(`${userId}:${id}`).revokeToken(tokenId)
    ),
  );
}

export async function handleApi(
  request: Request,
  env: AppEnv,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(request, env)) {
      return response(request, env, { error: "origin-not-allowed" }, { status: 403 });
    }
    const preflight = new Response(null, { status: 204 });
    preflight.headers.set("access-control-allow-origin", env.WEB_ORIGIN);
    preflight.headers.set("access-control-allow-credentials", "true");
    preflight.headers.set(
      "access-control-allow-headers",
      "content-type,x-csrf-token",
    );
    preflight.headers.set(
      "access-control-allow-methods",
      "GET,POST,DELETE,OPTIONS",
    );
    preflight.headers.set("access-control-max-age", "600");
    return preflight;
  }
  if (!isAllowedOrigin(request, env)) {
    return response(request, env, { error: "origin-not-allowed" }, { status: 403 });
  }

  const session = await readSession(request, env);
  if (!session) {
    return response(request, env, { error: "authentication-required" }, { status: 401 });
  }
  context.waitUntil(
    env.DB.prepare(
      "UPDATE browser_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1",
    )
      .bind(session.id)
      .run(),
  );
  if (
    request.method !== "GET"
    && !(await verifyCsrf(request, session, env))
  ) {
    return response(request, env, { error: "csrf-invalid" }, { status: 403 });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/me") {
    const [user, identities] = await Promise.all([
      env.DB.prepare(
        "SELECT id, display_name, avatar_url, created_at FROM users WHERE id = ?1",
      ).bind(session.userId).first<UserRow>(),
      env.DB.prepare(
        `SELECT provider, email, email_verified, display_name, avatar_url,
          created_at, last_login_at
         FROM external_identities WHERE user_id = ?1 ORDER BY created_at`,
      ).bind(session.userId).all<IdentityRow>(),
    ]);
    if (!user) return response(request, env, { error: "user-not-found" }, { status: 404 });
    return response(request, env, {
      user: {
        id: user.id,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
      },
      identities: identities.results.map((identity) => ({
        provider: identity.provider,
        email: identity.email,
        emailVerified: identity.email_verified === 1,
        displayName: identity.display_name,
        avatarUrl: identity.avatar_url,
        createdAt: identity.created_at,
        lastLoginAt: identity.last_login_at,
      })),
      sessionId: session.id,
    });
  }

  if (request.method === "POST" && path === "/api/logout") {
    await env.DB.prepare(
      `UPDATE browser_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(session.id, session.userId)
      .run();
    return clearSessionCookies(response(request, env, { ok: true }), env);
  }

  if (request.method === "GET" && path === "/api/sessions") {
    const sessions = await env.DB.prepare(
      `SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent
       FROM browser_sessions WHERE user_id = ?1 ORDER BY created_at DESC`,
    )
      .bind(session.userId)
      .all<{
        id: string;
        created_at: string;
        last_seen_at: string;
        expires_at: string;
        revoked_at: string | null;
        user_agent: string | null;
      }>();
    return response(request, env, sessions.results.map((item) => ({
      id: item.id,
      current: item.id === session.id,
      createdAt: item.created_at,
      lastSeenAt: item.last_seen_at,
      expiresAt: item.expires_at,
      revokedAt: item.revoked_at,
      userAgent: item.user_agent,
    })));
  }

  const sessionMatch = /^\/api\/sessions\/([A-Za-z0-9_-]{16})$/u.exec(path);
  if (request.method === "DELETE" && sessionMatch) {
    const revoked = await env.DB.prepare(
      `UPDATE browser_sessions SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
    )
      .bind(sessionMatch[1], session.userId)
      .run();
    const result = response(
      request,
      env,
      { revoked: revoked.meta.changes === 1 },
      { status: revoked.meta.changes === 1 ? 200 : 404 },
    );
    return sessionMatch[1] === session.id
      ? clearSessionCookies(result, env)
      : result;
  }

  const identityMatch = /^\/api\/identities\/(google|microsoft|github)$/u.exec(path);
  if (request.method === "DELETE" && identityMatch) {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM external_identities WHERE user_id = ?1",
    )
      .bind(session.userId)
      .first<{ count: number }>();
    if ((count?.count ?? 0) <= 1) {
      return response(request, env, { error: "last-identity" }, { status: 409 });
    }
    const removed = await env.DB.prepare(
      "DELETE FROM external_identities WHERE provider = ?1 AND user_id = ?2",
    )
      .bind(identityMatch[1], session.userId)
      .run();
    return response(
      request,
      env,
      { removed: removed.meta.changes === 1 },
      { status: removed.meta.changes === 1 ? 200 : 404 },
    );
  }

  if (request.method === "GET" && path === "/api/tokens") {
    return response(request, env, await listTokens(env, session.userId));
  }
  if (request.method === "POST" && path === "/api/tokens") {
    try {
      return response(
        request,
        env,
        await createToken(env, session.userId, await requestBody(request)),
        { status: 201 },
      );
    } catch (error) {
      return response(
        request,
        env,
        { error: error instanceof Error ? error.message : "token-create-failed" },
        { status: 400 },
      );
    }
  }

  const rotateMatch = /^\/api\/tokens\/([A-Za-z0-9_-]{16})\/rotate$/u.exec(path);
  if (request.method === "POST" && rotateMatch) {
    try {
      const rotated = await rotateToken(env, session.userId, rotateMatch[1]);
      context.waitUntil(notifyTokenRevocation(env, session.userId, rotateMatch[1]));
      return response(request, env, rotated, { status: 201 });
    } catch (error) {
      return response(
        request,
        env,
        { error: error instanceof Error ? error.message : "token-rotation-failed" },
        { status: 409 },
      );
    }
  }

  const tokenMatch = /^\/api\/tokens\/([A-Za-z0-9_-]{16})$/u.exec(path);
  if (request.method === "DELETE" && tokenMatch) {
    const revoked = await revokeToken(env, session.userId, tokenMatch[1]);
    if (revoked) {
      context.waitUntil(notifyTokenRevocation(env, session.userId, tokenMatch[1]));
    }
    return response(
      request,
      env,
      { revoked },
      { status: revoked ? 200 : 404 },
    );
  }
  return response(request, env, { error: "not-found" }, { status: 404 });
}
