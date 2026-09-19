const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BUDGETS, installerMatch, parseArgs, fixture, assertSameExistingPath, streamedCommand, timed, trackApp, closeTrackedApps } = require('../recovery-qualify-installer.cjs');

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
