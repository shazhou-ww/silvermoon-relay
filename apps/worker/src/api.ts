import type { AppEnv } from "./env";
import {
  connectorCapabilitiesSchema,
  connectorIdSchema,
  createSessionCommandSchema,
  PROTOCOL_VERSION,
  sendSessionMessageCommandSchema,
  sessionIdSchema,
  syncSessionHistoryCommandSchema,
  type ConnectorCommand,
} from "@silvermoon-ai/protocol";
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

interface ConnectorRow {
  id: string;
  display_name: string;
  agent_name: string | null;
  agent_version: string | null;
  capabilities_json: string;
  status: "online" | "offline";
  connected_at: string | null;
  disconnected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  session_count: number;
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
  const token = await env.DB.prepare(
    `SELECT device_id FROM connection_tokens
     WHERE user_id = ?1 AND id = ?2`,
  )
    .bind(userId, tokenId)
    .first<{ device_id: string }>();
  if (!token) return;
  await env.DAEMON_SESSIONS.getByName(tokenId).revokeToken(tokenId);
}

function pathValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function connectorForUser(
  env: AppEnv,
  userId: string,
  connectorId: string,
): Promise<{ id: string; status: "online" | "offline" } | null> {
  return env.DB.prepare(
    "SELECT id, status FROM connectors WHERE user_id = ?1 AND id = ?2",
  )
    .bind(userId, connectorId)
    .first<{ id: string; status: "online" | "offline" }>();
}

async function dispatchCommand(
  env: AppEnv,
  userId: string,
  connectorId: string,
  command: ConnectorCommand,
): Promise<boolean> {
  await env.DB.prepare(
    `INSERT INTO connector_commands
      (id, user_id, connector_id, type, session_id, payload_json, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued')`,
  )
    .bind(
      command.commandId,
      userId,
      connectorId,
      command.type,
      command.type === "session.message" || command.type === "session.history"
        ? command.sessionId
        : null,
      JSON.stringify(command),
    )
    .run();

  const result = await env.DAEMON_SESSIONS
    .getByName(
      await env.DB.prepare(
        `SELECT connection_token_id FROM connectors
         WHERE user_id = ?1 AND id = ?2`,
      ).bind(userId, connectorId).first<string>("connection_token_id")
        ?? `${userId}:${connectorId}`,
    )
    .dispatchCommand(command);
  if (result.delivered) return true;

  await env.DB.prepare(
    `UPDATE connector_commands SET status = 'failed',
      error_code = 'connector-offline',
      error_message = 'The connector is not currently connected.',
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(command.commandId)
    .run();
  return false;
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

  if (request.method === "GET" && path === "/api/connectors") {
    const connectors = await env.DB.prepare(
      `SELECT c.id, c.display_name, c.agent_name, c.agent_version,
        c.capabilities_json, c.status, c.connected_at, c.disconnected_at,
        c.last_seen_at, c.created_at, COUNT(s.id) AS session_count
       FROM connectors c
       LEFT JOIN agent_sessions s
         ON s.user_id = c.user_id AND s.connector_id = c.id
       WHERE c.user_id = ?1
       GROUP BY c.user_id, c.id
       ORDER BY c.status DESC, c.last_seen_at DESC, c.display_name`,
    )
      .bind(session.userId)
      .all<ConnectorRow>();
    return response(request, env, connectors.results.map((connector) => ({
      id: connector.id,
      displayName: connector.display_name,
      agent: connector.agent_name
        ? {
            name: connector.agent_name,
            version: connector.agent_version,
          }
        : null,
      capabilities: connectorCapabilitiesSchema.parse(
        JSON.parse(connector.capabilities_json),
      ),
      status: connector.status,
      connectedAt: connector.connected_at,
      disconnectedAt: connector.disconnected_at,
      lastSeenAt: connector.last_seen_at,
      createdAt: connector.created_at,
      sessionCount: connector.session_count,
    })));
  }

  const connectorSessionsMatch =
    /^\/api\/connectors\/([^/]+)\/sessions$/u.exec(path);
  if (connectorSessionsMatch) {
    const connectorId = pathValue(connectorSessionsMatch[1]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    if (!parsedConnectorId.success) {
      return response(
        request,
        env,
        { error: "invalid-connector-id" },
        { status: 400 },
      );
    }
    const connector = await connectorForUser(
      env,
      session.userId,
      parsedConnectorId.data,
    );
    if (!connector) {
      return response(
        request,
        env,
        { error: "connector-not-found" },
        { status: 404 },
      );
    }

    if (request.method === "GET") {
      const sessions = await env.DB.prepare(
        `SELECT id, title, status, native_status, created_at, updated_at, last_activity_at,
          last_message_preview, parent_session_id, can_send_message
         FROM agent_sessions
         WHERE user_id = ?1 AND connector_id = ?2
         ORDER BY last_activity_at DESC
         LIMIT 500`,
      )
        .bind(session.userId, connector.id)
        .all<{
          id: string;
          title: string | null;
          status: string;
          native_status: string | null;
          created_at: string;
          updated_at: string;
          last_activity_at: string;
          last_message_preview: string | null;
          parent_session_id: string | null;
          can_send_message: number;
        }>();
      return response(request, env, sessions.results.map((item) => ({
        id: item.id,
        connectorId: connector.id,
        title: item.title,
        status: item.status,
        nativeStatus: item.native_status,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        lastActivityAt: item.last_activity_at,
        lastMessagePreview: item.last_message_preview,
        parentSessionId: item.parent_session_id,
        canSendMessage: item.can_send_message !== 0,
      })));
    }

    if (request.method === "POST") {
      const body = await requestBody(request);
      const command = createSessionCommandSchema.safeParse({
        type: "session.create",
        protocolVersion: PROTOCOL_VERSION,
        commandId: crypto.randomUUID(),
        prompt: body.prompt,
        ...(body.title === undefined ? {} : { title: body.title }),
      });
      if (!command.success) {
        return response(
          request,
          env,
          { error: "invalid-session-request" },
          { status: 400 },
        );
      }
      const delivered = await dispatchCommand(
        env,
        session.userId,
        connector.id,
        command.data,
      );
      return response(
        request,
        env,
        {
          command: {
            id: command.data.commandId,
            type: command.data.type,
            status: delivered ? "sent" : "failed",
          },
          ...(delivered ? {} : { error: "connector-offline" }),
        },
        { status: delivered ? 202 : 409 },
      );
    }
  }

  const sessionHistorySyncMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/events\/sync$/u.exec(path);
  if (request.method === "POST" && sessionHistorySyncMatch) {
    const connectorId = pathValue(sessionHistorySyncMatch[1]);
    const agentSessionId = pathValue(sessionHistorySyncMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT
         EXISTS (
           SELECT 1 FROM agent_session_events AS event
           WHERE event.user_id = session.user_id
             AND event.connector_id = session.connector_id
             AND event.session_id = session.id
             AND julianday(event.created_at) >= julianday(session.updated_at)
         ) AS events_current,
         EXISTS (
           SELECT 1 FROM connector_commands AS command
           WHERE command.user_id = session.user_id
             AND command.connector_id = session.connector_id
             AND command.session_id = session.id
             AND command.type = 'session.history'
             AND command.status = 'succeeded'
             AND julianday(command.completed_at) >= julianday(session.updated_at)
         ) AS history_current
       FROM agent_sessions AS session
       WHERE session.user_id = ?1
         AND session.connector_id = ?2
         AND session.id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{ events_current: number; history_current: number }>();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    const inFlight = await env.DB.prepare(
      `SELECT id, status FROM connector_commands
       WHERE user_id = ?1 AND connector_id = ?2 AND session_id = ?3
         AND type = 'session.history'
         AND status IN ('queued', 'sent', 'accepted')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{ id: string; status: "queued" | "sent" | "accepted" }>();
    if (inFlight) {
      return response(
        request,
        env,
        {
          command: {
            id: inFlight.id,
            type: "session.history",
            status: inFlight.status,
          },
        },
        { status: 202 },
      );
    }
    if (owned.events_current === 1 || owned.history_current === 1) {
      return response(request, env, {
        command: null,
        synced: true,
      });
    }
    const command = syncSessionHistoryCommandSchema.parse({
      type: "session.history",
      protocolVersion: PROTOCOL_VERSION,
      commandId: crypto.randomUUID(),
      sessionId: parsedSessionId.data,
    });
    const delivered = await dispatchCommand(
      env,
      session.userId,
      parsedConnectorId.data,
      command,
    );
    return response(
      request,
      env,
      {
        command: {
          id: command.commandId,
          type: command.type,
          status: delivered ? "sent" : "failed",
        },
        ...(delivered ? {} : { error: "connector-offline" }),
      },
      { status: delivered ? 202 : 409 },
    );
  }

  const sessionEventsMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/events$/u.exec(path);
  if (request.method === "GET" && sessionEventsMatch) {
    const connectorId = pathValue(sessionEventsMatch[1]);
    const agentSessionId = pathValue(sessionEventsMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT 1 FROM agent_sessions
       WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    const after = Number(url.searchParams.get("after") ?? "-1");
    if (!Number.isSafeInteger(after) || after < -1) {
      return response(
        request,
        env,
        { error: "invalid-event-cursor" },
        { status: 400 },
      );
    }
    const events = await env.DB.prepare(
      `SELECT event_id, sequence, type, role, content, data_json, created_at
       FROM agent_session_events
       WHERE user_id = ?1 AND connector_id = ?2 AND session_id = ?3
         AND sequence > ?4
       ORDER BY sequence
       LIMIT 500`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
        after,
      )
      .all<{
        event_id: string;
        sequence: number;
        type: string;
        role: string | null;
        content: string | null;
        data_json: string | null;
        created_at: string;
      }>();
    return response(request, env, {
      events: events.results.map((event) => ({
        id: event.event_id,
        sessionId: parsedSessionId.data,
        sequence: event.sequence,
        type: event.type,
        role: event.role,
        text: event.content,
        data: event.data_json ? JSON.parse(event.data_json) : null,
        createdAt: event.created_at,
      })),
      nextAfter: events.results.at(-1)?.sequence ?? after,
    });
  }

  const sessionMessageMatch =
    /^\/api\/connectors\/([^/]+)\/sessions\/([^/]+)\/messages$/u.exec(path);
  if (request.method === "POST" && sessionMessageMatch) {
    const connectorId = pathValue(sessionMessageMatch[1]);
    const agentSessionId = pathValue(sessionMessageMatch[2]);
    const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
    const parsedSessionId = sessionIdSchema.safeParse(agentSessionId);
    if (!parsedConnectorId.success || !parsedSessionId.success) {
      return response(
        request,
        env,
        { error: "invalid-session-route" },
        { status: 400 },
      );
    }
    const owned = await env.DB.prepare(
      `SELECT can_send_message FROM agent_sessions
       WHERE user_id = ?1 AND connector_id = ?2 AND id = ?3`,
    )
      .bind(
        session.userId,
        parsedConnectorId.data,
        parsedSessionId.data,
      )
      .first<{ can_send_message: number }>();
    if (!owned) {
      return response(
        request,
        env,
        { error: "session-not-found" },
        { status: 404 },
      );
    }
    if (owned.can_send_message === 0) {
      return response(
        request,
        env,
        { error: "session-read-only" },
        { status: 409 },
      );
    }
    const body = await requestBody(request);
    const command = sendSessionMessageCommandSchema.safeParse({
      type: "session.message",
      protocolVersion: PROTOCOL_VERSION,
      commandId: crypto.randomUUID(),
      sessionId: parsedSessionId.data,
      message: body.message,
    });
    if (!command.success) {
      return response(
        request,
        env,
        { error: "invalid-session-message" },
        { status: 400 },
      );
    }
    const delivered = await dispatchCommand(
      env,
      session.userId,
      parsedConnectorId.data,
      command.data,
    );
    return response(
      request,
      env,
      {
        command: {
          id: command.data.commandId,
          type: command.data.type,
          status: delivered ? "sent" : "failed",
        },
        ...(delivered ? {} : { error: "connector-offline" }),
      },
      { status: delivered ? 202 : 409 },
    );
  }

  const commandMatch = /^\/api\/commands\/([0-9a-f-]{36})$/u.exec(path);
  if (request.method === "GET" && commandMatch) {
    const command = await env.DB.prepare(
      `SELECT id, connector_id, type, session_id, status, error_code,
        error_message, created_at, updated_at, sent_at, accepted_at,
        completed_at
       FROM connector_commands WHERE id = ?1 AND user_id = ?2`,
    )
      .bind(commandMatch[1], session.userId)
      .first<{
        id: string;
        connector_id: string;
        type: string;
        session_id: string | null;
        status: string;
        error_code: string | null;
        error_message: string | null;
        created_at: string;
        updated_at: string;
        sent_at: string | null;
        accepted_at: string | null;
        completed_at: string | null;
      }>();
    if (!command) {
      return response(
        request,
        env,
        { error: "command-not-found" },
        { status: 404 },
      );
    }
    return response(request, env, {
      id: command.id,
      connectorId: command.connector_id,
      type: command.type,
      sessionId: command.session_id,
      status: command.status,
      error: command.error_code
        ? {
            code: command.error_code,
            message: command.error_message,
          }
        : null,
      createdAt: command.created_at,
      updatedAt: command.updated_at,
      sentAt: command.sent_at,
      acceptedAt: command.accepted_at,
      completedAt: command.completed_at,
    });
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
