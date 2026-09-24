/** Actual installer -> real Electron UI -> populated N-1 upgrade on the same profile. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const archive = require('./smoke-archive-standalone.cjs');
const ui = require('./smoke-first-launch-ui.cjs');
const { sha256File, parseChecksumSidecar } = require('./finalize-release-assets.cjs');

// Product budgets, deliberately separate from GitHub's infrastructure timeout.
const BUDGETS = Object.freeze({ install: 120000, baselineSetup: 300000, baselineLaunch: 180000, launch: 30000, preview: 5000, link: 5000, navigation: 3000 });

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert(['--installer', '--platform', '--previous-version', '--output'].includes(argv[i]), `Unknown option ${argv[i]}`);
    assert(argv[i + 1], `Missing value for ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
  }
  assert(options.installer && options.output, 'An installer and proof output are required');
  options.platform ||= process.platform;
  assert.equal(options.platform, process.platform, 'Installers must run on their actual target OS');
  assert(['linux', 'win32', 'darwin'].includes(options.platform));
  options.installer = path.resolve(options.installer);
  options.output = path.resolve(options.output);
  return options;
}

async function timed(proof, phase, budget, callback) {
  const start = performance.now();
  const value = await callback();
  const duration_ms = performance.now() - start;
  proof.timings.push({ phase, duration_ms, budget_ms: budget });
  assert(duration_ms <= budget, `${phase} took ${Math.round(duration_ms)}ms; budget ${budget}ms`);
  return value;
}

async function install(file, platform, root) {
  const command = (program, args) => streamedCommand(program, args, path.dirname(root));
  if (platform === 'win32') {
    // /D is deliberately last; execFile passes the path with spaces as one argument.
    await command(file, ['/S', '/allusers', `/D=${root}`]);
    assert(fs.existsSync(path.join(root, 'nirs4all Studio.exe')), 'NSIS did not install the application');
    return root;
  }
  if (platform === 'linux') {
    await command('sudo', ['apt-get', 'install', '-y', '--allow-downgrades', file]);
    const { stdout } = await command('dpkg-deb', ['-f', file, 'Package']);
    const listing = await command('dpkg', ['-L', stdout.trim()]);
    const sandbox = listing.stdout.split('\n').find(line => line.endsWith('/chrome-sandbox'));
    assert(sandbox && fs.existsSync(sandbox), 'Installed DEB has no Chromium sandbox');
    return path.dirname(sandbox);
  }
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dmg-'));
  try {
    await command('hdiutil', ['attach', file, '-nobrowse', '-readonly', '-mountpoint', mount]);
    const apps = fs.readdirSync(mount).filter(name => name.endsWith('.app'));
    assert.equal(apps.length, 1, 'DMG must contain exactly one application');
    const target = path.join(root, apps[0]);
    // Remove only this runner-owned test app, to avoid merging stale application files.
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    await command('ditto', [path.join(mount, apps[0]), target]);
    return target;
  } finally {
    await command('hdiutil', ['detach', mount]).catch(() => {});
    fs.rmSync(mount, { recursive: true, force: true });
  }
}

async function streamedCommand(program, args, logRoot) {
  fs.mkdirSync(logRoot, { recursive: true });
  const prefix = path.join(logRoot, `install-${path.basename(program)}-${require('node:crypto').randomBytes(4).toString('hex')}`);
  const output = fs.openSync(`${prefix}.stdout.log`, 'w');
  const errors = fs.openSync(`${prefix}.stderr.log`, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(program, args, { stdio: ['ignore', output, errors], timeout: BUDGETS.install });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(
        `${program} exited ${code ?? signal}; see ${prefix}.*.log: ${fs.readFileSync(`${prefix}.stderr.log`, 'utf8').slice(-4096)}`)));
    });
  } finally { fs.closeSync(output); fs.closeSync(errors); }
  return { stdout: /^dpkg/.test(path.basename(program)) ? fs.readFileSync(`${prefix}.stdout.log`, 'utf8') : '' };
}
async function downloadBaseline(plan, root) {
  const response = await fetch(`https://api.github.com/repos/GBeurier/nirs4all-studio/releases/tags/${plan.version}`,
    { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Baseline release HTTP ${response.status}`);
  const release = await response.json();
  assert(!release.draft && !release.prerelease && release.published_at);
  assert.equal(release.id, plan.release_id, 'Baseline release identity changed');
  const asset = release.assets.find(a => a.id === plan.installer_id && a.name === plan.name);
  const checksum = release.assets.find(a => a.id === plan.checksum_id && a.name === `${plan.name}.sha256`);
  assert(asset && checksum, 'Baseline installer/checksum identity changed');
  for (const entry of [asset, checksum]) {
    assert(entry.state === 'uploaded' && entry.size > 0);
    const download = await fetch(entry.browser_download_url, { signal: AbortSignal.timeout(180000) });
    assert(download.ok && download.body, `Baseline download HTTP ${download.status}`);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(path.join(root, entry.name), { flags: 'wx' }));
    assert.equal(fs.statSync(path.join(root, entry.name)).size, entry.size);
  }
  const file = path.join(root, plan.name);
  assert.equal(sha256File(file), parseChecksumSidecar(`${file}.sha256`, plan.name));
  return file;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function fixture(root) {
  const data = path.join(root, 'Données avec espaces');
  fs.mkdirSync(data, { recursive: true });
  const wavelengths = Array.from({ length: 256 }, (_, j) => 1000 + j);
  fs.writeFileSync(path.join(data, 'Xtrain.csv'), wavelengths.join(';') + '\n' + Array.from({ length: 1000 }, (_, i) =>
    wavelengths.map((_, j) => (Math.sin(i * 0.01 + j * 0.005) + i * 0.001).toFixed(6)).join(';')).join('\n') + '\n');
  fs.writeFileSync(path.join(data, 'Ytrain.csv'), 'target\n' + Array.from({ length: 1000 }, (_, i) => i / 100).join('\n') + '\n');
  return data;
}

async function api(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_NATIVE_SIDECAR_PORT}/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  assert(response.ok, `${method} ${route}: HTTP ${response.status}`);
  return response.json();
}

/** Setup of the old release is fixture preparation, not candidate qualification. */
async function seedBaseline(installed, platform, profile, data, workspace, envOverrides) {
  const layout = archive.resolveLaunchLayout(installed, platform, 'nirs4all Studio');
  const nativeBaseline = fs.existsSync(layout.nativeSidecarPath);
  const env = baselineBackendEnvironment(
    { ...archive.buildSandboxEnv(platform, profile, await freePort(), BUDGETS.baselineLaunch), ...envOverrides },
    layout,
  );
  const actualWindowsProfile = platform === 'win32' && Boolean(envOverrides);
  const app = await electron.launch({ executablePath: layout.executablePath, cwd: layout.appRoot, env,
    args: [...(platform === 'linux' ? ['--no-sandbox'] : []),
      ...(!actualWindowsProfile ? [`--user-data-dir=${path.join(profile, 'electron-user-data')}`] : [])],
    timeout: BUDGETS.baselineLaunch });
  try {
    if (!nativeBaseline) await preparePythonRecoveryBaseline(app);
    await expect.poll(async () => api(env, '/health').then(() => true).catch(() => false), { timeout: BUDGETS.baselineLaunch }).toBe(true);
    await api(env, '/workspace/create', 'POST', { path: workspace, name: 'Upgrade preservation', create_dir: true });
    await api(env, '/workspace/select', 'POST', { path: workspace });
    await api(env, '/app/settings', 'PUT', { ui_preferences: { language: 'en', theme: 'dark', developer_mode: true } });
    const detected = await api(env, '/datasets/detect-unified', 'POST', { path: data });
    const linked = await api(env, '/datasets/link', 'POST', { path: data, config: { name: 'Preserved spectra', files: detected.files,
      global_params: { delimiter: ';', decimal_separator: '.', has_header: true, na_policy: 'auto' } } });
    assert(linked.success && linked.dataset?.id, 'Baseline dataset was not registered');
    await api(env, '/config/skip-setup', 'POST');
    // Save consent using the real renderer storage, so reopening must not prompt again.
    for (const page of app.windows()) {
      if (await page.evaluate(() => Boolean(window.electronApi?.isElectron)).catch(() => false)) {
        await page.evaluate(async () => {
          await window.electronApi.setTelemetryConsent(false);
          localStorage.setItem('nirs4all-telemetry-consent', 'declined');
          localStorage.setItem('nirs4all-telemetry-consent-decided-at', 'installer-qualification');
        });
      }
    }
    return { dataset_id: linked.dataset.id, workspace, preferences: (await api(env, '/app/settings')).ui_preferences };
  } finally { await app.close(); }
}

function baselineBackendEnvironment(env, layout, exists = fs.existsSync) {
  // Recovery installers before the unified sidecar use BackendManager's
  // Python HTTP port. Give both product lines the same isolated test port.
  if (exists(layout.nativeSidecarPath)) return env;
  const legacy = { ...env, NIRS4ALL_BACKEND_PORT: env.NIRS4ALL_NATIVE_SIDECAR_PORT, PYTHONNOUSERSITE: '1', SENTRY_DSN: '' };
  for (const key of ['NIRS4ALL_OFFLINE', 'VIRTUAL_ENV', 'PYTHONPATH', 'NIRS4ALL_PYTHON_PATH']) delete legacy[key];
  return legacy;
}

async function preparePythonRecoveryBaseline(app) {
  let page;
  await expect.poll(() => {
    page = app.windows().find(window => /index\.html/.test(window.url()));
    return Boolean(page);
  }, { timeout: BUDGETS.baselineLaunch }).toBe(true);
  let timer;
  let setup;
  try {
    setup = await Promise.race([
      page.evaluate(() => window.electronApi.startEnvSetup()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Recovery baseline Python setup timed out')), BUDGETS.baselineSetup); }),
    ]);
  } finally { clearTimeout(timer); }
  assert(setup?.success, `Recovery baseline Python setup failed: ${String(setup?.error || 'unknown').slice(0, 500)}`);
  await page.evaluate(() => window.electronApi.markWizardComplete(true));
}

function fileSnapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[path.relative(root, file)] = sha256File(file);
    }
  }
  visit(root);
  return result;
}

async function journeys(context, proof, data) {
  return require('./qualify-scientific-journey.cjs').businessJourney({ ...context, proof }, data);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const proof = { success: false, platform: options.platform, arch: process.arch, source_sha: process.env.RELEASE_SOURCE_SHA,
    installer_sha256: sha256File(options.installer), budgets: BUDGETS, timings: [] };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio installer qualification '));
  const installRoot = path.join(root, 'Application installée');
  const profile = path.join(root, 'upgrade-profile');
  const data = fixture(root);
  const candidateData = fixture(path.join(root, 'candidate'));
  const workspace = path.join(root, 'Workspace conservé');
  const baseline = JSON.parse(process.env.INSTALLER_BASELINE || 'null');
  let envOverrides;
  if (options.platform === 'win32' && baseline) {
    // NSIS resolves $APPDATA through Windows known folders, independently of
    // process.env.APPDATA. Use the actual disposable runner user for both app
    // and installer or this test would miss a real uninstall-time config wipe.
    assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP,
      'Windows populated upgrade requires a disposable GitHub Actions runner');
    envOverrides = Object.fromEntries(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'TEMP', 'TMP']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  }
  try {
    assert.equal(proof.installer_sha256, parseChecksumSidecar(`${options.installer}.sha256`, path.basename(options.installer)));
    if (options['previous-version']) assert.equal(baseline?.version, options['previous-version']);
    let preserved, before;
    if (baseline) {
      const file = await downloadBaseline(baseline, root);
      const installed = await timed(proof, 'baseline_install', BUDGETS.install, () => install(file, options.platform, installRoot));
      preserved = await seedBaseline(installed, options.platform, profile, data, workspace, envOverrides);
      before = fileSnapshot(workspace);
      assert(Object.keys(before).some(name => /store\.(sqlite|duckdb)$/.test(name)), 'Baseline workspace has no real store');
      proof.baseline = { ...baseline, installer_sha256: sha256File(file), preserved };
    }
    const installed = await timed(proof, 'candidate_install', BUDGETS.install, () => install(options.installer, options.platform, installRoot));
    if (before) assert.deepEqual(fileSnapshot(workspace), before, 'Installer changed workspace bytes');
    const config = archive.assertValidConfig(archive.parseArgs(['--extracted-root', installed, '--platform', options.platform, '--timeout-ms', String(BUDGETS.launch)]));
    for (const consent of ['decline', 'accept']) {
      await ui.main({ config, consent, timings: proof.timings,
        inspectProfile: async ({ env }) => assert((await api(env, '/workspace')).workspace?.path, 'First install did not create a workspace') });
    }
    if (preserved) {
      await ui.main({ config, sandboxRoot: profile, existingProfile: true, envOverrides, timings: proof.timings,
        inspectProfile: async ({ page, env }) => {
          assert.equal((await api(env, '/workspace')).workspace.path, preserved.workspace);
          const prefs = (await api(env, '/app/settings')).ui_preferences;
          for (const key of ['language', 'theme', 'developer_mode']) assert.equal(prefs[key], preserved.preferences[key], `Lost preference ${key}`);
          const datasets = await api(env, '/datasets');
          assert(datasets.datasets.some(d => d.id === preserved.dataset_id), 'Upgrade lost linked dataset');
          assert.equal(await page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'declined');
          await expect(page.getByText(/Checking installation|Retry verification/i)).not.toBeVisible();
        }, journeys: context => journeys(context, proof, candidateData) });
    } else {
      await ui.main({ config, timings: proof.timings, journeys: context => journeys(context, proof, data) });
    }
    proof.success = true;
  } catch (error) {
    proof.error = ui.sanitizeDiagnostic(error.stack || error);
    throw error;
  } finally {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(proof, null, 2));
    // Keep a failed isolated profile for diagnosis; never touch real user state.
    if (proof.success) fs.rmSync(root, { recursive: true, force: true });
  }
  return proof;
}

module.exports = { BUDGETS, baselineBackendEnvironment, fileSnapshot, fixture, parseArgs, seedBaseline, timed, main };
if (require.main === module) main().catch(error => { console.error(ui.sanitizeDiagnostic(error.stack || error)); process.exitCode = 1; });
