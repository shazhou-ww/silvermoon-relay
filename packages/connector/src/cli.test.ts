import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliOptions, resolveCliOptions } from "./cli.js";
import { writeProfile } from "./config.js";

describe("connector CLI configuration", () => {
  it("allows direct configuration before a profile exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "silvermoon-cli-"));
    const profilePath = join(directory, "missing", "connector.yaml");
    const parsed = parseCliOptions(["--config", profilePath]);
    if ("help" in parsed) throw new Error("Unexpected help result.");
    await expect(resolveCliOptions(parsed, {
      SILVERMOON_CONNECTION_TOKEN: "environment-token",
    })).resolves.toMatchObject({
      token: "environment-token",
      profilePath,
    });
  });

  it("uses direct token, explicit options, and environment before profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "silvermoon-cli-"));
    const profilePath = join(directory, "connector.yaml");
    await writeProfile({
      version: 1,
      relay: "https://profile.example.com",
      token: "profile-token",
      options: { model: "profile-model" },
    }, profilePath);
    const parsed = parseCliOptions([
      "--config",
      profilePath,
      "--relay",
      "https://argument.example.com",
      "--model",
      "argument-model",
      "--approve-all",
    ]);
    if ("help" in parsed) throw new Error("Unexpected help result.");
    await expect(resolveCliOptions(parsed, {
      SILVERMOON_CONNECTION_TOKEN: "environment-token",
      SILVERMOON_RELAY_URL: "https://environment.example.com",
    })).resolves.toMatchObject({
      relayUrl: "https://argument.example.com",
      token: "environment-token",
      model: "argument-model",
      approveAllPermissions: true,
    });
  });

  it("uses an explicit token file before profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "silvermoon-cli-"));
    const profilePath = join(directory, "connector.yaml");
    const tokenPath = join(directory, "token");
    await writeFile(tokenPath, "file-token\n", { mode: 0o600 });
    await writeProfile({
      version: 1,
      relay: "https://profile.example.com",
      token: "profile-token",
    }, profilePath);
    const parsed = parseCliOptions([
      "--config",
      profilePath,
      "--token-file",
      tokenPath,
    ]);
    if ("help" in parsed) throw new Error("Unexpected help result.");
    await expect(resolveCliOptions(parsed, {})).resolves.toMatchObject({
      relayUrl: "https://profile.example.com",
      token: "file-token",
    });
  });

  it("rejects legacy identity settings", async () => {
    expect(() => parseCliOptions(["--id", "studio-laptop"])).toThrow(
      "device identity is managed by Relay",
    );
    const parsed = parseCliOptions([]);
    if ("help" in parsed) throw new Error("Unexpected help result.");
    await expect(resolveCliOptions(parsed, {
      SILVERMOON_CONNECTOR_ID: "legacy",
    })).rejects.toThrow("SILVERMOON_CONNECTOR_ID is no longer supported");
  });
});
