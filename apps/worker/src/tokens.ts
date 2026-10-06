import { connectionTokenHash } from "./auth";
import { randomBase64Url } from "./crypto";
import type { AppEnv } from "./env";

const MAX_ACTIVE_TOKENS = 20;
const MAX_LABEL_LENGTH = 80;

export interface ConnectionTokenMetadata {
  id: string;
  label: string;
  tokenHint: string;
  scope: "daemon:connect";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface TokenRow {
  id: string;
  label: string;
  token_hint: string;
  scope: "daemon:connect";
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

function metadata(row: TokenRow): ConnectionTokenMetadata {
  return {
    id: row.id,
    label: row.label,
    tokenHint: row.token_hint,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export async function listTokens(
  env: AppEnv,
  userId: string,
): Promise<ConnectionTokenMetadata[]> {
  const result = await env.DB.prepare(
    `SELECT id, label, token_hint, scope, created_at, expires_at,
      last_used_at, revoked_at
     FROM connection_tokens WHERE user_id = ?1
     ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<TokenRow>();
  return result.results.map(metadata);
}

function tokenExpiry(expiresInDays: unknown): string | null {
  if (expiresInDays === undefined || expiresInDays === null) return null;
  if (
    typeof expiresInDays !== "number"
    || !Number.isInteger(expiresInDays)
    || expiresInDays < 1
    || expiresInDays > 365
  ) {
    throw new Error("invalid-expiry");
  }
  return new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
}

async function tokenMaterial(
  env: AppEnv,
  label: string,
  expiresAt: string | null,
): Promise<{
  id: string;
  secret: string;
  secretHash: string;
  tokenHint: string;
  label: string;
  expiresAt: string | null;
}> {
  const id = randomBase64Url(12);
  const secret = randomBase64Url(32);
  return {
    id,
    secret,
    secretHash: await connectionTokenHash(
      id,
      secret,
      env.CONNECTION_TOKEN_PEPPER,
    ),
    tokenHint: secret.slice(-4),
    label,
    expiresAt,
  };
}

async function createdToken(
  env: AppEnv,
  id: string,
  secret: string,
): Promise<{ token: string; metadata: ConnectionTokenMetadata }> {
  const created = await env.DB.prepare(
    `SELECT id, label, token_hint, scope, created_at, expires_at,
      last_used_at, revoked_at FROM connection_tokens WHERE id = ?1`,
  )
    .bind(id)
    .first<TokenRow>();
  if (!created) throw new Error("token-create-failed");
  return { token: `smr1_${id}_${secret}`, metadata: metadata(created) };
}

export async function createToken(
  env: AppEnv,
  userId: string,
  input: { label?: unknown; expiresInDays?: unknown },
): Promise<{ token: string; metadata: ConnectionTokenMetadata }> {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > MAX_LABEL_LENGTH) throw new Error("invalid-label");
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM connection_tokens
     WHERE user_id = ?1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
  )
    .bind(userId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_ACTIVE_TOKENS) throw new Error("token-limit");

  const expiresAt = tokenExpiry(input.expiresInDays);
  const material = await tokenMaterial(env, label, expiresAt);
  await env.DB.prepare(
    `INSERT INTO connection_tokens
      (id, user_id, secret_hash, token_hint, label, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      material.id,
      userId,
      material.secretHash,
      material.tokenHint,
      label,
      expiresAt,
    )
    .run();
  return createdToken(env, material.id, material.secret);
}

export async function revokeToken(
  env: AppEnv,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE connection_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
  )
    .bind(tokenId, userId)
    .run();
  return result.meta.changes === 1;
}

export async function rotateToken(
  env: AppEnv,
  userId: string,
  tokenId: string,
): Promise<{ token: string; metadata: ConnectionTokenMetadata }> {
  const current = await env.DB.prepare(
    `SELECT label, expires_at FROM connection_tokens
     WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
  )
    .bind(tokenId, userId)
    .first<{ label: string; expires_at: string | null }>();
  if (!current) throw new Error("token-not-found");

  const material = await tokenMaterial(env, current.label, current.expires_at);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE connection_tokens SET revoked_at = CURRENT_TIMESTAMP,
        replaced_by_id = ?3
       WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
    ).bind(tokenId, userId, material.id),
    env.DB.prepare(
      `INSERT INTO connection_tokens
        (id, user_id, secret_hash, token_hint, label, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE EXISTS (
         SELECT 1 FROM connection_tokens
         WHERE id = ?7 AND user_id = ?2 AND replaced_by_id = ?1
       )`,
    ).bind(
      material.id,
      userId,
      material.secretHash,
      material.tokenHint,
      material.label,
      material.expiresAt,
      tokenId,
    ),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    throw new Error("token-rotation-conflict");
  }
  return createdToken(env, material.id, material.secret);
}
