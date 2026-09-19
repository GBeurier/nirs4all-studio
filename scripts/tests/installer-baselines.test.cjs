const test = require('node:test');
const assert = require('node:assert/strict');
const { installerBaselines } = require('../installer-baselines.cjs');

function release(version, suffixes = ['win-x64.exe', 'linux-amd64.deb', 'mac-x64.dmg', 'mac-arm64.dmg']) {
  return { id: 10, tag_name: version, draft: false, prerelease: false, published_at: '2026-09-19',
    assets: suffixes.flatMap(suffix => [`nirs4all.Studio-${version}-${suffix}`, `nirs4all.Studio-${version}-${suffix}.sha256`])
      .map((name, i) => ({ name, id: i + 1, state: 'uploaded', size: 100 })) };
}

test('selects the last actual installer per CPU without any new archive', () => {
  const plan = installerBaselines([release('0.10.1'), release('0.11.7', ['win-x64.exe'])], '0.11.8');
  assert.equal(plan['windows-x64'].version, '0.11.7');
  assert.equal(plan['macos-x64'].version, '0.10.1');
  assert.equal(plan['linux-x64'].version, '0.10.1');
});

test('ignores drafts, prereleases, current version and a portable-only platform', () => {
  const plan = installerBaselines([release('0.12.0'), { ...release('0.11.8'), draft: true },
    { ...release('0.11.9'), prerelease: true }, release('0.10.1', ['win-x64-portable.exe'])], '0.12.0');
  assert.deepEqual(Object.values(plan), [null, null, null, null]);
});

test('refuses a partial baseline instead of silently falling back', () => {
  const broken = release('0.11.7');
  broken.assets.splice(1, 1);
  assert.throws(() => installerBaselines([broken, release('0.10.1')], '0.11.8'), /checksum/);
});
