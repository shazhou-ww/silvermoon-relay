import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import {
  randomBase64Url,
  sealJson,
  sha256Base64Url,
  signSecret,
  unsealJson,
} from "./crypto";
import type { AppEnv, OAuthProvider } from "./env";
import {
  appendCookie,
  cookie,
  json,
  readCookies,
} from "./http";
import {
  createSession,
  readSession,
  setSessionCookies,
} from "./session";

const providers = ["google", "microsoft", "github"] as const;
const TRANSACTION_SECONDS = 10 * 60;
const OAUTH_COOKIE = "sm_oauth";
const microsoftConsumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";

interface TransactionRow {
  state_hash: string;
  provider: OAuthProvider;
  mode: "login" | "link";
  session_user_id: string | null;
  initiator_hash: string;
  sealed_context: string;
  return_to: string;
  expires_at: string;
  consumed_at: string | null;
}

interface TransactionContext {
  codeVerifier: string;
  nonce: string;
}

export interface ProviderProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function linkIdentity(
  env: AppEnv,
  userId: string,
  provider: OAuthProvider,
  profile: ProviderProfile,
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT user_id FROM external_identities
     WHERE provider = ?1 AND provider_subject = ?2`,
  )
    .bind(provider, profile.subject)
    .first<IdentityRow>();
  if (existing?.user_id === userId) return;
  if (existing) throw new Error("Identity already belongs to another user");
  await env.DB.prepare(
    `INSERT INTO external_identities
      (provider, provider_subject, user_id, email, email_verified, display_name, avatar_url)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      provider,
      profile.subject,
      userId,
      profile.email,
      profile.emailVerified ? 1 : 0,
      profile.displayName,
      profile.avatarUrl,
    )
    .run();
}

interface IdentityRow {
  user_id: string;
}

async function transactionByState(
  env: AppEnv,
  state: string,
): Promise<TransactionRow | null> {
  for (const secret of [
    env.SESSION_SECRET,
    env.SESSION_SECRET_PREVIOUS,
  ]) {
    if (!secret) continue;
    const stateHash = await signSecret(state, secret);
    const transaction = await env.DB.prepare(
      `SELECT state_hash, provider, mode, session_user_id, initiator_hash,
        sealed_context, return_to, expires_at, consumed_at
       FROM oauth_transactions WHERE state_hash = ?1`,
    )
      .bind(stateHash)
      .first<TransactionRow>();
    if (transaction) return transaction;
  }
  return null;
}

async function transactionContext(
  env: AppEnv,
  sealed: string,
): Promise<TransactionContext> {
  let failure: unknown;
  for (const secret of [
    env.SESSION_SECRET,
    env.SESSION_SECRET_PREVIOUS,
  ]) {
    if (!secret) continue;
    try {
      return await unsealJson<TransactionContext>(sealed, secret);
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error ? failure : new Error("Cannot decrypt transaction");
}

function isProvider(value: string): value is OAuthProvider {
  return providers.includes(value as OAuthProvider);
}

function providerClient(env: AppEnv, provider: OAuthProvider): {
  clientId: string;
  clientSecret: string;
} {
  if (provider === "google") {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (provider === "microsoft") {
    return {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    };
  }
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

function providerEndpoints(provider: OAuthProvider): {
  authorize: string;
  token: string;
} {
  if (provider === "google") {
    return {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
    };
  }
  if (provider === "microsoft") {
    return {
      authorize:
        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
      token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
    };
  }
  return {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
  };
}

function callbackUrl(env: AppEnv, provider: OAuthProvider): string {
  return `${env.AUTH_BASE_URL}/auth/${provider}/callback`;
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store" },
  });
}

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function validateOidcClaims(
  claims: JWTPayload,
  expectedNonce: string,
  provider: "google" | "microsoft",
): void {
  if (claims.nonce !== expectedNonce || typeof claims.sub !== "string") {
    throw new Error("Invalid OIDC subject or nonce");
  }
  if (provider === "microsoft" && claims.tid !== microsoftConsumerTenant) {
    throw new Error("Microsoft token is not a consumer account");
  }
}

export async function beginOAuth(
  request: Request,
  env: AppEnv,
  providerValue: string,
): Promise<Response> {
  if (!isProvider(providerValue)) return json({ error: "unknown-provider" }, { status: 404 });
  const requestUrl = new URL(request.url);
  const mode = requestUrl.searchParams.get("mode") === "link" ? "link" : "login";
  const session = await readSession(request, env);
  if (mode === "link" && !session) {
    return json({ error: "authentication-required" }, { status: 401 });
  }

  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  const nonce = randomBase64Url(32);
  const stateHash = await signSecret(state, env.SESSION_SECRET);
  const initiator = session
    ? `user:${session.userId}`
    : `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
  const initiatorHash = await signSecret(initiator, env.SESSION_SECRET);
  const activeTransactions = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM oauth_transactions
     WHERE initiator_hash = ?1 AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP`,
  )
    .bind(initiatorHash)
    .first<{ count: number }>();
  if ((activeTransactions?.count ?? 0) >= 10) {
    return json({ error: "oauth-rate-limit" }, { status: 429 });
  }
  const expiresAt = new Date(Date.now() + TRANSACTION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_transactions
      (state_hash, provider, mode, session_user_id, initiator_hash,
       sealed_context, return_to, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      stateHash,
      providerValue,
      mode,
      session?.userId ?? null,
      initiatorHash,
      await sealJson({ codeVerifier, nonce }, env.SESSION_SECRET),
      safeReturnTo(requestUrl.searchParams.get("returnTo")),
      expiresAt,
    )
    .run();

  const { clientId } = providerClient(env, providerValue);
  const endpoints = providerEndpoints(providerValue);
  const authorize = new URL(endpoints.authorize);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl(env, providerValue));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  if (providerValue === "github") {
    authorize.searchParams.set("scope", "read:user user:email");
  } else {
    authorize.searchParams.set("scope", "openid email profile");
    authorize.searchParams.set("nonce", nonce);
  }
  const response = redirectResponse(authorize.toString());
  return appendCookie(response, cookie(OAUTH_COOKIE, state, {
    httpOnly: true,
    maxAge: TRANSACTION_SECONDS,
  }));
}

async function exchangeCode(
  env: AppEnv,
  provider: OAuthProvider,
  code: string,
  codeVerifier: string,
): Promise<Record<string, unknown>> {
  const client = providerClient(env, provider);
  const body = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(env, provider),
  });
  const response = await fetch(providerEndpoints(provider).token, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) throw new Error(`OAuth token exchange failed: ${response.status}`);
  return response.json<Record<string, unknown>>();
}

async function oidcProfile(
  env: AppEnv,
  provider: "google" | "microsoft",
  idToken: string,
  nonce: string,
): Promise<ProviderProfile> {
  const { clientId } = providerClient(env, provider);
  const jwks = createRemoteJWKSet(new URL(
    provider === "google"
      ? "https://www.googleapis.com/oauth2/v3/certs"
      : "https://login.microsoftonline.com/consumers/discovery/v2.0/keys",
  ));
  const verification = await jwtVerify(idToken, jwks, {
    audience: clientId,
    issuer: provider === "google"
      ? ["https://accounts.google.com", "accounts.google.com"]
      : `https://login.microsoftonline.com/${microsoftConsumerTenant}/v2.0`,
  });
  validateOidcClaims(verification.payload, nonce, provider);
  return {
    subject: verification.payload.sub!,
    email: typeof verification.payload.email === "string"
      ? verification.payload.email
      : null,
    emailVerified: verification.payload.email_verified === true,
    displayName: typeof verification.payload.name === "string"
      ? verification.payload.name
      : null,
    avatarUrl: typeof verification.payload.picture === "string"
      ? verification.payload.picture
      : null,
  };
}

async function githubProfile(accessToken: string): Promise<ProviderProfile> {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": "silvermoon-relay",
    "x-github-api-version": "2022-11-28",
  };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userResponse.ok || !emailsResponse.ok) {
    throw new Error("GitHub profile request failed");
  }
  const user = await userResponse.json<{
    id: number;
    name: string | null;
    avatar_url: string | null;
  }>();
  const emails = await emailsResponse.json<
    Array<{ email: string; primary: boolean; verified: boolean }>
  >();
  const primary = emails.find((email) => email.primary && email.verified);
  return {
    subject: String(user.id),
    email: primary?.email ?? null,
    emailVerified: Boolean(primary),
    displayName: user.name,
    avatarUrl: user.avatar_url,
  };
}

async function providerProfile(
  env: AppEnv,
  provider: OAuthProvider,
  tokens: Record<string, unknown>,
  nonce: string,
): Promise<ProviderProfile> {
  if (provider === "github") {
    if (typeof tokens.access_token !== "string") throw new Error("Missing access token");
    return githubProfile(tokens.access_token);
  }
  if (typeof tokens.id_token !== "string") throw new Error("Missing ID token");
  return oidcProfile(env, provider, tokens.id_token, nonce);
}

async function resolveUser(
  env: AppEnv,
  transaction: TransactionRow,
  profile: ProviderProfile,
): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT user_id FROM external_identities
     WHERE provider = ?1 AND provider_subject = ?2`,
  )
    .bind(transaction.provider, profile.subject)
    .first<IdentityRow>();

  if (transaction.mode === "link") {
    if (!transaction.session_user_id) throw new Error("Missing linking user");
    if (existing && existing.user_id !== transaction.session_user_id) {
      throw new Error("Identity already belongs to another user");
    }
    if (!existing) {
      await linkIdentity(
        env,
        transaction.session_user_id,
        transaction.provider,
        profile,
      );
    }
    return transaction.session_user_id;
  }

  if (existing) {
    await env.DB.prepare(
      `UPDATE external_identities SET email = ?3, email_verified = ?4,
       display_name = ?5, avatar_url = ?6, last_login_at = CURRENT_TIMESTAMP
       WHERE provider = ?1 AND provider_subject = ?2`,
    )
      .bind(
        transaction.provider,
        profile.subject,
        profile.email,
        profile.emailVerified ? 1 : 0,
        profile.displayName,
        profile.avatarUrl,
      )
      .run();
    return existing.user_id;
  }

  const userId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, display_name, avatar_url) VALUES (?1, ?2, ?3)`,
    ).bind(userId, profile.displayName, profile.avatarUrl),
    env.DB.prepare(
      `INSERT INTO external_identities
        (provider, provider_subject, user_id, email, email_verified, display_name, avatar_url)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      transaction.provider,
      profile.subject,
      userId,
      profile.email,
      profile.emailVerified ? 1 : 0,
      profile.displayName,
      profile.avatarUrl,
    ),
  ]);
  return userId;
}

function oauthError(env: AppEnv, code: string): Response {
  const redirect = new URL(env.WEB_ORIGIN);
  redirect.searchParams.set("authError", code);
  return clearOAuthCookie(redirectResponse(redirect.toString()));
}

function clearOAuthCookie(response: Response): Response {
  return appendCookie(response, cookie(OAUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
  }));
}

export async function completeOAuth(
  request: Request,
  env: AppEnv,
  providerValue: string,
): Promise<Response> {
  if (!isProvider(providerValue)) return oauthError(env, "unknown-provider");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return oauthError(env, "incomplete-callback");
  if (readCookies(request).get(OAUTH_COOKIE) !== state) {
    return oauthError(env, "oauth-browser-mismatch");
  }
  const transaction = await transactionByState(env, state);
  if (
    !transaction
    || transaction.provider !== providerValue
    || transaction.consumed_at
    || Date.parse(transaction.expires_at) <= Date.now()
  ) {
    return oauthError(env, "invalid-transaction");
  }

  const consumed = await env.DB.prepare(
    `UPDATE oauth_transactions SET consumed_at = CURRENT_TIMESTAMP
     WHERE state_hash = ?1 AND consumed_at IS NULL`,
  )
    .bind(transaction.state_hash)
    .run();
  if (consumed.meta.changes !== 1) return oauthError(env, "replayed-callback");

  try {
    if (transaction.mode === "link") {
      const session = await readSession(request, env);
      if (!session || session.userId !== transaction.session_user_id) {
        return oauthError(env, "link-session-changed");
      }
    }
    const context = await transactionContext(env, transaction.sealed_context);
    const tokens = await exchangeCode(env, providerValue, code, context.codeVerifier);
    const profile = await providerProfile(env, providerValue, tokens, context.nonce);
    const userId = await resolveUser(env, transaction, profile);
    const redirect = new URL(transaction.return_to, env.WEB_ORIGIN);
    redirect.searchParams.set("auth", transaction.mode === "link" ? "linked" : "signed-in");
    const response = clearOAuthCookie(redirectResponse(redirect.toString()));
    if (transaction.mode === "login") {
      return setSessionCookies(
        response,
        await createSession(userId, request, env),
        env,
      );
    }
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: "oauth.callback.failed",
      provider: providerValue,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return oauthError(env, "provider-verification-failed");
  }
}
