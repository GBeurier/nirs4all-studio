/** Actual N-1 -> candidate application migration in one isolated local profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const archive = require('./smoke-archive-standalone.cjs');
const ui = require('./smoke-first-launch-ui.cjs');
const { fixture, seedBaseline } = require('./qualify-installer.cjs');
const { sha256File, parseChecksumSidecar } = require('./finalize-release-assets.cjs');
const { prepare, identity, contained, canonicalPath, plainAncestors, inOwnedTemp, finish,
  withOwnedProfile, bootstrapOwnedWorkspace, assertOwnedWorkspace } = require('./qualify-local-packaged.cjs');

// Verify N-1 with its own immutable public verifier; candidate identity stays current.
const BASELINE_SOURCE_SHA = '376e1f5fde1c08b9ea0a43dc033dc5b74ce68de6';
const BASELINE_VERIFIER_FILES = Object.freeze([
  {"path": "scripts/native-runtime-contract.cjs","bytes": 26136,"sha256": "17654a0315ba43eed0fc60bbd300a309c0f94385c18d66f7060f167120677fde"},
  {"path": "scripts/bake-python-plugin-runtime.cjs","bytes": 27362,"sha256": "671b39b43006e0669598b178ce85f7d3c1ef5505027f98b57f42df694edaaa10"},
  {"path": "scripts/studio-document-adapters.cjs","bytes": 5799,"sha256": "832e0c1c583edec2c2defe8962786e50b5b3699428bf5815a64b593fa215f0ce"},
  {"path": "build/constraints/plugin-runtime-cpython311.txt","bytes": 2400,"sha256": "2e4b1f1f61ceae48d370676de6f7aab36281cfb46953752d5e2a080bce794a60"},
]);
function verifyBaselineRuntimeContract(layout) {
  const verifierRoot = path.resolve(__dirname, '../qualification/baseline-0150-verifier');
  for (const row of BASELINE_VERIFIER_FILES) {
    const file = path.resolve(verifierRoot, row.path);
    contained(verifierRoot, file); plainAncestors(file);
    assert.equal(fs.statSync(file).size, row.bytes, `Baseline verifier bytes differ: ${row.path}`);
    assert.equal(sha256File(file), row.sha256, `Baseline verifier identity differs: ${row.path}`);
  }
  const verifier = require(path.join(verifierRoot, 'scripts/native-runtime-contract.cjs'));
  const verified = verifier.verifyRuntimeContract({ backendRoot: layout.backendRoot,
    artifactBoundaryRoot: layout.appRoot, platform: process.platform, arch: process.arch,
    requireBundledPythonPlugin: true, requireBundledMethods: true });
  return { ...verified, verifier_source_sha: BASELINE_SOURCE_SHA,
    verifier_files: BASELINE_VERIFIER_FILES };
}

async function api(env, route) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    headers: { 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN }, signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Migration ${route}: HTTP ${response.status}`);
  return response.json();
}
async function main(configPath) {
  const context = prepare(configPath, 'application-migration');
  let error;
  try {
    await inOwnedTemp(context, async () => {
      const candidate = identity(context);
      const { config, work, proof } = context;
      assert.equal(config.baseline.version, '0.15.0');
      for (const name of ['app_root', 'installer']) {
        plainAncestors(config.baseline[name]); contained(config.owned_root, config.baseline[name]);
      }
      assert.equal(sha256File(config.baseline.installer), config.baseline.installer_sha256);
      assert.equal(parseChecksumSidecar(`${config.baseline.installer}.sha256`, path.basename(config.baseline.installer)), config.baseline.installer_sha256);
      const baselineConfig = archive.assertValidConfig(archive.parseArgs(['--extracted-root', config.baseline.app_root,
        '--platform', process.platform, '--timeout-ms', '180000', '--keep-sandbox']));
      const baselineLayout = archive.resolveLaunchLayout(config.baseline.app_root, process.platform, baselineConfig.appName);
      proof.baseline_runtime_contract = verifyBaselineRuntimeContract(baselineLayout);
      const profile = path.join(work, 'shared-migration-profile'); fs.mkdirSync(profile);
      const data = fixture(path.join(work, 'preserved-data')), workspace = path.join(work, 'Workspace conservé');
      await withOwnedProfile(profile, async () => {
        await bootstrapOwnedWorkspace(baselineLayout, profile, work);
        await ui.main({ config: baselineConfig, sandboxRoot: profile, consent: 'decline', performancePolicy: proof.performance_policy,
          journeys: async ({ app, env }) => {
            await assertOwnedWorkspace(env, work);
            const actualVersion = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
            assert.equal(actualVersion, config.baseline.version, 'Actual baseline version mismatch');
            proof.baseline_version = actualVersion;
          } });
        // No envOverrides: both baseline and candidate always use explicit --user-data-dir.
        const before = await seedBaseline(config.baseline.app_root, process.platform, profile, data, workspace);
        const sourceFiles = Object.fromEntries(fs.readdirSync(data).map(name => [name, sha256File(path.join(data, name))]));
        proof.before = before;
        await ui.main({ config: candidate.config, sandboxRoot: profile, existingProfile: true,
          timings: proof.timings, performancePolicy: proof.performance_policy,
          inspectProfile: async ({ page, env }) => {
            await assertOwnedWorkspace(env, work);
            const active = (await api(env, '/workspace')).workspace.path;
          assert.equal(canonicalPath(active), canonicalPath(before.workspace), 'Application upgrade lost active workspace');
            const prefs = (await api(env, '/app/settings')).ui_preferences;
            for (const [key, value] of Object.entries(before.preferences)) assert.deepEqual(prefs[key], value, `Lost preference ${key}`);
            const datasets = (await api(env, '/datasets')).datasets;
            assert(datasets.some(dataset => dataset.id === before.dataset_id), 'Application upgrade lost registered dataset');
            assert.equal(await page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'declined');
            proof.after = { dataset_id: before.dataset_id, workspace: active, preferences: prefs };
          } });
        assert.deepEqual(Object.fromEntries(fs.readdirSync(data).map(name => [name, sha256File(path.join(data, name))])), sourceFiles,
          'Application migration changed scientific dataset bytes');
        proof.application_migration = true; proof.isolated_profile = true;
        proof.baseline_installer_sha256 = config.baseline.installer_sha256;
        context.report.provenance.source_artifacts.push({ name: path.basename(config.baseline.installer), version: proof.baseline_version,
          origin: config.baseline.installer, sha256: config.baseline.installer_sha256,
          bytes: fs.statSync(config.baseline.installer).size, artifact_path: config.baseline.installer });
        context.report.facts = { application_migration: true, isolated_profile: true, installer_cycle: false,
          baseline_version: proof.baseline_version, candidate_version: proof.packaged_version.version,
          preserved_dataset: true, preserved_workspace: true, preserved_preferences: true, preserved_dataset_bytes: true };
      });
    });
  } catch (caught) { error = caught; }
  finally { finish(context, error); }
  if (error) throw error;
  return context.report;
}
if (require.main === module) {
  assert(process.argv.length === 4 && process.argv[2] === '--config', 'Usage: qualify-local-application-migration.cjs --config PATH');
  main(process.argv[3]).then(() => console.log('LOCAL_APPLICATION_MIGRATION_OK')).catch(error => { console.error(ui.sanitizeDiagnostic(error.message)); process.exitCode = 1; });
}
module.exports = { main, verifyBaselineRuntimeContract };
