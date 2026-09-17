const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../qualified-unix-release-contract.cjs');

function qualification(platform) {
  const config = contract.platformConfig(platform);
  return {
    run: { head_sha: contract.QUALIFICATION_SHA, path: '.github/workflows/unix-real-install-update.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure' },
    jobs: [{ name: `Real install and N-1 update — ${config.label}`, status: 'completed', conclusion: 'success', steps: [config.installStep, 'Prove the installed application works offline', 'Prove first setup, saved preference, reload and restart in installed UI', 'Migrate actual public 0.11.4 to exact F314 and cold boot offline', 'Preserve installation and real migration evidence'].map(name => ({ name, conclusion: 'success' })) }, { name: 'Other platform failed', status: 'completed', conclusion: 'failure' }],
  };
}
function evidence(platform) {
  const config = contract.platformConfig(platform);
  const digest = 'a'.repeat(64);
  return {
    candidate: { product_sha: contract.PRODUCT_SHA, source_run: contract.SOURCE_RUN, installer: { name: config.installer.replace('nirs4all.Studio', 'nirs4all Studio'), sha256: digest }, archive: { name: config.archive.replace('nirs4all.Studio', 'nirs4all Studio'), sha256: digest } },
    records: [config.installer, config.archive, ...config.extra].map(publishedName => ({ publishedName, digest })),
    migration: { success: true, from: '0.11.4', to: '0.11.5', source: 'qualified-candidate-fixture', offline_cold_boot: true, target_asset: config.archive, target_archive_sha256: digest, old_archive_sha256: 'b'.repeat(64), apply_result: { status: 'success', from_version: '0.11.4', to_version: '0.11.5', current_version: '0.11.5' } },
  };
}
test('each successful platform can publish independently of a failed sibling', () => {
  for (const platform of ['linux-x64', 'macos-arm64']) {
    const { run, jobs } = qualification(platform);
    assert.equal(contract.qualificationStatus(run, jobs, platform), true);
    const { candidate, migration, records } = evidence(platform);
    contract.assertEvidence(candidate, migration, records, platform);
  }
});
test('waits for unfinished selected job and fails closed on skipped or failed gates', () => {
  const { run, jobs } = qualification('linux-x64');
  run.status = 'in_progress'; jobs[0].status = 'in_progress';
  assert.equal(contract.qualificationStatus(run, jobs, 'linux-x64'), false);
  jobs[0].status = 'completed'; jobs[0].conclusion = 'failure';
  assert.throws(() => contract.qualificationStatus(run, jobs, 'linux-x64'));
  jobs[0].conclusion = 'success'; jobs[0].steps[2].conclusion = 'skipped';
  assert.throws(() => contract.qualificationStatus(run, jobs, 'linux-x64'));
});
test('rejects a different qualification workflow revision', () => {
  const { run, jobs } = qualification('macos-arm64');
  run.head_sha = 'unreviewed';
  assert.throws(() => contract.qualificationStatus(run, jobs, 'macos-arm64'));
});
test('rejects mismatched source, archive, installer, migration version or cold boot evidence', () => {
  const mutations = [
    value => { value.candidate.product_sha = 'wrong'; },
    value => { value.candidate.source_run = '999'; },
    value => { value.candidate.installer.sha256 = 'c'.repeat(64); },
    value => { value.candidate.archive.name = 'wrong.zip'; },
    value => { value.migration.target_archive_sha256 = 'c'.repeat(64); },
    value => { value.migration.from = '0.11.5'; },
    value => { value.migration.offline_cold_boot = false; },
    value => { value.migration.apply_result.status = 'failure'; },
    value => { value.records.pop(); },
  ];
  for (const mutate of mutations) {
    const value = evidence('linux-x64'); mutate(value);
    assert.throws(() => contract.assertEvidence(value.candidate, value.migration, value.records, 'linux-x64'));
  }
});
test('requires the original source CI, selected builds and E2E at exact F314', () => {
  const source = { id: contract.SOURCE_RUN, head_sha: contract.PRODUCT_SHA, path: '.github/workflows/release-unified.yml', event: 'push', head_branch: '0.11.5' };
  const jobs = ['Prepare', 'Acquire pinned plugin wheels', 'Qualify release commit / CI Summary', 'Installer — Linux x64', 'All-in-one — Linux x64'].map(name => ({ name, conclusion: 'success' }));
  const e2e = { id: contract.E2E_RUN, head_sha: contract.PRODUCT_SHA, path: '.github/workflows/playwright.yml', conclusion: 'success' };
  contract.assertSource(source, jobs, e2e, 'linux-x64');
  jobs[2].conclusion = 'skipped';
  assert.throws(() => contract.assertSource(source, jobs, e2e, 'linux-x64'));
  jobs[2].conclusion = 'success'; e2e.head_sha = 'wrong';
  assert.throws(() => contract.assertSource(source, jobs, e2e, 'linux-x64'));
});
test('allows additional Unix assets but protects every existing Windows payload and checksum', () => {
  const release = { id: 390685191, tag_name: '0.11.5', draft: false, prerelease: false, assets: Object.entries(contract.WINDOWS_DIGESTS).map(([name, digest]) => ({ name, state: 'uploaded', digest: `sha256:${digest}` })) };
  release.assets.push({ name: 'some-new-unix-asset' });
  const latest = { id: release.id }, tag = { type: 'commit', sha: contract.PRODUCT_SHA };
  contract.assertPublicRelease(release, latest, tag);
  for (const asset of release.assets.slice(0, 6)) {
    const original = asset.digest; asset.digest = 'changed';
    assert.throws(() => contract.assertPublicRelease(release, latest, tag));
    asset.digest = original;
  }
  tag.sha = 'different-product';
  assert.throws(() => contract.assertPublicRelease(release, latest, tag));
});
