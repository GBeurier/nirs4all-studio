/** Strict local scientific qualification of an extracted, isolated application. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const asar = require('@electron/asar');
const archive = require('./smoke-archive-standalone.cjs');
const ui = require('./smoke-first-launch-ui.cjs');
const { businessJourney } = require('./qualify-scientific-journey.cjs');
const { fixture } = require('./qualify-installer.cjs');
const { sha256File, parseChecksumSidecar } = require('./finalize-release-assets.cjs');
const { resolvePerformancePolicy, timed } = require('./qualification-performance.cjs');
const { verifyInstalledCohort } = require('./verify-runtime-cohort.cjs');

const root = path.resolve(__dirname, '..');
function checkedCvScores(scores) {
  assert(Array.isArray(scores) && scores.length > 0, 'Observed CV scores must be a nonempty array');
  for (const score of scores) {
    assert(Number.isFinite(score), 'Every observed CV score must be a finite number');
  }
  return scores;
}
function ordinaryPath(file) {
  if (process.platform !== 'win32') return file;
  assert(!file.startsWith('\\\\.\\'), 'Device paths are not local qualification paths');
  if (!file.startsWith('\\\\?\\')) return file;
  const dos = /^\\\\\?\\([A-Za-z]:\\.*)$/.exec(file);
  if (dos) return dos[1];
  const unc = /^\\\\\?\\UNC\\([^\\]+)\\([^\\]+)(\\.*)?$/i.exec(file);
  assert(unc, 'Unsupported Windows namespace in local qualification path');
  return `\\\\${unc[1]}\\${unc[2]}${unc[3] || '\\'}`;
}
function filesystemPath(file) {
  const ordinary = ordinaryPath(file);
  if (ordinary === file) return file;
  const resolved = path.resolve(ordinary);
  // Node cannot lstat an extended drive root. Keep extended member paths,
  // including long paths, but use the ordinary spelling for a root itself.
  return path.dirname(resolved) === resolved ? resolved : path.toNamespacedPath(resolved);
}
function canonicalPath(file) {
  // The JS realpath implementation itself walks extended drive roots and
  // fails on Windows. The native OS call resolves junctions and long paths.
  return ordinaryPath(process.platform === 'win32'
    ? fs.realpathSync.native(filesystemPath(file)) : fs.realpathSync(file));
}
function contained(parent, file) {
  const relative = path.relative(canonicalPath(parent), canonicalPath(file));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path escapes owned root: ${file}`);
}
function plainAncestors(file) {
  const ordinary = ordinaryPath(file), namespaced = ordinary !== file;
  let current = path.resolve(ordinary);
  while (true) {
    const parent = path.dirname(current);
    const member = namespaced && parent !== current ? path.toNamespacedPath(current) : current;
    assert(!fs.lstatSync(member).isSymbolicLink(), `Link in local qualification path: ${current}`);
    if (parent === current) break; current = parent;
  }
}
function evidence(config, field) {
  const value = config[field];
  assert(value && typeof value.path === 'string' && value.path.startsWith('qualification/'));
  const file = path.resolve(root, value.path); contained(root, file); plainAncestors(file);
  assert.equal(fs.statSync(file).size, value.bytes);
  assert.equal(sha256File(file), value.sha256, `Changed ${field}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function prepare(configPath, gate) {
  assert(['linux', 'win32'].includes(process.platform), 'Local Linux or Windows is required');
  assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'Full journeys run locally');
  assert.notEqual(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert(!process.env.NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY || process.env.NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY === 'strict',
    'Local qualification requires strict performance');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(config.platform, process.platform);
  assert.equal(config.installer_cycle, false, 'Local qualification never executes an installer');
  assert(/^[0-9a-f]{40}$/.test(config.source_sha), 'Exact binary source is required');
  plainAncestors(config.owned_root);
  const marker = path.join(config.owned_root, 'CODEx_TASK_OWNERSHIP.json');
  plainAncestors(marker); assert.equal(sha256File(marker), config.ownership_marker_sha256);
  for (const name of ['run_root', 'app_root', 'installer']) {
    plainAncestors(config[name]); contained(config.owned_root, config[name]);
  }
  contained(config.run_root, config.app_root);
  const inputCapture = evidence(config, 'input_evidence');
  assert.equal(inputCapture.mode, 'captured', 'Inputs must be captured before local execution');
  assert(inputCapture.input_fingerprints && Object.keys(inputCapture.input_fingerprints).length > 1);
  for (const [relative, digest] of Object.entries(inputCapture.input_fingerprints)) {
    const file = path.resolve(root, relative); contained(root, file); plainAncestors(file);
    assert.equal(sha256File(file), digest, `Source changed before execution: ${relative}`);
  }
  const work = fs.mkdtempSync(path.join(config.run_root, `${gate}-`));
  assert(typeof config.output === 'string' && config.output.startsWith('qualification/'));
  const output = path.resolve(root, config.output); contained(root, path.dirname(output)); plainAncestors(path.dirname(output));
  assert(!fs.existsSync(output), 'Local reports are immutable; choose a new output');
  const report = { schema: 'nirs4all.local-qualification.v1', kind: 'nirs4all.studio.local-producer-raw.v1',
    source_sha: config.source_sha, id: `${process.platform === 'win32' ? 'windows' : 'linux'}-${gate}`,
    host: config.host, command: [process.execPath, ...process.argv.slice(1)], cwd: process.cwd(),
    environment: { GITHUB_ACTIONS: process.env.GITHUB_ACTIONS || '', RUNNER_ENVIRONMENT: process.env.RUNNER_ENVIRONMENT || '',
      NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: process.env.NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY || 'strict' },
    started_at: new Date().toISOString(), input_fingerprints: inputCapture.input_fingerprints,
    input_evidence: config.input_evidence, exit_code: 1, summary: { passed: 0, failed: 1, skipped: 0 }, skips: [], facts: {},
    proof: { success: false, source_sha: config.source_sha, diagnostic_only: false, installer_cycle: false,
      platform: process.platform, arch: process.arch, timings: [], performance_policy: resolvePerformancePolicy({ NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'strict' }),
      hardware: { cpu_model: os.cpus()[0].model, logical_cpus: os.cpus().length, ram_bytes: os.totalmem(),
        os_release: os.release(), node: process.version }, owned_work_root: work } };
  const cohort = JSON.parse(fs.readFileSync(path.join(root, 'build/runtime-cohort.json'), 'utf8'));
  return { config, work, report, proof: report.proof, cohort };
}
function identity(context, appRoot = context.config.app_root, source = context.config.source_sha) {
  const config = archive.assertValidConfig(archive.parseArgs(['--extracted-root', appRoot, '--platform', process.platform,
    '--timeout-ms', '120000', '--keep-sandbox']));
  const layout = archive.resolveLaunchLayout(appRoot, process.platform, config.appName);
  const version = JSON.parse(asar.extractFile(path.join(path.dirname(layout.backendRoot), 'app.asar'), 'version.json').toString('utf8'));
  assert.equal(version.commit, source, 'Actual packaged source mismatch');
  assert.equal(version.version, require('../package.json').version, 'Actual packaged version mismatch');
  const contract = archive.verifyLaunchRuntimeContract(layout, process.platform);
  context.proof.installed_distributions = verifyInstalledCohort(contract, context.cohort);
  const marker = JSON.parse(fs.readFileSync(layout.runtimeReadyPath, 'utf8'));
  assert.equal(marker.source_commit, context.cohort.sdk.source_sha, 'Actual SDK source mismatch');
  assert.equal(marker.distribution_version, context.cohort.sdk.version, 'Actual SDK version mismatch');
  assert.equal(marker.wheel_sha256, context.cohort.sdk.wheel_sha256, 'Actual SDK wheel mismatch');
  context.proof.runtime_contract = contract; context.proof.packaged_version = version;
  context.proof.binary_source_sha = version.commit;
  context.proof.embedded_sdk = marker;
  assert.equal(sha256File(context.config.installer), context.config.installer_sha256);
  assert.equal(parseChecksumSidecar(`${context.config.installer}.sha256`, path.basename(context.config.installer)), context.config.installer_sha256);
  const wheel = context.config.sdk_wheel_path;
  assert(wheel, 'Retained exact SDK wheel is required for portable provenance');
  plainAncestors(wheel); contained(context.config.owned_root, wheel);
  assert.equal(sha256File(wheel), context.cohort.sdk.wheel_sha256, 'Actual SDK wheel bytes differ from the embedded cohort');
  context.report.provenance = {
    tools: { node: process.version, platform: process.platform, arch: process.arch },
    source_artifacts: [{ name: path.basename(context.config.installer), version: version.version,
      origin: context.config.installer, sha256: context.config.installer_sha256,
      bytes: fs.statSync(context.config.installer).size, artifact_path: context.config.installer }],
    dependency_origins: [{ name: 'nirs4all', version: marker.distribution_version,
      origin: `SDK wheel ${marker.source_commit}`, sha256: marker.wheel_sha256,
      bytes: fs.statSync(wheel).size, artifact_path: wheel },
    { name: 'CPython runtime closure', version: '3.11', origin: contract.pythonClosurePath,
      sha256: sha256File(contract.pythonClosurePath), bytes: fs.statSync(contract.pythonClosurePath).size,
      artifact_path: contract.pythonClosurePath }],
  };
  return { config, layout };
}
async function inOwnedTemp(context, action) {
  const keys = ['TEMP', 'TMP', 'TMPDIR']; const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const temp = path.join(context.work, 'temp'); fs.mkdirSync(temp);
  for (const key of keys) process.env[key] = temp;
  try { return await action(); }
  finally { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } }
}
async function withOwnedProfile(profile, action) {
  const values = { NIRS4ALL_CONFIG: path.join(profile, 'config'), NIRS4ALL_BACKEND_DATA_DIR: path.join(profile, 'backend-data'),
    NIRS4ALL_BACKEND_LOG_DIR: path.join(profile, 'backend-logs'),
    PORTABLE_EXECUTABLE_FILE: undefined, NIRS4ALL_PORTABLE_ROOT: undefined };
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  plainAncestors(profile);
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) { delete process.env[key]; continue; }
      if (fs.existsSync(value)) plainAncestors(value);
      fs.mkdirSync(value, { recursive: true }); process.env[key] = value;
    }
    return await action();
  }
  finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
async function localApi(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000) });
  assert(response.ok, `Owned workspace ${route}: HTTP ${response.status}`);
  return response.json();
}
async function assertOwnedWorkspace(env, ownedRoot) {
  const active = (await localApi(env, '/workspace')).workspace?.path;
  assert(active, 'No actual active workspace'); plainAncestors(active); contained(ownedRoot, active);
  return active;
}
async function bootstrapOwnedWorkspace(layout, profile, ownedRoot) {
  // Electron's default Documents path is an OS known folder. Bootstrap the
  // real catalogue before Electron starts, so it never creates a real-user workspace.
  contained(ownedRoot, profile); plainAncestors(profile);
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const env = archive.buildSandboxEnv(process.platform, profile, port, 120000);
  for (const key of ['NIRS4ALL_CONFIG', 'NIRS4ALL_BACKEND_DATA_DIR', 'NIRS4ALL_BACKEND_LOG_DIR']) {
    assert(env[key], `Missing owned ${key}`); plainAncestors(env[key]); contained(profile, env[key]);
  }
  env.NIRS4ALL_STUDIO_SESSION_TOKEN = env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  delete env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  const requestEnv = { ...env, NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: env.NIRS4ALL_STUDIO_SESSION_TOKEN };
  const logPath = path.join(profile, 'workspace-bootstrap.log'), log = fs.openSync(logPath, 'wx');
  try {
    const child = spawn(layout.nativeSidecarPath, ['--host', '127.0.0.1', '--port', String(port)], {
      cwd: layout.appRoot, env, stdio: ['ignore', log, log], windowsHide: true });
    let exit, processError;
    const terminal = new Promise(resolve => child.once('close', (code, signal) => { exit = { code, signal }; resolve(); }));
    child.once('error', error => { processError = error; });
    try {
      const deadline = Date.now() + 120000; let ready = false;
      while (Date.now() < deadline) {
        if (processError) throw processError;
        assert(!exit, 'Workspace bootstrap sidecar exited before readiness');
        try { await localApi(requestEnv, '/health'); ready = true; break; } catch { /* bounded startup poll */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(ready, 'Workspace bootstrap sidecar did not become ready');
      const workspace = path.join(profile, 'startup-workspace');
      await localApi(requestEnv, '/workspace/create', 'POST', { path: workspace, name: 'Isolated local qualification', create_dir: true });
      await localApi(requestEnv, '/workspace/select', 'POST', { path: workspace });
      await assertOwnedWorkspace(requestEnv, ownedRoot);
    } finally {
      if (!exit) child.kill('SIGTERM');
      let timer;
      const stopped = await Promise.race([terminal.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
      clearTimeout(timer);
      if (!stopped) {
        child.kill('SIGKILL');
        const killed = await Promise.race([terminal.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
        clearTimeout(timer); assert(killed, 'Owned bootstrap sidecar could not be stopped; do not continue');
      }
    }
  } finally { fs.closeSync(log); }
}
function finish(context, error) {
  const { report, proof, config } = context;
  if (error) proof.error = ui.sanitizeDiagnostic(error.stack || error);
  report.finished_at = new Date().toISOString(); report.exit_code = error ? 1 : 0;
  report.summary = { passed: error ? 0 : 1, failed: error ? 1 : 0, skipped: 0 };
  proof.success = !error;
  const output = path.resolve(root, config.output);
  assert(config.output.startsWith('qualification/')); contained(root, path.dirname(output)); plainAncestors(path.dirname(output));
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
}
async function main(configPath) {
  const context = prepare(configPath, 'packaged-journeys');
  let error;
  try {
    await inOwnedTemp(context, async () => {
      const { config, layout } = identity(context);
      const { proof, work } = context;
      plainAncestors(context.config.provider_script);
      assert.equal(sha256File(context.config.provider_script), context.config.provider_sha256, 'Provider oracle changed');
      assert.equal(context.config.provider_sha256, context.cohort.sdk.qualification_oracle_sha256, 'Provider bytes differ from the fingerprinted SDK oracle');
      assert.equal(context.config.provider_source_sha, context.cohort.sdk.source_sha, 'Provider must come from the exact embedded SDK');
      const profile = path.join(work, 'science-profile'); fs.mkdirSync(profile);
      const data = fixture(path.join(work, 'science-data'));
      await withOwnedProfile(profile, async () => {
        await bootstrapOwnedWorkspace(layout, profile, work);
        await ui.main({ config, sandboxRoot: profile, consent: 'decline', timings: proof.timings,
          inspectProfile: async ({ env }) => assertOwnedWorkspace(env, work),
          performancePolicy: proof.performance_policy, journeys: async renderer => {
            proof.active_workspace = await assertOwnedWorkspace(renderer.env, work);
            proof.electron = await renderer.app.evaluate(() => ({ versions: process.versions, arch: process.arch }));
            return businessJourney({ ...renderer, proof, profile }, data);
          } });
      });
      const python = layout.bundledPythonCandidates.find(file => fs.existsSync(file)) || layout.bundledPythonPath;
      const providerProfile = path.join(work, 'provider-profile'); fs.mkdirSync(providerProfile);
      await withOwnedProfile(providerProfile, async () => {
        const env = { ...archive.buildSandboxEnv(process.platform, providerProfile, 0, 120000),
          N4A_SMOKE_ROOT: path.join(work, 'provider-smoke'), N4A_FULL_HPO_MATRIX: '1' };
        await timed(proof, 'multimodal_installed_provider', 360000, async () => {
          const stdoutPath = path.join(work, 'provider.stdout.log'), stderrPath = path.join(work, 'provider.stderr.log');
          const stdout = fs.openSync(stdoutPath, 'wx'), stderr = fs.openSync(stderrPath, 'wx');
          try { await new Promise((resolve, reject) => {
            const child = spawn(python, ['-I', '-B', context.config.provider_script], { cwd: work, env,
              stdio: ['ignore', stdout, stderr], timeout: 360000 });
            child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Provider exited ${code ?? signal}`)));
          }); } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
          assert.match(fs.readFileSync(stdoutPath, 'utf8'), /INSTALLED_GENERATED_HPO_MATRIX_OK 45\b/);
          console.log('INSTALLED_GENERATED_HPO_MATRIX_OK 45');
        });
      });
      const multimodalProfile = path.join(work, 'multimodal-profile'); fs.mkdirSync(multimodalProfile);
      await withOwnedProfile(multimodalProfile, async () => {
        await bootstrapOwnedWorkspace(layout, multimodalProfile, work);
        await timed(proof, 'multimodal_installed_ui', 360000, () =>
          require('./smoke-multimodal-ui.cjs').main({ ...config, sandboxRoot: multimodalProfile }, proof,
            async ({ env }) => assertOwnedWorkspace(env, work)));
      });
      proof.multimodal = { provider_hpo_combinations: 45, installed_ui_replay_without_fit: true };
      const cvScores = checkedCvScores(proof.predictions.cv_val_scores);
      context.report.facts = { strict_budgets: proof.performance_policy.budgets_enforced, diagnostic_only: false,
        samples: proof.dataset.samples, features: proof.dataset.features, training_status: proof.training.status,
        requested_engine: proof.training.requested_engine, fallback: proof.training.fallback,
        historical_steps: proof.historical_pipeline.steps, predictions_total: proof.predictions.total,
        validation_samples: proof.predictions.validation_samples,
        finite_cv_scores: cvScores.length,
        cv_scores: cvScores,
        hpo_combinations: 45, replay_without_fit: true, sdk_version: context.cohort.sdk.version,
        sdk_source_sha: context.cohort.sdk.source_sha, dag_version: proof.installed_distributions['dag-ml'],
        core_version: proof.installed_distributions['nirs4all-core'] };
    });
  } catch (caught) { error = caught; }
  finally { finish(context, error); }
  if (error) throw error;
  return context.report;
}
if (require.main === module) {
  assert(process.argv.length === 4 && process.argv[2] === '--config', 'Usage: qualify-local-packaged.cjs --config PATH');
  main(process.argv[3]).then(() => console.log('LOCAL_PACKAGED_JOURNEYS_OK')).catch(error => { console.error(ui.sanitizeDiagnostic(error.message)); process.exitCode = 1; });
}
module.exports = { main, prepare, identity, contained, canonicalPath, plainAncestors, inOwnedTemp, finish,
  withOwnedProfile, bootstrapOwnedWorkspace, assertOwnedWorkspace, checkedCvScores };
