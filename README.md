# Silvermoon Relay

Silvermoon Relay is an online control plane for agent sessions that run on
your own devices. Each device runs a local connector; the Web UI can then
create sessions, follow their activity, and continue the conversation from
any signed-in browser.

The project uses Silvermoon as its product concept, but it does **not** depend
on the Silvermoon CLI or its repository format. The first connector adapter
controls persisted GitHub Copilot sessions through the official
`@github/copilot-sdk` and live VS Code sessions through the official Agent
Host Protocol (AHP).

## Architecture

```text
Browser
  │ authenticated HTTP control plane
  ▼
Cloudflare Worker ─── D1 (connectors, sessions, events, commands)
  │
  │ authenticated tRPC over WebSocket
  ▼
silvermoon-connector ─── GitHub Copilot SDK ─── local Copilot sessions
                     └── VS Code Agent Host ─── live Copilot sessions
```

- `apps/web`: React/Vite dashboard for devices, sessions, live activity,
  follow-up messages, identities, and connection tokens.
- `apps/worker`: Cloudflare Worker, Durable Object WebSocket relay, OIDC
  login, HTTP control plane, and D1 migrations.
- `packages/protocol`: runtime-validated connector, session, event, and command
  domain schemas.
- `packages/rpc`: the typed tRPC contract shared by the relay and connectors.
- `packages/connector`: publishable `silvermoon-connector` CLI and GitHub
  Copilot adapter.

The connector sends registration, inventory, command results, and session
events through tRPC mutations. The relay sends session commands through a
tRPC subscription on the same WebSocket. Persisted session history is loaded
on demand, uploaded in bounded event batches, and coalesced by the relay when
the same session is already synchronized or has a history command in flight.
The connector also discovers Agent Host endpoints published by VS Code for the
current operating-system user. Live Agent Host metadata wins when the same
session is also present in SDK storage; the connector falls back to persisted
SDK metadata when the host disconnects.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.27.0
- A Cloudflare account only for remote resource operations
- A locally authenticated GitHub Copilot account on connector devices

No production credential is required for installation, tests, local D1, or a
Worker dry run.

## Develop

```powershell
pnpm install
pnpm --filter @silvermoon-ai/worker d1:migrate:local
pnpm dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local` when the relay origin
needs to differ from `https://relay.silvermoon.work`. Put local Worker secrets
in `apps/worker/.dev.vars`; neither file is committed.

The message stream opens at the latest visible event and follows updates only
while within 64 CSS pixels of the bottom. Scrolling farther up preserves the
reading position; **Jump to latest** returns to the bottom and resumes following.
The control supports keyboard activation and respects reduced-motion preferences.

Run the Web browser regressions (mocked relay API, no production credentials):

```powershell
pnpm --filter @silvermoon-ai/web exec playwright install chromium
pnpm --filter @silvermoon-ai/web test:browser
```

These cover desktop and narrow-screen positioning, history protection, Session
switching, filtering, reconnects, layout changes, and accessible return controls.

## Run a connector

Create a connection token in the Web UI, build the connector, and start it on
the device that owns the Copilot sessions:

```powershell
pnpm --filter @silvermoon-ai/connector build
$env:SILVERMOON_CONNECTION_TOKEN = "smr1_..."
node .\packages\connector\dist\cli.js `
  --id studio-laptop `
  --display-name "Studio laptop" `
  --working-directory D:\Code\my-project
```

The WebSocket endpoint is derived from the relay origin:

```text
wss://relay.silvermoon.work/v1/connectors/<connector-id>/connect
```

The token is sent only in the WebSocket `Authorization` header. It is never
placed in the URL or printed. A protected token file can be used instead:

```powershell
node .\packages\connector\dist\cli.js `
  --id studio-laptop `
  --token-file C:\Users\me\.config\silvermoon-relay-token
```

Run `silvermoon-connector --help` for all environment variables and options.
`--approve-all` allows remotely initiated sessions to approve every Copilot
permission request and can trigger local side effects. It is intentionally
opt-in.

Live VS Code sessions are discovered automatically from the current user's
VS Code data directory. Use `--vscode-user-data-dir` or
`SILVERMOON_VSCODE_USER_DATA_DIR` for portable, Insiders, or other custom
profiles. The connector must run as the same operating-system user as VS Code;
Agent Host connection tokens are read from the owner-local endpoint registry,
used only for the local WebSocket upgrade, and never logged or persisted by
the connector.

## Identity and connection tokens

The Web app signs users in through Google, Microsoft Account, or GitHub.
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
token is returned only when it is created or rotated; D1 stores its public ID,
display hint, metadata, and a peppered HMAC. Browser sessions and OAuth
provider tokens are separate credentials and cannot connect a device.

During secret rotation, set the previous session secret or token pepper in the
matching `_PREVIOUS` binding until old sessions or tokens have been rotated,
then remove it.

## Validate

```powershell
pnpm check
pnpm --filter @silvermoon-ai/worker d1:migrate:local
pnpm --filter @silvermoon-ai/worker build
node .\packages\connector\dist\cli.js --help
```

## Package scope migration

Workspace packages now use the Silvermoon-AI npm scope:

| Previous package | New package | Publication boundary |
| --- | --- | --- |
| `@silvermoon-relay/connector` | `@silvermoon-ai/connector` | Public |
| `@silvermoon-relay/protocol` | `@silvermoon-ai/protocol` | Private workspace package |
| `@silvermoon-relay/rpc` | `@silvermoon-ai/rpc` | Private workspace package |
| `@silvermoon-relay/worker` | `@silvermoon-ai/worker` | Private application package |
| `@silvermoon-relay/web` | `@silvermoon-ai/web` | Private application package |

Consumers of the connector should replace the package spec and imports with
`@silvermoon-ai/connector`. The `silvermoon-connector` executable name and
relay protocol remain unchanged. The public connector bundles the protocol
and RPC implementation it needs, so consumers do not install the private
workspace packages. After the new package is available, registry maintainers
should deprecate the legacy connector with a message that points to
`@silvermoon-ai/connector`; the private workspace packages must not be
published under either scope.

## Release

Pull requests and pushes to `main` or `release` run the quality gate. Only a
push produced by merging into `release` runs deployment:

1. apply remote D1 migrations;
2. deploy the Worker and Durable Object;
3. deploy `apps/web/dist` to the `silvermoon-work` Pages project.

The repository must provide `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets. Scope the token only to the
target account's Workers Scripts, D1, and Pages edit operations.
