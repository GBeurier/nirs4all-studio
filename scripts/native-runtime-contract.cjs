const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CONTRACT_FILE = "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function describeFile(filePath, relativePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Packaged runtime member is not a file: ${filePath}`);
  }
  return {
    path: relativePath.split(path.sep).join("/"),
    size: stat.size,
    sha256: sha256File(filePath),
  };
}

function bundledPythonRelativePath(platform) {
  return platform === "win32"
    ? path.join("python-runtime", "python", "python.exe")
    : path.join("python-runtime", "python", "bin", "python3");
}

function bundledMethodsRelativePath(platform) {
  if (platform === "win32") return path.join("native", "n4m.dll");
  if (platform === "darwin") return path.join("native", "libn4m.dylib");
  return path.join("native", "libn4m.so");
}

function createRuntimeContract({
  backendRoot,
  platform = process.platform,
  arch = process.arch,
  methodsLibraryPath = null,
}) {
  const sidecarName = platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar";
  const sidecarRelativePath = path.join("native", sidecarName);
  const sidecarPath = path.join(backendRoot, sidecarRelativePath);
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`Native Studio sidecar not found: ${sidecarPath}`);
  }

  const runtimeReadyPath = path.join(
    backendRoot,
    "python-runtime",
    "RUNTIME_READY.json",
  );
  const hasBundledRuntime = fs.existsSync(runtimeReadyPath);
  let pythonPluginHost = {
    mode: "external-explicit",
    member: null,
  };
  if (hasBundledRuntime) {
    const pythonRelativePath = bundledPythonRelativePath(platform);
    const pythonPath = path.join(backendRoot, pythonRelativePath);
    if (!fs.existsSync(pythonPath)) {
      throw new Error(
        `Bundled runtime marker exists but its Python plugin host is missing: ${pythonPath}`,
      );
    }
    pythonPluginHost = {
      mode: "bundled-required",
      member: describeFile(pythonPath, pythonRelativePath),
    };
  }
  const methodsRelativePath = bundledMethodsRelativePath(platform);
  const methodsPath = path.join(backendRoot, methodsRelativePath);
  if (
    methodsLibraryPath !== null &&
    path.resolve(methodsLibraryPath) !== path.resolve(methodsPath)
  ) {
    throw new Error("Native Methods stage path is outside the frozen packaged location");
  }
  if (methodsLibraryPath !== null) {
    const methodsStat = fs.lstatSync(methodsPath);
    if (
      methodsStat.isSymbolicLink() ||
      !methodsStat.isFile() ||
      fs.realpathSync.native(methodsPath) !== path.resolve(methodsPath)
    ) {
      throw new Error("Native Methods stage must be a canonical non-symlink file");
    }
  }
  const methodsLibrary = methodsLibraryPath !== null
    ? {
        mode: "bundled-required",
        member: describeFile(methodsPath, methodsRelativePath),
        abi: { major: 2, minor: 2 },
      }
    : {
        mode: "unavailable",
        member: null,
        abi: { major: 2, minor: 2 },
      };

  return {
    schema: CONTRACT_SCHEMA,
    platform,
    arch,
    product_backend: "rust-sidecar",
    python_role: "library-plugin-host-only",
    sidecar: describeFile(sidecarPath, sidecarRelativePath),
    python_plugin_host: pythonPluginHost,
    methods_library: methodsLibrary,
  };
}

function writeRuntimeContract(options) {
  const contract = createRuntimeContract(options);
  const contractPath = path.join(options.backendRoot, "native", CONTRACT_FILE);
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return { contract, contractPath };
}

function hasValidPlatformSignature(filePath, platform) {
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

function assertMember(backendRoot, label, member, platform, allowPlatformSignature = true) {
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
  const metadata = fs.lstatSync(memberPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink packaged member`);
  }
  const actual = describeFile(memberPath, member.path);
  if (
    (actual.size !== member.size || actual.sha256 !== member.sha256) &&
    !(allowPlatformSignature && hasValidPlatformSignature(memberPath, platform))
  ) {
    throw new Error(`${label} integrity mismatch: ${memberPath}`);
  }
  return memberPath;
}

function verifyRuntimeContract({
  backendRoot,
  platform = process.platform,
  arch = process.arch,
}) {
  const contractPath = path.join(backendRoot, "native", CONTRACT_FILE);
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Packaged runtime contract not found: ${contractPath}`);
  }
  const raw = fs.readFileSync(contractPath);
  if (raw.length > 64 * 1024) {
    throw new Error("Packaged runtime contract exceeds 64 KiB");
  }
  const contract = JSON.parse(raw.toString("utf8"));
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
  const sidecarPath = assertMember(
    backendRoot,
    "Native Studio sidecar",
    contract.sidecar,
    platform,
  );

  const plugin = contract.python_plugin_host;
  if (!plugin || !["external-explicit", "bundled-required"].includes(plugin.mode)) {
    throw new Error("Invalid Python plugin-host policy in packaged runtime contract");
  }
  let pythonPluginHostPath = null;
  if (plugin.mode === "bundled-required") {
    const expectedPython = bundledPythonRelativePath(platform);
    if (path.normalize(plugin.member?.path ?? "") !== expectedPython) {
      throw new Error("Packaged runtime contract selects an unexpected Python plugin host");
    }
    pythonPluginHostPath = assertMember(
      backendRoot,
      "Bundled Python plugin host",
      plugin.member,
      platform,
    );
  } else if (plugin.member !== null) {
    throw new Error("External Python plugin-host policy must not select a member");
  }

  const methods = contract.methods_library;
  if (
    !methods ||
    !["unavailable", "bundled-required"].includes(methods.mode) ||
    methods.abi?.major !== 2 ||
    methods.abi?.minor !== 2
  ) {
    throw new Error("Invalid native Methods policy in packaged runtime contract");
  }
  let methodsLibraryPath = null;
  if (methods.mode === "bundled-required") {
    const expectedMethods = bundledMethodsRelativePath(platform);
    if (path.normalize(methods.member?.path ?? "") !== expectedMethods) {
      throw new Error("Packaged runtime contract selects an unexpected native Methods library");
    }
    methodsLibraryPath = assertMember(
      backendRoot,
      "Bundled native Methods library",
      methods.member,
      platform,
      false,
    );
  } else if (methods.member !== null) {
    throw new Error("Unavailable native Methods policy must not select a member");
  }

  return { contract, contractPath, sidecarPath, pythonPluginHostPath, methodsLibraryPath };
}

function parseVerifyArgs(argv = process.argv.slice(2)) {
  const parsed = {
    backendRoot: "",
    platform: process.platform,
    arch: process.arch,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inlineValue] = argument.includes("=")
      ? argument.split(/=(.+)/, 2)
      : [argument, undefined];
    const readValue = () => {
      const value = inlineValue ?? argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      return value;
    };
    if (flag === "--backend-root") {
      parsed.backendRoot = path.resolve(readValue());
    } else if (flag === "--platform") {
      parsed.platform = readValue();
    } else if (flag === "--arch") {
      parsed.arch = readValue();
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!parsed.backendRoot) {
    throw new Error("--backend-root is required");
  }
  return parsed;
}

if (require.main === module) {
  try {
    const verified = verifyRuntimeContract(parseVerifyArgs());
    console.log(
      `Packaged runtime verified: ${verified.sidecarPath} (${verified.contract.sidecar.sha256})`,
    );
  } catch (error) {
    console.error(
      `Packaged runtime verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

module.exports = {
  bundledMethodsRelativePath,
  CONTRACT_FILE,
  CONTRACT_SCHEMA,
  bundledPythonRelativePath,
  createRuntimeContract,
  hasValidPlatformSignature,
  parseVerifyArgs,
  sha256File,
  verifyRuntimeContract,
  writeRuntimeContract,
};
