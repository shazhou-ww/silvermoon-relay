import { connectionTokenHash } from "./auth";
import { randomBase64Url } from "./crypto";
import type { AppEnv } from "./env";

const MAX_ACTIVE_TOKENS = 20;
const MAX_LABEL_LENGTH = 80;

export interface ConnectionTokenMetadata {
  id: string;
  deviceId: string;
  deviceName: string;
  tokenHint: string;
  scope: "daemon:connect";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface TokenRow {
  id: string;
  device_id: string;
  display_name: string;
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
    deviceId: row.device_id,
    deviceName: row.display_name,
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
    `SELECT token.id, token.device_id, device.display_name, token.token_hint,
      token.scope, token.created_at, token.expires_at, token.last_used_at,
      token.revoked_at
     FROM connection_tokens AS token
     JOIN devices AS device
       ON device.user_id = token.user_id AND device.id = token.device_id
     WHERE token.user_id = ?1
     ORDER BY token.created_at DESC`,
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
  deviceId: string,
  deviceName: string,
  expiresAt: string | null,
): Promise<{
  id: string;
  secret: string;
  secretHash: string;
  tokenHint: string;
  deviceId: string;
  deviceName: string;
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
    deviceId,
    deviceName,
    expiresAt,
  };
}

async function createdToken(
  env: AppEnv,
  id: string,
  secret: string,
): Promise<{ token: string; metadata: ConnectionTokenMetadata }> {
  const created = await env.DB.prepare(
    `SELECT token.id, token.device_id, device.display_name, token.token_hint,
      token.scope, token.created_at, token.expires_at, token.last_used_at,
      token.revoked_at
     FROM connection_tokens AS token
     JOIN devices AS device
       ON device.user_id = token.user_id AND device.id = token.device_id
     WHERE token.id = ?1`,
  )
    .bind(id)
    .first<TokenRow>();
  if (!created) throw new Error("token-create-failed");
  return { token: `smr1_${id}_${secret}`, metadata: metadata(created) };
}

export async function createToken(
  env: AppEnv,
  userId: string,
  input: { name?: unknown; label?: unknown; expiresInDays?: unknown },
): Promise<{ token: string; metadata: ConnectionTokenMetadata }> {
  const nameValue = input.name ?? input.label;
  const deviceName = typeof nameValue === "string" ? nameValue.trim() : "";
  if (!deviceName || deviceName.length > MAX_LABEL_LENGTH) {
    throw new Error("invalid-device-name");
  }
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM connection_tokens
     WHERE user_id = ?1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
  )
    .bind(userId)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_ACTIVE_TOKENS) throw new Error("token-limit");

  const expiresAt = tokenExpiry(input.expiresInDays);
  const deviceId = `device-${randomBase64Url(12)}`;
  const material = await tokenMaterial(env, deviceId, deviceName, expiresAt);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO devices (user_id, id, display_name)
       VALUES (?1, ?2, ?3)`,
    ).bind(userId, deviceId, deviceName),
    env.DB.prepare(
      `INSERT INTO connection_tokens
        (id, user_id, device_id, secret_hash, token_hint, label, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      material.id,
      userId,
      deviceId,
      material.secretHash,
      material.tokenHint,
      deviceName,
      expiresAt,
    ),
    env.DB.prepare(
      `INSERT INTO connectors
        (user_id, id, display_name, connection_token_id)
       VALUES (?1, ?2, ?3, ?4)`,
    ).bind(userId, deviceId, deviceName, material.id),
  ]);
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
    `SELECT token.device_id, device.display_name, token.expires_at
     FROM connection_tokens AS token
     JOIN devices AS device
       ON device.user_id = token.user_id AND device.id = token.device_id
     WHERE token.id = ?1 AND token.user_id = ?2
       AND token.revoked_at IS NULL`,
  )
    .bind(tokenId, userId)
    .first<{
      device_id: string;
      display_name: string;
      expires_at: string | null;
    }>();
  if (!current) throw new Error("token-not-found");

  const material = await tokenMaterial(
    env,
    current.device_id,
    current.display_name,
    current.expires_at,
  );
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE connection_tokens SET revoked_at = CURRENT_TIMESTAMP,
        replaced_by_id = ?3
       WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
    ).bind(tokenId, userId, material.id),
    env.DB.prepare(
      `INSERT INTO connection_tokens
        (id, user_id, device_id, secret_hash, token_hint, label, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (
         SELECT 1 FROM connection_tokens
         WHERE id = ?8 AND user_id = ?2 AND replaced_by_id = ?1
       )`,
    ).bind(
      material.id,
      userId,
      material.deviceId,
      material.secretHash,
      material.tokenHint,
      material.deviceName,
      material.expiresAt,
      tokenId,
    ),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    throw new Error("token-rotation-conflict");
  }
  return createdToken(env, material.id, material.secret);
}
