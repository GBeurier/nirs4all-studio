const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PLATFORM_ALIASES = Object.freeze({
  linux: "linux",
  mac: "darwin",
  win: "win32",
});

function targetPlatforms(requestedPlatform, hostPlatform = process.platform) {
  if (!requestedPlatform) {
    return [hostPlatform];
  }
  if (requestedPlatform === "all") {
    return ["win32", "darwin", "linux"];
  }
  const platform = PLATFORM_ALIASES[requestedPlatform];
  if (!platform) {
    throw new Error(`Unsupported installer platform: ${requestedPlatform}`);
  }
  return [platform];
}

function snapshotTopLevel(root) {
  if (!fs.existsSync(root)) {
    return new Map();
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Installer output root must be a real directory: ${root}`);
  }
  return new Map(
    fs.readdirSync(root, { withFileTypes: true }).map((entry) => {
      const entryPath = path.join(root, entry.name);
      const stat = fs.lstatSync(entryPath, { bigint: true });
      return [
        entry.name,
        {
          kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          ino: stat.ino.toString(),
          size: stat.size.toString(),
          mtimeNs: stat.mtimeNs.toString(),
        },
      ];
    }),
  );
}

function newlyProducedNames(before, after) {
  const produced = [];
  for (const [name, identity] of after) {
    const previous = before.get(name);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(identity)) {
      produced.push(name);
    }
  }
  return produced.sort();
}

function requireExactlyOne(candidates, label) {
  if (candidates.length !== 1) {
    throw new Error(
      `${label} must resolve to exactly one newly produced output; found ${candidates.length}: ${candidates.join(", ") || "(none)"}`,
    );
  }
  return candidates[0];
}

function requireRealDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`${label} is missing: ${directoryPath}`);
  }
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directoryPath}`);
  }
  return directoryPath;
}

function discoverPlatformOutput(stagingRoot, platform, producedNames) {
  const produced = new Set(producedNames);
  const entries = fs.readdirSync(stagingRoot, { withFileTypes: true });
  const producedFiles = entries
    .filter((entry) => produced.has(entry.name) && entry.isFile())
    .map((entry) => entry.name);
  const producedDirectories = entries
    .filter((entry) => produced.has(entry.name) && entry.isDirectory())
    .map((entry) => entry.name);

  let unpackedName;
  let backendRoot;
  let artifacts;
  if (platform === "linux") {
    unpackedName = requireExactlyOne(
      producedDirectories.filter((name) => /^linux(?:-[a-z0-9_-]+)?-unpacked$/i.test(name)),
      "Linux unpacked application",
    );
    artifacts = [
      requireExactlyOne(producedFiles.filter((name) => name.endsWith(".AppImage")), "Linux AppImage"),
      requireExactlyOne(producedFiles.filter((name) => name.endsWith(".deb")), "Linux deb"),
    ];
    backendRoot = path.join(stagingRoot, unpackedName, "resources", "backend");
  } else if (platform === "win32") {
    unpackedName = requireExactlyOne(
      producedDirectories.filter((name) => /^win(?:-[a-z0-9_-]+)?-unpacked$/i.test(name)),
      "Windows unpacked application",
    );
    const executables = producedFiles.filter((name) => name.toLowerCase().endsWith(".exe"));
    artifacts = [
      requireExactlyOne(executables.filter((name) => /-portable\.exe$/i.test(name)), "Windows portable executable"),
      requireExactlyOne(executables.filter((name) => !/-portable\.exe$/i.test(name)), "Windows NSIS installer"),
    ];
    backendRoot = path.join(stagingRoot, unpackedName, "resources", "backend");
  } else if (platform === "darwin") {
    unpackedName = requireExactlyOne(
      producedDirectories.filter((name) => /^mac(?:-[a-z0-9_-]+)?$/i.test(name)),
      "macOS unpacked application directory",
    );
    artifacts = [
      requireExactlyOne(producedFiles.filter((name) => name.endsWith(".dmg")), "macOS dmg"),
    ];
    const macRoot = path.join(stagingRoot, unpackedName);
    const appName = requireExactlyOne(
      fs
        .readdirSync(macRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
        .map((entry) => entry.name),
      "macOS app bundle",
    );
    backendRoot = path.join(macRoot, appName, "Contents", "Resources", "backend");
  } else {
    throw new Error(`Unsupported installer output platform: ${platform}`);
  }

  requireRealDirectory(backendRoot, `${platform} packaged backend`);
  return {
    platform,
    unpackedName,
    backendRoot,
    artifacts,
  };
}

function smokePackagedSidecar(sidecarPath) {
  const stdout = execFileSync(sidecarPath, ["--smoke-readiness"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  const readiness = JSON.parse(stdout);
  if (
    readiness?.sidecar_ready !== true ||
    readiness?.protocol_version !== "studio-sidecar-r1"
  ) {
    throw new Error("Packaged Rust sidecar smoke readiness contract mismatch");
  }
}

function verifyDiscoveredOutputs({
  outputs,
  verifyRuntimeContract,
  smokeSidecar = smokePackagedSidecar,
  hostPlatform = process.platform,
}) {
  for (const output of outputs) {
    const verify = () =>
      verifyRuntimeContract({
        backendRoot: output.backendRoot,
        platform: output.platform,
        arch: output.platform === "darwin" ? process.arch : "x64",
        requireBundledPythonPlugin: true,
      });
    const first = verify();
    if (output.platform === hostPlatform) {
      smokeSidecar(first.sidecarPath);
    }
    verify();
  }
}

function moveWithRollback(stagingRoot, releaseRoot, names, verifyPublished) {
  const backupRoot = path.join(
    path.dirname(stagingRoot),
    `.installer-backup-${process.pid}-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  const moved = [];
  const backedUp = [];
  try {
    for (const name of names) {
      const source = path.join(stagingRoot, name);
      const destination = path.join(releaseRoot, name);
      if (fs.existsSync(destination)) {
        fs.renameSync(destination, path.join(backupRoot, name));
        backedUp.push(name);
      }
      fs.renameSync(source, destination);
      moved.push(name);
    }
    verifyPublished();
  } catch (error) {
    for (const name of moved.reverse()) {
      fs.rmSync(path.join(releaseRoot, name), { recursive: true, force: true });
    }
    for (const name of backedUp) {
      fs.renameSync(path.join(backupRoot, name), path.join(releaseRoot, name));
    }
    throw error;
  } finally {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}

async function packageAndVerifyInstallerOutputs({
  releaseRoot,
  requestedPlatform,
  runBuilder,
  verifyRuntimeContract,
  smokeSidecar = smokePackagedSidecar,
  hostPlatform = process.platform,
}) {
  const releaseBefore = snapshotTopLevel(releaseRoot);
  const stagingParent = path.join(path.dirname(releaseRoot), "build", "installer-invocations");
  fs.mkdirSync(stagingParent, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(stagingParent, "installer-"));
  const stagingBefore = snapshotTopLevel(stagingRoot);
  try {
    await runBuilder(stagingRoot);
    const stagingAfter = snapshotTopLevel(stagingRoot);
    const producedNames = newlyProducedNames(stagingBefore, stagingAfter);
    if (producedNames.length === 0) {
      throw new Error(
        "electron-builder produced no outputs for this invocation; stale release artifacts are not accepted",
      );
    }
    const platforms = targetPlatforms(requestedPlatform, hostPlatform);
    const outputs = platforms.map((platform) =>
      discoverPlatformOutput(stagingRoot, platform, producedNames),
    );
    verifyDiscoveredOutputs({
      outputs,
      verifyRuntimeContract,
      smokeSidecar,
      hostPlatform,
    });

    moveWithRollback(stagingRoot, releaseRoot, producedNames, () => {
      const publishedOutputs = platforms.map((platform) =>
        discoverPlatformOutput(releaseRoot, platform, producedNames),
      );
      verifyDiscoveredOutputs({
        outputs: publishedOutputs,
        verifyRuntimeContract,
        smokeSidecar,
        hostPlatform,
      });
    });

    const releaseAfter = snapshotTopLevel(releaseRoot);
    const publishedNames = newlyProducedNames(releaseBefore, releaseAfter);
    for (const name of producedNames) {
      if (!publishedNames.includes(name)) {
        throw new Error(`Verified installer output was not published by this invocation: ${name}`);
      }
    }
    return {
      producedNames,
      outputs: platforms.map((platform) =>
        discoverPlatformOutput(releaseRoot, platform, producedNames),
      ),
    };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = {
  discoverPlatformOutput,
  newlyProducedNames,
  packageAndVerifyInstallerOutputs,
  smokePackagedSidecar,
  snapshotTopLevel,
  targetPlatforms,
  verifyDiscoveredOutputs,
};
