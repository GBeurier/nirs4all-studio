/** Qualify the shipped application, including online Python setup and actual science. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer } = require('node:net');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const archive = require('./smoke-archive-standalone.cjs');
const run = promisify(execFile);
const liveApps = new Set();
const BUDGETS = Object.freeze({ installer: 120000, launch: 30000, python_setup: 180000,
  profile_setup: 60000, preview: 5000, link: 5000, playground: 10000, training: 60000, predictions: 5000 });

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert(['--platform', '--release-root', '--app-root', '--output', '--previous-version'].includes(argv[i]), `Unknown option ${argv[i]}`);
    assert(argv[i + 1], `Missing value for ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
  }
  options.platform ||= process.platform;
  assert.equal(options.platform, process.platform, 'Qualification requires the actual target OS');
  assert(options.output && Boolean(options['release-root']) !== Boolean(options['app-root']), 'Specify output and exactly one release-root or app-root');
  assert(!options['app-root'] || !options['previous-version'], 'Package-only local checks cannot qualify installer migration');
  return options;
}

async function timed(proof, phase, budget, callback) {
  const start = performance.now();
  let failed = false;
  try { return await callback(); }
  catch (error) { failed = true; throw error; }
  finally {
    const duration_ms = performance.now() - start;
    proof.timings.push({ phase, duration_ms, budget_ms: budget });
    console.log(`${phase}: ${Math.round(duration_ms)} ms (budget ${budget} ms)`);
    if (!failed) assert(duration_ms <= budget, `${phase} exceeded ${budget} ms: ${Math.round(duration_ms)} ms`);
  }
}

function installerMatch(name, platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return /\.exe$/i.test(name) && !/portable|uninstall/i.test(name);
  if (platform === 'linux') return /\.deb$/i.test(name) && new RegExp(arch === 'x64' ? '(amd64|x64)' : arch).test(name);
  return name.endsWith('.dmg') && name.includes(arch);
}

async function install(file, root) {
  const command = (program, args) => streamedCommand(program, args, path.dirname(root));
  if (process.platform === 'win32') {
    await command(file, ['/S', '/allusers', `/D=${root}`]);
    assert(fs.existsSync(path.join(root, 'nirs4all Studio.exe')));
    return root;
  }
  if (process.platform === 'linux') {
    await command('sudo', ['apt-get', 'install', '-y', '--allow-downgrades', file]);
    const { stdout: packageName } = await command('dpkg-deb', ['-f', file, 'Package']);
    const { stdout } = await command('dpkg', ['-L', packageName.trim()]);
    const sandbox = stdout.split('\n').find(name => name.endsWith('/chrome-sandbox'));
    assert(sandbox && fs.existsSync(sandbox));
    return path.dirname(sandbox);
  }
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-dmg-'));
  try {
    await command('hdiutil', ['attach', file, '-readonly', '-nobrowse', '-mountpoint', mount]);
    const apps = fs.readdirSync(mount).filter(name => name.endsWith('.app'));
    assert.equal(apps.length, 1);
    const target = path.join(root, apps[0]);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    await command('ditto', [path.join(mount, apps[0]), target]);
    return target;
  } finally { await command('hdiutil', ['detach', mount]).catch(() => {}); }
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Old bundled installers emit more output than execFile's default buffer. */
async function streamedCommand(program, args, logRoot) {
  fs.mkdirSync(logRoot, { recursive: true });
  const prefix = path.join(logRoot, `install-${path.basename(program)}-${crypto.randomBytes(4).toString('hex')}`);
  const output = fs.openSync(`${prefix}.stdout.log`, 'w');
  const errors = fs.openSync(`${prefix}.stderr.log`, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(program, args, { stdio: ['ignore', output, errors], timeout: BUDGETS.installer });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(
        `${program} exited ${code ?? signal}; see ${prefix}.*.log: ${fs.readFileSync(`${prefix}.stderr.log`, 'utf8').slice(-4096)}`)));
    });
  } finally { fs.closeSync(output); fs.closeSync(errors); }
  return { stdout: /^dpkg/.test(path.basename(program)) ? fs.readFileSync(`${prefix}.stdout.log`, 'utf8') : '' };
}
async function baselineInstaller(version, root) {
  const tag = version;
  const response = await fetch(`https://api.github.com/repos/GBeurier/nirs4all-studio/releases/tags/${tag}`, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Baseline release ${tag}: HTTP ${response.status}`);
  const release = await response.json();
  assert(release.published_at && !release.draft, 'Baseline must already be published');
  const assets = release.assets.filter(asset => installerMatch(asset.name));
  assert.equal(assets.length, 1, 'Expected exactly one native previous installer');
  const asset = assets[0];
  const checksum = release.assets.find(entry => entry.name === `${asset.name}.sha256`);
  assert(checksum, 'Baseline installer must have a published checksum');
  for (const entry of [asset, checksum]) {
    const download = await fetch(entry.browser_download_url, { signal: AbortSignal.timeout(180000) });
    assert(download.ok && download.body);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(path.join(root, entry.name), { flags: 'wx' }));
    assert.equal(fs.statSync(path.join(root, entry.name)).size, entry.size);
  }
  const file = path.join(root, asset.name);
  const expected = fs.readFileSync(`${file}.sha256`, 'utf8').trim().split(/\s+/)[0];
  assert.match(expected, /^[a-f0-9]{64}$/i);
  assert.equal(sha256(file), expected.toLowerCase());
  return { file, release_id: release.id, asset_id: asset.id, version: tag, sha256: expected };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function fixture(root) {
  const folder = path.join(root, 'Données avec espaces');
  fs.mkdirSync(folder, { recursive: true });
  const wavelengths = Array.from({ length: 256 }, (_, j) => 1000 + j);
  const values = Array.from({ length: 1000 }, (_, i) => wavelengths.map((_, j) =>
    (Math.sin(j * .025) * (1 + i / 1000) + Math.cos(j * .011) * Math.sin(i * .07) + .01 * Math.sin(i * j)).toFixed(6)).join(';'));
  fs.writeFileSync(path.join(folder, 'Xtrain.csv'), wavelengths.join(';') + '\n' + values.join('\n') + '\n');
  fs.writeFileSync(path.join(folder, 'Ytrain.csv'), 'target\n' + values.map((_, i) => 2 * i / 1000 + Math.sin(i * .07)).join('\n') + '\n');
  return folder;
}

async function api(env, route, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${env.NIRS4ALL_BACKEND_PORT}/api${route}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Nirs4all-Session': env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert(response.ok, `${method} ${route}: HTTP ${response.status}: ${text.slice(0, 1500)}`);
  return JSON.parse(text);
}

async function launch(installed, profile, proof, actualWindowsProfile = false) {
  const env = archive.buildSandboxEnv(process.platform, profile, await freePort(), BUDGETS.launch);
  env.NIRS4ALL_NATIVE_SIDECAR_PORT = env.NIRS4ALL_BACKEND_PORT;
  env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
  for (const key of ['NIRS4ALL_OFFLINE', 'NIRS4ALL_UPDATE_API_BASE', 'VIRTUAL_ENV', 'PYTHONPATH', 'NIRS4ALL_PYTHON_PATH']) delete env[key];
  env.SENTRY_DSN = ''; env.PYTHONNOUSERSITE = '1';
  if (actualWindowsProfile) {
    assert(process.platform === 'win32' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP,
      'NSIS preservation tests require the actual disposable Windows runner user');
    for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  const layout = archive.resolveLaunchLayout(installed, process.platform, 'nirs4all Studio');
  fs.mkdirSync(profile, { recursive: true });
  const app = await electron.launch({ executablePath: layout.executablePath, cwd: layout.appRoot, env,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ...(!actualWindowsProfile ? [`--user-data-dir=${path.join(profile, 'electron-user-data')}`] : [])], timeout: BUDGETS.launch });
  // A later readiness/budget assertion can throw before the caller receives context.
  trackApp(app);
  app.process().stderr.on('data', data => fs.appendFileSync(path.join(profile, 'electron.log'), data));
  app.process().stdout.on('data', data => fs.appendFileSync(path.join(profile, 'electron-stdout.log'), data));
  const errors = [];
  const requests = [];
  const attach = page => {
    page.on('console', message => fs.appendFileSync(path.join(profile, 'renderer.log'), `${message.type()}: ${message.text()}\n`));
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    page.on('requestfinished', async request => {
      try {
      if (!request.url().includes('/api/') || /readiness|health/.test(request.url())) return;
      const response = await request.response();
      const entry = { method: request.method(), url: request.url(), status: response?.status(), timing: request.timing() };
      if (/datasets\/(preview|validate|detect)/.test(request.url())) {
        entry.response = await response?.json().then(value => ({ success: value.success, error: value.error,
          summary: value.summary, validation: value.validation })).catch(() => null);
      }
      requests.push(entry);
      } catch { /* The page can close while diagnostics finish reading a response. */ }
    });
  };
  app.on('window', attach); app.windows().forEach(attach);
  let page;
  await expect.poll(() => { page = app.windows().find(window => /index\.html/.test(window.url())); return Boolean(page); }, { timeout: BUDGETS.launch }).toBe(true);
  await page.locator('body').waitFor();
  await page.evaluate(() => window.electronApi?.onEnvSetupProgress?.(progress => {
    console.log('QUALIFICATION_ENV_PROGRESS', JSON.stringify(progress));
  }));
  page.setDefaultTimeout(10000);
  return { app, page, env, errors, requests, proof, profile };
}

async function finishSetup(context, consent = 'decline', existingConsent = false) {
  const { page, proof } = context;
  const consentButton = page.getByRole('button', { name: consent === 'decline' ? /^Do not send$/ : /^Allow reports/ });
  if (existingConsent) {
    assert.equal(await page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'declined', 'Migration lost telemetry preference');
    let mode;
    await expect.poll(async () => {
      if (await page.getByRole('button', { name: /Set up automatically/ }).isVisible()) mode = 'setup';
      else {
        const ready = await api(context.env, '/system/readiness').catch(() => null);
        if (ready?.ml_ready && ready?.workspace_ready) mode = 'ready';
      }
      return mode !== undefined;
    }, { timeout: BUDGETS.launch }).toBe(true);
    if (mode === 'ready') { await verifyRuntime(context); return; }
  } else {
    await expect(consentButton).toBeVisible({ timeout: BUDGETS.launch });
    await consentButton.click();
  }
  const defaultEnv = await page.evaluate(() => window.electronApi.getEnvInfo());
  const userData = await context.app.evaluate(({ app }) => app.getPath('userData'));
  assert(path.isAbsolute(defaultEnv.envDir) && !path.relative(userData, defaultEnv.envDir).startsWith('..'),
    `Managed Python path is outside the OS application-data directory: ${defaultEnv.envDir}`);
  if (process.platform === 'win32') assert(path.win32.isAbsolute(defaultEnv.envDir) && !defaultEnv.envDir.startsWith('/'));
  proof.python_env_dir = defaultEnv.envDir;
  await timed(proof, `python_setup_${consent}`, BUDGETS.python_setup, async () => {
    await page.getByRole('button', { name: /Set up automatically/ }).click();
    const completed = page.getByText('Select Compute Profile', { exact: true });
    // Report an installation error immediately instead of timing out on a later screen.
    const failed = page.getByRole('alert').filter({ hasText: /failed|error|cannot|unable/i });
    await expect(completed.or(failed).first()).toBeVisible({ timeout: BUDGETS.python_setup });
    assert(await completed.isVisible(), `Python setup failed:\n${await page.locator('body').innerText()}`);
  });
  await timed(proof, `profile_setup_${consent}`, BUDGETS.profile_setup, async () => {
    await page.getByText('CPU — Lite (scikit-learn only)', { exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Optional Packages', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Install & Continue', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Get Started', exact: true })).toBeVisible({ timeout: BUDGETS.profile_setup });
    assert.equal(await page.getByRole('button', { name: 'Continue Anyway', exact: true }).count(), 0, 'Install failed');
    await page.getByRole('button', { name: 'Get Started', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Datasets', exact: true })).toBeVisible({ timeout: BUDGETS.launch });
  });
  const workspace = await api(context.env, '/workspace');
  assert(workspace.workspace?.path && path.isAbsolute(workspace.workspace.path), 'No automatic workspace');
  assert.equal(await page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), consent === 'decline' ? 'declined' : 'accepted');
  assert.deepEqual(context.errors, []);
  await verifyRuntime(context);
}

async function verifyRuntime(context) {
  const info = await context.page.evaluate(() => window.electronApi.getEnvInfo());
  assert(info.pythonPath && path.isAbsolute(info.pythonPath));
  const { stdout } = await run(info.pythonPath, ['-I', '-c',
    'import json, importlib.metadata; d = importlib.metadata.distribution("nirs4all"); print(json.dumps({"version": d.version, "origin": json.loads(d.read_text("direct_url.json") or "null")}))'], { timeout: 10000 });
  const installed = JSON.parse(stdout.trim());
  assert.equal(installed.version, '1.0.2', 'Shipped recovery must actually execute nirs4all 1.0.2');
  const resources = await context.app.evaluate(() => process.resourcesPath);
  const wheel = path.join(resources, 'python-wheels', 'nirs4all-1.0.2-py3-none-any.whl');
  const installedHash = installed.origin?.archive_info?.hashes?.sha256;
  assert.equal(installedHash, sha256(wheel), 'Runtime did not install the exact library wheel carried by this installer');
  context.proof.nirs4all_version = installed.version;
  context.proof.nirs4all_wheel_sha256 = installedHash;
}

async function awaitReady(context) {
  await expect.poll(async () => {
    try {
      const readiness = await api(context.env, '/system/readiness');
      return readiness.ml_ready && readiness.workspace_ready;
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw error;
    }
  }, { timeout: BUDGETS.launch, intervals: [100, 200, 500] }).toBe(true);
  await expect(context.page.getByRole('link', { name: 'Datasets', exact: true })).toBeVisible({ timeout: BUDGETS.launch });
}

async function qualifyReplay(context, chainId, data, phase) {
  const spectra = fs.readFileSync(path.join(data, 'Xtrain.csv'), 'utf8').trim().split('\n').slice(1, 9)
    .map(line => line.split(';').map(Number));
  const expected = fs.readFileSync(path.join(data, 'Ytrain.csv'), 'utf8').trim().split('\n').slice(1, 9).map(Number);
  await timed(context.proof, phase, BUDGETS.predictions, async () => {
    const replay = await api(context.env, '/predict', 'POST', {
      model_id: chainId, model_source: 'chain', data_source: 'array', spectra,
    });
    assert.equal(replay.num_samples, spectra.length, 'Saved-model replay returned the wrong sample count');
    assert.equal(replay.predictions.length, spectra.length, 'Saved-model replay returned missing predictions');
    assert(replay.predictions.every(Number.isFinite), 'Saved-model replay contains non-finite predictions');
    const rmse = Math.sqrt(replay.predictions.reduce((sum, value, i) => sum + (value - expected[i]) ** 2, 0) / expected.length);
    assert(rmse < .05, `Saved PLS model failed the synthetic-fixture accuracy check: RMSE=${rmse}`);
    context.proof[phase] = { samples: spectra.length, rmse };
  });
}

async function businessJourney(context, data) {
  const { page, app, env, proof } = context;
  await page.getByRole('link', { name: 'Datasets', exact: true }).click();
  // The OS file chooser is the only replacement; all app processing remains real.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, data);
  await page.getByRole('button', { name: /add dataset/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Select Folder', { exact: true }).click();
  await dialog.getByPlaceholder('Enter dataset name').fill('Release journey spectra');
  for (const description of ['Configure file roles and splits', 'Configure CSV and data parsing', 'Configure target columns and task type']) {
    await expect(dialog.getByText(description, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await timed(proof, 'dataset_preview_ui', BUDGETS.preview, async () => {
    try { await expect(dialog.getByText(/All files parsed successfully/)).toBeVisible({ timeout: BUDGETS.preview }); }
    catch (error) { throw new Error(`${error.message}\nDataset wizard:\n${await dialog.innerText()}\nRequests:\n${JSON.stringify(context.requests)}`); }
  });
  await timed(proof, 'dataset_link_ui', BUDGETS.link, async () => {
    await dialog.getByRole('button', { name: 'Add Dataset', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: BUDGETS.link });
    await expect(page.getByText('Release journey spectra', { exact: true }).first()).toBeVisible({ timeout: BUDGETS.link });
  });
  const dataset = (await api(env, '/datasets')).datasets.find(entry => entry.name === 'Release journey spectra');
  assert(dataset && dataset.num_samples === 1000, `Wrong imported dataset: ${JSON.stringify(dataset)}`);
  proof.dataset = { id: dataset.id, samples: dataset.num_samples, features: dataset.num_features };
  await timed(proof, 'playground_transform_ui', BUDGETS.playground, async () => {
    await page.evaluate(({ id, name }) => { window.location.hash = `/playground?datasetId=${encodeURIComponent(id)}&datasetName=${encodeURIComponent(name)}`; }, dataset);
    await page.getByRole('button', { name: /Search operators/ }).click();
    await page.getByPlaceholder('Search operators...').fill('SNV');
    const responsePromise = page.waitForResponse(response => response.url().includes('/playground/execute')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.steps?.some(step => /StandardNormalVariate|SNV/.test(step.name)), { timeout: BUDGETS.playground });
    await page.getByRole('option').filter({ has: page.getByText(/^(SNV|Standard Normal Variate|StandardNormalVariate)$/) }).first().click();
    const response = await responsePromise;
    const result = response.headers()['content-type']?.includes('application/x-msgpack')
      ? require('@msgpack/msgpack').decode(await response.body()) : await response.json();
    assert(result.success && !result.is_raw_data && result.execution_trace.some(step => step.success && /StandardNormalVariate|SNV/.test(step.name)),
      `Renderer did not execute SNV: ${JSON.stringify({ trace: result.execution_trace, errors: result.step_errors })}`);
    assert(result.processed && result.original, 'Missing real spectral arrays');
    const spectrum = result.processed.spectra[0];
    assert(Array.isArray(spectrum) && spectrum.length === 256 && spectrum.every(Number.isFinite));
    const mean = spectrum.reduce((sum, value) => sum + value, 0) / spectrum.length;
    const variance = spectrum.reduce((sum, value) => sum + (value - mean) ** 2, 0) / spectrum.length;
    assert(Math.abs(mean) < 1e-5 && Math.abs(variance - 1) < .02, `SNV numerical invariant failed: mean=${mean}, variance=${variance}, trace=${JSON.stringify(result.execution_trace)}`);
    proof.playground = { execution_time_ms: result.execution_time_ms, trace: result.execution_trace };
    await expect(page.locator('canvas, .recharts-surface').first()).toBeVisible({ timeout: BUDGETS.playground });
  });
  await page.screenshot({ path: path.join(context.profile, 'playground.png') });
  const training = await timed(proof, 'pls_training', BUDGETS.training, async () => {
    const started = await api(env, '/runs/quick', 'POST', { pipeline_id: 'release-qualification', dataset_id: dataset.id,
      name: 'Release PLS qualification', cv_folds: 3, export_model: true,
      inline_pipeline: { name: 'Release PLS', steps: [
        { id: 'scale', type: 'preprocessing', name: 'StandardScaler', params: {} },
        { id: 'folds', type: 'splitting', name: 'KFold', params: { n_splits: 3, shuffle: true, random_state: 42 } },
        { id: 'pls', type: 'model', name: 'PLSRegression', params: { n_components: 3 } },
      ] } });
    let result;
    await expect.poll(async () => {
      result = await api(env, `/runs/${started.id}`);
      assert(!['failed', 'error', 'cancelled'].includes(result.status), JSON.stringify(result));
      return result.status;
    }, { timeout: BUDGETS.training, intervals: [200, 500, 1000] }).toBe('completed');
    return result;
  });
  proof.training = { id: training.id, status: training.status };
  const pipelines = training.datasets.flatMap(datasetRun => datasetRun.pipelines);
  assert(pipelines.length > 0 && pipelines.every(pipelineRun => pipelineRun.engine === 'legacy'), 'Recovery training did not use the legacy engine');
  proof.training.engines = pipelines.map(pipelineRun => pipelineRun.engine);
  let replayChainId;
  await timed(proof, 'nonempty_predictions_ui', BUDGETS.predictions, async () => {
    const stored = await api(env, '/aggregated-predictions');
    assert(stored.total > 0 && stored.predictions.some(entry => Number.isFinite(entry.cv_val_score)), 'No finite cross-validation prediction score');
    proof.predictions = { total: stored.total, cv_val_scores: stored.predictions.map(entry => entry.cv_val_score) };
    const cvChain = stored.predictions.find(entry => Number.isFinite(entry.cv_val_score));
    replayChainId = cvChain.chain_id;
    const chain = await api(env, `/aggregated-predictions/chain/${encodeURIComponent(cvChain.chain_id)}`);
    const fold = chain.predictions.find(entry => entry.partition === 'val');
    assert(fold?.prediction_id, 'No persisted validation-fold predictions');
    const arrays = await api(env, `/aggregated-predictions/${encodeURIComponent(fold.prediction_id)}/arrays`);
    const truth = arrays.y_true?.flat(Infinity), predicted = arrays.y_pred?.flat(Infinity);
    assert(truth?.length > 100 && truth.length === predicted?.length && truth.every(Number.isFinite) && predicted.every(Number.isFinite));
    proof.predictions.validation_samples = truth.length;
    await page.locator('a[href="#/predictions"]').click();
    await expect(page.getByText('PLSRegression', { exact: false }).first()).toBeVisible({ timeout: BUDGETS.predictions });
    await expect(page.getByText(/Error loading predictions|route_not_native_qualified|No predictions/i)).not.toBeVisible();
  });
  await qualifyReplay(context, replayChainId, data, 'saved_model_replay');
  await page.screenshot({ path: path.join(context.profile, 'predictions.png') });
  assert.deepEqual(context.errors, []);
  return dataset;
}

function snapshot(root) {
  const entries = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) entries[path.relative(root, file)] = sha256(file);
    }
  };
  visit(root);
  return entries;
}

async function qualifyMigration(candidate, version, root, proof, data) {
  const baseline = await baselineInstaller(version, root);
  proof.baseline = baseline;
  const installRoot = path.join(root, 'Application installée');
  const installed = await timed(proof, 'baseline_install', BUDGETS.installer, () => install(baseline.file, installRoot));
  const profile = path.join(root, 'preserved-profile');
  const actualWindowsProfile = process.platform === 'win32';
  let context = await launch(installed, profile, proof, actualWindowsProfile);
  const workspace = path.join(root, 'Workspace conservé');
  let preserved;
  try {
    // Old-release setup is preparation. Candidate setup is exercised separately without bypasses.
    await expect.poll(() => api(context.env, '/health').then(() => true).catch(() => false), { timeout: BUDGETS.python_setup }).toBe(true);
    await api(context.env, '/workspace/create', 'POST', { path: workspace, name: 'Upgrade preservation', create_dir: true });
    await api(context.env, '/workspace/select', 'POST', { path: workspace });
    await api(context.env, '/app/settings', 'PUT', { ui_preferences: { language: 'en', theme: 'dark', developer_mode: true } });
    const detected = await api(context.env, '/datasets/detect-unified', 'POST', { path: data });
    const linked = await api(context.env, '/datasets/link', 'POST', { path: data, config: { name: 'Preserved spectra', files: detected.files,
      global_params: { delimiter: ';', decimal_separator: '.', has_header: true, na_policy: 'auto' } } });
    assert(linked.success && linked.dataset?.id);
    await api(context.env, '/config/skip-setup', 'POST');
    await context.page.evaluate(async () => {
      await window.electronApi.setTelemetryConsent(false);
      localStorage.setItem('nirs4all-telemetry-consent', 'declined');
      localStorage.setItem('nirs4all-telemetry-consent-decided-at', new Date().toISOString());
    });
    preserved = { dataset_id: linked.dataset.id, preferences: (await api(context.env, '/app/settings')).ui_preferences };
  } finally { await closeTrackedApps(); }
  // Registration alone does not create a store. Populate actual predictions with
  // the previous installer's own Python/library, while that application is closed.
  const layout = archive.resolveLaunchLayout(installed, process.platform, 'nirs4all Studio');
  const python = (layout.bundledPythonCandidates || [layout.bundledPythonPath]).find(file => fs.existsSync(file));
  assert(python, 'Previous installer has no bundled scientific interpreter');
  const seedCode = [
    'import json, sys, sqlite3, importlib.metadata',
    'from pathlib import Path',
    'import numpy as np',
    'import nirs4all',
    'from sklearn.preprocessing import StandardScaler',
    'from sklearn.model_selection import KFold',
    'from sklearn.cross_decomposition import PLSRegression',
    'data, workspace = map(Path, sys.argv[1:])',
    'X = np.loadtxt(data / "Xtrain.csv", delimiter=";", skiprows=1)',
    'y = np.loadtxt(data / "Ytrain.csv", delimiter=";", skiprows=1)',
    'nirs4all.run([StandardScaler(), KFold(n_splits=3, shuffle=True, random_state=42), PLSRegression(n_components=3)], dataset=(X, y), workspace_path=workspace, engine="legacy", verbose=0, save_charts=False)',
    'store = workspace / "store.sqlite"',
    'assert store.is_file(), "Previous library did not persist its real store"',
    'with sqlite3.connect(f"file:{store.as_posix()}?mode=ro", uri=True) as db: count = db.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]',
    'assert count > 0, "Previous library did not persist predictions"',
    'print(json.dumps({"prediction_count": count, "nirs4all_version": importlib.metadata.version("nirs4all"), "store_bytes": store.stat().st_size}))',
  ].join('\n');
  const seeded = await timed(proof, 'baseline_populate_scientific_store', BUDGETS.installer, () => run(python,
    ['-I', '-c', seedCode, data, workspace], { timeout: BUDGETS.installer, maxBuffer: 2 ** 20,
      env: { ...process.env, PYTHONNOUSERSITE: '1', N4A_ENGINE: 'legacy' } }));
  proof.baseline.scientific_store = JSON.parse(seeded.stdout.trim().split('\n').at(-1));
  const before = snapshot(workspace);
  assert(Object.keys(before).some(name => /store\.(sqlite|duckdb)$/.test(name)), 'Baseline must contain a genuine store');
  const upgraded = await timed(proof, 'populated_reinstall', BUDGETS.installer, () => install(candidate, installRoot));
  assert.deepEqual(snapshot(workspace), before, 'Installer changed workspace bytes');
  context = await launch(upgraded, profile, proof, actualWindowsProfile);
  try {
    // Moving from an old bundled runtime to source installation may need one
    // real managed-runtime setup. Keep the existing profile and consent intact.
    await finishSetup(context, 'decline', true);
    await expect(context.page.getByRole('link', { name: 'Datasets', exact: true })).toBeVisible({ timeout: BUDGETS.python_setup });
    await verifyRuntime(context);
    assert.equal((await api(context.env, '/workspace')).workspace.path, workspace);
    const preferences = (await api(context.env, '/app/settings')).ui_preferences;
    for (const key of ['language', 'theme', 'developer_mode']) assert.equal(preferences[key], preserved.preferences[key], `Lost ${key}`);
    assert((await api(context.env, '/datasets')).datasets.some(entry => entry.id === preserved.dataset_id), 'Lost dataset');
    const previousResults = await api(context.env, '/aggregated-predictions');
    assert(previousResults.total > 0, 'Recovery cannot read previous scientific results');
    await qualifyReplay(context, previousResults.predictions[0].chain_id, data, 'previous_model_replay');
    assert.equal(await context.page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'declined');
    await expect(context.page.getByRole('button', { name: 'Do not send', exact: true })).not.toBeVisible();
    const preview = await api(context.env, `/datasets/${preserved.dataset_id}`);
    assert(preview.dataset || preview.id, 'Preserved dataset cannot be read');
    await context.page.locator('a[href="#/predictions"]').click();
    await expect(context.page.getByRole('heading', { name: 'Predictions', exact: true })).toBeVisible();
    await expect(context.page.getByText(/Error loading predictions|route_not_native_qualified/i)).not.toBeVisible();
    assert.deepEqual(context.errors, []);
    proof.migration = { success: true, workspace, dataset_id: preserved.dataset_id, files_preserved: Object.keys(before).length,
      windows_known_folders: actualWindowsProfile };
  } finally { await closeTrackedApps(); }
}

function trackApp(app) {
  liveApps.add(app);
  app.on('close', () => liveApps.delete(app));
  return app;
}

async function closeTrackedApps(timeoutMs = 5000) {
    for (const app of liveApps) {
      let timeout;
      try {
        await Promise.race([app.close(), new Promise(resolve => {
          timeout = setTimeout(() => { app.process().kill('SIGKILL'); resolve(); }, timeoutMs);
        })]);
      } catch { app.process().kill('SIGKILL'); }
      finally { clearTimeout(timeout); liveApps.delete(app); }
    }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio recovery qualification '));
  const proof = { success: false, scope: options['app-root'] ? 'packaged_application_only' : 'installed_application',
    platform: process.platform, arch: process.arch, root, budgets: BUDGETS, timings: [] };
  let context;
  try {
    let installed = options['app-root'];
    let candidate;
    if (!installed) {
      const files = fs.readdirSync(options['release-root']).filter(name => installerMatch(name));
      assert.equal(files.length, 1, 'Expected exactly one installer for the host OS/CPU');
      const file = path.resolve(options['release-root'], files[0]);
      candidate = file;
      proof.installer_sha256 = sha256(file);
      installed = await timed(proof, 'candidate_install', BUDGETS.installer, () => install(file, path.join(root, 'Application installée')));
    }
    const data = fixture(root);
    const profile = path.join(root, 'fresh-decline');
    context = await timed(proof, 'fresh_launch', BUDGETS.launch, () => launch(installed, profile, proof));
    await finishSetup(context, 'decline');
    await businessJourney(context, data);
    const workspace = (await api(context.env, '/workspace')).workspace.path;
    await api(context.env, '/app/settings', 'PUT', { ui_preferences: { language: 'en', theme: 'dark', developer_mode: true } });
    await closeTrackedApps(); context = undefined;
    context = await timed(proof, 'restart_ready', BUDGETS.launch, async () => {
      const reopened = await launch(installed, profile, proof);
      await awaitReady(reopened);
      return reopened;
    });
    assert.equal((await api(context.env, '/workspace')).workspace.path, workspace);
    assert.equal((await api(context.env, '/app/settings')).ui_preferences.developer_mode, true);
    assert.equal(await context.page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'declined');
    await expect(context.page.getByText(/Python Environment Setup|Checking installation|Select Compute Profile/)).not.toBeVisible();
    assert((await api(context.env, '/aggregated-predictions')).total > 0, 'Restart lost predictions');
    assert.deepEqual(context.errors, []);
    await closeTrackedApps(); context = undefined;
    context = await launch(installed, path.join(root, 'fresh-accept'), proof);
    await finishSetup(context, 'accept');
    await closeTrackedApps(); context = undefined;
    context = await launch(installed, path.join(root, 'fresh-accept'), proof);
    await awaitReady(context);
    assert.equal(await context.page.evaluate(() => localStorage.getItem('nirs4all-telemetry-consent')), 'accepted');
    assert.deepEqual(context.errors, []);
    await closeTrackedApps(); context = undefined;
    if (options['previous-version']) await qualifyMigration(candidate, options['previous-version'], root, proof, data);
    proof.success = true;
  } catch (error) { proof.error = error.stack || String(error); throw error; }
  finally {
    const diagnostics = path.join(path.dirname(path.resolve(options.output)), `${process.platform}-${process.arch}-diagnostics`);
    fs.mkdirSync(diagnostics, { recursive: true });
    if (context) {
      await context.page.screenshot({ path: path.join(diagnostics, 'failure.png') }).catch(() => {});
      fs.writeFileSync(path.join(diagnostics, 'failure-body.txt'), await context.page.locator('body').innerText().catch(() => ''));
      proof.api_errors = context.errors;
      proof.requests = context.requests;
      await closeTrackedApps();
    }
    await closeTrackedApps();
    function collect(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const source = path.join(directory, entry.name);
        if (entry.isDirectory() && !['home', 'electron-user-data', 'Application installée', 'UserProfile'].includes(entry.name)) collect(source);
        else if (entry.isFile() && /\.(log|png)$/.test(entry.name)) {
          fs.copyFileSync(source, path.join(diagnostics, path.relative(root, source).replaceAll(path.sep, '_')));
        }
      }
    }
    collect(root);
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, JSON.stringify(proof, null, 2));
  }
  return proof;
}

module.exports = { BUDGETS, baselineInstaller, businessJourney, finishSetup, fixture, installerMatch, launch, main, parseArgs, qualifyMigration, snapshot, streamedCommand, timed, trackApp, closeTrackedApps };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
