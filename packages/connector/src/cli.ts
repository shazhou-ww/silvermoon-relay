#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { CopilotAgentAdapter } from "./copilot-adapter.js";
import {
  defaultProfilePath,
  readProfile,
  writeProfile,
  type ConnectorProfile,
} from "./config.js";
import { SilvermoonConnector } from "./connector.js";

interface ParsedCliOptions {
  relayUrl?: string;
  tokenFile?: string;
  profilePath: string;
  workingDirectory?: string;
  copilotHome?: string;
  vscodeUserDataDirectory?: string;
  model?: string;
  approveAllPermissions?: boolean;
  writeConfig: boolean;
}

export interface CliOptions {
  relayUrl: string;
  token: string;
  profilePath: string;
  workingDirectory?: string;
  copilotHome?: string;
  vscodeUserDataDirectory?: string;
  model?: string;
  approveAllPermissions: boolean;
  writeConfig: boolean;
}

export const HELP = `silvermoon-connector

Expose local GitHub Copilot sessions through Silvermoon Relay.

Usage:
  silvermoon-connector [options]

Options:
  --relay <url>                Relay origin
  --token-file <path>          Read the relay connection token from a file
  --config <path>              Connector profile (default: ~/.silvermoon/connector.yaml)
  --write-config               Atomically save the resolved settings and exit
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
  SILVERMOON_RELAY_URL
  SILVERMOON_COPILOT_HOME
  SILVERMOON_COPILOT_MODEL
  SILVERMOON_VSCODE_USER_DATA_DIR

Token priority is SILVERMOON_CONNECTION_TOKEN, an explicit token file, then
the profile. Explicit options and environment variables override profile
settings. Device identity and display name are managed by Relay from the token;
legacy --id, --display-name, and SILVERMOON_CONNECTOR_ID are not accepted.
Relay and Agent Host tokens are never printed. --approve-all enables remote
tool side effects; omit it unless this connector runs in a trusted environment.
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
): ParsedCliOptions | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const values = new Map<string, string>();
  let approveAllPermissions: boolean | undefined;
  let writeConfig = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--approve-all") {
      approveAllPermissions = true;
      continue;
    }
    if (option === "--write-config") {
      writeConfig = true;
      continue;
    }
    if (option === "--id" || option === "--display-name") {
      throw new Error(
        `${option} is no longer supported; device identity is managed by Relay from the token.`,
      );
    }
    if (![
      "--relay",
      "--token-file",
      "--config",
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
  return {
    relayUrl: values.get("--relay"),
    tokenFile: values.get("--token-file"),
    profilePath: values.get("--config") ?? defaultProfilePath(),
    workingDirectory: values.get("--working-directory"),
    copilotHome: values.get("--copilot-home"),
    vscodeUserDataDirectory: values.get("--vscode-user-data-dir"),
    model: values.get("--model"),
    approveAllPermissions,
    writeConfig,
  };
}

async function tokenFromFile(path: string): Promise<string> {
  const token = (await readFile(path, "utf8")).trim();
  if (!token) throw new Error("Connection token file is empty.");
  return token;
}

export async function resolveCliOptions(
  parsed: ParsedCliOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CliOptions> {
  if (environment.SILVERMOON_CONNECTOR_ID) {
    throw new Error(
      "SILVERMOON_CONNECTOR_ID is no longer supported; device identity is managed by Relay from the token.",
    );
  }
  const profile = await readProfile(parsed.profilePath);
  const tokenFile = parsed.tokenFile
    ?? environment.SILVERMOON_CONNECTION_TOKEN_FILE;
  const token = environment.SILVERMOON_CONNECTION_TOKEN?.trim()
    || (tokenFile ? await tokenFromFile(tokenFile) : profile?.token);
  if (!token) {
    throw new Error(
      "Set SILVERMOON_CONNECTION_TOKEN, provide --token-file, or configure ~/.silvermoon/connector.yaml.",
    );
  }
  return {
    relayUrl: parsed.relayUrl
      ?? environment.SILVERMOON_RELAY_URL
      ?? profile?.relay
      ?? "https://relay.silvermoon.work",
    token,
    profilePath: parsed.profilePath,
    workingDirectory: parsed.workingDirectory
      ?? profile?.options?.workingDirectory,
    copilotHome: parsed.copilotHome
      ?? environment.SILVERMOON_COPILOT_HOME
      ?? profile?.options?.copilotHome,
    vscodeUserDataDirectory: parsed.vscodeUserDataDirectory
      ?? environment.SILVERMOON_VSCODE_USER_DATA_DIR
      ?? profile?.options?.vscodeUserDataDirectory,
    model: parsed.model
      ?? environment.SILVERMOON_COPILOT_MODEL
      ?? profile?.options?.model,
    approveAllPermissions: parsed.approveAllPermissions
      ?? profile?.options?.approveAllPermissions
      ?? false,
    writeConfig: parsed.writeConfig,
  };
}

function profileFromOptions(options: CliOptions): ConnectorProfile {
  return {
    version: 1,
    relay: options.relayUrl,
    token: options.token,
    options: {
      ...(options.workingDirectory
        ? { workingDirectory: options.workingDirectory }
        : {}),
      ...(options.copilotHome ? { copilotHome: options.copilotHome } : {}),
      ...(options.vscodeUserDataDirectory
        ? { vscodeUserDataDirectory: options.vscodeUserDataDirectory }
        : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.approveAllPermissions
        ? { approveAllPermissions: true }
        : {}),
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseCliOptions(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(HELP);
    return;
  }
  const options = await resolveCliOptions(parsed, process.env);
  if (options.writeConfig) {
    await writeProfile(profileFromOptions(options), options.profilePath);
    process.stdout.write(`Saved connector profile to ${options.profilePath}.\n`);
    return;
  }
  const adapter = new CopilotAgentAdapter({
    workingDirectory: options.workingDirectory,
    baseDirectory: options.copilotHome,
    vscodeUserDataDirectory: options.vscodeUserDataDirectory,
    model: options.model,
    approveAllPermissions: options.approveAllPermissions,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  const connector = new SilvermoonConnector({
    relayUrl: options.relayUrl,
    token: options.token,
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
