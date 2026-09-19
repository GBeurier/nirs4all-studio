const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installerMatch, parseArgs, fixture, streamedCommand, timed } = require('../recovery-qualify-installer.cjs');

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
