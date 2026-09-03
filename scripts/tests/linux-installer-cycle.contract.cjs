const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cycle = require("../smoke-linux-installer-cycle.cjs");

const roots = [];

test.afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-inst001-contract-"));
  roots.push(root);
  return root;
}

function fakeAppImage(root, name, marker) {
  const artifact = path.join(root, name);
  const script = `#!${process.execPath}
const http = require("node:http");
const port = Number(process.env.NIRS4ALL_NATIVE_SIDECAR_PORT);
const server = http.createServer((request, response) => {
  if (request.url !== "/sidecar/v1/health") { response.writeHead(404).end(); return; }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ sidecar_ready: true, protocol_version: "studio-sidecar-r1", marker: ${JSON.stringify(marker)} }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
setInterval(() => {}, 1000);
`;
  fs.writeFileSync(artifact, script, { mode: 0o755 });
  return {
    path: artifact,
    sha256: createHash("sha256").update(script).digest("hex"),
  };
}

function config(root) {
  const install = fakeAppImage(root, "candidate.AppImage", "candidate");
  const update = fakeAppImage(root, "update.AppImage", "update");
  return {
    installArtifact: install.path,
    installSha256: install.sha256,
    updateArtifact: update.path,
    updateSha256: update.sha256,
    report: path.join(root, "report.json"),
    workRoot: root,
    timeoutMs: 5000,
    launchArgs: [],
    help: false,
  };
}

test("parses explicit artifact identities without implicit discovery", () => {
  const parsed = cycle.parseArgs([
    "--install-artifact", "candidate.AppImage",
    "--install-sha256", "a".repeat(64),
    "--update-artifact=update.AppImage",
    "--update-sha256", "b".repeat(64),
    "--report", "receipt.json",
    "--launch-arg=--appimage-extract-and-run",
  ]);
  assert.equal(parsed.installArtifact, path.resolve("candidate.AppImage"));
  assert.equal(parsed.updateArtifact, path.resolve("update.AppImage"));
  assert.deepEqual(parsed.launchArgs, ["--appimage-extract-and-run"]);
});

test("refuses a missing or tampered artifact before creating a sandbox", async () => {
  const root = tempRoot();
  const raw = config(root);
  fs.appendFileSync(raw.installArtifact, "tampered");

  const report = await cycle.runCycle(raw);

  assert.equal(report.status, "failed");
  assert.match(report.failure, /SHA-256 mismatch/);
  assert.deepEqual(
    fs.readdirSync(root).sort(),
    ["candidate.AppImage", "update.AppImage"],
  );

  raw.installArtifact = path.join(root, "missing.AppImage");
  const missing = await cycle.runCycle(raw);
  assert.equal(missing.status, "failed");
  assert.match(missing.failure, /artifact is missing/);
});

test("runs install, launch, crash, restart, update, and uninstall with fake artifacts", async () => {
  const root = tempRoot();

  const report = await cycle.runCycle(config(root));

  assert.equal(report.status, "passed");
  assert.equal(report.evidence_state, "advanced_local_linux_appimage_cycle");
  assert.equal(report.inst001_complete, false);
  assert.equal(report.release_eligible, false);
  assert.equal(report.holds.includes("real_candidate_artifacts_required"), false);
  assert.equal(report.holds.includes("windows_and_macos_not_covered"), true);
  assert.deepEqual(
    report.steps.map((step) => [step.id, step.status]),
    [
      ["verify-artifacts", "passed"],
      ["install", "passed"],
      ["launch", "passed"],
      ["crash", "passed"],
      ["restart", "passed"],
      ["update", "passed"],
      ["launch-updated", "passed"],
      ["uninstall", "passed"],
    ],
  );
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith("n4a-inst001-linux-")), false);
});
