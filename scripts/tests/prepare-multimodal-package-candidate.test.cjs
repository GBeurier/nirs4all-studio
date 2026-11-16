const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareCandidate } = require('../prepare-multimodal-package-candidate.cjs');
const { lockPath, lockedPackages, readLock, stageLockedPackages } = require('../python-wheel-lock.cjs');
const { sha256File } = require('../verified-download.cjs');

const projectRoot = path.resolve(__dirname, '../..');
const published = require('../../recommended-config.json').required;
const linux = { platform: 'linux', arch: 'x64', appVersion: '9.9.9-dev.0', commit: 'abc1234' };

/** A checkout reduced to the files the preparation reads and writes, with one candidate wheel beside it. */
function checkout(t, wheelName = 'dag_ml-9.9.9.dev0-cp311-abi3-manylinux_2_34_x86_64.whl') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multimodal-candidate-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'build', 'constraints'), { recursive: true });
  for (const key of ['linux-x64', 'darwin-arm64']) fs.copyFileSync(lockPath(key), lockPath(key, root));
  fs.copyFileSync(path.join(projectRoot, 'recommended-config.json'), path.join(root, 'recommended-config.json'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.8' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '9.9.8', packages: { '': { version: '9.9.8' } } }));
  fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '9.9.8', build_date: 'released', commit: 'released' }));
  const wheel = path.join(root, 'candidate-wheels', wheelName);
  fs.mkdirSync(path.dirname(wheel));
  fs.writeFileSync(wheel, 'candidate wheel bytes');
  return { root, wheel };
}

test('a candidate wheel becomes the required package that the checkout locks, stages and installs', async t => {
  const { root, wheel } = checkout(t);
  const result = prepareCandidate({ ...linux, wheels: [wheel] }, root);
  const sha256 = sha256File(wheel);
  assert.deepEqual(result, { appVersion: '9.9.9-dev.0', target: 'linux-x64',
    candidates: [{ name: 'dag-ml', version: '9.9.9.dev0', filename: path.basename(wheel), sha256 }] });

  const required = JSON.parse(fs.readFileSync(path.join(root, 'recommended-config.json'), 'utf8')).required;
  assert.deepEqual(required, published.map(spec => spec.name === 'dag-ml' ? { ...spec, install: '9.9.9.dev0' } : spec));

  // readLock is the check of the build scripts: the patched lock matches the patched catalogue.
  const locked = lockedPackages(readLock('linux-x64', root), 'required');
  const before = lockedPackages(readLock('linux-x64'), 'required');
  assert.deepEqual(locked.filter(entry => entry.name !== 'dag-ml'), before.filter(entry => entry.name !== 'dag-ml'));
  const candidate = locked.find(entry => entry.name === 'dag-ml');
  assert.deepEqual({ version: candidate.version, filename: candidate.filename, sha256: candidate.sha256 },
    { version: '9.9.9.dev0', filename: path.basename(wheel), sha256 });

  // The wheelhouse build keeps the staged candidate because its digest is the locked one, without any download...
  const wheelhouse = path.join(root, 'backend-dist', 'wheels');
  assert.deepEqual(await stageLockedPackages([candidate], wheelhouse, 'linux-x64', path.join(root, 'backend-dist')), [candidate.filename]);
  assert.equal(sha256File(path.join(wheelhouse, candidate.filename)), sha256);
  // ...and refuses other bytes under the candidate's name.
  fs.writeFileSync(path.join(wheelhouse, candidate.filename), 'other bytes');
  await assert.rejects(stageLockedPackages([candidate], wheelhouse, 'linux-x64', path.join(root, 'backend-dist')), /Download failed/);

  for (const file of ['package.json', 'package-lock.json', 'version.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version, '9.9.9-dev.0', file);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages[''].version, '9.9.9-dev.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).commit, 'abc1234');
});

test('wheels that the target cannot ship as a required package are refused', t => {
  const cases = [
    ['numpy-9.9.9-cp311-cp311-manylinux_2_28_x86_64.whl', linux, /not a required package/],
    ['dag_ml-9.9.9.dev0-cp311-abi3-win_amd64.whl', linux, /not a wheel that the linux-x64 application can install/],
    ['dag_ml-9.9.9.dev0-cp311-abi3-macosx_11_0_arm64.whl', { ...linux, platform: 'darwin', arch: 'arm64' }, /embeds no wheels/],
    ['dag_ml-9.9.9.dev0-cp311-abi3-manylinux_2_34_x86_64.whl', { ...linux, appVersion: '9.9.8' }, /distinct from the released one/],
  ];
  for (const [wheelName, options, refusal] of cases) {
    const { root, wheel } = checkout(t, wheelName);
    assert.throws(() => prepareCandidate({ ...options, wheels: [wheel] }, root), refusal, wheelName);
  }
  const { root, wheel } = checkout(t);
  assert.throws(() => prepareCandidate({ ...linux, wheels: [wheel, wheel] }, root), /More than one candidate wheel for dag-ml/);
});
