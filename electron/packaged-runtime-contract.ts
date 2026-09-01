import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PACKAGED_RUNTIME_CONTRACT_FILE =
  "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";
const MAX_CONTRACT_BYTES = 64 * 1024;

interface ContractMember {
  path: string;
  size: number;
  sha256: string;
}

interface PackagedRuntimeContract {
  schema: string;
  platform: string;
  arch: string;
  product_backend: string;
  python_role: string;
  sidecar: ContractMember;
  python_plugin_host: {
    mode: string;
    member: ContractMember | null;
  };
}

export interface VerifiedPackagedRuntime {
  contractPath: string;
  sidecarPath: string;
  pythonPluginHostPath: string | null;
  pythonPluginHostError: string | null;
}

function hashFile(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function validateMember(
  backendRoot: string,
  label: string,
  member: ContractMember | null | undefined,
  platform: NodeJS.Platform,
): string {
  if (
    !member ||
    typeof member.path !== "string" ||
    !Number.isSafeInteger(member.size) ||
    member.size < 1 ||
    typeof member.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(member.sha256)
  ) {
    throw new Error(`Invalid ${label} member in packaged runtime contract`);
  }
  const normalized = path.normalize(member.path);
  if (
    path.isAbsolute(member.path) ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Invalid ${label} path in packaged runtime contract`);
  }
  const memberPath = path.join(backendRoot, normalized);
  if (!fs.existsSync(memberPath)) {
    throw new Error(`${label} not found: ${memberPath}`);
  }
  const stat = fs.statSync(memberPath);
  if (
    !stat.isFile() ||
    ((stat.size !== member.size || hashFile(memberPath) !== member.sha256) &&
      !hasValidPlatformSignature(memberPath, platform))
  ) {
    throw new Error(`${label} integrity mismatch: ${memberPath}`);
  }
  return memberPath;
}

function hasValidPlatformSignature(
  filePath: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "darwin") {
    return spawnSync(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", filePath],
      { stdio: "ignore" },
    ).status === 0;
  }
  if (platform === "win32") {
    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]; if ($signature.Status -eq 'Valid') { exit 0 } else { exit 1 }",
        filePath,
      ],
      { stdio: "ignore", windowsHide: true },
    ).status === 0;
  }
  return false;
}

/**
 * Verify the product-owned Rust backend before spawn. A missing or altered
 * bundled CPython disables only the explicit library/plugin host; it never
 * changes the selected product backend or starts an HTTP compatibility server.
 */
export function verifyPackagedRuntimeContract({
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
}: {
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}): VerifiedPackagedRuntime {
  const backendRoot = path.join(resourcesPath, "backend");
  const contractPath = path.join(
    backendRoot,
    "native",
    PACKAGED_RUNTIME_CONTRACT_FILE,
  );
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Packaged runtime contract not found: ${contractPath}`);
  }
  const raw = fs.readFileSync(contractPath);
  if (raw.length > MAX_CONTRACT_BYTES) {
    throw new Error("Packaged runtime contract exceeds 64 KiB");
  }
  let contract: PackagedRuntimeContract;
  try {
    contract = JSON.parse(raw.toString("utf8")) as PackagedRuntimeContract;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid packaged runtime contract JSON: ${detail}`);
  }
  if (
    contract.schema !== CONTRACT_SCHEMA ||
    contract.platform !== platform ||
    contract.arch !== arch ||
    contract.product_backend !== "rust-sidecar" ||
    contract.python_role !== "library-plugin-host-only"
  ) {
    throw new Error("Packaged runtime contract metadata mismatch");
  }
  const expectedSidecar = path.join(
    "native",
    platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar",
  );
  if (path.normalize(contract.sidecar?.path ?? "") !== expectedSidecar) {
    throw new Error("Packaged runtime contract selects an unexpected sidecar path");
  }
  const sidecarPath = validateMember(
    backendRoot,
    "Native Studio sidecar",
    contract.sidecar,
    platform,
  );

  const plugin = contract.python_plugin_host;
  if (!plugin || !["external-explicit", "bundled-required"].includes(plugin.mode)) {
    throw new Error("Invalid Python plugin-host policy in packaged runtime contract");
  }
  if (plugin.mode === "external-explicit") {
    if (plugin.member !== null) {
      throw new Error("External Python plugin-host policy must not select a member");
    }
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError: null,
    };
  }

  const expectedPython = platform === "win32"
    ? path.join("python-runtime", "python", "python.exe")
    : path.join("python-runtime", "python", "bin", "python3");
  try {
    if (path.normalize(plugin.member?.path ?? "") !== expectedPython) {
      throw new Error(
        "Packaged runtime contract selects an unexpected Python plugin host",
      );
    }
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath: validateMember(
        backendRoot,
        "Bundled Python plugin host",
        plugin.member,
        platform,
      ),
      pythonPluginHostError: null,
    };
  } catch (error) {
    return {
      contractPath,
      sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError:
        error instanceof Error ? error.message : String(error),
    };
  }
}
