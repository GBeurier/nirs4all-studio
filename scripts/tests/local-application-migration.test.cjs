const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const finalize = require('../finalize-release-assets.cjs');
const source = fs.readFileSync(path.join(__dirname, '../qualify-local-application-migration.cjs'), 'utf8');
async function run(change = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-control-unit-'));
  const app = path.join(root, 'baseline-app'); fs.mkdirSync(app);
  const installer = path.join(root, 'baseline.deb'); fs.writeFileSync(installer, 'fixture baseline bytes');
  fs.writeFileSync(`${installer}.sha256`, `${finalize.sha256File(installer)}  baseline.deb\n`);
  const preferences = { theme: 'dark', density: 'compact', language: 'en', developer_mode: true };
  const config = { owned_root: root, baseline: { version: '0.15.0', app_root: app, installer,
    installer_sha256: finalize.sha256File(installer) } };
  const context = { config, work: root, proof: { timings: [], performance_policy: { mode: 'strict' }, packaged_version: { version: '0.15.1' } },
    report: { provenance: { source_artifacts: [] } } };
  const calls = []; let before; let candidateIdentities = 0;
  const baselineVerifications = [];
  const verifierRoot = path.join(root, 'qualification/baseline-0150-verifier');
  for (const relative of ['scripts/native-runtime-contract.cjs', 'scripts/bake-python-plugin-runtime.cjs',
    'scripts/studio-document-adapters.cjs', 'build/constraints/plugin-runtime-cpython311.txt']) {
    const target = path.join(verifierRoot, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../../qualification/baseline-0150-verifier', relative), target);
  }
  if (change.verifierTampered) {
    const target = path.join(verifierRoot, 'scripts/bake-python-plugin-runtime.cjs');
    const bytes = fs.readFileSync(target); bytes[0] ^= 1; fs.writeFileSync(target, bytes);
  }
  if (change.verifierMissing) fs.unlinkSync(path.join(verifierRoot, 'scripts/studio-document-adapters.cjs'));
  fs.mkdirSync(path.join(root, 'scripts'));
  const module = { exports: {} };
  const env = { NIRS4ALL_NATIVE_SIDECAR_PORT: '43123', NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: 'unit-only' };
  const mocks = {
    [path.join(verifierRoot, 'scripts/native-runtime-contract.cjs')]: { verifyRuntimeContract: options => {
      assert.equal(options.requireBundledPythonPlugin, true); assert.equal(options.requireBundledMethods, true);
      baselineVerifications.push(options); return { contract: { sdk: '1.4.0' } };
    } },
    './smoke-archive-standalone.cjs': { parseArgs: () => ({}), assertValidConfig: value => value,
      resolveLaunchLayout: () => ({}), verifyLaunchRuntimeContract: () => ({}) },
    './smoke-first-launch-ui.cjs': { sanitizeDiagnostic: String, main: async options => {
      calls.push({ ui: options });
      assert.equal(options.envOverrides, undefined, 'Real Windows profile mode must remain inaccessible');
      if (options.journeys) await options.journeys({ app: { evaluate: async () => change.baselineVersion || '0.15.0' }, env });
      if (options.inspectProfile) await options.inspectProfile({ env, page: { evaluate: async () => 'declined' } });
    } },
    './qualify-installer.cjs': {
      fixture: dir => { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'X.csv'), 'fixture data'); return dir; },
      seedBaseline: async (_app, _platform, _profile, _data, workspace, overrides) => {
        assert.equal(overrides, undefined); calls.push('seed'); fs.mkdirSync(workspace);
        if (change.lostWorkspace) fs.mkdirSync(path.join(root, 'different-workspace'));
        before = { workspace, dataset_id: 'dataset-preserved', preferences }; return before;
      },
    },
    './finalize-release-assets.cjs': finalize,
    './qualify-local-packaged.cjs': { prepare: () => context, identity: () => { candidateIdentities++; return { config: {} }; },
      contained: () => {}, plainAncestors: () => {}, inOwnedTemp: (_context, action) => action(),
      canonicalPath: value => { calls.push({ canonical: value });
        return change.activeAlias && value === change.activeAlias ? before.workspace : fs.realpathSync(value); },
      withOwnedProfile: (_profile, action) => action(),
      bootstrapOwnedWorkspace: async () => { calls.push('bootstrap'); }, assertOwnedWorkspace: async () => true,
      finish: (_context, error) => { context.proof.success = !error; calls.push(error ? 'failed' : 'finished'); },
    },
  };
  const fetch = async url => {
    const route = new URL(url).pathname;
    return { ok: true, json: async () => route === '/api/workspace' ? { workspace: { path: change.lostWorkspace
      ? path.join(root, 'different-workspace') : change.activeAlias || before.workspace } }
      : route === '/api/app/settings' ? { ui_preferences: { ...preferences, ...(change.preferences || {}) } }
      : { datasets: change.lostDataset ? [] : [{ id: before.dataset_id }] } };
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { platform: 'linux', arch: 'x64' }, __dirname: path.join(root, 'scripts'), fetch, console, AbortSignal });
  let error;
  try { await module.exports.main('/unit-config'); } catch (caught) { error = caught; }
  fs.rmSync(root, { recursive: true, force: true });
  return { context, calls, error, baselineVerifications, candidateIdentities };
}
test('migration bootstraps before baseline and uses the same isolated profile for candidate', async () => {
  const result = await run(); assert.equal(result.error, undefined);
  assert.equal(result.calls[0], 'bootstrap');
  const ui = result.calls.filter(call => call.ui).map(call => call.ui);
  assert.equal(ui.length, 2); assert.equal(ui[0].sandboxRoot, ui[1].sandboxRoot);
  assert.equal(ui[1].existingProfile, true); assert.equal(result.context.report.facts.installer_cycle, false);
  assert.equal(result.context.proof.success, true);
  assert.equal(result.candidateIdentities, 1, 'Current candidate identity remains checked');
  assert.equal(result.baselineVerifications.length, 1);
  assert.equal(result.context.proof.baseline_runtime_contract.verifier_source_sha, '376e1f5fde1c08b9ea0a43dc033dc5b74ce68de6');
});
test('a lost density preference fails the actual migration callback', async () => {
  const result = await run({ preferences: { density: 'comfortable' } });
  assert.match(result.error.message, /Lost preference density/); assert.equal(result.context.proof.success, false);
});
test('migration uses canonical workspace identity while retaining the observed namespace spelling', async () => {
  const alias = '\\\\?\\D:\\owned\\workspace';
  const result = await run({ activeAlias: alias }); assert.equal(result.error, undefined);
  const canonical = result.calls.filter(call => call.canonical);
  assert.equal(canonical.length, 2); assert.equal(canonical[0].canonical, alias);
  assert.equal(result.context.proof.after.workspace, alias);
  assert.equal(result.context.proof.success, true);
});
test('a genuinely changed active workspace still fails migration after canonicalization', async () => {
  const result = await run({ lostWorkspace: true }); assert.match(result.error.message, /lost active workspace/);
  assert.equal(result.context.proof.success, false);
});
test('a missing linked dataset blocks migration despite surviving preferences', async () => {
  const result = await run({ lostDataset: true }); assert.match(result.error.message, /lost registered dataset/);
  assert.equal(result.context.proof.success, false);
});
test('the actual baseline must be version 0.15.0 before fixture seeding', async () => {
  const result = await run({ baselineVersion: '0.14.9' }); assert.match(result.error.message, /baseline version mismatch/);
  assert.equal(result.calls.includes('seed'), false); assert.equal(result.context.proof.success, false);
});

test('changed frozen baseline verifier bytes refuse before bootstrap or seeding', async () => {
  const result = await run({ verifierTampered: true });
  assert.match(result.error.message, /Baseline verifier identity differs/);
  assert.equal(result.baselineVerifications.length, 0); assert.equal(result.calls.includes('bootstrap'), false);
  assert.equal(result.calls.includes('seed'), false); assert.equal(result.context.proof.success, false);
});
test('missing frozen baseline verifier input refuses before any application launch', async () => {
  const result = await run({ verifierMissing: true }); assert(result.error);
  assert.equal(result.baselineVerifications.length, 0); assert.equal(result.calls.some(call => call.ui), false);
  assert.equal(result.context.proof.success, false);
});
