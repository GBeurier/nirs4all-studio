#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const witness = path.join(
  root,
  "sidecar",
  "fixtures",
  "archive-v2",
  "multitarget-pls-abi2.0.n4a",
);
const expectedWitnessSha256 =
  "6c626742245db5232a35c6b70095640480f6c6fb98c56dca5bce958686bbc99e";
const methodsLibrary = process.env.NIRS4ALL_BUILD_METHODS_LIBRARY;
const methodsSha256 = process.env.NIRS4ALL_BUILD_METHODS_SHA256;

function fail(message) {
  throw new Error(`Native Archive V2 qualification failed: ${message}`);
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(witness) || !fs.statSync(witness).isFile()) {
  fail(`missing immutable Archive V2 witness: ${witness}`);
}
if (sha256(witness) !== expectedWitnessSha256) {
  fail(`Archive V2 witness digest does not match ${expectedWitnessSha256}`);
}
if (!methodsLibrary || !path.isAbsolute(methodsLibrary)) {
  fail("NIRS4ALL_BUILD_METHODS_LIBRARY must be an absolute path");
}
if (!fs.existsSync(methodsLibrary) || !fs.statSync(methodsLibrary).isFile()) {
  fail(`missing Methods library: ${methodsLibrary}`);
}
if (!/^[0-9a-f]{64}$/.test(methodsSha256 || "")) {
  fail("NIRS4ALL_BUILD_METHODS_SHA256 must be a lowercase SHA-256 digest");
}
if (sha256(methodsLibrary) !== methodsSha256) {
  fail(`Methods library digest does not match ${methodsSha256}`);
}

execFileSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    path.join(root, "sidecar", "Cargo.toml"),
    "archive_v2_real_core_route_predicts_multitarget_without_python_or_fallback",
    "--",
    "--ignored",
    "--nocapture",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      N4A_RT_PRED_ARCHIVE_V2: witness,
      N4A_RT_PRED_METHODS_LIBRARY: methodsLibrary,
      N4A_RT_PRED_METHODS_SHA256: methodsSha256,
    },
    stdio: "inherit",
  },
);
