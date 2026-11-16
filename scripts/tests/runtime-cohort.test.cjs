const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRuntimeCohort } = require('../verify-runtime-cohort.cjs');
const cohort = require('../../build/runtime-cohort.json');
const env = { NIRS4ALL_LIBRARY_REF: cohort.sdk.source_sha, DAG_ML_REF: cohort.dag.source_sha,
  DAG_ML_DATA_REF: cohort.dag_data.source_sha, NIRS4ALL_WHEEL_SHA256: cohort.sdk.wheel_sha256 };
test('actual pinned build environment, catalogue and wheel locks agree with the fingerprinted cohort', () => {
  assert.deepEqual(verifyRuntimeCohort(env), cohort);
});
test('moving, stale-source and stale-wheel environments fail before a build', () => {
  for (const change of [{ DAG_ML_REF: 'main' }, { NIRS4ALL_LIBRARY_REF: 'f'.repeat(40) },
    { NIRS4ALL_WHEEL_SHA256: '0'.repeat(64) }]) assert.throws(() => verifyRuntimeCohort({ ...env, ...change }));
});
test('a catalogue or wheel lock that leaves the cohort is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cohort-unit-'));
  try {
    const project = path.resolve(__dirname, '../..');
    for (const file of ['build/runtime-cohort.json', 'recommended-config.json',
      ...fs.readdirSync(path.join(project, 'build/constraints')).filter(name => name.startsWith('python-wheels-'))
        .map(name => `build/constraints/${name}`)]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(project, file), path.join(root, file));
    }
    assert.deepEqual(verifyRuntimeCohort(env, root), cohort);
    const lockPath = path.join(root, 'build/constraints/python-wheels-win32-x64.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.packages.find(entry => entry.name === 'nirs4all').sha256 = '0'.repeat(64);
    fs.writeFileSync(lockPath, JSON.stringify(lock));
    assert.throws(() => verifyRuntimeCohort(env, root), /win32-x64 wheel lock selects another SDK wheel/);
    fs.copyFileSync(path.join(project, 'build/constraints/python-wheels-win32-x64.json'), lockPath);
    const cataloguePath = path.join(root, 'recommended-config.json');
    const catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
    catalogue.required.find(spec => spec.name === 'nirs4all-core').install = '0.0.1';
    fs.writeFileSync(cataloguePath, JSON.stringify(catalogue));
    assert.throws(() => verifyRuntimeCohort(env, root), /differ from runtime cohort/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
