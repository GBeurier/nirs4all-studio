#!/usr/bin/env node
// SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
// Stage the authored JS/types/legal surface into a wasm-pack package.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = path.join(root, "bindings/wasm");
const sbomFileName = "nirs4all-io-wasm.cdx.json";
const legalTopLevel = ["LICENSE", "LICENSING.md", "THIRD_PARTY_NOTICES.md", "COPY_PROVENANCE.md"];
const legalMirrors = [
  "bindings/python",
  "bindings/r/inst",
  "bindings/wasm",
  "crates/nirs4all-io-core",
  "crates/nirs4all-io",
  "crates/nirs4all-io-capi",
  "crates/nirs4all-io-cli",
];
const wasmLicenseClosureChecksum = "d678472a3b5e09bec06f6c4bd5d36a8b9edf22fe7fd343cceb260b443140c920";
const lockedLicenseSources = [
  {
    packageName: "ryu",
    version: "1.0.23",
    crateChecksum: "9774ba4a74de5f7b1c1451ed6cd5285a32eddb5cccb8cc655a4e50009e06477f",
    licenseFile: "Apache-2.0.txt",
    licenseChecksum: "62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a",
  },
  {
    packageName: "unicode-ident",
    version: "1.0.24",
    crateChecksum: "e6e4313cd5fcd3dad5cafa179702e2b244f760991f45397d14d4ebf38247da75",
    licenseFile: "Unicode-3.0.txt",
    licenseChecksum: "f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1",
  },
];

function regularFileNames(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function verifyWasmLicenseClosure() {
  const result = spawnSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "bindings/wasm/Cargo.toml",
      "--locked",
      "--offline",
      "--format-version=1",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`could not audit the locked WASM license closure: ${result.stderr.trim()}`);
  }
  const metadata = JSON.parse(result.stdout);
  const lines = metadata.packages
    .map((pkg) => `${pkg.name}@${pkg.version}|${pkg.license ?? "NO-LICENSE"}`)
    .sort();
  const checksum = sha256(Buffer.from(`${lines.join("\n")}\n`));
  if (checksum !== wasmLicenseClosureChecksum) {
    throw new Error(
      `locked WASM license closure changed (${checksum}); audit every license expression before staging`,
    );
  }
  return metadata;
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function sourceIdentity(requireClean) {
  if (requireClean) {
    const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status) throw new Error("WASM SBOM staging requires a clean source worktree");
  }
  const commit = runGit(["rev-parse", "HEAD"]);
  const tree = runGit(["rev-parse", "HEAD^{tree}"]);
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error("source commit/tree must be full SHA-1 object identities");
  }
  return { commit, tree };
}

function normalizedSpdx(expression) {
  if (expression === "Unlicense/MIT") return "Unlicense OR MIT";
  if (expression === "MIT/Apache-2.0") return "MIT OR Apache-2.0";
  return expression;
}

function lockChecksums() {
  const blocks = fs.readFileSync(path.join(wasm, "Cargo.lock"), "utf8").split("[[package]]").slice(1);
  const checksums = new Map();
  for (const block of blocks) {
    const name = block.match(/^name = "([^"]+)"$/m)?.[1];
    const version = block.match(/^version = "([^"]+)"$/m)?.[1];
    const checksum = block.match(/^checksum = "([0-9a-f]+)"$/m)?.[1];
    if (!name || !version || !checksum) continue;
    const key = `${name}@${version}`;
    if (checksums.has(key) && checksums.get(key) !== checksum) {
      throw new Error(`ambiguous Cargo.lock checksums for ${key}`);
    }
    checksums.set(key, checksum);
  }
  return checksums;
}

function cargoPurl(pkg) {
  return `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`;
}

function buildWasmSbom(metadata, identity) {
  const checksums = lockChecksums();
  const packages = [...metadata.packages].sort((left, right) =>
    cargoPurl(left).localeCompare(cargoPurl(right)),
  );
  const refsById = new Map(packages.map((pkg) => [pkg.id, cargoPurl(pkg)]));
  if (new Set(refsById.values()).size !== packages.length) {
    throw new Error("WASM Cargo metadata contains duplicate package purls/bom-refs");
  }
  const components = packages.map((pkg) => {
    const purl = cargoPurl(pkg);
    const component = {
      type: "library",
      "bom-ref": purl,
      name: pkg.name,
      version: pkg.version,
      licenses: [{ expression: normalizedSpdx(pkg.license ?? "NOASSERTION") }],
      purl,
    };
    const crateChecksum = checksums.get(`${pkg.name}@${pkg.version}`);
    if (crateChecksum) component.hashes = [{ alg: "SHA-256", content: crateChecksum }];
    if (pkg.source === null) {
      component.externalReferences = [
        {
          type: "vcs",
          url: `https://github.com/GBeurier/nirs4all-io/tree/${identity.commit}`,
        },
      ];
      component.properties = [
        { name: "nirs4all:source:commit", value: identity.commit },
        { name: "nirs4all:source:tree", value: identity.tree },
      ];
    }
    return component;
  });

  const dependencyMap = new Map(
    (metadata.resolve?.nodes ?? []).map((node) => [
      node.id,
      [...new Set(node.dependencies.map((id) => refsById.get(id)).filter(Boolean))].sort(),
    ]),
  );
  const dependencies = packages.map((pkg) => ({
    ref: refsById.get(pkg.id),
    dependsOn: dependencyMap.get(pkg.id) ?? [],
  }));
  const subjectPackage = packages.find((pkg) => pkg.id === metadata.resolve?.root);
  if (!subjectPackage || subjectPackage.name !== "nirs4all-io-wasm") {
    throw new Error("WASM Cargo metadata root is not nirs4all-io-wasm");
  }
  const subjectPurl = cargoPurl(subjectPackage);
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "library",
        "bom-ref": subjectPurl,
        name: subjectPackage.name,
        version: subjectPackage.version,
        licenses: [{ expression: "CECILL-2.1 OR AGPL-3.0-or-later" }],
        purl: subjectPurl,
        externalReferences: [
          {
            type: "vcs",
            url: `https://github.com/GBeurier/nirs4all-io/tree/${identity.commit}`,
          },
        ],
        properties: [
          { name: "nirs4all:source:commit", value: identity.commit },
          { name: "nirs4all:source:tree", value: identity.tree },
        ],
      },
    },
    components,
    dependencies,
  };
}

function validateWasmSbom(sbom) {
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.version !== 1) {
    throw new Error("invalid deterministic WASM CycloneDX envelope");
  }
  const subject = sbom.metadata?.component;
  if (subject?.name !== "nirs4all-io-wasm" || subject.purl !== subject["bom-ref"]) {
    throw new Error("invalid WASM SBOM subject identity");
  }
  if (sbom.components.length !== 55 || sbom.dependencies.length !== 55) {
    throw new Error(
      `WASM SBOM must contain exactly 55 components/dependencies, got ${sbom.components.length}/${sbom.dependencies.length}`,
    );
  }
  const refs = new Set(sbom.components.map((component) => component["bom-ref"]));
  if (refs.size !== sbom.components.length || !refs.has(subject["bom-ref"])) {
    throw new Error("WASM SBOM component bom-refs are incomplete or duplicated");
  }
  for (const component of sbom.components) {
    if (component.purl !== component["bom-ref"] || !component.licenses?.[0]?.expression) {
      throw new Error(`invalid component identity/license for ${component.name}`);
    }
  }
  for (const dependency of sbom.dependencies) {
    if (!refs.has(dependency.ref) || dependency.dependsOn.some((ref) => !refs.has(ref))) {
      throw new Error(`invalid dependency reference for ${dependency.ref}`);
    }
  }
  const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
  if (/"timestamp"\s*:|"serialNumber"\s*:|\/home\/|[A-Za-z]:\\\\/.test(serialized)) {
    throw new Error("WASM SBOM contains a volatile timestamp, UUID, or local path");
  }
  return serialized;
}

function verifyLockedLicenseSources() {
  const lock = fs.readFileSync(path.join(wasm, "Cargo.lock"), "utf8");
  const packageBlocks = lock.split("[[package]]").slice(1);
  for (const source of lockedLicenseSources) {
    const blocks = packageBlocks.filter((block) => {
      const name = block.match(/^name = "([^"]+)"$/m)?.[1];
      return name === source.packageName;
    });
    if (blocks.length !== 1) {
      throw new Error(`expected exactly one ${source.packageName} package in bindings/wasm/Cargo.lock`);
    }
    const version = blocks[0].match(/^version = "([^"]+)"$/m)?.[1];
    const crateChecksum = blocks[0].match(/^checksum = "([0-9a-f]+)"$/m)?.[1];
    if (version !== source.version || crateChecksum !== source.crateChecksum) {
      throw new Error(
        `${source.packageName} lock identity changed; re-audit its selected license before staging`,
      );
    }
    const license = fs.readFileSync(path.join(root, "LICENSES", source.licenseFile));
    if (sha256(license) !== source.licenseChecksum) {
      throw new Error(
        `LICENSES/${source.licenseFile} is not the audited ${source.packageName} ${source.version} upstream text`,
      );
    }
  }
}

function verifyLegalMirror(surface, expectedLicenses) {
  const surfaceRoot = path.join(root, surface);
  const surfaceLicenseDir = path.join(surfaceRoot, "LICENSES");
  const actualLicenses = regularFileNames(surfaceLicenseDir);
  if (JSON.stringify(actualLicenses) !== JSON.stringify(expectedLicenses)) {
    throw new Error(
      `${surface}/LICENSES must mirror root LICENSES exactly; expected ${expectedLicenses.join(", ")}, got ${actualLicenses.join(", ")}`,
    );
  }

  for (const relative of [
    ...legalTopLevel,
    ...expectedLicenses.map((name) => path.join("LICENSES", name)),
  ]) {
    const canonical = fs.readFileSync(path.join(root, relative));
    const authored = fs.readFileSync(path.join(surfaceRoot, relative));
    if (!canonical.equals(authored)) {
      throw new Error(`${surface}/${relative} differs from canonical root ${relative}`);
    }
  }
}

function verifyReleaseLegalMirrors() {
  const metadata = verifyWasmLicenseClosure();
  verifyLockedLicenseSources();
  const rootLicenseDir = path.join(root, "LICENSES");
  const expectedLicenses = regularFileNames(rootLicenseDir);
  for (const surface of legalMirrors) verifyLegalMirror(surface, expectedLicenses);
  const referencedLicenseFiles = new Set();
  for (const name of ["LICENSING.md", "THIRD_PARTY_NOTICES.md"]) {
    const text = fs.readFileSync(path.join(root, name), "utf8");
    for (const match of text.matchAll(/LICENSES\/([A-Za-z0-9._-]+)/g)) {
      referencedLicenseFiles.add(match[1]);
    }
  }
  for (const name of referencedLicenseFiles) {
    if (!expectedLicenses.includes(name)) {
      throw new Error(`canonical legal documents reference missing LICENSES/${name}`);
    }
  }

  return { expectedLicenses, metadata };
}

const { expectedLicenses, metadata } = verifyReleaseLegalMirrors();
if (process.argv.includes("--check-legal")) {
  const identity = sourceIdentity(false);
  const first = validateWasmSbom(buildWasmSbom(metadata, identity));
  const second = validateWasmSbom(buildWasmSbom(metadata, identity));
  if (first !== second) throw new Error("WASM SBOM generation is not deterministic");
  console.log(
    `verified ${legalMirrors.length} release legal mirrors, ${metadata.packages.length} SBOM components (${sha256(Buffer.from(first))})`,
  );
  process.exit(0);
}

const pkgDirArg = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const pkgDir = path.resolve(pkgDirArg ?? path.join(root, "bindings/wasm/pkg-node"));
const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
const workspace = cargo.match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
if (!workspace) throw new Error("could not read [workspace.package] version");
const sbom = validateWasmSbom(buildWasmSbom(metadata, sourceIdentity(true)));

const packagePath = path.join(pkgDir, "package.json");
const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
manifest.name = process.env.NPM_PKG_NAME ?? "@nirs4all/io-wasm";
manifest.version = workspace[1];
manifest.publishConfig = { access: "public", provenance: true };
manifest.repository = {
  type: "git",
  url: "https://github.com/GBeurier/nirs4all-io.git",
  directory: "bindings/wasm",
};
manifest.files = [...new Set([
  ...(manifest.files ?? []),
  "idiomatic.mjs",
  "idiomatic.d.ts",
  "types/nirs4all-io.d.ts",
  "LICENSE",
  "LICENSES",
  "LICENSING.md",
  "THIRD_PARTY_NOTICES.md",
  "COPY_PROVENANCE.md",
  sbomFileName,
])];
manifest.exports = {
  ".": {
    types: "./nirs4all_io_wasm.d.ts",
    require: "./nirs4all_io_wasm.js",
    default: "./nirs4all_io_wasm.js",
  },
  "./idiomatic": {
    types: "./idiomatic.d.ts",
    import: "./idiomatic.mjs",
    default: "./idiomatic.mjs",
  },
  "./types": { types: "./types/nirs4all-io.d.ts" },
};

fs.mkdirSync(path.join(pkgDir, "types"), { recursive: true });
fs.rmSync(path.join(pkgDir, "LICENSES"), { recursive: true, force: true });
fs.mkdirSync(path.join(pkgDir, "LICENSES"), { recursive: true });
fs.copyFileSync(path.join(wasm, "idiomatic.d.ts"), path.join(pkgDir, "idiomatic.d.ts"));
fs.copyFileSync(
  path.join(wasm, "types/nirs4all-io.d.ts"),
  path.join(pkgDir, "types/nirs4all-io.d.ts"),
);
const wrapper = fs
  .readFileSync(path.join(wasm, "idiomatic.mjs"), "utf8")
  .replace('"./pkg/nirs4all_io_wasm.js"', '"./nirs4all_io_wasm.js"');
if (wrapper.includes('"./pkg/nirs4all_io_wasm.js"')) {
  throw new Error("failed to retarget the idiomatic wrapper to the staged WASM module");
}
fs.writeFileSync(path.join(pkgDir, "idiomatic.mjs"), wrapper);

for (const name of legalTopLevel) {
  fs.copyFileSync(path.join(wasm, name), path.join(pkgDir, name));
}
for (const name of expectedLicenses) {
  fs.copyFileSync(path.join(wasm, "LICENSES", name), path.join(pkgDir, "LICENSES", name));
}
fs.writeFileSync(path.join(pkgDir, sbomFileName), sbom);
fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`staged ${manifest.name}@${manifest.version} in ${pkgDir}`);
