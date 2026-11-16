/**
 * Hosted smoke: exact packaged contract, an environment created by the
 * application from its setup page, renderer, readiness, then a real training
 * run and its SHAP analysis.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const archive = require('./smoke-archive-standalone.cjs');
const ui = require('./smoke-first-launch-ui.cjs');
const { resolvePerformancePolicy } = require('./qualification-performance.cjs');
const { sha256File, parseChecksumSidecar } = require('./finalize-release-assets.cjs');
const { verifyRuntimeCohort } = require('./verify-runtime-cohort.cjs');
const { withOwnedProfile, bootstrapOwnedWorkspace, assertOwnedWorkspace } = require('./qualify-local-packaged.cjs');
const { shapJourney } = require('./smoke-shap-journey.cjs');

// The journey explains a model and renders its figures: neither package is installed by default.
const JOURNEY_PACKAGES = ['shap', 'matplotlib'];

/** The SDK wheel an installer embeds must be the fingerprinted public one; macOS names its wheels instead. */
function shippedSdk(backendRoot, cohort) {
  const wheelhouse = path.join(backendRoot, 'wheels');
  if (!fs.existsSync(wheelhouse)) return { wheelhouse: JSON.parse(fs.readFileSync(path.join(backendRoot, 'wheelhouse.json'), 'utf8')) };
  const wheel = path.join(wheelhouse, `nirs4all-${cohort.sdk.version}-py3-none-any.whl`);
  assert.equal(sha256File(wheel), cohort.sdk.wheel_sha256, 'Embedded SDK wheel mismatch');
  return { version: cohort.sdk.version, wheel_sha256: cohort.sdk.wheel_sha256 };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const index = argv.indexOf('--output');
  assert(index >= 0 && argv[index + 1], 'A build-smoke proof output is required');
  const output = path.resolve(argv[index + 1]);
  const rest = [...argv.slice(0, index), ...argv.slice(index + 2)];
  const installerIndex = rest.indexOf('--installer');
  assert(installerIndex >= 0 && rest[installerIndex + 1], 'The produced installer is required');
  const installer = path.resolve(rest[installerIndex + 1]);
  const args = [...rest.slice(0, installerIndex), ...rest.slice(installerIndex + 2)];
  const config = archive.assertValidConfig(archive.parseArgs(args));
  const proof = { schema: 'nirs4all.studio.packaged-ui-smoke.v1', success: false,
    scope: 'unpacked-build-application-created-environment-renderer-readiness-training-shap', full_local_qualification: false,
    installed_cycle: false,
    platform: config.platform, arch: process.arch, source_sha: env.RELEASE_SOURCE_SHA,
    performance_policy: resolvePerformancePolicy(env), timings: [] };
  try {
    assert(/^[0-9a-f]{40}$/.test(proof.source_sha), 'An immutable build source SHA is required');
    assert(/^[0-9a-f]{40}$/.test(env.NIRS4ALL_LIBRARY_REF), 'An immutable embedded SDK SHA is required');
    assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(env.RELEASE_VERSION), 'A release version is required');
    assert.equal(config.platform, process.platform, 'UI must run on the actual build OS');
    assert(!fs.lstatSync(installer).isSymbolicLink() && fs.statSync(installer).isFile()
      && fs.statSync(installer).size > 0, 'Produced installer must be a nonempty regular file');
    proof.installer = { name: path.basename(installer), bytes: fs.statSync(installer).size,
      sha256: sha256File(installer) };
    assert.equal(parseChecksumSidecar(`${installer}.sha256`, path.basename(installer)), proof.installer.sha256,
      'Produced installer checksum mismatch');
    const layout = archive.resolveLaunchLayout(config.extractedRoot, config.platform, config.appName);
    const appArchive = path.join(path.dirname(layout.backendRoot), 'app.asar');
    proof.packaged_version = JSON.parse(asar.extractFile(appArchive, 'version.json').toString('utf8'));
    assert.equal(proof.packaged_version.commit, proof.source_sha, 'Packaged application source mismatch');
    assert.equal(proof.packaged_version.version, env.RELEASE_VERSION, 'Packaged application version mismatch');
    proof.runtime_contract = archive.verifyLaunchRuntimeContract(layout, config.platform);
    proof.shipped_sdk = shippedSdk(layout.backendRoot, verifyRuntimeCohort(env));
    // A small real training run and its SHAP regression qualify the created environment and the renderer.
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-packaged-ui-'));
    const profile = path.join(sandbox, 'profile'); fs.mkdirSync(profile);
    proof.isolated_profile = profile;
    await withOwnedProfile(profile, async () => {
      await bootstrapOwnedWorkspace(layout, profile, sandbox);
      await ui.main({ config, sandboxRoot: profile, consent: 'decline', extraPackages: JOURNEY_PACKAGES, timings: proof.timings,
        performancePolicy: proof.performance_policy,
        inspectProfile: async ({ env: actualEnv }) => assertOwnedWorkspace(actualEnv, sandbox),
        journeys: async context => shapJourney(context, proof, await assertOwnedWorkspace(context.env, sandbox)) });
    });
    proof.success = true;
    return proof;
  } catch (error) {
    proof.error = ui.sanitizeDiagnostic(error.stack || error);
    throw error;
  } finally {
    fs.writeFileSync(output, JSON.stringify(proof, null, 2));
  }
}

if (require.main === module) main().then(proof => {
  console.log(JSON.stringify({ success: proof.success, source_sha: proof.source_sha, scope: proof.scope }));
}).catch(error => { console.error(ui.sanitizeDiagnostic(error.message)); process.exitCode = 1; });
module.exports = { main };
