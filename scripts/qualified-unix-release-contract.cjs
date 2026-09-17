const assert = require('node:assert/strict');

const PRODUCT_SHA = 'f314cdb223cd77ce1a3fb6d336cca82206cd02a4';
const QUALIFICATION_SHA = '47fddff8a4478d940325b3abd5886747055b1b49';
const SOURCE_RUN = '35216053291';
const E2E_RUN = '35216025664';
const PREFIX = 'nirs4all.Studio-0.11.5-';
const PLATFORMS = {
  'linux-x64': { label: 'Linux x64', installer: `${PREFIX}linux-amd64.deb`, archive: `${PREFIX}all-in-one-linux-x64.tar.gz`, extra: [`${PREFIX}linux-x86_64.AppImage`], installStep: 'Install the actual DEB package' },
  'macos-arm64': { label: 'macOS arm64', installer: `${PREFIX}mac-arm64.dmg`, archive: `${PREFIX}all-in-one-mac-arm64.zip`, extra: [], installStep: 'Install the application from the actual DMG' },
};
const WINDOWS_DIGESTS = {
  [`${PREFIX}all-in-one-win-x64.zip`]: '053112186b48c46084ffd71a620df33566a42f453fc08c5058ee2a82f076417e',
  [`${PREFIX}all-in-one-win-x64.zip.sha256`]: '3670b95cb92970eeaf2c5ef5880358e2b2d85921524fd393920db449f8da095a',
  [`${PREFIX}win-x64-portable.exe`]: '8359fc05b3a438921c18436daa7815c8a40e9a7c68b1816a42470d90664656d8',
  [`${PREFIX}win-x64-portable.exe.sha256`]: '84dee72b7c5fb0eda1c7a4e405a804605bb5af091c45d5c2004e5e81219ed636',
  [`${PREFIX}win-x64.exe`]: '1f9eecc8a75e141c4552af8d95281730371b33a8d1c213f03a9b693671b9df1d',
  [`${PREFIX}win-x64.exe.sha256`]: 'fa68665a8333ea8ba41496708b7056d76183391f1925c44ab9900da2779549d8',
};
function platformConfig(platform) {
  assert(Object.hasOwn(PLATFORMS, platform), 'Unsupported publication platform');
  return PLATFORMS[platform];
}
function requiredJob(jobs, name) {
  const found = jobs.filter(job => job.name === name);
  assert.equal(found.length, 1, name);
  assert.equal(found[0].conclusion, 'success', name);
  return found[0];
}
function assertSource(source, jobs, e2e, platform) {
  const config = platformConfig(platform);
  assert.equal(String(source.id), SOURCE_RUN);
  assert.equal(source.head_sha, PRODUCT_SHA);
  assert.equal(source.path, '.github/workflows/release-unified.yml');
  assert.equal(source.event, 'push');
  assert.equal(source.head_branch, '0.11.5');
  for (const name of ['Prepare', 'Acquire pinned plugin wheels', 'Qualify release commit / CI Summary', `Installer — ${config.label}`, `All-in-one — ${config.label}`]) requiredJob(jobs, name);
  assert.equal(String(e2e.id), E2E_RUN);
  assert.equal(e2e.head_sha, PRODUCT_SHA);
  assert.equal(e2e.path, '.github/workflows/playwright.yml');
  assert.equal(e2e.conclusion, 'success');
}
function qualificationStatus(run, jobs, platform) {
  const config = platformConfig(platform);
  assert.equal(run.head_sha, QUALIFICATION_SHA);
  assert.equal(run.path, '.github/workflows/unix-real-install-update.yml');
  assert.equal(run.event, 'workflow_dispatch');
  const name = `Real install and N-1 update — ${config.label}`;
  const found = jobs.filter(job => job.name === name);
  assert(found.length <= 1, 'Ambiguous qualification job');
  if (!found.length || found[0].status !== 'completed') {
    assert.notEqual(run.status, 'completed', 'Qualification ended without selected job');
    return false;
  }
  const job = requiredJob(jobs, name);
  for (const step of [config.installStep, 'Prove the installed application works offline', 'Prove first setup, saved preference, reload and restart in installed UI', 'Migrate actual public 0.11.4 to exact F314 and cold boot offline', 'Preserve installation and real migration evidence']) {
    assert(job.steps.some(value => value.name === step && value.conclusion === 'success'), step);
  }
  return true;
}
function assertEvidence(candidate, migration, records, platform) {
  const config = platformConfig(platform);
  assert.equal(candidate.product_sha, PRODUCT_SHA);
  assert.equal(String(candidate.source_run), SOURCE_RUN);
  const expectedNames = [config.installer, config.archive, ...config.extra].sort();
  assert.deepEqual(records.map(record => record.publishedName).sort(), expectedNames);
  for (const [kind, name] of [['installer', config.installer], ['archive', config.archive]]) {
    assert.equal(candidate[kind].name, name.replace('nirs4all.Studio', 'nirs4all Studio'));
    assert.equal(candidate[kind].sha256, records.find(record => record.publishedName === name).digest);
  }
  assert.equal(migration.success, true);
  assert.equal(migration.from, '0.11.4');
  assert.equal(migration.to, '0.11.5');
  assert.equal(migration.source, 'qualified-candidate-fixture');
  assert.equal(migration.offline_cold_boot, true);
  assert.equal(migration.target_asset, config.archive);
  assert.equal(migration.target_archive_sha256, candidate.archive.sha256);
  assert.match(migration.old_archive_sha256, /^[0-9a-f]{64}$/);
  for (const [key, value] of Object.entries({ status: 'success', from_version: '0.11.4', to_version: '0.11.5', current_version: '0.11.5' })) assert.equal(migration.apply_result[key], value);
}
function assertPublicRelease(release, latest, tagObject) {
  assert.equal(tagObject.type, 'commit');
  assert.equal(tagObject.sha, PRODUCT_SHA);
  assert.equal(release.id, 390685191);
  assert.equal(latest.id, release.id);
  assert.equal(release.tag_name, '0.11.5');
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  for (const [name, digest] of Object.entries(WINDOWS_DIGESTS)) {
    const found = release.assets.filter(asset => asset.name === name);
    assert.equal(found.length, 1, name);
    assert.equal(found[0].state, 'uploaded');
    assert.equal(found[0].digest, `sha256:${digest}`, `Windows asset changed: ${name}`);
  }
}
module.exports = { PRODUCT_SHA, QUALIFICATION_SHA, SOURCE_RUN, E2E_RUN, WINDOWS_DIGESTS, platformConfig, assertSource, qualificationStatus, assertEvidence, assertPublicRelease };
