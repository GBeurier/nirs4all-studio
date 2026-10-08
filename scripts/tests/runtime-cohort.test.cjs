const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyRuntimeCohort, verifyInstalledCohort } = require('../verify-runtime-cohort.cjs');
const cohort = require('../../build/runtime-cohort.json');
const env = { NIRS4ALL_LIBRARY_REF: cohort.sdk.source_sha, DAG_ML_REF: cohort.dag.source_sha,
  DAG_ML_DATA_REF: cohort.dag_data.source_sha, NIRS4ALL_TOOLS_REF: cohort.tools.source_sha,
  NIRS4ALL_WHEEL_SHA256: cohort.sdk.wheel_sha256 };
test('actual pinned build environment agrees with the fingerprinted constraints and cohort', () => {
  assert.deepEqual(verifyRuntimeCohort(env), cohort);
});
test('moving, stale-source and stale-wheel environments fail before a build', () => {
  for (const change of [{ DAG_ML_REF: 'main' }, { NIRS4ALL_LIBRARY_REF: 'f'.repeat(40) },
    { NIRS4ALL_WHEEL_SHA256: '0'.repeat(64) }]) assert.throws(() => verifyRuntimeCohort({ ...env, ...change }));
});
test('embedded dependency versions are read from actual metadata; a stale Core is refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cohort-unit-'));
  try {
    const rows = { sdk: 'nirs4all', dag: 'dag-ml', dag_data: 'dag-ml-data', core: 'nirs4all-core', tools: 'nirs4all-tools' };
    for (const [key, name] of Object.entries(rows)) {
      const dir = path.join(root, `${name}.dist-info`); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'METADATA'), `Name: ${name}\nVersion: ${cohort[key].version}\n`);
    }
    assert.equal(verifyInstalledCohort({ pythonSitePackagesPath: root }, cohort)['dag-ml'], cohort.dag.version);
    fs.writeFileSync(path.join(root, 'nirs4all-core.dist-info/METADATA'), 'Name: nirs4all-core\nVersion: 0.0.1\n');
    assert.throws(() => verifyInstalledCohort({ pythonSitePackagesPath: root }, cohort), /Actual embedded nirs4all-core/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
