import type { AppEnv } from "./env";

export function json(
  value: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(value, init);
}

export function appendCookie(response: Response, cookie: string): Response {
  response.headers.append("set-cookie", cookie);
  return response;
}

export function cookie(
  name: string,
  value: string,
  options: {
    domain?: string;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: "Lax" | "Strict";
  } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    "Secure",
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

export function readCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const item of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    cookies.set(
      item.slice(0, separator).trim(),
      decodeURIComponent(item.slice(separator + 1).trim()),
    );
  }
  return cookies;
}

export function withCors(
  response: Response,
  request: Request,
  env: AppEnv,
): Response {
  const origin = request.headers.get("origin");
  if (origin === env.WEB_ORIGIN) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("access-control-allow-credentials", "true");
    response.headers.set("vary", "Origin");
  }
  return response;
}

export function isAllowedOrigin(request: Request, env: AppEnv): boolean {
  return request.headers.get("origin") === env.WEB_ORIGIN;
}
