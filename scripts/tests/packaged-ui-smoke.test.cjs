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
  const backendRoot = path.join(root, 'backend'), wheel = path.join(backendRoot, 'wheels/nirs4all-1.4.13-py3-none-any.whl');
  fs.mkdirSync(path.dirname(wheel), { recursive: true });
  fs.writeFileSync(wheel, 'fingerprinted public SDK wheel');
  const cohort = { sdk: { version: '1.4.13', wheel_sha256: finalize.sha256File(wheel) } };
  if (change.sdk) fs.writeFileSync(wheel, 'another SDK wheel');
  // A macOS application embeds no wheels: Studio installs them from the package index.
  const platform = change.macos ? 'darwin' : 'linux';
  if (change.macos && !change.embedded) fs.rmSync(path.dirname(wheel), { recursive: true });
  const calls = [], module = { exports: {} };
  const env = { RELEASE_SOURCE_SHA: 'a'.repeat(40), RELEASE_VERSION: '0.15.1', NIRS4ALL_LIBRARY_REF: 'b'.repeat(40),
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'github-observational' };
  const mocks = {
    '@electron/asar': { extractFile: () => Buffer.from(JSON.stringify({ version: '0.15.1', commit: change.source || env.RELEASE_SOURCE_SHA })) },
    './smoke-archive-standalone.cjs': { parseArgs: () => ({ platform, extractedRoot: root }), assertValidConfig: value => value,
      resolveLaunchLayout: () => ({ backendRoot }),
      verifyLaunchRuntimeContract: () => { calls.push('contract'); if (change.contract) throw new Error('tampered contract'); return {}; } },
    './qualification-performance.cjs': { resolvePerformancePolicy }, './finalize-release-assets.cjs': finalize,
    './verify-runtime-cohort.cjs': { verifyRuntimeCohort: () => cohort },
    './smoke-owned-profile.cjs': { withOwnedProfile: (_profile, action) => action(),
      bootstrapOwnedWorkspace: async () => { calls.push('bootstrap'); }, assertOwnedWorkspace: async () => true },
    './smoke-shap-journey.cjs': { shapJourney: async () => {
      calls.push('shap'); if (change.shap) throw new Error('SHAP regression failed');
    } },
    './smoke-first-launch-ui.cjs': { sanitizeDiagnostic: String, main: async options => {
      calls.push('ui'); assert.equal(typeof options.journeys, 'function'); assert(options.sandboxRoot);
      assert.equal(options.extraPackages.join(), 'shap,matplotlib');
      assert.equal(options.performancePolicy.budgets_enforced, false);
      if (change.ui) throw new Error('renderer failed');
      await options.journeys({ env: {} });
    } },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { platform, arch: 'x64' }, console, Buffer });
  let error;
  try { await module.exports.main(['--output', output, '--installer', installer, '--extracted-root', root], env); }
  catch (caught) { error = caught; }
  const proof = JSON.parse(fs.readFileSync(output, 'utf8'));
  fs.rmSync(root, { recursive: true, force: true });
  if (proof.isolated_profile) fs.rmSync(path.dirname(proof.isolated_profile), { recursive: true, force: true });
  return { proof, error, calls };
}
test('hosted UI smoke verifies source/contract/bootstrap and the real SHAP regression', async () => {
  const result = await run(); assert.equal(result.error, undefined); assert.equal(result.proof.success, true);
  assert.equal(result.proof.installed_cycle, false); assert.equal(result.proof.full_local_qualification, false);
  assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui', 'shap']);
  assert.equal(result.proof.shipped_sdk.version, '1.4.13');
  assert.match(result.proof.shipped_sdk.wheel_sha256, /^[0-9a-f]{64}$/);
});
test('wrong packaged source refuses UI and retains a failing proof', async () => {
  const result = await run({ source: 'c'.repeat(40) }); assert.match(result.error.message, /source mismatch/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, []);
});
test('wrong embedded SDK refuses UI despite a valid native contract', async () => {
  const result = await run({ sdk: true }); assert.match(result.error.message, /Embedded SDK wheel mismatch/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract']);
});
test('a macOS application embeds no wheels and is qualified on packages from the package index', async () => {
  const result = await run({ macos: true }); assert.equal(result.error, undefined);
  assert.deepEqual(result.proof.shipped_sdk, { source: 'package-index', version: '1.4.13' });
  assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui', 'shap']);
  const embedded = await run({ macos: true, embedded: true });
  assert.match(embedded.error.message, /must not embed wheels/); assert.deepEqual(embedded.calls, ['contract']);
});
test('contract failure remains blocking for hosted builds', async () => {
  const result = await run({ contract: true }); assert.match(result.error.message, /tampered contract/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract']);
});
test('actual UI assertion failure remains blocking under observational performance', async () => {
  const result = await run({ ui: true }); assert.match(result.error.message, /renderer failed/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui']);
});
test('a SHAP regression blocks publication and retains the failing proof', async () => {
  const result = await run({ shap: true }); assert.match(result.error.message, /SHAP regression failed/);
  assert.equal(result.proof.success, false); assert.deepEqual(result.calls, ['contract', 'bootstrap', 'ui', 'shap']);
});
