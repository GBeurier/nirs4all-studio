const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { prepareDesktopSidecar } = require('../prepare-desktop-sidecar.cjs');

test('an explicit backend override is used without building', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dev-sidecar-'));
  try {
    const binary = path.join(directory, 'custom-backend');
    fs.writeFileSync(binary, 'test executable');
    assert.equal(prepareDesktopSidecar(directory, { NIRS4ALL_NATIVE_SIDECAR_PATH: './custom-backend' }, () => {
      assert.fail('An explicitly selected binary must not be rebuilt');
    }), binary);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('a failed build prevents launching an old backend', () => {
  assert.throws(() => prepareDesktopSidecar('/project', {}, () => ({ status: 1 })), /build failed/);
});

test('development launches the fresh release from the actual Cargo target directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-dev-sidecar-'));
  try {
    const binary = path.join(directory, 'release', process.platform === 'win32' ? 'studio-sidecar.exe' : 'studio-sidecar');
    fs.mkdirSync(path.dirname(binary));
    const commands = [];
    assert.equal(prepareDesktopSidecar('/project', {}, (_command, args) => {
      commands.push(args[0]);
      if (args[0] === 'build') {
        fs.writeFileSync(binary, 'fresh executable');
        assert(args.includes('--release'));
        return { status: 0 };
      }
      return { status: 0, stdout: JSON.stringify({ target_directory: directory }) };
    }), binary);
    assert.deepEqual(commands, ['build', 'metadata']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
