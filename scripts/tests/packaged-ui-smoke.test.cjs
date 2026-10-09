const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const finalize = require('../finalize-release-assets.cjs');
const source = fs.readFileSync(path.join(__dirname, '../smoke-packaged-ui.cjs'), 'utf8');
const { resolvePerformancePolicy } = require('../qualification-performance.cjs');

async function run(change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-ui-smoke-unit-'));
  const installer = path.join(root, 'candidate.deb'), output = path.join(root, 'proof.json');
  fs.writeFileSync(installer, 'fixture installer bytes');
  fs.writeFileSync(`${installer}.sha256`, `${finalize.sha256File(installer)}  candidate.deb\n`);
  const markerPath = path.join(root, 'marker.json');
  fs.writeFileSync(markerPath, JSON.stringify({ source_commit: change.sdk || 'b'.repeat(40), distribution_version: '1.4.8',
    wheel_sha256: 'd'.repeat(64), constraints: { sha256: 'e'.repeat(64) } }));
  const calls = [], module = { exports: {} };
  const env = { RELEASE_SOURCE_SHA: 'a'.repeat(40), RELEASE_VERSION: '0.15.1', NIRS4ALL_LIBRARY_REF: 'b'.repeat(40),
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'github-observational' };
  const mocks = {
    '@electron/asar': { extractFile: () => Buffer.from(JSON.stringify({ version: '0.15.1', commit: change.source || env.RELEASE_SOURCE_SHA })) },
    './smoke-archive-standalone.cjs': { parseArgs: () => ({ platform: 'linux', extractedRoot: root }), assertValidConfig: value => value,
      resolveLaunchLayout: () => ({ backendRoot: path.join(root, 'backend'), runtimeReadyPath: markerPath }),
      verifyLaunchRuntimeContract: () => { calls.push('contract'); if (change.contract) throw new Error('tampered contract'); return {}; } },
    './qualification-performance.cjs': { resolvePerformancePolicy }, './finalize-release-assets.cjs': finalize,
    './verify-runtime-cohort.cjs': { verifyRuntimeCohort: () => ({}), verifyInstalledCohort: () => ({}) },
    './qualify-local-packaged.cjs': { withOwnedProfile: (_profile, action) => action(),
      bootstrapOwnedWorkspace: async () => { calls.push('bootstrap'); }, assertOwnedWorkspace: async () => true },
    './smoke-first-launch-ui.cjs': { sanitizeDiagnostic: String, main: async options => {
      calls.push('ui'); assert.equal(options.journeys, undefined); assert(options.sandboxRoot);
      assert.equal(options.performancePolicy.budgets_enforced, false);
      if (change.ui) throw new Error('renderer failed');
    } },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { platform: 'linux', arch: 'x64' }, console, Buffer });
  let error;
  try { await module.exports.main(['--output', output, '--installer', installer, '--extracted-root', root], env); }
  catch (caught) { error = caught; }
  const proof = JSON.parse(fs.readFileSync(output, 'utf8'));
  fs.rmSync(root, { recursive: true, force: true });
  if (proof.isolated_profile) fs.rmSync(path.dirname(proof.isolated_profile), { recursive: true, force: true });
  return { proof, error, calls };
}
test('hosted UI smoke verifies source/contract/bootstrap before actual UI without full journeys', async () => {
  const result = await run(); assert.equal(result.error, undefined); assert.equal(result.proof.success, true);
  assert.equal(result.proof.installed_cycle, false); assert.equal(result.proof.full_local_qualification, false);
  assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui']);
});
test('wrong packaged source refuses UI and retains a failing proof', async () => {
  const result = await run({ source: 'c'.repeat(40) }); assert.match(result.error.message, /source mismatch/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, []);
});
test('wrong embedded SDK refuses UI despite a valid native contract', async () => {
  const result = await run({ sdk: 'c'.repeat(40) }); assert.match(result.error.message, /SDK source mismatch/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract']);
});
test('contract failure remains blocking for hosted builds', async () => {
  const result = await run({ contract: true }); assert.match(result.error.message, /tampered contract/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract']);
});
test('actual UI assertion failure remains blocking under observational performance', async () => {
  const result = await run({ ui: true }); assert.match(result.error.message, /renderer failed/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui']);
});
