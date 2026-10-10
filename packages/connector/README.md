# Silvermoon Connector

`silvermoon-connector` exposes GitHub Copilot sessions on one device through
Silvermoon Relay. It uses the official `@github/copilot-sdk` to control the
local Copilot CLI runtime; it does not invoke or depend on the Silvermoon CLI.

Connector and relay communicate through a typed tRPC router over one
authenticated WebSocket:

- mutations publish registration, heartbeats, session inventory, command
  results, and activity;
- a subscription carries list, create, and follow-up commands to the device.

## Requirements

- Node.js 22.12 or newer
- A locally authenticated GitHub Copilot account
- A connection token created in the Silvermoon Relay Web UI

The Copilot SDK includes its verified platform runtime when available. Set
`COPILOT_CLI_PATH` only when an existing Copilot CLI installation should be
used instead.

## Run

After installing the package, provide a stable device ID and a relay token:

```powershell
$env:SILVERMOON_CONNECTION_TOKEN = "smr1_..."
silvermoon-connector `
  --id studio-laptop `
  --display-name "Studio laptop" `
  --working-directory D:\Code\my-project
```

For a checkout of this monorepo:

```powershell
pnpm --filter @silvermoon-relay/connector build
node .\packages\connector\dist\cli.js --help
```

Use `--token-file` instead of the environment variable when a protected
credential file is more appropriate. Relay tokens are sent only in the
WebSocket `Authorization` header and are never printed.

The SDK uses the local GitHub Copilot authentication available to the user.
`--approve-all` allows remotely initiated sessions to approve every Copilot
permission request. This enables unattended tool execution and local side
effects, so it is intentionally opt-in.

## Embed

The package exports `CopilotAgentAdapter`, `SilvermoonConnector`, and the
generic `AgentAdapter` contract for embedding a connector in another local
process or adding another agent implementation later.
