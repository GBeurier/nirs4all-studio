/** Anchor build environment and constraints to fingerprinted runtime inputs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installedDistributionVersions } = require('./bake-python-plugin-runtime.cjs');
const distributions = { sdk: 'nirs4all', dag: 'dag-ml', dag_data: 'dag-ml-data', core: 'nirs4all-core', tools: 'nirs4all-tools' };

function verifyRuntimeCohort(env = process.env, root = path.resolve(__dirname, '..')) {
  const cohort = JSON.parse(fs.readFileSync(path.join(root, 'build/runtime-cohort.json'), 'utf8'));
  assert.equal(cohort.schema, 'nirs4all.studio.runtime-cohort.v1');
  const refs = { sdk: 'NIRS4ALL_LIBRARY_REF', dag: 'DAG_ML_REF', dag_data: 'DAG_ML_DATA_REF', tools: 'NIRS4ALL_TOOLS_REF' };
  for (const [key, variable] of Object.entries(refs)) {
    assert(/^[0-9a-f]{40}$/.test(cohort[key].source_sha), `Invalid ${key} source identity`);
    assert.equal(env[variable], cohort[key].source_sha, `Build ${key} source differs from runtime cohort`);
  }
  assert.equal(env.NIRS4ALL_WHEEL_SHA256, cohort.sdk.wheel_sha256, 'SDK wheel differs from runtime cohort');
  const constraints = fs.readFileSync(path.join(root, 'build/constraints/plugin-runtime-cpython311.txt'), 'utf8');
  for (const [key, distribution] of Object.entries(distributions)) {
    const rows = constraints.split(/\r?\n/).filter(line => line.startsWith(`${distribution}==`));
    assert.deepEqual(rows, [`${distribution}==${cohort[key].version}`], `${distribution} constraints differ from runtime cohort`);
  }
  return cohort;
}

function verifyInstalledCohort(contract, cohort) {
  const versions = installedDistributionVersions(contract.pythonSitePackagesPath);
  for (const [key, distribution] of Object.entries(distributions)) {
    assert.equal(versions.get(distribution), cohort[key].version, `Actual embedded ${distribution} differs from runtime cohort`);
  }
  return Object.fromEntries(versions);
}

if (require.main === module) {
  try { verifyRuntimeCohort(); console.log('RUNTIME_COHORT_INPUTS_OK'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verifyRuntimeCohort, verifyInstalledCohort };
