import { randomBase64Url, signSecret, verifySecret } from "./crypto";
import type { AppEnv } from "./env";
import { appendCookie, cookie, readCookies } from "./http";

const SESSION_COOKIE = "sm_session";
const CSRF_COOKIE = "sm_csrf";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const MAX_ACTIVE_SESSIONS = 20;

interface SessionRow {
  id: string;
  user_id: string;
  secret_hash: string;
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

async function verifyWithSessionSecrets(
  value: string,
  expected: string,
  env: AppEnv,
): Promise<boolean> {
  if (await verifySecret(value, expected, env.SESSION_SECRET)) return true;
  return env.SESSION_SECRET_PREVIOUS
    ? verifySecret(value, expected, env.SESSION_SECRET_PREVIOUS)
    : false;
}

export interface AuthenticatedSession {
  id: string;
  userId: string;
  csrfHash: string;
}

function parseSessionToken(
  token: string | undefined,
): { id: string; secret: string } | null {
  const match = /^sms1_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/u.exec(
    token ?? "",
  );
  return match ? { id: match[1], secret: match[2] } : null;
}

export async function readSession(
  request: Request,
  env: AppEnv,
): Promise<AuthenticatedSession | null> {
  const parsed = parseSessionToken(readCookies(request).get(SESSION_COOKIE));
  if (!parsed) return null;
  const row = await env.DB.prepare(
    `SELECT id, user_id, secret_hash, csrf_hash, expires_at, revoked_at
     FROM browser_sessions WHERE id = ?1`,
  )
    .bind(parsed.id)
    .first<SessionRow>();
  if (
    !row
    || row.revoked_at
    || Date.parse(row.expires_at) <= Date.now()
    || !(await verifyWithSessionSecrets(parsed.secret, row.secret_hash, env))
  ) {
    return null;
  }
  return { id: row.id, userId: row.user_id, csrfHash: row.csrf_hash };
}

export async function createSession(
  userId: string,
  request: Request,
  env: AppEnv,
): Promise<{ token: string; csrf: string }> {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM browser_sessions
     WHERE user_id = ?1 AND revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP`,
  )
    .bind(userId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_ACTIVE_SESSIONS) {
    throw new Error("session-limit");
  }
  const id = randomBase64Url(12);
  const secret = randomBase64Url(32);
  const csrf = randomBase64Url(24);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO browser_sessions
      (id, user_id, secret_hash, csrf_hash, expires_at, user_agent)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      id,
      userId,
      await signSecret(secret, env.SESSION_SECRET),
      await signSecret(csrf, env.SESSION_SECRET),
      expiresAt,
      request.headers.get("user-agent"),
    )
    .run();
  return { token: `sms1_${id}_${secret}`, csrf };
}

export function setSessionCookies(
  response: Response,
  values: { token: string; csrf: string },
  env: AppEnv,
): Response {
  appendCookie(response, cookie(SESSION_COOKIE, values.token, {
    httpOnly: true,
    maxAge: SESSION_SECONDS,
  }));
  appendCookie(response, cookie(CSRF_COOKIE, values.csrf, {
    domain: new URL(env.WEB_ORIGIN).hostname === "silvermoon.work"
      ? ".silvermoon.work"
      : undefined,
    maxAge: SESSION_SECONDS,
    sameSite: "Strict",
  }));
  return response;
}

export function clearSessionCookies(response: Response, env: AppEnv): Response {
  appendCookie(response, cookie(SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
  }));
  appendCookie(response, cookie(CSRF_COOKIE, "", {
    domain: new URL(env.WEB_ORIGIN).hostname === "silvermoon.work"
      ? ".silvermoon.work"
      : undefined,
    maxAge: 0,
    sameSite: "Strict",
  }));
  return response;
}

export async function verifyCsrf(
  request: Request,
  session: AuthenticatedSession,
  env: AppEnv,
): Promise<boolean> {
  const cookieValue = readCookies(request).get(CSRF_COOKIE);
  const headerValue = request.headers.get("x-csrf-token");
  return Boolean(
    cookieValue
    && headerValue
    && cookieValue === headerValue
    && await verifyWithSessionSecrets(headerValue, session.csrfHash, env),
  );
}
