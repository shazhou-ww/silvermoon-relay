# Silvermoon Relay

Silvermoon Relay is the Cloudflare-hosted upstream for Silvermoon daemons. This
repository is a pnpm TypeScript monorepo containing:

- `apps/web`: React, Vite, Tailwind CSS, and shadcn components for
  `silvermoon.work`.
- `apps/worker`: the `relay.silvermoon.work` Worker, a per-daemon Durable
  Object, and D1 migrations.
- `packages/protocol`: runtime-validated messages shared across relay clients
  and services.

## Requirements

- Node.js 24
- pnpm 10.27.0
- A Cloudflare account for remote resource operations

No production credential is required for installation, tests, local D1, or a
Worker dry run.

## Develop

```sh
pnpm install
pnpm --filter @silvermoon-relay/worker d1:migrate:local
pnpm dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local` only when the relay origin
needs to differ from `https://relay.silvermoon.work`. Put local Worker secrets
in `apps/worker/.dev.vars`; neither file is committed.

The daemon WebSocket endpoint is:

```text
wss://relay.silvermoon.work/v1/daemon/connect
```

Daemon clients send the access token in `Authorization: Bearer <token>` and the
stable daemon identity in `X-Silvermoon-Daemon-Id`. Tokens must never be placed
in URLs or logs.

## Identity and connection tokens

The Pages app signs users in through Google, Microsoft Account, or GitHub.
Production callbacks are:

```text
https://relay.silvermoon.work/auth/google/callback
https://relay.silvermoon.work/auth/microsoft/callback
https://relay.silvermoon.work/auth/github/callback
```

OAuth client credentials and relay security keys are Worker secrets:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SESSION_SECRET
SESSION_SECRET_PREVIOUS
CONNECTION_TOKEN_PEPPER
CONNECTION_TOKEN_PEPPER_PREVIOUS
```

Connection tokens use the `smr1_<public-id>_<secret>` format. The complete
token is returned only when it is created or rotated; D1 stores only its public
ID, display hint, metadata, and a peppered HMAC. Browser sessions and OAuth
provider tokens are separate credentials and cannot connect a daemon.
During secret rotation, set the previous session secret or token pepper in the
matching `_PREVIOUS` binding until all old sessions or tokens have been
rotated, then remove it.

## Validate

```sh
pnpm check
pnpm --filter @silvermoon-relay/worker d1:migrate:local
pnpm --filter @silvermoon-relay/worker build
```

## Release

Pull requests and pushes to `main` or `release` run the quality gate. Only a
push produced by merging into `release` runs deployment:

1. apply remote D1 migrations;
2. deploy the Worker and Durable Object;
3. deploy `apps/web/dist` to the `silvermoon-work` Pages project.

The repository must provide `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. The token should be scoped
only to the target account's Workers Scripts, D1, and Pages edit operations.
