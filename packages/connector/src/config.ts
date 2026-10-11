import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const profileSchema = z.object({
  version: z.literal(1),
  relay: z.url(),
  token: z.string().trim().min(1),
  options: z.object({
    workingDirectory: z.string().min(1).optional(),
    copilotHome: z.string().min(1).optional(),
    vscodeUserDataDirectory: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    approveAllPermissions: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export type ConnectorProfile = z.infer<typeof profileSchema>;

export function defaultProfilePath(home = homedir()): string {
  return join(home, ".silvermoon", "connector.yaml");
}

async function windowsAcl(path: string): Promise<{
  current: string;
  allowed: string[];
}> {
  const script = [
    "$current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$file = [System.IO.FileInfo]::new($env:SILVERMOON_PROFILE_PATH)",
    "$acl = $file.GetAccessControl()",
    "$allowed = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object AccessControlType -eq ([Security.AccessControl.AccessControlType]::Allow) | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)",
    "[pscustomobject]@{ current = $current; allowed = $allowed } | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      env: { ...process.env, SILVERMOON_PROFILE_PATH: path },
    },
  );
  return z.object({
    current: z.string().min(1),
    allowed: z.array(z.string()),
  }).parse(JSON.parse(stdout));
}

async function restrictWindowsAcl(path: string): Promise<void> {
  const script = [
    "$file = [System.IO.FileInfo]::new($env:SILVERMOON_PROFILE_PATH)",
    "$acl = $file.GetAccessControl()",
    "$acl.SetAccessRuleProtection($true, $false)",
    "foreach ($rule in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleAll($rule) }",
    "$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)",
    "$acl.AddAccessRule($rule)",
    "$file.SetAccessControl($acl)",
  ].join("; ");
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      env: { ...process.env, SILVERMOON_PROFILE_PATH: path },
    },
  );
}

export async function assertSecureProfile(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") {
    const acl = await windowsAcl(path);
    if (
      acl.allowed.length !== 1
      || acl.allowed[0].toUpperCase() !== acl.current.toUpperCase()
    ) {
      throw new Error(
        `Refusing to read ${path}: Windows ACL grants access beyond the current user.`,
      );
    }
    return;
  }
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to read ${path}: permissions must be 0600.`,
    );
  }
}

export async function readProfile(
  path = defaultProfilePath(),
): Promise<ConnectorProfile | null> {
  try {
    await assertSecureProfile(path);
    return profileSchema.parse(parse(await readFile(path, "utf8")));
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function writeProfile(
  profile: ConnectorProfile,
  path = defaultProfilePath(),
): Promise<void> {
  const value = profileSchema.parse(profile);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(
    directory,
    `.connector.yaml.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(stringify(value), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (process.platform === "win32") await restrictWindowsAcl(temporary);
    else await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch((cleanupError: unknown) => {
      if (
        !(cleanupError instanceof Error)
        || !("code" in cleanupError)
        || cleanupError.code !== "ENOENT"
      ) {
        throw cleanupError;
      }
    });
    throw error;
  }
}
