#!/usr/bin/env node
/** Build and attest the exact per-platform libn4m required by Studio products. */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  METHODS_ABI_MAJOR,
  METHODS_ABI_MINOR,
  METHODS_PROJECT_VERSION,
  METHODS_SOURCE_COMMIT,
  METHODS_SOURCE_TREE,
  sha256File,
} = require("./native-runtime-contract.cjs");

const MAX_SOURCE_STATUS_BYTES = 1024 * 1024;
const MAX_BUILD_ENTRIES = 50_000;
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${String(result.stderr || result.stdout || "").trim()}`
      : "";
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(" ")}${detail}`,
    );
  }
  return String(result.stdout || "").trim();
}

function git(sourceRoot, args) {
  return run("git", ["-C", sourceRoot, ...args], { capture: true });
}

function assertSourceIdentity(sourceRoot) {
  const resolved = path.resolve(sourceRoot);
  const metadata = fs.lstatSync(resolved);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    fs.realpathSync.native(resolved) !== resolved
  ) {
    throw new Error("Methods source root must be a canonical non-symlink directory");
  }
  const commit = git(resolved, ["rev-parse", "HEAD"]);
  const tree = git(resolved, ["rev-parse", "HEAD^{tree}"]);
  if (commit !== METHODS_SOURCE_COMMIT || tree !== METHODS_SOURCE_TREE) {
    throw new Error(
      `Methods source identity mismatch: ${commit}/${tree}, expected ${METHODS_SOURCE_COMMIT}/${METHODS_SOURCE_TREE}`,
    );
  }
  const status = git(resolved, ["status", "--porcelain=v1"]);
  if (Buffer.byteLength(status) > MAX_SOURCE_STATUS_BYTES || status !== "") {
    throw new Error("Methods source checkout must be clean before and after its native build");
  }
  const header = fs.readFileSync(
    path.join(resolved, "cpp", "include", "n4m", "n4m_version.h"),
    "utf8",
  );
  for (const [name, value] of [
    ["N4M_ABI_VERSION_MAJOR", METHODS_ABI_MAJOR],
    ["N4M_ABI_VERSION_MINOR", METHODS_ABI_MINOR],
    ["N4M_ABI_VERSION_PATCH", 0],
  ]) {
    if (!new RegExp(`^#define\\s+${name}\\s+${value}\\s*$`, "m").test(header)) {
      throw new Error(`Methods source header does not declare ${name} ${value}`);
    }
  }
  if (!header.includes(`#define N4M_PROJECT_VERSION_STRING "${METHODS_PROJECT_VERSION}"`)) {
    throw new Error("Methods source project version mismatch");
  }
  return { sourceRoot: resolved, commit, tree };
}

function targetConfig(platform, arch) {
  if (platform === "linux" && arch === "x64") {
    return {
      preset: "ci-linux-gcc12-release",
      libraryPattern: /^libn4m\.so\.2\.5\.0$/,
      cliParts: ["cpp", "cli", "n4m_cli"],
      configureExtra: [],
      buildExtra: [],
      ctestExtra: [],
    };
  }
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) {
    return {
      preset: "ci-macos-clang-release",
      libraryPattern: /^libn4m\.2\.5\.0\.dylib$/,
      cliParts: ["cpp", "cli", "n4m_cli"],
      configureExtra: [
        `-DCMAKE_OSX_ARCHITECTURES=${arch === "x64" ? "x86_64" : "arm64"}`,
        "-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0",
      ],
      buildExtra: [],
      ctestExtra: [],
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      preset: "ci-windows-msvc-release",
      libraryPattern: /^n4m\.dll$/i,
      cliParts: ["cpp", "cli", "Release", "n4m_cli.exe"],
      configureExtra: [],
      buildExtra: ["--config", "Release"],
      ctestExtra: ["-C", "Release"],
    };
  }
  throw new Error(`Unsupported native Methods target: ${platform}-${arch}`);
}

function collectRegularFiles(root) {
  const files = [];
  const pending = [root];
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      entries += 1;
      if (entries > MAX_BUILD_ENTRIES) {
        throw new Error("Methods build tree exceeds the bounded entry limit");
      }
      const entryPath = path.join(directory, name);
      const metadata = fs.lstatSync(entryPath);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) pending.push(entryPath);
      else if (metadata.isFile()) files.push(entryPath);
    }
  }
  return files;
}

function resolveBuiltLibrary(sourceRoot, config) {
  const buildRoot = path.join(sourceRoot, "build", config.preset, "cpp", "src");
  const matches = collectRegularFiles(buildRoot).filter((candidate) =>
    config.libraryPattern.test(path.basename(candidate)),
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one native Methods library, found ${matches.length}`);
  }
  const libraryPath = fs.realpathSync.native(matches[0]);
  const metadata = fs.lstatSync(libraryPath);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_LIBRARY_BYTES) {
    throw new Error("Native Methods library is empty, special, or too large");
  }
  return { libraryPath, size: metadata.size, sha256: sha256File(libraryPath) };
}

function appendGitHubEnvironment(environmentPath, library) {
  if (!environmentPath) return;
  for (const value of [library.libraryPath, library.sha256]) {
    if (/[\r\n]/.test(value)) throw new Error("Methods build identity contains a newline");
  }
  fs.appendFileSync(
    environmentPath,
    `NIRS4ALL_BUILD_METHODS_LIBRARY=${library.libraryPath}\n` +
      `NIRS4ALL_BUILD_METHODS_DIRECTORY=${path.dirname(library.libraryPath)}\n` +
      `NIRS4ALL_BUILD_METHODS_SHA256=${library.sha256}\n`,
  );
}

function buildAndAttest({
  sourceRoot,
  platform = process.platform,
  arch = process.arch,
  githubEnv = process.env.GITHUB_ENV || "",
}) {
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(
      `Native Methods build must run on its target host: requested ${platform}-${arch}, current ${process.platform}-${process.arch}`,
    );
  }
  const source = assertSourceIdentity(sourceRoot);
  const config = targetConfig(platform, arch);
  const buildRoot = path.join(source.sourceRoot, "build", config.preset);
  fs.rmSync(buildRoot, { recursive: true, force: true });
  run("cmake", ["--preset", config.preset, ...config.configureExtra], {
    cwd: source.sourceRoot,
  });
  run("cmake", ["--build", "--preset", config.preset, ...config.buildExtra, "--parallel"], {
    cwd: source.sourceRoot,
  });
  run("ctest", ["--preset", config.preset, "--output-on-failure", ...config.ctestExtra], {
    cwd: source.sourceRoot,
  });
  const cliPath = path.join(
    source.sourceRoot,
    "build",
    config.preset,
    ...config.cliParts,
  );
  const abiInfo = run(cliPath, ["--abi-info"], { cwd: source.sourceRoot, capture: true });
  if (!new RegExp(`abi_version\\s*:\\s*${METHODS_ABI_MAJOR}\\.${METHODS_ABI_MINOR}\\.0`).test(abiInfo)) {
    throw new Error("Built Methods CLI did not report ABI 2.5.0");
  }
  run(cliPath, ["--selfcheck"], { cwd: source.sourceRoot, capture: true });
  const library = resolveBuiltLibrary(source.sourceRoot, config);
  if (platform === "darwin") {
    const architectures = run("lipo", ["-archs", library.libraryPath], {
      cwd: source.sourceRoot,
      capture: true,
    }).split(/\s+/).filter(Boolean);
    const expectedArchitecture = arch === "x64" ? "x86_64" : "arm64";
    if (architectures.length !== 1 || architectures[0] !== expectedArchitecture) {
      throw new Error(
        `Built Methods dylib architecture mismatch: ${architectures.join(" ") || "none"}`,
      );
    }
  }
  assertSourceIdentity(source.sourceRoot);
  appendGitHubEnvironment(githubEnv, library);
  return {
    schema: "nirs4all.studio-methods-build.v1",
    platform,
    arch,
    preset: config.preset,
    source_commit: source.commit,
    source_tree: source.tree,
    project_version: METHODS_PROJECT_VERSION,
    abi: `${METHODS_ABI_MAJOR}.${METHODS_ABI_MINOR}.0`,
    library_path: library.libraryPath,
    library_size: library.size,
    library_sha256: library.sha256,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    sourceRoot: "",
    platform: process.platform,
    arch: process.arch,
    githubEnv: process.env.GITHUB_ENV || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inline] = argument.includes("=")
      ? argument.split(/=(.+)/, 2)
      : [argument, undefined];
    const value = () => {
      const selected = inline ?? argv[++index];
      if (!selected || selected.startsWith("--")) throw new Error(`${flag} requires a value`);
      return selected;
    };
    if (flag === "--source-root") parsed.sourceRoot = path.resolve(value());
    else if (flag === "--platform") parsed.platform = value();
    else if (flag === "--arch") parsed.arch = value();
    else if (flag === "--github-env") parsed.githubEnv = path.resolve(value());
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!parsed.sourceRoot) throw new Error("--source-root is required");
  return parsed;
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(buildAndAttest(parseArgs()), null, 2));
  } catch (error) {
    console.error(
      `Native Methods build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

module.exports = {
  appendGitHubEnvironment,
  assertSourceIdentity,
  buildAndAttest,
  collectRegularFiles,
  parseArgs,
  resolveBuiltLibrary,
  targetConfig,
};
