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

function requireRealFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a real regular file: ${filePath}`);
  }
  return filePath;
}

function regularFileIdentity(filePath, label) {
  requireRealFile(filePath, label);
  const before = fs.lstatSync(filePath, { bigint: true });
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
  const after = fs.lstatSync(filePath, { bigint: true });
  if (
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw new Error(`${label} changed while its identity was captured: ${filePath}`);
  }
  return {
    size: after.size.toString(),
    sha256: hash.digest("hex"),
  };
}

function assertCanonicalMember(root, memberPath, label) {
  const canonicalRoot = fs.realpathSync.native(root);
  const canonicalMember = fs.realpathSync.native(memberPath);
  const rootPrefix = `${canonicalRoot}${path.sep}`;
  if (
    (canonicalMember !== canonicalRoot && !canonicalMember.startsWith(rootPrefix))
  ) {
    throw new Error(`${label} escapes its installer output root`);
  }
}

function requireDirectoryChain(root, segments, label) {
  requireRealDirectory(root, `${label} output root`);
  assertCanonicalMember(root, root, `${label} output root`);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    requireRealDirectory(current, `${label} component '${segment}'`);
    assertCanonicalMember(root, current, `${label} component '${segment}'`);
  }
  return current;
}

function relativeDirectorySegments(root, directoryPath, label) {
  const relative = path.relative(path.resolve(root), path.resolve(directoryPath));
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} escapes its invocation boundary`);
  }
  return relative.split(path.sep).filter(Boolean);
}

function ensureRealChildDirectory(parent, name, label) {
  requireRealDirectory(parent, `${label} parent`);
  if (!name || name !== path.basename(name)) {
    throw new Error(`${label} must be a direct child directory`);
  }
  const child = path.join(parent, name);
  try {
    fs.mkdirSync(child);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  requireRealDirectory(child, label);
  assertCanonicalMember(parent, child, label);
  return child;
}

function captureDirectoryIdentity(directoryPath, label) {
  requireRealDirectory(directoryPath, label);
  const stat = fs.lstatSync(directoryPath, { bigint: true });
  return {
    path: directoryPath,
    canonicalPath: fs.realpathSync.native(directoryPath),
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

function assertDirectoryIdentity(identity, label) {
  const actual = captureDirectoryIdentity(identity.path, label);
  if (
    actual.canonicalPath !== identity.canonicalPath ||
    actual.dev !== identity.dev ||
    actual.ino !== identity.ino ||
    actual.birthtimeNs !== identity.birthtimeNs
  ) {
    throw new Error(`${label} identity changed during installer packaging`);
  }
}

function validateTransactionRoots(
  invocationBoundary,
  releaseRoot,
  stagingRoot,
  directoryIdentities = [],
) {
  requireDirectoryChain(
    invocationBoundary,
    relativeDirectorySegments(invocationBoundary, releaseRoot, "Installer release root"),
    "Installer release root",
  );
  requireDirectoryChain(
    invocationBoundary,
    relativeDirectorySegments(invocationBoundary, stagingRoot, "Installer staging root"),
    "Installer staging root",
  );
  for (const identity of directoryIdentities) {
    assertDirectoryIdentity(identity, "Installer transaction directory");
  }
}

function removeGeneratedDirectoryIfConfined(
  invocationBoundary,
  directoryPath,
  expectedIdentity,
) {
  try {
    requireDirectoryChain(
      invocationBoundary,
      relativeDirectorySegments(invocationBoundary, directoryPath, "Generated directory"),
      "Generated directory",
    );
    assertDirectoryIdentity(expectedIdentity, "Generated directory");
  } catch {
    return false;
  }
  fs.rmSync(directoryPath, { recursive: true, force: true });
  return true;
}

function assertClosedBackendTree(root, backendRoot, label) {
  assertCanonicalMember(root, backendRoot, label);
  const pending = [backendRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory)) {
      const entryPath = path.join(directory, name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`${label} contains a link or special file: ${entryPath}`);
      }
      assertCanonicalMember(backendRoot, entryPath, label);
      if (stat.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
}

function assertDiscoveredOutput(output) {
  const backendRoot = requireDirectoryChain(
    output.outputRoot,
    output.backendSegments,
    `${output.platform} packaged backend`,
  );
  if (backendRoot !== output.backendRoot) {
    throw new Error(`${output.platform} packaged backend path changed after discovery`);
  }
  assertClosedBackendTree(
    output.outputRoot,
    backendRoot,
    `${output.platform} packaged backend`,
  );
  for (const artifact of output.allArtifacts) {
    const artifactPath = path.join(output.outputRoot, artifact);
    const identity = regularFileIdentity(
      artifactPath,
      `${output.platform} installer artifact`,
    );
    if (
      identity.size !== output.artifactIdentities[artifact]?.size ||
      identity.sha256 !== output.artifactIdentities[artifact]?.sha256
    ) {
      throw new Error(`${output.platform} installer artifact identity mismatch: ${artifact}`);
    }
    assertCanonicalMember(
      output.outputRoot,
      artifactPath,
      `${output.platform} installer artifact`,
    );
  }
}

function validateProducedEntries(stagingRoot, producedNames, outputs) {
  const expected = new Set(
    outputs.flatMap((output) => [output.unpackedName, ...output.allArtifacts]),
  );
  for (const name of producedNames) {
    const entryPath = path.join(stagingRoot, name);
    if (expected.has(name)) {
      const output = outputs.find((candidate) => candidate.unpackedName === name);
      if (output) {
        requireRealDirectory(entryPath, `${output.platform} unpacked output`);
      } else {
        requireRealFile(entryPath, "Installer artifact");
      }
      assertCanonicalMember(stagingRoot, entryPath, "Fresh installer output");
      continue;
    }
    if (/^builder-(?:debug|effective-config)\.ya?ml$/i.test(name)) {
      requireRealFile(entryPath, "electron-builder metadata");
      assertCanonicalMember(stagingRoot, entryPath, "electron-builder metadata");
      continue;
    }
    throw new Error(`Unexpected fresh electron-builder output: ${name}`);
  }
  return [...expected].sort();
}

function discoverPlatformOutput(
  stagingRoot,
  platform,
  producedNames,
  expectedArtifactIdentities = null,
) {
  const produced = new Set(producedNames);
  const producedEntries = fs
    .readdirSync(stagingRoot)
    .filter((name) => produced.has(name));

  let unpackedName;
  let backendRoot;
  let backendSegments;
  let artifacts;
  let updaterMetadataPattern;
  if (platform === "linux") {
    unpackedName = requireExactlyOne(
      producedEntries.filter((name) => /^linux(?:-[a-z0-9_-]+)?-unpacked$/i.test(name)),
      "Linux unpacked application",
    );
    artifacts = [
      requireExactlyOne(producedEntries.filter((name) => name.endsWith(".AppImage")), "Linux AppImage"),
      requireExactlyOne(producedEntries.filter((name) => name.endsWith(".deb")), "Linux deb"),
    ];
    backendSegments = [unpackedName, "resources", "backend"];
    backendRoot = path.join(stagingRoot, ...backendSegments);
    updaterMetadataPattern = /^latest-linux\.ya?ml$/i;
  } else if (platform === "win32") {
    unpackedName = requireExactlyOne(
      producedEntries.filter((name) => /^win(?:-[a-z0-9_-]+)?-unpacked$/i.test(name)),
      "Windows unpacked application",
    );
    const executables = producedEntries.filter((name) => name.toLowerCase().endsWith(".exe"));
    artifacts = [
      requireExactlyOne(executables.filter((name) => /-portable\.exe$/i.test(name)), "Windows portable executable"),
      requireExactlyOne(executables.filter((name) => !/-portable\.exe$/i.test(name)), "Windows NSIS installer"),
    ];
    backendSegments = [unpackedName, "resources", "backend"];
    backendRoot = path.join(stagingRoot, ...backendSegments);
    updaterMetadataPattern = /^latest\.ya?ml$/i;
  } else if (platform === "darwin") {
    unpackedName = requireExactlyOne(
      producedEntries.filter((name) => /^mac(?:-[a-z0-9_-]+)?$/i.test(name)),
      "macOS unpacked application directory",
    );
    artifacts = [
      requireExactlyOne(producedEntries.filter((name) => name.endsWith(".dmg")), "macOS dmg"),
    ];
    const macRoot = path.join(stagingRoot, unpackedName);
    const appName = requireExactlyOne(
      fs
        .readdirSync(macRoot)
        .filter((name) => name.endsWith(".app")),
      "macOS app bundle",
    );
    backendSegments = [
      unpackedName,
      appName,
      "Contents",
      "Resources",
      "backend",
    ];
    backendRoot = path.join(stagingRoot, ...backendSegments);
    updaterMetadataPattern = /^latest-mac\.ya?ml$/i;
  } else {
    throw new Error(`Unsupported installer output platform: ${platform}`);
  }

  const auxiliaryArtifacts = producedEntries.filter((name) =>
    updaterMetadataPattern.test(name) || (
      name.toLowerCase().endsWith(".blockmap") &&
      artifacts.some((artifact) => name === `${artifact}.blockmap`)
    ),
  );
  const allArtifacts = [...artifacts, ...auxiliaryArtifacts];
  const output = {
    platform,
    outputRoot: stagingRoot,
    unpackedName,
    backendSegments,
    backendRoot,
    artifactBoundaryRoot: platform === "darwin"
      ? path.join(stagingRoot, unpackedName, backendSegments[1])
      : path.join(stagingRoot, unpackedName),
    artifacts,
    auxiliaryArtifacts,
    allArtifacts,
    artifactIdentities: expectedArtifactIdentities ?? Object.fromEntries(
      allArtifacts.map((artifact) => [
        artifact,
        regularFileIdentity(
          path.join(stagingRoot, artifact),
          `${platform} installer artifact`,
        ),
      ]),
    ),
  };
  assertDiscoveredOutput(output);
  return output;
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
    const verify = () => {
      assertDiscoveredOutput(output);
      return verifyRuntimeContract({
        backendRoot: output.backendRoot,
        artifactBoundaryRoot: output.artifactBoundaryRoot,
        platform: output.platform,
        arch: output.platform === "darwin" ? process.arch : "x64",
        requireBundledPythonPlugin: true,
        requireBundledMethods: true,
      });
    };
    const first = verify();
    if (output.platform === hostPlatform) {
      smokeSidecar(first.sidecarPath);
    }
    verify();
  }
}

function moveWithRollback(
  invocationBoundary,
  stagingRoot,
  releaseRoot,
  names,
  verifyPublished,
  directoryIdentities,
) {
  validateTransactionRoots(
    invocationBoundary,
    releaseRoot,
    stagingRoot,
    directoryIdentities,
  );
  const backupRoot = path.join(
    path.dirname(stagingRoot),
    `.installer-backup-${process.pid}-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(backupRoot);
  requireDirectoryChain(
    invocationBoundary,
    relativeDirectorySegments(invocationBoundary, backupRoot, "Installer backup root"),
    "Installer backup root",
  );
  const backupIdentity = captureDirectoryIdentity(
    backupRoot,
    "Installer backup root",
  );
  const moved = [];
  const backedUp = [];
  let preserveBackup = false;
  try {
    for (const name of names) {
      validateTransactionRoots(
        invocationBoundary,
        releaseRoot,
        stagingRoot,
        directoryIdentities,
      );
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
    validateTransactionRoots(
      invocationBoundary,
      releaseRoot,
      stagingRoot,
      directoryIdentities,
    );
  } catch (error) {
    try {
      validateTransactionRoots(
        invocationBoundary,
        releaseRoot,
        stagingRoot,
        directoryIdentities,
      );
    } catch (boundaryError) {
      preserveBackup = true;
      throw new Error(
        `Installer transaction boundary changed; rollback refused and recovery backup retained at ${backupIdentity.canonicalPath}: ${boundaryError.message}`,
        { cause: error },
      );
    }
    for (const name of moved.reverse()) {
      validateTransactionRoots(
        invocationBoundary,
        releaseRoot,
        stagingRoot,
        directoryIdentities,
      );
      fs.rmSync(path.join(releaseRoot, name), { recursive: true, force: true });
    }
    for (const name of backedUp) {
      validateTransactionRoots(
        invocationBoundary,
        releaseRoot,
        stagingRoot,
        directoryIdentities,
      );
      fs.renameSync(path.join(backupRoot, name), path.join(releaseRoot, name));
    }
    throw error;
  } finally {
    if (!preserveBackup) {
      removeGeneratedDirectoryIfConfined(
        invocationBoundary,
        backupRoot,
        backupIdentity,
      );
    }
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
  const invocationBoundary = path.dirname(releaseRoot);
  requireRealDirectory(invocationBoundary, "Installer invocation boundary");
  assertCanonicalMember(
    invocationBoundary,
    invocationBoundary,
    "Installer invocation boundary",
  );
  ensureRealChildDirectory(
    invocationBoundary,
    path.basename(releaseRoot),
    "Installer release root",
  );
  const releaseBefore = snapshotTopLevel(releaseRoot);
  const buildRoot = ensureRealChildDirectory(
    invocationBoundary,
    "build",
    "Installer build root",
  );
  const stagingParent = ensureRealChildDirectory(
    buildRoot,
    "installer-invocations",
    "Installer staging parent",
  );
  const stagingRoot = fs.mkdtempSync(path.join(stagingParent, "installer-"));
  requireDirectoryChain(
    invocationBoundary,
    ["build", "installer-invocations", path.basename(stagingRoot)],
    "Installer staging root",
  );
  const transactionDirectoryIdentities = [
    captureDirectoryIdentity(invocationBoundary, "Installer invocation boundary"),
    captureDirectoryIdentity(releaseRoot, "Installer release root"),
    captureDirectoryIdentity(buildRoot, "Installer build root"),
    captureDirectoryIdentity(stagingParent, "Installer staging parent"),
    captureDirectoryIdentity(stagingRoot, "Installer staging root"),
  ];
  const stagingIdentity = transactionDirectoryIdentities.at(-1);
  const stagingBefore = snapshotTopLevel(stagingRoot);
  try {
    await runBuilder(stagingRoot);
    validateTransactionRoots(
      invocationBoundary,
      releaseRoot,
      stagingRoot,
      transactionDirectoryIdentities,
    );
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
    const promotedNames = validateProducedEntries(stagingRoot, producedNames, outputs);
    verifyDiscoveredOutputs({
      outputs,
      verifyRuntimeContract,
      smokeSidecar,
      hostPlatform,
    });
    for (const output of outputs) {
      assertDiscoveredOutput(output);
    }
    const revalidatedNames = validateProducedEntries(stagingRoot, producedNames, outputs);
    if (JSON.stringify(revalidatedNames) !== JSON.stringify(promotedNames)) {
      throw new Error("Fresh installer output set changed before promotion");
    }

    let finalOutputs = null;
    validateTransactionRoots(
      invocationBoundary,
      releaseRoot,
      stagingRoot,
      transactionDirectoryIdentities,
    );
    moveWithRollback(invocationBoundary, stagingRoot, releaseRoot, promotedNames, () => {
      const publishedOutputs = platforms.map((platform, index) =>
        discoverPlatformOutput(
          releaseRoot,
          platform,
          promotedNames,
          outputs[index].artifactIdentities,
        ),
      );
      verifyDiscoveredOutputs({
        outputs: publishedOutputs,
        verifyRuntimeContract,
        smokeSidecar,
        hostPlatform,
      });
      const releaseAfter = snapshotTopLevel(releaseRoot);
      const publishedNames = newlyProducedNames(releaseBefore, releaseAfter);
      for (const name of promotedNames) {
        if (!publishedNames.includes(name)) {
          throw new Error(`Verified installer output was not published by this invocation: ${name}`);
        }
      }
      finalOutputs = platforms.map((platform, index) =>
        discoverPlatformOutput(
          releaseRoot,
          platform,
          promotedNames,
          outputs[index].artifactIdentities,
        ),
      );
    }, transactionDirectoryIdentities);
    return {
      producedNames: promotedNames,
      outputs: finalOutputs,
    };
  } finally {
    removeGeneratedDirectoryIfConfined(
      invocationBoundary,
      stagingRoot,
      stagingIdentity,
    );
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
