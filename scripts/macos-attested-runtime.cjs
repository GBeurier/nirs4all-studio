#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  collectRuntimeClosure,
  verifyRuntimeContract,
  writeRuntimeContract,
} = require("./native-runtime-contract.cjs");

const MACOS_ATTESTED_SIGN_IGNORE = Object.freeze([
  String.raw`[\\/]Contents[\\/]Resources[\\/]backend[\\/]python-runtime[\\/]python[\\/]`,
  String.raw`[\\/]Contents[\\/]Resources[\\/]backend[\\/]native[\\/]libn4m\.dylib$`,
]);

const MACH_O_MAGICS = new Set([
  "cafebabe",
  "cafebabf",
  "bebafeca",
  "bfbafeca",
  "cefaedfe",
  "cffaedfe",
  "feedface",
  "feedfacf",
]);

function isMachO(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const magic = Buffer.alloc(4);
    return fs.readSync(descriptor, magic, 0, magic.length, 0) === magic.length &&
      MACH_O_MAGICS.has(magic.toString("hex"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function requireCanonicalFile(filePath, label) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    fs.realpathSync.native(resolved) !== resolved
  ) {
    throw new Error(`${label} must be a canonical non-symlink file`);
  }
  return resolved;
}

function normalizeMacArch(arch) {
  if (typeof arch === "string") {
    if (["x64", "arm64"].includes(arch)) return arch;
    throw new Error(`Unsupported macOS attested runtime architecture: ${arch}`);
  }
  const { Arch } = require("builder-util");
  const normalized = Arch[arch];
  if (!["x64", "arm64"].includes(normalized)) {
    throw new Error(`Unsupported macOS attested runtime architecture: ${String(normalized)}`);
  }
  return normalized;
}

function resolveMacAppPath(context) {
  const appNames = fs
    .readdirSync(context.appOutDir)
    .filter((name) => name.endsWith(".app"));
  if (appNames.length !== 1) {
    throw new Error(
      `Expected exactly one macOS app bundle in ${context.appOutDir}; found ${appNames.length}`,
    );
  }
  const appPath = path.join(context.appOutDir, appNames[0]);
  const metadata = fs.lstatSync(appPath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    fs.realpathSync.native(appPath) !== path.resolve(appPath)
  ) {
    throw new Error("Packaged macOS app must be a canonical non-symlink directory");
  }
  return appPath;
}

async function resolveElectronBuilderSigningIdentity(
  context,
  findIdentityOverride = null,
) {
  const options = context.packager.platformSpecificBuildOptions ?? {};
  if (options.identity === null) return null;
  if (options.sign) {
    throw new Error(
      "Custom macOS signing hooks are incompatible with attested runtime pre-signing",
    );
  }
  if (options.identity === "-") return "-";

  const findIdentity = findIdentityOverride ??
    require("app-builder-lib/out/codeSign/macCodeSign").findIdentity;
  const signingInfo = await context.packager.codeSigningInfo.value;
  const keychainFile = signingInfo?.keychainFile ?? null;
  const qualifier = options.identity;
  const explicitType = options.type;
  const isDevelopment = explicitType === "development";
  const certificateTypes = isDevelopment
    ? ["Mac Developer", "Developer ID Application"]
    : ["Developer ID Application"];
  let identity = null;
  for (const certificateType of certificateTypes) {
    identity = await findIdentity(certificateType, qualifier, keychainFile);
    if (identity) break;
  }
  if (!identity && !isDevelopment && explicitType !== "distribution") {
    identity = await findIdentity("Mac Developer", qualifier, keychainFile);
  }
  if (identity) return identity.hash || identity.name;

  const arch = normalizeMacArch(context.arch);
  if (arch === "arm64" && !context.packager.forceCodeSigning) return "-";
  if (
    context.packager.forceCodeSigning ||
    qualifier ||
    keychainFile ||
    process.env.CSC_LINK ||
    process.env.CSC_NAME
  ) {
    throw new Error(
      "macOS application signing was requested but no identity can pre-sign the attested runtime",
    );
  }
  return null;
}

function resolveInheritedEntitlements(context, signingIdentity) {
  if (!signingIdentity) return null;
  const options = context.packager.platformSpecificBuildOptions ?? {};
  const configured = options.entitlementsInherit ?? options.entitlements;
  if (!configured) {
    throw new Error(
      "macOS attested runtime signing requires explicit inherited entitlements",
    );
  }
  const projectDir = context.packager.projectDir;
  return requireCanonicalFile(
    path.isAbsolute(configured) ? configured : path.join(projectDir, configured),
    "macOS inherited entitlements",
  );
}

function signMachO(
  filePath,
  { identity, entitlementsPath, keychainFile = null, spawnSyncImpl = spawnSync },
) {
  const canonicalPath = requireCanonicalFile(filePath, "Attested Mach-O member");
  const args = ["--force", "--sign", identity, "--options", "runtime"];
  if (identity === "-") args.push("--timestamp=none");
  else args.push("--timestamp");
  if (keychainFile) args.push("--keychain", keychainFile);
  if (entitlementsPath) args.push("--entitlements", entitlementsPath);
  args.push(canonicalPath);
  const signed = spawnSyncImpl("/usr/bin/codesign", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (signed.status !== 0) {
    throw new Error(
      `Failed to pre-sign attested Mach-O ${canonicalPath}: ${signed.stderr || signed.error?.message || "codesign failed"}`,
    );
  }
  const verified = spawnSyncImpl(
    "/usr/bin/codesign",
    ["--verify", "--strict", "--verbose=2", canonicalPath],
    { encoding: "utf8", windowsHide: true },
  );
  if (verified.status !== 0) {
    throw new Error(`Pre-signed attested Mach-O does not verify: ${canonicalPath}`);
  }
}

function collectAttestedMachOs(verified) {
  const files = [];
  if (verified.pythonRuntimeRoot) {
    const closure = collectRuntimeClosure(verified.pythonRuntimeRoot);
    const nestedBundle = closure.directories.find((directory) =>
      /\.(?:app|bundle|framework|plugin|xpc)$/i.test(directory),
    );
    if (nestedBundle) {
      throw new Error(
        `Bundled Python closure contains an unsupported nested code bundle: ${nestedBundle}`,
      );
    }
    for (const member of closure.files) {
      const filePath = requireCanonicalFile(
        path.join(verified.pythonRuntimeRoot, ...member.path.split("/")),
        "Bundled Python closure member",
      );
      if (isMachO(filePath)) files.push(filePath);
    }
    if (!files.includes(path.resolve(verified.pythonPluginHostPath))) {
      throw new Error("Bundled Python plugin host is not a Mach-O executable");
    }
  }
  if (verified.methodsLibraryPath) {
    const methodsPath = requireCanonicalFile(
      verified.methodsLibraryPath,
      "Bundled native Methods library",
    );
    if (!isMachO(methodsPath)) {
      throw new Error("Bundled native Methods library is not a Mach-O binary");
    }
    files.push(methodsPath);
  }
  return [...new Set(files)].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}

function prepareMacosAttestedRuntime({
  backendRoot,
  artifactBoundaryRoot,
  arch,
  signingIdentity,
  entitlementsPath = null,
  keychainFile = null,
  signMachOImpl = signMachO,
  verifyRuntimeContractImpl = verifyRuntimeContract,
  writeRuntimeContractImpl = writeRuntimeContract,
}) {
  const verifiedBefore = verifyRuntimeContractImpl({
    backendRoot,
    artifactBoundaryRoot,
    platform: "darwin",
    arch,
    requireBundledPythonPlugin: true,
  });
  const machOs = collectAttestedMachOs(verifiedBefore);
  if (machOs.length === 0) {
    throw new Error("Packaged macOS runtime contains no attested Mach-O members");
  }
  if (signingIdentity) {
    for (const filePath of machOs) {
      signMachOImpl(filePath, {
        identity: signingIdentity,
        entitlementsPath,
        keychainFile,
      });
    }
  }

  writeRuntimeContractImpl({
    backendRoot,
    platform: "darwin",
    arch,
    methodsLibraryPath: verifiedBefore.methodsLibraryPath,
  });
  const verifiedAfter = verifyRuntimeContractImpl({
    backendRoot,
    artifactBoundaryRoot,
    platform: "darwin",
    arch,
    requireBundledPythonPlugin: true,
  });
  return { machOs, verified: verifiedAfter };
}

async function macosAttestedRuntimeAfterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const arch = normalizeMacArch(context.arch);
  const appPath = resolveMacAppPath(context);
  const backendRoot = path.join(appPath, "Contents", "Resources", "backend");
  const signingIdentity = await resolveElectronBuilderSigningIdentity(context);
  const entitlementsPath = resolveInheritedEntitlements(context, signingIdentity);
  const signingInfo = signingIdentity
    ? await context.packager.codeSigningInfo.value
    : null;
  const prepared = prepareMacosAttestedRuntime({
    backendRoot,
    artifactBoundaryRoot: appPath,
    arch,
    signingIdentity,
    entitlementsPath,
    keychainFile: signingInfo?.keychainFile ?? null,
  });
  console.log(
    `[macos-attested-runtime] ${signingIdentity ? "pre-signed and " : ""}attested ${prepared.machOs.length} Mach-O member(s); Rust remains the product HTTP owner`,
  );
}

module.exports = macosAttestedRuntimeAfterPack;
Object.assign(module.exports, {
  collectAttestedMachOs,
  isMachO,
  MACOS_ATTESTED_SIGN_IGNORE,
  normalizeMacArch,
  prepareMacosAttestedRuntime,
  resolveElectronBuilderSigningIdentity,
  resolveInheritedEntitlements,
  resolveMacAppPath,
  signMachO,
});
