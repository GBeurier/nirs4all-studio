const assert = require('node:assert/strict');

const INSTALLERS = Object.freeze({
  'windows-x64': /-win-x64\.exe$/,
  'linux-x64': /-linux-(?:amd64|x64)\.deb$/,
  'macos-x64': /-mac-x64\.dmg$/,
  'macos-arm64': /-mac-arm64\.dmg$/,
});

function compareVersion(a, b) {
  const right = b.split('.').map(Number);
  return a.split('.').map(Number).map((n, i) => n - right[i]).find(Boolean) || 0;
}

/** Resolve the last actual installer available to each platform's users. */
function installerBaselines(releases, targetVersion) {
  assert.match(targetVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  const targetBase = targetVersion.split('-')[0];
  const stable = releases.filter(r => !r.draft && !r.prerelease && r.published_at
    && /^\d+\.\d+\.\d+$/.test(r.tag_name) && compareVersion(r.tag_name, targetBase) < 0)
    .sort((a, b) => compareVersion(b.tag_name, a.tag_name));
  return Object.fromEntries(Object.entries(INSTALLERS).map(([platform, suffix]) => {
    for (const release of stable) {
      const assets = (release.assets || []).filter(a => suffix.test(a.name));
      if (!assets.length) continue;
      assert.equal(assets.length, 1, `Ambiguous public installer for ${platform}`);
      const asset = assets[0];
      const checksums = release.assets.filter(a => a.name === `${asset.name}.sha256`);
      assert.equal(checksums.length, 1, `Missing or ambiguous installer checksum for ${platform}/${release.tag_name}`);
      for (const entry of [asset, checksums[0]]) {
        assert(entry.state === 'uploaded' && entry.size > 0 && Number.isSafeInteger(entry.id),
          `Incomplete public installer for ${platform}/${release.tag_name}`);
      }
      return [platform, { version: release.tag_name, release_id: release.id,
        installer_id: asset.id, checksum_id: checksums[0].id, name: asset.name }];
    }
    // A platform's first ever installer has no upgrade baseline. An existing
    // incomplete installer above is an error, never an excuse to skip upgrade.
    return [platform, null];
  }));
}

module.exports = { INSTALLERS, installerBaselines };
