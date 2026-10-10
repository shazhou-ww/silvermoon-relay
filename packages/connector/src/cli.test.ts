import { describe, expect, it } from "vitest";
import { parseCliOptions } from "./cli.js";

describe("parseCliOptions", () => {
  it("uses explicit arguments over environment defaults", () => {
    expect(parseCliOptions([
      "--id",
      "studio-laptop",
      "--relay",
      "https://relay.example.com",
      "--display-name",
      "Studio laptop",
      "--approve-all",
    ], {
      SILVERMOON_CONNECTOR_ID: "environment-device",
      SILVERMOON_RELAY_URL: "https://ignored.example.com",
    })).toEqual({
      connectorId: "studio-laptop",
      relayUrl: "https://relay.example.com",
      displayName: "Studio laptop",
      tokenFile: undefined,
      workingDirectory: undefined,
      copilotHome: undefined,
      vscodeUserDataDirectory: undefined,
      model: undefined,
      approveAllPermissions: true,
    });
  });

  it("supports environment configuration", () => {
    expect(parseCliOptions([], {
      SILVERMOON_CONNECTOR_ID: "desktop:copilot",
      SILVERMOON_RELAY_URL: "http://localhost:8787",
      SILVERMOON_CONNECTION_TOKEN_FILE: "C:\\secrets\\relay-token",
      SILVERMOON_COPILOT_HOME: "C:\\copilot",
      SILVERMOON_COPILOT_MODEL: "gpt-5",
      SILVERMOON_VSCODE_USER_DATA_DIR: "C:\\vscode-data",
    })).toMatchObject({
      connectorId: "desktop:copilot",
      relayUrl: "http://localhost:8787",
      tokenFile: "C:\\secrets\\relay-token",
      copilotHome: "C:\\copilot",
      vscodeUserDataDirectory: "C:\\vscode-data",
      model: "gpt-5",
      approveAllPermissions: false,
    });
  });

  it("rejects missing, malformed, and unknown options", () => {
    expect(() => parseCliOptions([], {})).toThrow("--id is required.");
    expect(() => parseCliOptions(["--id", "invalid id"], {})).toThrow(
      "--id must start",
    );
    expect(() => parseCliOptions(["--wat"], {})).toThrow(
      "Unknown option: --wat",
    );
  });
});
