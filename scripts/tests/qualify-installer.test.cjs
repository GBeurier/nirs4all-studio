const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { baselineBackendEnvironment, fileSnapshot, fixture, parseArgs, timed } = require('../qualify-installer.cjs');

test('populated upgrade reaches the real backend of the public Python recovery installer', () => {
  const source = { NIRS4ALL_NATIVE_SIDECAR_PORT: '49152', NIRS4ALL_OFFLINE: '1' };
  const layout = { nativeSidecarPath: '/missing/native/studio-sidecar' };
  const oldEnvironment = baselineBackendEnvironment(source, layout, () => false);
  assert.equal(oldEnvironment.NIRS4ALL_BACKEND_PORT, '49152');
  assert.equal(oldEnvironment.NIRS4ALL_NATIVE_SIDECAR_PORT, '49152');
  assert.equal(oldEnvironment.NIRS4ALL_OFFLINE, undefined);
  assert.deepEqual(baselineBackendEnvironment(source, layout, () => true), source);
});

test('rejects cross-platform installation and incomplete arguments before launching', () => {
  assert.throws(() => parseArgs(['--installer', 'app.exe', '--output', 'proof.json', '--platform', process.platform === 'linux' ? 'win32' : 'linux']), /actual target OS/);
  assert.throws(() => parseArgs(['--installer', 'app.exe']), /proof output/);
});

test('representative fixture has 1000 spectra, 256 variables and an accented spaced path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fixture-test-'));
  try {
    const folder = fixture(root);
    const lines = fs.readFileSync(path.join(folder, 'Xtrain.csv'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1001);
    assert.equal(lines[0].split(';').length, 256);
    assert.match(folder, /Données avec espaces/);
    const before = fileSnapshot(root);
    fs.appendFileSync(path.join(folder, 'Ytrain.csv'), 'corruption');
    assert.notDeepEqual(fileSnapshot(root), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a completed action beyond its product budget fails rather than turning green', async () => {
  const proof = { timings: [] };
  await assert.rejects(timed(proof, 'preview', 1, () => new Promise(resolve => setTimeout(resolve, 10))), /budget/);
  assert.equal(proof.timings.length, 1);
});
