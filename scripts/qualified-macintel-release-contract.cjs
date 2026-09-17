const assert = require('node:assert/strict');
const unix = require('./qualified-unix-release-contract.cjs');

// Pin the reviewed manufacturing workflow revision before dispatching publication.
const MANUFACTURING_SHA = '721c7eca0ff2c882ef5779ed9d1b2b54480a6568';
const DMG = 'nirs4all.Studio-0.11.5-mac-x64.dmg';
const ZIP = 'nirs4all.Studio-0.11.5-all-in-one-mac-x64.zip';
const OVERLAY_FILES = {
  'build/constraints/plugin-runtime-cpython311.txt': '8a9430806d2fb316ba5a415cd03982bb5a4ea71535cd828fe1b9bdbb40348619',
  'scripts/bake-python-plugin-runtime.cjs': '8bff0fa0505efe43983894089075ccbcdf83faf1adabfc183772353aff34152e',
  'scripts/setup-python-env.cjs': 'b6e28b737e4281e050a59ebbd96a50a80d1376a4fbf6e4fa0380cf3773a69559',
};
const REQUIRED_JOBS = {
  'Installer — macOS x64': ['Apply only the three content-addressed manufacturing files', 'Verify packaged native sidecar', 'Prove first setup and developer preference in the actual DMG application', 'Generate checksums', 'Bind final payload hashes to the manufacturing identity', 'Upload artifacts', 'Upload manufacturing and qualification evidence'],
  'All-in-one — macOS x64': ['Apply only the three content-addressed manufacturing files', 'Smoke test offline all-in-one launch', 'Migrate actual public 0.11.4 and cold boot the Mac Intel candidate', 'Generate checksum', 'Bind final payload hashes to the manufacturing identity', 'Upload artifacts', 'Upload manufacturing and qualification evidence'],
};
function assertSource(source, jobs, e2e) {
  assert.equal(String(source.id), unix.SOURCE_RUN);
  assert.equal(source.head_sha, unix.PRODUCT_SHA);
  assert.equal(source.path, '.github/workflows/release-unified.yml');
  assert.equal(source.event, 'push');
  assert.equal(source.head_branch, '0.11.5');
  for (const name of ['Prepare', 'Acquire pinned plugin wheels', 'Qualify release commit / CI Summary']) {
    const found = jobs.filter(job => job.name === name);
    assert.equal(found.length, 1, name); assert.equal(found[0].conclusion, 'success', name);
  }
  assert.equal(String(e2e.id), unix.E2E_RUN);
  assert.equal(e2e.head_sha, unix.PRODUCT_SHA);
  assert.equal(e2e.path, '.github/workflows/playwright.yml');
  assert.equal(e2e.conclusion, 'success');
}
function manufacturingStatus(run, jobs) {
  assert.match(MANUFACTURING_SHA, /^[0-9a-f]{40}$/, 'Manufacturing SHA must be reviewed and pinned');
  assert.equal(run.head_sha, MANUFACTURING_SHA);
  assert.equal(run.path, '.github/workflows/macos-intel-hotfix.yml');
  assert.equal(run.event, 'workflow_dispatch');
  let ready = true;
  for (const [name, steps] of Object.entries(REQUIRED_JOBS)) {
    const found = jobs.filter(job => job.name === name);
    assert(found.length <= 1, name);
    if (!found.length || found[0].status !== 'completed') { ready = false; continue; }
    assert.equal(found[0].conclusion, 'success', name);
    for (const step of steps) assert(found[0].steps.some(value => value.name === step && value.conclusion === 'success'), step);
  }
  if (!ready) assert.notEqual(run.status, 'completed', 'Manufacturing ended without both qualified products');
  return ready;
}
function assertManufacturingEvidence(attestation, version, checksums, publishedName, records) {
  assert.equal(attestation.schema, 'nirs4all.manufacturing-overlay.v1');
  assert.equal(attestation.version, '0.11.5');
  assert.equal(attestation.product_sha, unix.PRODUCT_SHA);
  assert.equal(attestation.manufacturing_sha, MANUFACTURING_SHA);
  assert.equal(String(attestation.source_release_run), unix.SOURCE_RUN);
  assert.equal(attestation.platform, 'darwin'); assert.equal(attestation.arch, 'x64');
  assert.deepEqual(attestation.files, OVERLAY_FILES, 'Only the reviewed three files may differ from F314');
  assert.deepEqual(attestation.scientific_versions, { numpy: '2.3.5', numba: '0.62.1', llvmlite: '0.45.1' });
  assert.equal(version.version, '0.11.5');
  assert.equal(version.commit, unix.PRODUCT_SHA);
  assert.equal(version.manufacturing_commit, MANUFACTURING_SHA);
  assert.deepEqual(version.manufacturing_overlay, attestation);
  assert.equal(checksums.product_sha, unix.PRODUCT_SHA);
  assert.equal(checksums.manufacturing_sha, MANUFACTURING_SHA);
  assert.equal(checksums.platform, 'darwin'); assert.equal(checksums.arch, 'x64');
  const originalName = publishedName.replace('nirs4all.Studio', 'nirs4all Studio');
  assert.equal(checksums.files.length, 1);
  assert.equal(checksums.files[0].name, originalName);
  const record = records.filter(value => value.publishedName === publishedName);
  assert.equal(record.length, 1);
  assert.equal(checksums.files[0].sha256, record[0].digest);
}
function assertMigration(migration, records) {
  assert.deepEqual(records.map(value => value.publishedName).sort(), [DMG, ZIP].sort());
  assert.equal(migration.success, true);
  assert.equal(migration.from, '0.11.4'); assert.equal(migration.to, '0.11.5');
  assert.equal(migration.source, 'qualified-candidate-fixture');
  assert.equal(migration.offline_cold_boot, true);
  assert.equal(migration.target_asset, ZIP);
  assert.equal(migration.target_archive_sha256, records.find(value => value.publishedName === ZIP).digest);
  assert.match(migration.old_archive_sha256, /^[0-9a-f]{64}$/);
  for (const [key, value] of Object.entries({ status: 'success', from_version: '0.11.4', to_version: '0.11.5', current_version: '0.11.5' })) assert.equal(migration.apply_result[key], value);
}
module.exports = { MANUFACTURING_SHA, DMG, ZIP, OVERLAY_FILES, REQUIRED_JOBS, assertSource, manufacturingStatus, assertManufacturingEvidence, assertMigration, assertPublicRelease: unix.assertPublicRelease };
