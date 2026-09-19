const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { BUDGETS, api, createBaselineApi, baselineInstaller, installerMatch, parseArgs, fixture, assertSameExistingPath, streamedCommand, timed, trackApp, closeTrackedApps } = require('../recovery-qualify-installer.cjs');

test('qualification selects installers only and rejects wrong architecture', () => {
  assert(installerMatch('nirs4all-setup.exe', 'win32', 'x64'));
  assert(!installerMatch('nirs4all-portable.exe', 'win32', 'x64'));
  assert(installerMatch('nirs4all_0.11.8_amd64.deb', 'linux', 'x64'));
  assert(!installerMatch('nirs4all.AppImage', 'linux', 'x64'));
  assert(installerMatch('nirs4all-arm64.dmg', 'darwin', 'arm64'));
  assert(!installerMatch('nirs4all-x64.dmg', 'darwin', 'arm64'));
});

test('local app check cannot claim native installer migration', () => {
  assert.throws(() => parseArgs(['--app-root', '/tmp/app', '--previous-version', '0.11.7', '--output', '/tmp/proof']), /cannot qualify installer/);
  assert.throws(() => parseArgs(['--release-root', 'release', '--platform', process.platform === 'win32' ? 'linux' : 'win32', '--output', '/tmp/proof']), /actual target OS/);
});

test('scientific fixture has 1000 spectra, 256 wavelengths and a varying regression target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-fixture-'));
  try {
    const folder = fixture(root);
    const spectra = fs.readFileSync(path.join(folder, 'Xtrain.csv'), 'utf8').trim().split('\n');
    const target = fs.readFileSync(path.join(folder, 'Ytrain.csv'), 'utf8').trim().split('\n');
    assert.equal(spectra.length, 1001);
    assert(spectra.every(line => line.split(';').length === 256));
    assert.equal(target.length, 1001);
    assert(new Set(target.slice(1)).size > 900);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('timing fails a slow success without concealing the original application error', async () => {
  const proof = { timings: [] };
  await assert.rejects(timed(proof, 'too slow', -1, async () => true), /exceeded/);
  await assert.rejects(timed(proof, 'real error', -1, async () => { throw Error('route_not_native_qualified'); }), /route_not_native_qualified/);
  assert.equal(proof.timings.length, 2);
});

test('installer output streams beyond execFile buffer limits and preserves failure status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-output-'));
  try {
    await streamedCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024))'], root);
    const output = fs.readdirSync(root).find(name => name.endsWith('.stdout.log'));
    assert.equal(fs.statSync(path.join(root, output)).size, 3 * 1024 * 1024);
    await assert.rejects(streamedCommand(process.execPath, ['-e', 'process.stderr.write("installer failed"); process.exit(7)'], root), /exited 7.*installer failed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a readiness budget failure closes an app even before its context reaches the caller', async () => {
  let closes = 0;
  const app = { on() {}, close: async () => { closes++; }, process: () => ({ kill() {} }) };
  await assert.rejects(timed({ timings: [] }, 'restart ready', -1, async () => ({ app: trackApp(app) })), /exceeded/);
  await closeTrackedApps();
  assert.equal(closes, 1);
  await closeTrackedApps();
  assert.equal(closes, 1);
});

test('a stuck Electron close is terminated within the cleanup deadline', async () => {
  let kills = 0;
  trackApp({ on() {}, close: () => new Promise(() => {}), process: () => ({ kill() { kills++; } }) });
  await closeTrackedApps(10);
  assert.equal(kills, 1);
});


test('workspace identity accepts filesystem aliases but rejects another or missing directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-alias-'));
  try {
    const workspace = path.join(root, 'Workspace conservé');
    const alias = path.join(root, 'alias');
    const other = path.join(root, 'Other workspace');
    fs.mkdirSync(workspace); fs.mkdirSync(other);
    fs.symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assertSameExistingPath(alias, workspace);
    assert.throws(() => assertSameExistingPath(other, workspace), /Workspace changed/);
    assert.throws(() => assertSameExistingPath(path.join(root, 'missing'), workspace), /ENOENT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


test('only historical installer preparation receives five minutes; the candidate remains limited to two', () => {
  assert.equal(BUDGETS.installer, 120000, 'Fresh and populated candidate installations must keep the original budget');
  assert.equal(BUDGETS.baseline_installer, 300000, 'Old bundled installer preparation has a separate timeout');
});

test('streamed installer commands enforce their own timeout', { timeout: 2000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-timeout-'));
  try {
    await assert.rejects(streamedCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], root, 25), /exited (?:SIGTERM|1)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const token of ['ghp_fixture_secret_do_not_log', '']) {
  test(`baseline metadata ${token ? 'authenticates only the GitHub API' : 'works without a token'} and verifies downloaded bytes`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-download-'));
    const name = process.platform === 'win32' ? 'Studio-win-x64.exe'
      : process.platform === 'linux' ? `Studio-linux-${process.arch}.deb` : `Studio-mac-${process.arch}.dmg`;
    const installer = Buffer.from('genuine installer fixture bytes');
    const hash = crypto.createHash('sha256').update(installer).digest('hex');
    const checksum = Buffer.from(`${hash}  ${name}\n`);
    const contents = new Map([[name, installer], [`${name}.sha256`, checksum]]);
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        assert.equal(url, 'https://api.github.com/repos/GBeurier/nirs4all-studio/releases/tags/0.11.7');
        assert.equal(options.redirect, 'error', 'An authenticated request must never follow an asset redirect');
        assert.equal(options.headers.Authorization, token ? `Bearer ${token}` : undefined);
        return Response.json({ id: 17, published_at: '2026-09-18T00:00:00Z', draft: false,
          assets: [...contents].map(([file, bytes], index) => ({ id: index + 1, name: file, size: bytes.length,
            browser_download_url: `https://release-assets.githubusercontent.com/${file}` })) });
      }
      assert.equal(options.headers, undefined, 'Never forward the API credentials to asset hosts');
      return new Response(contents.get(new URL(url).pathname.slice(1)));
    };
    try {
      const result = await baselineInstaller('0.11.7', root, { token, fetchImpl });
      assert.equal(result.sha256, hash);
      assert.deepEqual(fs.readFileSync(result.file), installer);
      assert.equal(calls.length, 3);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('baseline HTTP failure reports bounded redacted evidence without guessing its cause or downloading assets', async () => {
  const token = 'ghp_fixture_secret_do_not_log';
  let requests = 0;
  let reads = 0;
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(Buffer.from(`Forbidden: ${token} Bearer another_secret\n${'x'.repeat(512)}`));
    },
    cancel() { canceled = true; },
  });
  await assert.rejects(baselineInstaller('0.11.7', os.tmpdir(), {
    token,
    fetchImpl: async () => {
      requests++;
      return new Response(stream, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '12345',
        'x-github-request-id': token } });
    },
  }), error => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /x-ratelimit-remaining=0/);
    assert.match(error.message, /x-ratelimit-reset=12345/);
    assert.match(error.message, /Forbidden/);
    assert(!error.message.includes(token));
    assert(!error.message.includes('another_secret'));
    assert(error.message.length < 2000);
    return true;
  });
  assert.equal(requests, 1, 'Do not weaken qualification by falling back to another baseline');
  assert(reads < 12, 'Diagnostic body consumption must stay bounded even for an endless response');
  assert(canceled);
});

test('old API preparation uses one deadline and leaves candidate request budgets unchanged', async () => {
  assert.equal(BUDGETS.api, 30000);
  assert.equal(BUDGETS.installer, 120000);
  assert.equal(BUDGETS.baseline_prepare, 180000);
  let clock = 0;
  const calls = [];
  const proof = {};
  const baselineApi = createBaselineApi({}, proof, { now: () => clock,
    request: async (_env, route, _method, _body, options) => { calls.push({ route, ...options }); return {}; } });
  await baselineApi('/workspace/create', 'POST');
  clock = 150000;
  await baselineApi('/datasets/link', 'POST');
  clock = 180001;
  await assert.rejects(baselineApi('/config/skip-setup', 'POST'), /Baseline preparation exceeded 180000 ms.*POST \/config\/skip-setup/);
  assert.deepEqual(calls, [{ route: '/workspace/create', timeoutMs: 120000 }, { route: '/datasets/link', timeoutMs: 30000 }]);
  assert.equal(proof.preparation_requests.length, 2, 'An expired global budget must not start another request');
  assert(proof.preparation_requests.every(entry => entry.success));
});

test('baseline request cancellation is bounded by the remaining global preparation deadline', { timeout: 2000 }, async () => {
  let clock = 0;
  const proof = {};
  let canceled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  const baselineApi = createBaselineApi({ NIRS4ALL_BACKEND_PORT: '1', NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: 'secret' }, proof, {
    now: () => clock,
    request: (env, route, method, body, options) => api(env, route, method, body, { ...options,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        canceled = true; reject(signal.reason);
      }, { once: true })) }),
  });
  clock = BUDGETS.baseline_prepare - 5;
  try {
    await assert.rejects(baselineApi('/datasets/link', 'POST'), /POST \/datasets\/link: TimeoutError after \d+ ms \(timeout 5 ms\)/);
    assert(canceled);
    assert.equal(proof.preparation_requests[0].success, false);
  } finally { clearTimeout(keepAlive); }
});

test('candidate fetch failures identify the route and duration without printing network credentials', async () => {
  await assert.rejects(api({ NIRS4ALL_BACKEND_PORT: '1' }, '/workspace/create', 'POST', {}, {
    fetchImpl: async () => { throw new TypeError('network error containing Bearer private_secret'); },
  }), error => {
    assert.match(error.message, /POST \/workspace\/create: TypeError after \d+ ms \(timeout 30000 ms\)/);
    assert(!error.message.includes('private_secret'));
    return true;
  });
});
