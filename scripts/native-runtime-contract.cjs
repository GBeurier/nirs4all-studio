const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  PLUGIN_MARKER_FILE,
  expectedMarker,
  verifyPluginRuntime,
} = require("./bake-python-plugin-runtime.cjs");

const CONTRACT_FILE = "STUDIO_RUNTIME_CONTRACT.json";
const CONTRACT_SCHEMA = "nirs4all.studio-packaged-runtime.v1";
const PYTHON_CLOSURE_FILE = "PYTHON_PLUGIN_CLOSURE.json";
const PYTHON_CLOSURE_SCHEMA = "nirs4all.studio-python-plugin-closure.v1";
const MAX_PYTHON_CLOSURE_BYTES = 32 * 1024 * 1024;
const MAX_PYTHON_CLOSURE_FILES = 100_000;
const MAX_PYTHON_CLOSURE_DIRECTORIES = 100_000;

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

function assertCanonicalDirectory(directoryPath, label, boundaryRoot = directoryPath) {
  const metadata = fs.lstatSync(directoryPath);
  const relative = path.relative(path.resolve(boundaryRoot), path.resolve(directoryPath));
  const expected = path.resolve(fs.realpathSync.native(boundaryRoot), relative);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    fs.realpathSync.native(directoryPath) !== expected
  ) {
    throw new Error(`${label} must be a canonical non-symlink directory`);
  }
}

function collectRuntimeClosure(runtimeRoot) {
  assertCanonicalDirectory(runtimeRoot, "Bundled Python runtime root");
  const files = [];
  const directories = [];
  const pending = [runtimeRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    assertCanonicalDirectory(
      directory,
      "Bundled Python runtime directory",
      runtimeRoot,
    );
    if (directories.length >= MAX_PYTHON_CLOSURE_DIRECTORIES) {
      throw new Error("Bundled Python runtime exceeds the 100000-directory closure limit");
    }
    const relativeDirectory = path.relative(runtimeRoot, directory);
    directories.push(relativeDirectory.split(path.sep).join("/"));
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Bundled Python runtime must not contain symlinks: ${entryPath}`);
      }
      if (metadata.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`Bundled Python runtime contains a special file: ${entryPath}`);
      }
      if (files.length >= MAX_PYTHON_CLOSURE_FILES) {
        throw new Error("Bundled Python runtime exceeds the 100000-file closure limit");
      }
      const relativePath = path.relative(runtimeRoot, entryPath).split(path.sep).join("/");
      files.push({
        path: relativePath,
        size: metadata.size,
        sha256: sha256File(entryPath),
      });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  directories.sort();
  return { files, directories };
}

function findRuntimeSitePackages(runtimeRoot, directories) {
  const candidates = directories
    .filter((relativePath) =>
      relativePath === "Lib/site-packages" ||
      /^lib\/python3\.\d+\/site-packages$/.test(relativePath),
    )
    .map((relativePath) => path.join(runtimeRoot, ...relativePath.split("/")));
  if (candidates.length !== 1) {
    throw new Error(
      `Bundled Python runtime must contain exactly one site-packages directory; found ${candidates.length}`,
    );
  }
  return candidates[0];
}

function writePythonRuntimeClosure(backendRoot) {
  const runtimeRoot = path.join(backendRoot, "python-runtime", "python");
  const { files, directories } = collectRuntimeClosure(runtimeRoot);
  const sitePackagesPath = findRuntimeSitePackages(runtimeRoot, directories);
  const closurePath = path.join(
    backendRoot,
    "python-runtime",
    PYTHON_CLOSURE_FILE,
  );
  const closure = {
    schema: PYTHON_CLOSURE_SCHEMA,
    root: "python-runtime/python",
    site_packages: path
      .relative(backendRoot, sitePackagesPath)
      .split(path.sep)
      .join("/"),
    directories,
    files,
  };
  const encoded = `${JSON.stringify(closure)}\n`;
  if (Buffer.byteLength(encoded) > MAX_PYTHON_CLOSURE_BYTES) {
    throw new Error("Bundled Python closure manifest exceeds 32 MiB");
  }
  fs.writeFileSync(closurePath, encoded, { flag: "w" });
  return {
    closurePath,
    runtimeRoot,
    sitePackagesPath,
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

  const pluginMarkerPath = path.join(backendRoot, "python-runtime", PLUGIN_MARKER_FILE);
  const hasBundledRuntime = fs.existsSync(pluginMarkerPath);
  let pythonPluginHost = {
    mode: "unavailable",
    member: null,
    closure: null,
    runtime_root: null,
    site_packages: null,
    marker: null,
  };
  if (hasBundledRuntime) {
    verifyPluginRuntime({ backendRoot, platform, arch, writeMarker: false });
    const pythonRelativePath = bundledPythonRelativePath(platform);
    const pythonPath = path.join(backendRoot, pythonRelativePath);
    if (!fs.existsSync(pythonPath)) {
      throw new Error(
        `Bundled runtime marker exists but its Python plugin host is missing: ${pythonPath}`,
      );
    }
    const closure = writePythonRuntimeClosure(backendRoot);
    pythonPluginHost = {
      mode: "bundled-required",
      member: describeFile(pythonPath, pythonRelativePath, backendRoot),
      closure: describeFile(
        closure.closurePath,
        path.relative(backendRoot, closure.closurePath),
        backendRoot,
      ),
      runtime_root: path.relative(backendRoot, closure.runtimeRoot).split(path.sep).join("/"),
      site_packages: path.relative(backendRoot, closure.sitePackagesPath).split(path.sep).join("/"),
      marker: describeFile(
        pluginMarkerPath,
        path.relative(backendRoot, pluginMarkerPath),
        backendRoot,
      ),
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
        member: describeFile(methodsPath, methodsRelativePath, backendRoot),
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
    sidecar: describeFile(sidecarPath, sidecarRelativePath, backendRoot),
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

function verifyPythonRuntimeClosure(backendRoot, plugin, platform) {
  const normalizedSitePackages =
    typeof plugin.site_packages === "string"
      ? path.normalize(plugin.site_packages).split(path.sep).join("/")
      : null;
  if (
    plugin.runtime_root !== "python-runtime/python" ||
    typeof plugin.site_packages !== "string" ||
    normalizedSitePackages !== plugin.site_packages ||
    !plugin.site_packages.startsWith("python-runtime/python/")
  ) {
    throw new Error("Invalid bundled Python closure paths in packaged runtime contract");
  }
  const closurePath = assertMember(
    backendRoot,
    "Bundled Python closure manifest",
    plugin.closure,
    platform,
    false,
  );
  const encoded = fs.readFileSync(closurePath);
  if (encoded.length > MAX_PYTHON_CLOSURE_BYTES) {
    throw new Error("Bundled Python closure manifest exceeds 32 MiB");
  }
  const closure = JSON.parse(encoded.toString("utf8"));
  if (
    !closure ||
    closure.schema !== PYTHON_CLOSURE_SCHEMA ||
    closure.root !== plugin.runtime_root ||
    closure.site_packages !== plugin.site_packages ||
    !Array.isArray(closure.directories) ||
    closure.directories.length < 1 ||
    closure.directories.length > MAX_PYTHON_CLOSURE_DIRECTORIES ||
    !Array.isArray(closure.files) ||
    closure.files.length < 1 ||
    closure.files.length > MAX_PYTHON_CLOSURE_FILES
  ) {
    throw new Error("Invalid bundled Python closure manifest");
  }
  const runtimeRoot = path.join(backendRoot, ...plugin.runtime_root.split("/"));
  const actualClosure = collectRuntimeClosure(runtimeRoot);
  if (
    actualClosure.directories.length !== closure.directories.length ||
    actualClosure.directories.some(
      (directory, index) => directory !== closure.directories[index],
    )
  ) {
    throw new Error("Bundled Python runtime closure directory inventory mismatch");
  }
  const actual = actualClosure.files;
  if (actual.length !== closure.files.length) {
    throw new Error("Bundled Python runtime closure inventory mismatch");
  }
  for (let index = 0; index < actual.length; index += 1) {
    const expected = closure.files[index];
    if (
      !expected ||
      expected.path !== actual[index].path ||
      expected.size !== actual[index].size ||
      expected.sha256 !== actual[index].sha256
    ) {
      throw new Error(`Bundled Python runtime closure mismatch: ${actual[index].path}`);
    }
  }
  const sitePackagesPath = path.join(backendRoot, ...plugin.site_packages.split("/"));
  assertCanonicalDirectory(
    sitePackagesPath,
    "Bundled Python site-packages",
    runtimeRoot,
  );
  return { closurePath, runtimeRoot, sitePackagesPath };
}

function verifyPluginMarker(backendRoot, plugin, platform, arch) {
  const expectedPath = path.join("python-runtime", PLUGIN_MARKER_FILE);
  if (path.normalize(plugin.marker?.path ?? "") !== expectedPath) {
    throw new Error("Packaged Python plugin marker path mismatch");
  }
  const readyPath = assertMember(
    backendRoot,
    "Bundled Python plugin marker",
    plugin.marker,
    platform,
    false,
  );
  const actual = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expectedMarker(platform, arch))) {
    throw new Error("Bundled Python plugin marker identity mismatch");
  }
  return readyPath;
}

function verifyRuntimeContract({
  backendRoot,
  platform = process.platform,
  arch = process.arch,
  requireBundledPythonPlugin = false,
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
  if (!plugin || !["unavailable", "bundled-required"].includes(plugin.mode)) {
    throw new Error("Invalid Python plugin-host policy in packaged runtime contract");
  }
  let pythonPluginHostPath = null;
  let pythonClosurePath = null;
  let pythonRuntimeRoot = null;
  let pythonSitePackagesPath = null;
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
    const closure = verifyPythonRuntimeClosure(backendRoot, plugin, platform);
    verifyPluginMarker(backendRoot, plugin, platform, arch);
    pythonClosurePath = closure.closurePath;
    pythonRuntimeRoot = closure.runtimeRoot;
    pythonSitePackagesPath = closure.sitePackagesPath;
  } else if (
    plugin.member !== null ||
    plugin.closure !== null ||
    plugin.runtime_root !== null ||
    plugin.site_packages !== null ||
    plugin.marker !== null
  ) {
    throw new Error("Unavailable Python plugin-host policy must not select packaged members");
  }
  if (requireBundledPythonPlugin && !pythonPluginHostPath) {
    throw new Error("Packaged Python plugin runtime is required for this release artifact");
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

  return {
    contract,
    contractPath,
    sidecarPath,
    pythonPluginHostPath,
    pythonClosurePath,
    pythonRuntimeRoot,
    pythonSitePackagesPath,
    methodsLibraryPath,
  };
}

function parseVerifyArgs(argv = process.argv.slice(2)) {
  const parsed = {
    backendRoot: "",
    platform: process.platform,
    arch: process.arch,
    requireBundledPythonPlugin: false,
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
    } else if (flag === "--require-bundled-python-plugin") {
      parsed.requireBundledPythonPlugin = true;
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
  collectRuntimeClosure,
  createRuntimeContract,
  hasValidPlatformSignature,
  parseVerifyArgs,
  PYTHON_CLOSURE_FILE,
  PYTHON_CLOSURE_SCHEMA,
  sha256File,
  verifyPythonRuntimeClosure,
  verifyRuntimeContract,
  writePythonRuntimeClosure,
  writeRuntimeContract,
};
