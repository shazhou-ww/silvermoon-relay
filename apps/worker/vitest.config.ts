import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          GOOGLE_CLIENT_ID: "google-client",
          GOOGLE_CLIENT_SECRET: "google-secret",
          MICROSOFT_CLIENT_ID: "microsoft-client",
          MICROSOFT_CLIENT_SECRET: "microsoft-secret",
          GITHUB_CLIENT_ID: "github-client",
          GITHUB_CLIENT_SECRET: "github-secret",
          SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
          CONNECTION_TOKEN_PEPPER:
            "test-connection-pepper-with-sufficient-entropy",
        },
      },
    }),
  ],
});
