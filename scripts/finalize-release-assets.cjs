const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PAYLOAD_SUFFIXES = Object.freeze([
  ".AppImage",
  ".deb",
  ".dmg",
  ".exe",
  ".tar.gz",
  ".zip",
]);

function expectedPublishedNames(version, includeAllInOne = true) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Release version is invalid: ${version}`);
  }
  const installers = [
    `nirs4all.Studio-${version}-linux-amd64.deb`,
    `nirs4all.Studio-${version}-linux-x86_64.AppImage`,
    `nirs4all.Studio-${version}-mac-arm64.dmg`,
    `nirs4all.Studio-${version}-mac-x64.dmg`,
    `nirs4all.Studio-${version}-win-x64-portable.exe`,
    `nirs4all.Studio-${version}-win-x64.exe`,
  ];
  const allInOne = [
    `nirs4all.Studio-${version}-all-in-one-linux-x64.tar.gz`,
    `nirs4all.Studio-${version}-all-in-one-mac-arm64.zip`,
    `nirs4all.Studio-${version}-all-in-one-mac-x64.zip`,
    `nirs4all.Studio-${version}-all-in-one-win-x64.zip`,
  ];
  return (includeAllInOne ? [...installers, ...allInOne] : installers).sort();
}

function canonicalPublishedName(name) {
  const canonical = name.replaceAll(" ", ".");
  if (!canonical || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(canonical)) {
    throw new Error(`Release asset has a non-canonical public name: ${name}`);
  }
  return canonical;
}

function requireRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a real regular file: ${filePath}`);
  }
  return stat;
}

function sha256File(filePath) {
  const before = requireRegularFile(filePath, "Release payload");
  const digest = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const after = requireRegularFile(filePath, "Release payload");
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(`Release payload changed while hashing: ${filePath}`);
  }
  return digest.digest("hex");
}

function parseChecksumSidecar(sidecarPath, payloadName) {
  requireRegularFile(sidecarPath, "Release checksum sidecar");
  const content = fs.readFileSync(sidecarPath, "utf8");
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\r?\n?$/.exec(content);
  if (!match) {
    throw new Error(`Release checksum sidecar is malformed: ${sidecarPath}`);
  }
  const listedName = path.basename(match[2].replaceAll("\\", "/"));
  if (listedName !== payloadName) {
    throw new Error(
      `Release checksum sidecar names '${listedName}', expected '${payloadName}'`,
    );
  }
  return match[1];
}

function isReleasePayload(name) {
  return PAYLOAD_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function finalizeReleaseAssets(releaseRoot, expectedNames = null) {
  const rootStat = fs.lstatSync(releaseRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Release root must be a real directory: ${releaseRoot}`);
  }

  const names = fs.readdirSync(releaseRoot);
  const payloadNames = names.filter(isReleasePayload).sort();
  const sidecarNames = names.filter((name) => name.endsWith(".sha256")).sort();
  const unknownNames = names.filter(
    (name) => !isReleasePayload(name) && !name.endsWith(".sha256"),
  );
  if (unknownNames.length > 0) {
    throw new Error(`Unexpected release assets: ${unknownNames.join(", ")}`);
  }
  if (payloadNames.length === 0) {
    throw new Error("Release directory contains no payloads");
  }
  if (sidecarNames.length !== payloadNames.length) {
    throw new Error(
      `Release payload/checksum count mismatch: ${payloadNames.length}/${sidecarNames.length}`,
    );
  }

  const records = payloadNames.map((payloadName) => {
    const payloadPath = path.join(releaseRoot, payloadName);
    const sidecarPath = `${payloadPath}.sha256`;
    if (!sidecarNames.includes(`${payloadName}.sha256`)) {
      throw new Error(`Release payload has no checksum sidecar: ${payloadName}`);
    }
    const declaredDigest = parseChecksumSidecar(sidecarPath, payloadName);
    const actualDigest = sha256File(payloadPath);
    if (declaredDigest !== actualDigest) {
      throw new Error(`Release checksum does not match payload: ${payloadName}`);
    }
    return {
      payloadName,
      payloadPath,
      sidecarPath,
      publishedName: canonicalPublishedName(payloadName),
      digest: actualDigest,
    };
  });

  const publishedNames = new Set();
  for (const record of records) {
    if (publishedNames.has(record.publishedName)) {
      throw new Error(`Canonical release asset name collision: ${record.publishedName}`);
    }
    publishedNames.add(record.publishedName);
  }
  if (expectedNames) {
    const actual = [...publishedNames].sort();
    const expected = [...expectedNames].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Release asset inventory mismatch:\nexpected ${expected.join(", ")}\nactual ${actual.join(", ")}`,
      );
    }
  }

  for (const record of records) {
    fs.unlinkSync(record.sidecarPath);
  }
  for (const record of records) {
    const publishedPath = path.join(releaseRoot, record.publishedName);
    if (publishedPath !== record.payloadPath) {
      fs.renameSync(record.payloadPath, publishedPath);
    }
    fs.writeFileSync(
      `${publishedPath}.sha256`,
      `${record.digest}  ${record.publishedName}\n`,
      { encoding: "ascii", flag: "wx", mode: 0o644 },
    );
  }

  return records.map(({ publishedName, digest }) => ({ publishedName, digest }));
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || !["true", "false"].includes(argv[2])) {
    throw new Error(
      "Usage: node scripts/finalize-release-assets.cjs <release-root> <version> <include-all-in-one:true|false>",
    );
  }
  const records = finalizeReleaseAssets(
    path.resolve(argv[0]),
    expectedPublishedNames(argv[1], argv[2] === "true"),
  );
  for (const record of records) {
    process.stdout.write(`${record.digest}  ${record.publishedName}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  canonicalPublishedName,
  expectedPublishedNames,
  finalizeReleaseAssets,
  parseChecksumSidecar,
  sha256File,
};
