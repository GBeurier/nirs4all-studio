/** Anchor the build environment, the package catalogue and the wheel locks to the fingerprinted cohort. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TARGETS, readLock } = require('./python-wheel-lock.cjs');
const distributions = {
  sdk: 'nirs4all', dag: 'dag-ml', dag_data: 'dag-ml-data', core: 'nirs4all-core',
  io: 'nirs4all-io', methods: 'nirs4all-methods',
  // pls4all ships from the Methods repository in exact lockstep with nirs4all-methods.
  pls4all: 'pls4all',
};

function verifyRuntimeCohort(env = process.env, root = path.resolve(__dirname, '..')) {
  const cohort = JSON.parse(fs.readFileSync(path.join(root, 'build/runtime-cohort.json'), 'utf8'));
  assert.equal(cohort.schema, 'nirs4all.studio.runtime-cohort.v1');
  const refs = { sdk: 'NIRS4ALL_LIBRARY_REF', dag: 'DAG_ML_REF', dag_data: 'DAG_ML_DATA_REF' };
  for (const [key, variable] of Object.entries(refs)) {
    assert(/^[0-9a-f]{40}$/.test(cohort[key].source_sha), `Invalid ${key} source identity`);
    assert.equal(env[variable], cohort[key].source_sha, `Build ${key} source differs from runtime cohort`);
  }
  assert.equal(env.NIRS4ALL_WHEEL_SHA256, cohort.sdk.wheel_sha256, 'SDK wheel differs from runtime cohort');
  const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'recommended-config.json'), 'utf8'));
  assert.deepEqual(
    Object.fromEntries(catalogue.required.map(spec => [spec.name, spec.install])),
    Object.fromEntries(Object.entries(distributions).map(([key, distribution]) => [distribution, cohort[key].version])),
    'Required packages of recommended-config.json differ from runtime cohort',
  );
  // readLock refuses a lock that does not carry the catalogue's exact versions.
  for (const target of Object.keys(TARGETS)) {
    const sdk = readLock(target, root).packages.find(entry => entry.name === distributions.sdk);
    assert.equal(sdk?.sha256, cohort.sdk.wheel_sha256, `${target} wheel lock selects another SDK wheel`);
  }
  return cohort;
}

if (require.main === module) {
  try { verifyRuntimeCohort(); console.log('RUNTIME_COHORT_INPUTS_OK'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyRuntimeCohort };
