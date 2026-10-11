# Silvermoon Connector

`silvermoon-connector` exposes GitHub Copilot sessions on one device through
Silvermoon Relay. It uses the official `@github/copilot-sdk` for persisted
Copilot sessions and the official Agent Host Protocol (AHP) for live sessions
owned by VS Code. It does not invoke or depend on the Silvermoon CLI.

Connector and relay communicate through a typed tRPC router over one
authenticated WebSocket:

- mutations publish registration, heartbeats, session inventory, command
  results, and activity;
- a subscription carries list, create, and follow-up commands to the device.

## Requirements

- Node.js 22.12 or newer
- A locally authenticated GitHub Copilot account
- A connection token created in the Silvermoon Relay Web UI
- VS Code with Agent Host support when live editor sessions should be exposed

The Copilot SDK includes its verified platform runtime when available. Set
`COPILOT_CLI_PATH` only when an existing Copilot CLI installation should be
used instead.

Install the public package after it has been released:

```powershell
pnpm add @silvermoon-ai/connector
```

The published package includes the Silvermoon protocol and RPC implementation
used by the connector. The monorepo's private workspace packages are not
runtime dependencies for consumers.

## Run

In the Relay Web UI, choose **Add device**, name the device once, and copy the
generated profile to `$HOME/.silvermoon/connector.yaml`. The connector reads
the Relay address, token, and non-sensitive options from that file:

```powershell
silvermoon-connector
```

The connector refuses to read a profile that is accessible by another
operating-system identity. Profile updates made with `--write-config` use an
atomic same-directory replacement, mode `0600` on POSIX, and a protected ACL
for only the current user on Windows:

```powershell
$env:SILVERMOON_CONNECTION_TOKEN = "smr1_..."
silvermoon-connector --relay https://relay.silvermoon.work --write-config
```

Resolution order for the token is `SILVERMOON_CONNECTION_TOKEN`, an explicit
`--token-file` or `SILVERMOON_CONNECTION_TOKEN_FILE`, then the profile. CLI
options and the existing Relay/Copilot environment variables override profile
values. `--id`, `--display-name`, and `SILVERMOON_CONNECTOR_ID` are no longer
accepted because Relay derives the stable device identity and name from the
token.

For a checkout of this monorepo:

```powershell
pnpm --filter @silvermoon-ai/connector build
node .\packages\connector\dist\cli.js --help
```

Relay tokens are sent only in the WebSocket `Authorization` header and are
never printed or included in connector logs.

The SDK uses the local GitHub Copilot authentication available to the user.
`--approve-all` allows remotely initiated sessions to approve every Copilot
permission request. This enables unattended tool execution and local side
effects, so it is intentionally opt-in.

The connector automatically reads the current user's VS Code Agent Host
endpoint registry and connects to compatible AHP 0.10 or 1.x hosts. Run the
connector as the same operating-system user as VS Code. For a portable or
custom installation, set `SILVERMOON_VSCODE_USER_DATA_DIR` or pass
`--vscode-user-data-dir <path>`.

Agent Host endpoint tokens stay in connector memory, are used only for the
local WebSocket upgrade, and are never printed or persisted by the connector.
The live provider exposes the default chat for history and follow-up messages.
When that chat is already running, follow-up text is queued behind the active
turn; otherwise it starts a new turn. If VS Code disconnects, sessions that
also exist in SDK storage fall back to their persisted metadata.

## Embed

The package exports `CopilotAgentAdapter`, `VsCodeAgentHostProvider`,
`SilvermoonConnector`, and the generic `AgentAdapter` and
`AgentHostSessionProvider` contracts for embedding a connector in another
local process or adding another agent implementation later.
