const assert = require('node:assert/strict');
const { test } = require('node:test');
const { platformArchiveSuffix, extractOldArchive } = require('../verify-real-release-update.cjs');

test('selects the published archive for each supported desktop architecture', () => {
  assert.equal(platformArchiveSuffix('darwin', 'arm64'), 'mac-arm64.zip');
  assert.equal(platformArchiveSuffix('darwin', 'x64'), 'mac-x64.zip');
  assert.equal(platformArchiveSuffix('linux', 'x64'), 'linux-x64.tar.gz');
  assert.equal(platformArchiveSuffix('win32', 'x64'), 'win-x64.zip');
  assert.throws(() => platformArchiveSuffix('linux', 'arm64'), /Unsupported/);
});

test('extracts macOS ZIPs with ditto and passes paths without shell interpolation', () => {
  const calls = [];
  extractOldArchive('darwin', '/tmp/a b/archive.zip', '/tmp/old app', (...args) => calls.push(args));
  assert.deepEqual(calls, [['ditto', ['-x', '-k', '/tmp/a b/archive.zip', '/tmp/old app'], { stdio: 'inherit' }]]);
});

test('preserves the existing Linux and Windows extraction commands', () => {
  for (const [platform, command] of [['linux', 'tar'], ['win32', 'tar.exe']]) {
    extractOldArchive(platform, 'source', 'destination', (actual, args) => {
      assert.equal(actual, command);
      assert.deepEqual(args, ['-xf', 'source', '-C', 'destination']);
    });
  }
});
