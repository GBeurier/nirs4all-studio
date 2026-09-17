const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../qualified-macintel-release-contract.cjs');
const unix = require('../qualified-unix-release-contract.cjs');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

test('required Mac Intel gates name actual steps in the manufacturing workflow', () => {
  const workflow = yaml.load(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/macos-intel-hotfix.yml'), 'utf8'));
  for (const [name, required] of Object.entries(contract.REQUIRED_JOBS)) {
    const jobs = Object.values(workflow.jobs).filter(job => job.name === name);
    assert.equal(jobs.length, 1, name);
    for (const step of required) assert(jobs[0].steps.some(value => value.name === step), `${name}: ${step}`);
  }
});

function fixture() {
  const attestation = { schema: 'nirs4all.manufacturing-overlay.v1', version: '0.11.5', product_sha: unix.PRODUCT_SHA, manufacturing_sha: contract.MANUFACTURING_SHA, source_release_run: unix.SOURCE_RUN, platform: 'darwin', arch: 'x64', files: { ...contract.OVERLAY_FILES }, scientific_versions: { numpy: '2.3.5', numba: '0.62.1', llvmlite: '0.45.1' } };
  const version = { version: '0.11.5', commit: unix.PRODUCT_SHA, manufacturing_commit: contract.MANUFACTURING_SHA, manufacturing_overlay: attestation };
  const records = [contract.DMG, contract.ZIP].map(publishedName => ({ publishedName, digest: 'a'.repeat(64) }));
  const checksums = { product_sha: unix.PRODUCT_SHA, manufacturing_sha: contract.MANUFACTURING_SHA, platform: 'darwin', arch: 'x64', files: [{ name: contract.DMG.replace('nirs4all.Studio', 'nirs4all Studio'), sha256: records[0].digest }] };
  const migration = { success: true, from: '0.11.4', to: '0.11.5', source: 'qualified-candidate-fixture', offline_cold_boot: true, target_asset: contract.ZIP, target_archive_sha256: records[1].digest, old_archive_sha256: 'b'.repeat(64), apply_result: { status: 'success', from_version: '0.11.4', to_version: '0.11.5', current_version: '0.11.5' } };
  return { attestation, version, records, checksums, migration };
}
test('requires both Mac Intel products and every real qualification step at one pinned commit', () => {
  const run = { head_sha: contract.MANUFACTURING_SHA, path: '.github/workflows/macos-intel-hotfix.yml', event: 'workflow_dispatch', status: 'in_progress' };
  const jobs = Object.entries(contract.REQUIRED_JOBS).map(([name, steps]) => ({ name, status: 'completed', conclusion: 'success', steps: steps.map(name => ({ name, conclusion: 'success' })) }));
  assert.equal(contract.manufacturingStatus(run, jobs), true);
  jobs[1].status = 'in_progress'; assert.equal(contract.manufacturingStatus(run, jobs), false);
  jobs[1].status = 'completed'; jobs[1].conclusion = 'failure';
  assert.throws(() => contract.manufacturingStatus(run, jobs));
  jobs[1].conclusion = 'success'; jobs[0].steps[2].conclusion = 'skipped';
  assert.throws(() => contract.manufacturingStatus(run, jobs));
  jobs[0].steps[2].conclusion = 'success'; run.head_sha = 'different';
  assert.throws(() => contract.manufacturingStatus(run, jobs));
});
test('binds product identity, exact overlay and final DMG or ZIP digest to manufacturing proof', () => {
  const value = fixture();
  contract.assertManufacturingEvidence(value.attestation, value.version, value.checksums, contract.DMG, value.records);
  value.checksums.files[0].name = contract.ZIP.replace('nirs4all.Studio', 'nirs4all Studio');
  contract.assertManufacturingEvidence(value.attestation, value.version, value.checksums, contract.ZIP, value.records);
  contract.assertMigration(value.migration, value.records);
});
test('rejects unreviewed overlay changes and evidence from another product or build', () => {
  const mutations = [
    value => { value.attestation.files['extra-product-file'] = 'c'.repeat(64); },
    value => { value.attestation.files['scripts/setup-python-env.cjs'] = 'c'.repeat(64); },
    value => { value.attestation.product_sha = 'wrong'; },
    value => { value.attestation.scientific_versions.numpy = 'unqualified'; },
    value => { value.version.manufacturing_commit = 'other-job-commit'; },
    value => { value.checksums.manufacturing_sha = 'other-run'; },
    value => { value.checksums.files[0].sha256 = 'c'.repeat(64); },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    assert.throws(() => contract.assertManufacturingEvidence(value.attestation, value.version, value.checksums, contract.DMG, value.records));
  }
});
test('rejects same-version simulated update, missing cold boot and archive-byte mismatch', () => {
  for (const mutate of [value => { value.from = '0.11.5'; }, value => { value.offline_cold_boot = false; }, value => { value.target_archive_sha256 = 'c'.repeat(64); }]) {
    const { migration, records } = fixture(); mutate(migration);
    assert.throws(() => contract.assertMigration(migration, records));
  }
});
