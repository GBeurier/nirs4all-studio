#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withPrependedSearchPath } = require("./build-native-methods.cjs");

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
const profile = "raw-pls2-affine-multitarget-core-v1";
// An attested prebuilt fixture bypasses generation; otherwise the ignored
// producer in the Studio test binary writes one retained owner-produced model.
let currentWitness = process.env.N4A_RT_PRED_ARCHIVE_V2;
let currentWitnessSha256 = process.env.N4A_RT_PRED_ARCHIVE_V2_SHA256;
const suppliedWitness = currentWitness !== undefined;
const methodsLibrary = process.env.NIRS4ALL_BUILD_METHODS_LIBRARY;
const methodsDirectory = process.env.NIRS4ALL_BUILD_METHODS_DIRECTORY;
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
if (suppliedWitness !== (currentWitnessSha256 !== undefined)) {
  fail("supply both N4A_RT_PRED_ARCHIVE_V2 and N4A_RT_PRED_ARCHIVE_V2_SHA256, or neither");
}
if (!methodsLibrary || !path.isAbsolute(methodsLibrary)) {
  fail("NIRS4ALL_BUILD_METHODS_LIBRARY must be an absolute path");
}
if (!fs.existsSync(methodsLibrary) || !fs.statSync(methodsLibrary).isFile()) {
  fail(`missing Methods library: ${methodsLibrary}`);
}
if (
  !methodsDirectory ||
  !path.isAbsolute(methodsDirectory) ||
  path.resolve(methodsDirectory) !== path.dirname(path.resolve(methodsLibrary))
) {
  fail("NIRS4ALL_BUILD_METHODS_DIRECTORY must match the attested library directory");
}
if (!/^[0-9a-f]{64}$/.test(methodsSha256 || "")) {
  fail("NIRS4ALL_BUILD_METHODS_SHA256 must be a lowercase SHA-256 digest");
}
if (sha256(methodsLibrary) !== methodsSha256) {
  fail(`Methods library digest does not match ${methodsSha256}`);
}

const testEnv = {
  ...(process.platform === "win32"
    ? withPrependedSearchPath(process.env, methodsDirectory, process.platform)
    : process.env),
  N4A_RT_PRED_METHODS_LIBRARY: methodsLibrary,
  N4A_RT_PRED_METHODS_SHA256: methodsSha256,
};
const producer = "native_archive_fixture::produce_raw_pls2_affine_multitarget_core_v1";
const consumers = [
  ["archive_v2_prediction::tests::core_refuses_frozen_physical_archive_v2_with_reexport_advice", false],
  ["archive_v2_prediction::tests::raw_pls2_affine_multitarget_core_v1_predicts_without_python_or_fallback", true],
  ["tests::raw_pls2_affine_multitarget_core_v1_http_route_predicts_without_python_or_fallback", true],
];

// Compile once and execute that exact lib-test binary for every phase.
const compilation = execFileSync("cargo", [
  "test", "--offline", "--lib", "--no-run", "--message-format=json",
  "--manifest-path", path.join(root, "sidecar", "Cargo.toml"),
], { cwd: root, env: testEnv, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const messages = compilation.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
for (const message of messages) {
  if (message.reason === "compiler-message" && message.message?.rendered) {
    process.stderr.write(message.message.rendered);
  }
}
const binaries = [...new Set(messages.filter(message =>
  message.reason === "compiler-artifact" && message.profile?.test === true &&
  message.target?.kind?.includes("lib") && message.target.name === "studio_sidecar" && message.executable,
).map(message => message.executable))];
if (binaries.length !== 1 || !path.isAbsolute(binaries[0]) || !fs.existsSync(binaries[0])) {
  fail("Cargo must identify exactly one Studio lib-test executable");
}
const binary = binaries[0];

function runExact(test, ignored, env) {
  const flags = [test, "--exact", ...(ignored ? ["--ignored"] : [])];
  const listing = execFileSync(binary, [...flags, "--list"], { cwd: root, env, encoding: "utf8" });
  if (listing.split(/\r?\n/).filter(line => line === `${test}: test`).length !== 1) {
    fail(`exact selector must identify one real case: ${test}`);
  }
  let output;
  try {
    output = execFileSync(binary, [...flags, "--nocapture", "--test-threads=1"], {
      cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    throw error;
  }
  process.stdout.write(output);
  if (!/^test result: ok\. 1 passed; 0 failed; 0 ignored;/m.test(output)) {
    fail(`exact selector did not execute and pass one case: ${test}`);
  }
}

let retainedOutput = null;
const savedEvidence = new Map();
if (!suppliedWitness) {
  retainedOutput = process.env.N4A_RT_PRED_FIXTURE_OUTPUT;
  if (retainedOutput !== undefined && (!retainedOutput || !path.isAbsolute(retainedOutput))) {
    fail("N4A_RT_PRED_FIXTURE_OUTPUT must be an absent absolute output directory");
  }
  if (retainedOutput === undefined) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-native-archive-v2-"));
    retainedOutput = path.join(scratch, profile);
  }
  console.log(`Retaining owner-produced fixture and evidence at ${retainedOutput}`);
  runExact(producer, true, { ...testEnv, N4A_RT_PRED_FIXTURE_OUTPUT: retainedOutput });
  const receiptPath = path.join(retainedOutput, "receipt.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  currentWitness = path.join(retainedOutput, `${profile}.n4a`);
  currentWitnessSha256 = receipt.archive_sha256;
  if (receipt.profile !== profile || receipt.owner_training_calls !== 1 ||
      path.resolve(receipt.archive_path) !== path.resolve(currentWitness)) {
    fail("producer receipt must identify this one saved fixture");
  }
  for (const name of ["outcome.json", "package.json", "receipt.json"]) {
    const file = path.join(retainedOutput, name);
    savedEvidence.set(file, sha256(file));
  }
}
if (!currentWitness || !path.isAbsolute(currentWitness) || !fs.existsSync(currentWitness) || !fs.statSync(currentWitness).isFile()) {
  fail("N4A_RT_PRED_ARCHIVE_V2 must name the owner-produced raw-pls2-affine-multitarget-core-v1 fixture");
}
if (!/^[0-9a-f]{64}$/.test(currentWitnessSha256 || "") || sha256(currentWitness) !== currentWitnessSha256) {
  fail("N4A_RT_PRED_ARCHIVE_V2_SHA256 must attest the raw-pls2-affine-multitarget-core-v1 fixture");
}
savedEvidence.set(currentWitness, currentWitnessSha256);
console.log(`Replaying the saved fixture ${currentWitness} (SHA-256 ${currentWitnessSha256}); no consumer invokes training.`);
const replayEnv = {
  ...testEnv,
  N4A_RT_PRED_ARCHIVE_V2: currentWitness,
  N4A_RT_PRED_ARCHIVE_V2_SHA256: currentWitnessSha256,
};
for (const [test, ignored] of consumers) runExact(test, ignored, replayEnv);
for (const [file, digest] of savedEvidence) {
  if (sha256(file) !== digest) fail(`saved fixture evidence changed during replay: ${file}`);
}
console.log(JSON.stringify({ profile, archive: currentWitness, sha256: currentWitnessSha256,
  retained_output: retainedOutput, producer_runs: suppliedWitness ? 0 : 1,
  passed_cases: consumers.length + (suppliedWitness ? 0 : 1) }));
