export interface AuthenticatedUser {
  id: string;
}

export async function authenticate(
  request: Request,
  database: D1Database,
): Promise<AuthenticatedUser | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length);
  if (!token || token.length > 4096) {
    return null;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const tokenHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return database
    .prepare("SELECT id FROM users WHERE access_token_hash = ?1")
    .bind(tokenHash)
    .first<AuthenticatedUser>();
}
