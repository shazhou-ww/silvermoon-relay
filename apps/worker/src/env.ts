export type OAuthProvider = "google" | "microsoft" | "github";

export interface AuthSecrets {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  SESSION_SECRET_PREVIOUS?: string;
  CONNECTION_TOKEN_PEPPER: string;
  CONNECTION_TOKEN_PEPPER_PREVIOUS?: string;
}

export type AppEnv = Env & AuthSecrets & {
  AUTH_BASE_URL: string;
  WEB_ORIGIN: string;
};
