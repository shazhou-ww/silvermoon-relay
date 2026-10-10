#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { connectorIdSchema } from "@silvermoon-ai/protocol";
import { CopilotAgentAdapter } from "./copilot-adapter.js";
import { SilvermoonConnector } from "./connector.js";

export interface CliOptions {
  connectorId: string;
  relayUrl: string;
  displayName: string;
  tokenFile?: string;
  workingDirectory?: string;
  copilotHome?: string;
  vscodeUserDataDirectory?: string;
  model?: string;
  approveAllPermissions: boolean;
}

export const HELP = `silvermoon-connector

Expose local GitHub Copilot sessions through Silvermoon Relay.

Usage:
  silvermoon-connector --id <device-id> [options]

Required:
  --id <id>                    Stable ID for this device connector

Options:
  --relay <url>                Relay origin
  --display-name <name>        Device name shown in the dashboard
  --token-file <path>          Read the relay connection token from a file
  --working-directory <path>   Default working directory for Copilot sessions
  --copilot-home <path>        Override Copilot session/config storage
  --vscode-user-data-dir <path>
                               Override the VS Code user-data directory
  --model <model>              Default model (SDK default: auto)
  --approve-all                Auto-approve Copilot permission requests
  --help                       Show this help

Environment:
  SILVERMOON_CONNECTION_TOKEN
  SILVERMOON_CONNECTION_TOKEN_FILE
  SILVERMOON_CONNECTOR_ID
  SILVERMOON_RELAY_URL
  SILVERMOON_COPILOT_HOME
  SILVERMOON_COPILOT_MODEL
  SILVERMOON_VSCODE_USER_DATA_DIR

The connector uses the locally authenticated GitHub Copilot SDK runtime and
discovers live VS Code Agent Host sessions from the current user's local
endpoint registry. Relay and Agent Host tokens are never printed. --approve-all
enables remote tool side effects; omit it unless this connector runs in a
trusted environment.
`;

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parseCliOptions(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): CliOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const values = new Map<string, string>();
  let approveAllPermissions = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--approve-all") {
      approveAllPermissions = true;
      continue;
    }
    if (![
      "--id",
      "--relay",
      "--display-name",
      "--token-file",
      "--working-directory",
      "--copilot-home",
      "--vscode-user-data-dir",
      "--model",
    ].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    values.set(option, takeValue(argv, index, option));
    index += 1;
  }

  const connectorId = values.get("--id")
    ?? environment.SILVERMOON_CONNECTOR_ID;
  if (!connectorId) throw new Error("--id is required.");
  const parsedConnectorId = connectorIdSchema.safeParse(connectorId);
  if (!parsedConnectorId.success) {
    throw new Error(
      "--id must start with a letter or number and contain only letters, numbers, '.', '_', ':', or '-'.",
    );
  }
  return {
    connectorId: parsedConnectorId.data,
    relayUrl: values.get("--relay")
      ?? environment.SILVERMOON_RELAY_URL
      ?? "https://relay.silvermoon.work",
    displayName: values.get("--display-name") ?? hostname(),
    tokenFile: values.get("--token-file")
      ?? environment.SILVERMOON_CONNECTION_TOKEN_FILE,
    workingDirectory: values.get("--working-directory"),
    copilotHome: values.get("--copilot-home")
      ?? environment.SILVERMOON_COPILOT_HOME,
    vscodeUserDataDirectory: values.get("--vscode-user-data-dir")
      ?? environment.SILVERMOON_VSCODE_USER_DATA_DIR,
    model: values.get("--model")
      ?? environment.SILVERMOON_COPILOT_MODEL,
    approveAllPermissions,
  };
}

async function readToken(
  options: CliOptions,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const direct = environment.SILVERMOON_CONNECTION_TOKEN?.trim();
  if (direct) return direct;
  if (!options.tokenFile) {
    throw new Error(
      "Set SILVERMOON_CONNECTION_TOKEN or provide --token-file.",
    );
  }
  const token = (await readFile(options.tokenFile, "utf8")).trim();
  if (!token) throw new Error("Connection token file is empty.");
  return token;
}

async function main(): Promise<void> {
  const parsed = parseCliOptions(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(HELP);
    return;
  }
  const token = await readToken(parsed, process.env);
  const adapter = new CopilotAgentAdapter({
    workingDirectory: parsed.workingDirectory,
    baseDirectory: parsed.copilotHome,
    vscodeUserDataDirectory: parsed.vscodeUserDataDirectory,
    model: parsed.model,
    approveAllPermissions: parsed.approveAllPermissions,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  const connector = new SilvermoonConnector({
    relayUrl: parsed.relayUrl,
    token,
    connectorId: parsed.connectorId,
    displayName: parsed.displayName,
    adapter,
    log: (message) => process.stderr.write(`${message}\n`),
  });

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void connector.stop().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    connector.start();
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`silvermoon-connector: ${message}\n`);
    process.exitCode = 1;
  });
}
