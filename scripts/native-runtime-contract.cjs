const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const publicMethodsWheel = require("./methods-public-wheel-profile.json");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const recommendedConfig = require("../recommended-config.json");
const { MANIFEST, PACKAGE, verifyAdapterPackage } = require("./studio-document-adapters.cjs");

const CONTRACT_FILE = "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";
const METHODS_ABI_MAJOR = 2;
const METHODS_ABI_MINOR = 22;
const METHODS_SOURCE_COMMIT = "41b5d4e02e2574a94cd9dad6fcfa6269573b5eed";
const METHODS_SOURCE_TREE = "61406cd2cf11204273a9972e4f268acfde7eb424";
const METHODS_PROJECT_VERSION = "1.3.15";
const WINDOWS_NATIVE_RUNTIME_LINKAGE = Object.freeze({
  profile: "studio-msvc-static-crt-v1",
  methods_cmake_runtime: "MultiThreaded",
  sidecar_rust_target_feature: "+crt-static",
  forbidden_dynamic_import_prefixes: ["MSVCP", "VCRUNTIME"],
});

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function verifyArtifactBoundary(artifactBoundaryRoot, backendRoot) {
  if (!artifactBoundaryRoot) {
    throw new Error("An explicit artifact boundary root is required");
  }
  const boundaryRoot = path.resolve(artifactBoundaryRoot);
  const resolvedBackendRoot = path.resolve(backendRoot);
  if (!isPathInside(boundaryRoot, resolvedBackendRoot)) {
    throw new Error("Packaged backend escapes its artifact boundary root");
  }

  const boundaryMetadata = fs.lstatSync(boundaryRoot);
  if (boundaryMetadata.isSymbolicLink() || !boundaryMetadata.isDirectory()) {
    throw new Error("Artifact boundary root must be a real non-symlink directory");
  }
  const canonicalBoundary = fs.realpathSync.native(boundaryRoot);
  let current = boundaryRoot;
  const relativeBackend = path.relative(boundaryRoot, resolvedBackendRoot);
  for (const segment of relativeBackend.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(
        `Packaged backend boundary component must be a real non-symlink directory: ${current}`,
      );
    }
    if (!isPathInside(canonicalBoundary, fs.realpathSync.native(current))) {
      throw new Error(`Packaged backend boundary component escapes artifact root: ${current}`);
    }
  }

  const pending = [resolvedBackendRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const entryPath = path.join(directory, name);
      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Packaged backend contains a link or special file: ${entryPath}`);
      }
      if (!isPathInside(canonicalBoundary, fs.realpathSync.native(entryPath))) {
        throw new Error(`Packaged backend member escapes artifact root: ${entryPath}`);
      }
      if (metadata.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return { boundaryRoot, backendRoot: resolvedBackendRoot };
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function describeFile(filePath, relativePath, boundaryRoot = path.dirname(filePath)) {
  const stat = fs.lstatSync(filePath);
  const relative = path.relative(path.resolve(boundaryRoot), path.resolve(filePath));
  const expected = path.resolve(fs.realpathSync.native(boundaryRoot), relative);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    fs.realpathSync.native(filePath) !== expected
  ) {
    throw new Error(`Packaged runtime member is not a canonical regular file: ${filePath}`);
  }
  return {
    path: relativePath.split(path.sep).join("/"),
    size: stat.size,
    sha256: sha256File(filePath),
  };
}

function bundledMethodsRelativePath(platform) {
  if (platform === "win32") return path.join("native", "n4m.dll");
  if (platform === "darwin") return path.join("native", "libn4m.dylib");
  return path.join("native", "libn4m.so");
}

// This is an exact product selection, not a claim about the wheel's source tree.
function hasExactPublicMethodsArtifact(methods, platform, arch) {
  return methods != null && Object.keys(methods).length === 4 &&
    methods.mode === "bundled-required" &&
    platform === publicMethodsWheel.platform && arch === publicMethodsWheel.arch &&
    isDeepStrictEqual(methods.abi, publicMethodsWheel.abi) &&
    isDeepStrictEqual(methods.artifact, publicMethodsWheel.artifact) &&
    methods.member != null && Object.keys(methods.member).length === 3 &&
    methods.member.path === "native/libn4m.so" &&
    methods.member.size === publicMethodsWheel.library.size &&
    methods.member?.sha256 === publicMethodsWheel.library.sha256;
}

function createRuntimeContract({
  backendRoot,
  platform = process.platform,
  arch = process.arch,
  methodsLibraryPath = null,
  methodsIdentityProfile = "public-wheel",
}) {
  const sidecarName = platform === "win32" ? "studio-sidecar.exe" : "studio-sidecar";
  const sidecarRelativePath = path.join("native", sidecarName);
  const sidecarPath = path.join(backendRoot, sidecarRelativePath);
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`Native Studio sidecar not found: ${sidecarPath}`);
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
  const source = {
    commit: METHODS_SOURCE_COMMIT,
    tree: METHODS_SOURCE_TREE,
    project_version: METHODS_PROJECT_VERSION,
  };
  const methodsLibrary = {
    mode: methodsLibraryPath === null ? "unavailable" : "bundled-required",
    member: methodsLibraryPath === null
      ? null : describeFile(methodsPath, methodsRelativePath, backendRoot),
    abi: { major: METHODS_ABI_MAJOR, minor: METHODS_ABI_MINOR },
    source,
  };
  if (methodsLibraryPath !== null) {
    if (methodsIdentityProfile === "public-wheel") {
      delete methodsLibrary.source;
      methodsLibrary.artifact = publicMethodsWheel.artifact;
      if (!hasExactPublicMethodsArtifact(methodsLibrary, platform, arch)) {
        throw new Error("Staged Methods library does not match the selected public wheel artifact");
      }
    } else if (methodsIdentityProfile !== "source-build" ||
        methodsLibrary.member.sha256 === publicMethodsWheel.library.sha256) {
      throw new Error("Invalid Methods identity profile; a public wheel must not claim source identity");
    }
    // source-build is explicitly selected by the existing source-checked builder.
    // Neither a package version nor an arbitrary library hash proves that source.
  }

  return {
    schema: CONTRACT_SCHEMA,
    platform,
    arch,
    product_backend: "rust-sidecar",
    sidecar: describeFile(sidecarPath, sidecarRelativePath, backendRoot),
    methods_library: methodsLibrary,
    ...(platform === "win32"
      ? { native_runtime_linkage: WINDOWS_NATIVE_RUNTIME_LINKAGE }
      : {}),
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
  const backendMetadata = fs.lstatSync(backendRoot);
  const expectedCanonicalPath = path.resolve(
    fs.realpathSync.native(backendRoot),
    normalized,
  );
  if (
    backendMetadata.isSymbolicLink() ||
    !backendMetadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    fs.realpathSync.native(memberPath) !== expectedCanonicalPath
  ) {
    throw new Error(`${label} must be a regular non-symlink packaged member`);
  }
  const actual = describeFile(memberPath, member.path, backendRoot);
  if (
    (actual.size !== member.size || actual.sha256 !== member.sha256) &&
    !(allowPlatformSignature && hasValidPlatformSignature(memberPath, platform))
  ) {
    throw new Error(`${label} integrity mismatch: ${memberPath}`);
  }
  return memberPath;
}

/**
 * What Studio needs to create and use a Python environment: the shipped uv,
 * the document adapters exactly as attested in the source tree, and on
 * Windows and Linux the required packages, one embedded wheel per package at
 * its catalogue version. A macOS application embeds no wheels (unsigned
 * binaries inside archives fail notarisation): Studio installs its required
 * packages from the package index.
 */
function verifyPythonPayload(backendRoot, platform = process.platform) {
  const uvPath = path.join(backendRoot, "tools", platform === "win32" ? "uv.exe" : "uv");
  if (!fs.existsSync(uvPath) || !fs.lstatSync(uvPath).isFile()) {
    throw new Error(`Packaged uv not found: ${uvPath}`);
  }
  if (platform === "darwin") {
    if (fs.existsSync(path.join(backendRoot, "wheels"))) {
      throw new Error("A macOS application must not embed wheels: unsigned binaries inside archives fail notarisation");
    }
  } else {
    const wheelhouse = path.join(backendRoot, "wheels");
    const wheels = fs.existsSync(wheelhouse) ? fs.readdirSync(wheelhouse).filter((name) => name.endsWith(".whl")) : [];
    for (const { name, install } of recommendedConfig.required) {
      const prefix = `${name.replace(/[-_.]+/g, "_")}-${install}-`;
      if (wheels.filter((wheel) => wheel.toLowerCase().startsWith(prefix)).length !== 1) {
        throw new Error(`Packaged wheels must contain exactly one ${name}==${install} wheel: ${wheelhouse}`);
      }
    }
    if (wheels.length !== recommendedConfig.required.length) {
      throw new Error(`Packaged wheels contain files outside the required cohort: ${wheelhouse}`);
    }
  }
  const adaptersDir = path.join(backendRoot, "adapters");
  if (!fs.existsSync(path.join(adaptersDir, PACKAGE))) {
    throw new Error(`Packaged document adapters not found: ${adaptersDir}`);
  }
  verifyAdapterPackage(JSON.parse(fs.readFileSync(path.join(__dirname, "..", MANIFEST), "utf8")), adaptersDir);
}

function verifyRuntimeContract({
  backendRoot,
  artifactBoundaryRoot,
  platform = process.platform,
  arch = process.arch,
  requirePythonPayload = false,
  requireBundledMethods = false,
}) {
  verifyArtifactBoundary(artifactBoundaryRoot, backendRoot);
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
    contract.product_backend !== "rust-sidecar"
  ) {
    throw new Error("Packaged runtime contract metadata mismatch");
  }
  if (platform === "win32") {
    if (
      JSON.stringify(contract.native_runtime_linkage) !==
      JSON.stringify(WINDOWS_NATIVE_RUNTIME_LINKAGE)
    ) {
      throw new Error("Packaged Windows native runtime linkage profile mismatch");
    }
  } else if (Object.hasOwn(contract, "native_runtime_linkage")) {
    throw new Error("Non-Windows runtime contract must not declare an MSVC linkage profile");
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

  if (requirePythonPayload) verifyPythonPayload(backendRoot, platform);

  const methods = contract.methods_library;
  if (
    !methods ||
    !["unavailable", "bundled-required"].includes(methods.mode) ||
    methods.abi?.major !== METHODS_ABI_MAJOR ||
    methods.abi?.minor !== METHODS_ABI_MINOR ||
    (Object.hasOwn(methods, "artifact")
      ? !hasExactPublicMethodsArtifact(methods, platform, arch)
      : Object.keys(methods).length !== 4 || !isDeepStrictEqual(methods.source, {
          commit: METHODS_SOURCE_COMMIT,
          tree: METHODS_SOURCE_TREE,
          project_version: METHODS_PROJECT_VERSION,
        }))
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
  if (requireBundledMethods && !methodsLibraryPath) {
    throw new Error("Packaged native Methods library is required for this release artifact");
  }

  // Revalidate after all hashes and policy checks so a concurrent tree mutation
  // cannot silently become the artifact accepted by this invocation.
  verifyArtifactBoundary(artifactBoundaryRoot, backendRoot);

  return {
    contract,
    contractPath,
    sidecarPath,
    methodsLibraryPath,
    methodsIdentityProfile: Object.hasOwn(methods, "artifact") ? "public-wheel" : "source-build",
  };
}

function parseVerifyArgs(argv = process.argv.slice(2)) {
  const parsed = {
    backendRoot: "",
    artifactBoundaryRoot: "",
    platform: process.platform,
    arch: process.arch,
    requirePythonPayload: false,
    requireBundledMethods: false,
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
    } else if (flag === "--artifact-boundary-root") {
      parsed.artifactBoundaryRoot = path.resolve(readValue());
    } else if (flag === "--platform") {
      parsed.platform = readValue();
    } else if (flag === "--arch") {
      parsed.arch = readValue();
    } else if (flag === "--require-python-payload") {
      parsed.requirePythonPayload = true;
    } else if (flag === "--require-bundled-methods") {
      parsed.requireBundledMethods = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!parsed.backendRoot) {
    throw new Error("--backend-root is required");
  }
  if (!parsed.artifactBoundaryRoot) {
    throw new Error("--artifact-boundary-root is required");
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
  createRuntimeContract,
  hasValidPlatformSignature,
  hasExactPublicMethodsArtifact,
  METHODS_ABI_MAJOR,
  METHODS_ABI_MINOR,
  METHODS_PROJECT_VERSION,
  METHODS_SOURCE_COMMIT,
  METHODS_SOURCE_TREE,
  WINDOWS_NATIVE_RUNTIME_LINKAGE,
  parseVerifyArgs,
  sha256File,
  verifyArtifactBoundary,
  verifyRuntimeContract,
  writeRuntimeContract,
};
