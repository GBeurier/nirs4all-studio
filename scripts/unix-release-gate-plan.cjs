const assert = require('node:assert/strict');

const UNIX_PLATFORMS = [
  { label: 'Linux x64', runner: 'ubuntu-22.04', artifact: 'linux-x64', platform: 'linux', arch: 'x64', archive_suffix: 'linux-x64.tar.gz', installer_suffix: 'linux-amd64.deb' },
  { label: 'macOS arm64', runner: 'macos-14', artifact: 'macos-arm64', platform: 'darwin', arch: 'arm64', archive_suffix: 'mac-arm64.zip', installer_suffix: 'mac-arm64.dmg' },
  { label: 'macOS x64', runner: 'macos-15-intel', artifact: 'macos-x64', platform: 'darwin', arch: 'x64', archive_suffix: 'mac-x64.zip', installer_suffix: 'mac-x64.dmg' },
];

function compareVersions(left, right) {
  const other = right.split('.').map(Number);
  return left.split('.').map(Number).map((value, index) => value - other[index]).find(value => value !== 0) || 0;
}

function publicArchivePair(release, suffix) {
  const name = `nirs4all.Studio-${release.tag_name}-all-in-one-${suffix}`;
  const archive = (release.assets || []).filter(asset => asset.name === name);
  const checksum = (release.assets || []).filter(asset => asset.name === `${name}.sha256`);
  if (!archive.length && !checksum.length) return null;
  for (const [kind, assets] of [['archive', archive], ['checksum', checksum]]) {
    assert(assets.length === 1 && assets[0].size > 0 && assets[0].state === 'uploaded',
      `Incomplete public ${kind} for ${release.tag_name}/${suffix}`);
    assert(Number.isSafeInteger(assets[0].id) && assets[0].id > 0, `Invalid public ${kind} identity`);
  }
  return { archive: archive[0], checksum: checksum[0] };
}

/** N-1 is the last public version available to this platform's users. */
function previousUnixReleasePlan(releases, targetVersion, { archiveEnabled }) {
  assert(/^\d+\.\d+\.\d+$/.test(targetVersion), 'Unix migration requires a stable numeric target version');
  assert(archiveEnabled, 'Stable releases require Unix update archives, including manual qualification');
  const stable = releases.filter(release => !release.draft && !release.prerelease && release.published_at
    && /^\d+\.\d+\.\d+$/.test(release.tag_name))
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name));
  assert(stable.length > 0, 'No stable public Unix migration baseline exists');
  assert(compareVersions(targetVersion, stable[0].tag_name) > 0, 'Target must be newer than every public stable release');
  return UNIX_PLATFORMS.map(platform => {
    for (const release of stable) {
      const pair = publicArchivePair(release, platform.archive_suffix);
      if (!pair) continue;
      assert(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid public release identity');
      return { ...platform, from_version: release.tag_name, source_release_id: release.id,
        source_archive_id: pair.archive.id, source_checksum_id: pair.checksum.id };
    }
    throw new Error(`No complete public migration archive for ${platform.label}`);
  });
}

function assertUnixCandidateProvenance(run, jobs, { runId, currentRunId, checkoutRef, targetVersion, platformLabel }) {
  assert.match(String(runId), /^\d+$/);
  assert.equal(String(runId), String(currentRunId), 'Unix gate must consume its own producer run');
  assert.equal(String(run.id), String(runId));
  assert.match(checkoutRef, /^[a-f0-9]{40}$/);
  assert.match(targetVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(run.path, '.github/workflows/release-unified.yml');
  assert(['push', 'workflow_dispatch'].includes(run.event), 'Expected a release producer run');
  if (run.event === 'push') {
    assert.equal(run.head_sha, checkoutRef, 'Tag producer SHA differs from the qualified product');
    assert.equal(run.head_branch, targetVersion, 'Tag producer version differs from the candidate');
  }
  // On workflow_dispatch, the parent resolves the requested tag once and all
  // producers use checkoutRef; run.head_sha is the workflow's own revision.
  assert(UNIX_PLATFORMS.some(platform => platform.label === platformLabel), 'Unknown Unix platform');
  const names = [`Installer — ${platformLabel}`, `All-in-one — ${platformLabel}`];
  for (const name of names) {
    const selected = jobs.filter(job => job.name === name);
    assert.equal(selected.length, 1, `Missing or ambiguous producer ${name}`);
    assert.equal(selected[0].status, 'completed', `Unfinished producer ${name}`);
    assert.equal(selected[0].conclusion, 'success', `Unqualified producer ${name}`);
  }
}

function assertUnixBaseline(release, platform) {
  assert(!release.draft && !release.prerelease && release.published_at, 'Migration baseline must remain stable and public');
  assert.equal(release.tag_name, platform.from_version);
  assert.equal(release.id, platform.source_release_id, 'Public migration release was replaced');
  const pair = publicArchivePair(release, platform.archive_suffix);
  assert(pair, 'Public migration archive disappeared');
  assert.equal(pair.archive.id, platform.source_archive_id, 'Public migration archive was replaced');
  assert.equal(pair.checksum.id, platform.source_checksum_id, 'Public migration checksum was replaced');
}

module.exports = { UNIX_PLATFORMS, previousUnixReleasePlan, assertUnixCandidateProvenance, assertUnixBaseline };
