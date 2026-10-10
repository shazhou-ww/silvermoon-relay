import { signSecret, verifySecret } from "./crypto";
import type { AppEnv } from "./env";

interface ConnectionTokenRow {
  id: string;
  user_id: string;
  secret_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface AuthenticatedConnection {
  userId: string;
  tokenId: string;
}

function parseConnectionToken(
  token: string,
): { id: string; secret: string } | null {
  const match = /^smr1_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/u.exec(token);
  return match ? { id: match[1], secret: match[2] } : null;
}

export async function connectionTokenHash(
  id: string,
  secret: string,
  pepper: string,
): Promise<string> {
  return signSecret(`${id}.${secret}`, pepper);
}

export async function authenticate(
  request: Request,
  env: AppEnv,
  context?: ExecutionContext,
): Promise<AuthenticatedConnection | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authenticateConnectionToken(
    authorization.slice("Bearer ".length),
    env,
    context,
  );
}

export async function authenticateConnectionToken(
  token: string,
  env: AppEnv,
  context?: ExecutionContext,
): Promise<AuthenticatedConnection | null> {
  const parsed = parseConnectionToken(token);
  if (!parsed) return null;

  const row = await env.DB.prepare(
    `SELECT id, user_id, secret_hash, expires_at, revoked_at
     FROM connection_tokens WHERE id = ?1`,
  )
    .bind(parsed.id)
    .first<ConnectionTokenRow>();
  if (
    !row
    || row.revoked_at
    || (row.expires_at && Date.parse(row.expires_at) <= Date.now())
    || !(
      await verifySecret(
        `${parsed.id}.${parsed.secret}`,
        row.secret_hash,
        env.CONNECTION_TOKEN_PEPPER,
      )
      || (
        env.CONNECTION_TOKEN_PEPPER_PREVIOUS
        && await verifySecret(
          `${parsed.id}.${parsed.secret}`,
          row.secret_hash,
          env.CONNECTION_TOKEN_PEPPER_PREVIOUS,
        )
      )
    )
  ) {
    return null;
  }

  const update = env.DB.prepare(
    "UPDATE connection_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?1",
  )
    .bind(row.id)
    .run();
  if (context) context.waitUntil(update);
  else await update;
  return { userId: row.user_id, tokenId: row.id };
}
