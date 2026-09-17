const assert = require('node:assert/strict');

function previousReleasePlan(release, targetVersion, { archiveEnabled, tagRelease }) {
  assert(/^\d+\.\d+\.\d+$/.test(targetVersion), 'This Windows migration gate qualifies stable target versions only');
  if (tagRelease) assert(archiveEnabled, 'Public tag releases require a Windows update archive');
  if (release === null) {
    return { previousVersion: '', note: 'Initial release: NSIS and installed UI remain mandatory; no public N-1 exists.' };
  }
  assert(!release.draft && !release.prerelease && release.published_at, 'Previous release must be stable and public');
  // Standard Studio release tags are numeric (release-unified push filter).
  assert(/^\d+\.\d+\.\d+$/.test(release.tag_name), 'Previous public tag is not a supported numeric Studio version');
  const previousVersion = release.tag_name;
  const previous = previousVersion.split('.').map(Number);
  const target = targetVersion.split('-')[0].split('.').map(Number);
  const difference = target.map((number, index) => number - previous[index]).find(number => number !== 0) || 0;
  assert(difference > 0, 'Target must be newer than the current public stable release');
  if (archiveEnabled) {
    const name = `nirs4all.Studio-${previousVersion}-all-in-one-win-x64.zip`;
    for (const assetName of [name, `${name}.sha256`]) {
      const assets = release.assets?.filter(asset => asset.name === assetName) || [];
      assert(assets.length === 1 && assets[0].size > 0 && assets[0].state === 'uploaded', `Previous release is missing its complete Windows migration asset: ${assetName}`);
    }
  }
  return { previousVersion, note: archiveEnabled
    ? `Windows must qualify actual NSIS/UI and public ${previousVersion} -> candidate ${targetVersion} before publication.`
    : 'Nonpublishing validation without archives: NSIS/UI required; N-1 migration is not tested.' };
}

module.exports = { previousReleasePlan };
