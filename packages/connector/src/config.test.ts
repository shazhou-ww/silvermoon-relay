import { chmod, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProfile, writeProfile } from "./config.js";

describe("connector profile", () => {
  it("atomically writes and reads a 0600 profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "silvermoon-profile-"));
    const path = join(directory, ".silvermoon", "connector.yaml");
    await writeProfile({
      version: 1,
      relay: "https://relay.example.com",
      token: "secret-token",
      options: { approveAllPermissions: false },
    }, path);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    await expect(readProfile(path)).resolves.toMatchObject({
      token: "secret-token",
      relay: "https://relay.example.com",
    });
    expect(await readFile(path, "utf8")).not.toContain(".tmp");
  });

  it.runIf(process.platform !== "win32")(
    "rejects a profile readable by another user",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "silvermoon-profile-"));
      const path = join(directory, "connector.yaml");
      await writeProfile({
        version: 1,
        relay: "https://relay.example.com",
        token: "secret-token",
      }, path);
      await chmod(path, 0o644);
      await expect(readProfile(path)).rejects.toThrow(
        "permissions must be 0600",
      );
    },
  );
});
