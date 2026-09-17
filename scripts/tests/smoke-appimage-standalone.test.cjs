const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { attributedFuseProcesses, stopAppImage } = require('../smoke-appimage-standalone.cjs');
const image = '/installer/nirs4all Studio-0.11.5-linux-x86_64.AppImage';

function fixture({ source = image, mount = '/tmp/.mount_Test Space', executable, unrelated = false, parent = 123 } = {}) {
  const appDir = '/tmp/.mount_Test Space';
  const mountLine = `100 99 0:1 / ${mount.replace(/ /g, '\\040')} rw - fuse.AppImage AppImage rw`;
  return {
    readdirSync: () => ['123', '124'],
    realpathSync: value => value,
    readlinkSync: () => executable || `${appDir}/studio`,
    readFileSync: file => {
      if (file === '/proc/123/stat') return '123 (AppImage loader) S 1 123 0';
      if (file === '/proc/124/stat') return `124 (electron) S ${parent} 123 0`;
      if (file === '/proc/123/environ') return '';
      if (file.endsWith('/environ')) return `APPIMAGE=${source}\0APPDIR=${appDir}\0`;
      if (file.endsWith('/mountinfo')) return unrelated ? '100 99 0:1 / /tmp/.mount_UNRELATED rw - fuse.AppImage unrelated rw' : mountLine;
      throw Error(`Unexpected file ${file}`);
    },
  };
}

test('attributes an escaped-space FUSE mount to the real executable descended from the loader', () => {
  const result = attributedFuseProcesses(123, image, fixture());
  assert.equal(result.length, 1);
  assert.equal(result[0].pid, 124);
  assert.equal(result[0].app_dir, '/tmp/.mount_Test Space');
  assert.equal(result[0].appimage, image);
});

test('rejects the original false proof from an unrelated FUSE mount', () => {
  assert.throws(() => attributedFuseProcesses(123, image, fixture({ unrelated: true })), /No live descendant/);
});

test('rejects the wrong source, a non-descendant and an executable outside its declared mount', () => {
  for (const options of [{ source: '/installer/other.AppImage' }, { parent: 999 }, { executable: '/usr/bin/electron' }]) {
    assert.throws(() => attributedFuseProcesses(123, image, fixture(options)), /No live descendant/);
  }
});

test('rejects shutdown when both termination waits fail instead of reporting success', async () => {
  const signals = [];
  await assert.rejects(stopAppImage({ pid: 123, exitCode: null, signalCode: null }, {
    processTable: () => [{ pid: 123, group: 123, state: 'S' }],
    kill: (pid, signal) => signals.push([pid, signal]), terminateTimeoutMs: 0, killTimeoutMs: 0,
  }), /did not stop/);
  assert.deepEqual(signals, [[-123, 'SIGTERM'], [-123, 'SIGKILL']]);
});

test('terminates a real process group, including a child that survives its parent', { skip: process.platform !== 'linux' }, async () => {
  const worker = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>console.log('ready'));
    process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);
  `], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve, reject) => { worker.stdout.once('data', resolve); worker.once('error', reject); });
    await stopAppImage(worker, { terminateTimeoutMs: 50, killTimeoutMs: 3000 });
    assert.equal(worker.signalCode, 'SIGKILL');
  } finally {
    try { process.kill(-worker.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
});

test('main preserves failure logs and does not write successful evidence if shutdown fails', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../smoke-appimage-standalone.cjs'), 'utf8');
  const writes = new Map();
  const io = fixture();
  io.existsSync = () => true;
  io.mkdtempSync = () => '/tmp/fake-appimage-proof';
  io.writeFileSync = (name, value) => writes.set(name, value);
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  const helper = { buildSandboxEnv: () => ({ NIRS4ALL_OFFLINE: '1' }), waitForNativeScientificReady: async () => {}, verifyInstalledProduct: async () => {} };
  const localModule = { exports: {} };
  const fakeRequire = name => name === 'node:fs' ? io
    : name === 'node:net' ? { createServer: () => ({ listen: (_port, _host, callback) => callback(), address: () => ({ port: 12345 }), close: callback => callback() }) }
    : name === 'node:child_process' ? { spawn: () => child }
    : name.endsWith('smoke-archive-standalone.cjs') ? helper
    : name.endsWith('finalize-release-assets.cjs') ? { sha256File: () => 'a'.repeat(64), parseChecksumSidecar: () => 'a'.repeat(64) }
    : require(name);
  let now = 0;
  const context = { module: localModule, require: fakeRequire, console,
    Date: { now: () => { now += 30000; return now; } }, setTimeout,
    process: { platform: 'linux', arch: 'x64', argv: ['node', 'script', '/repo', image], env: {}, kill: () => false },
  };
  vm.runInNewContext(source, context);
  await assert.rejects(localModule.exports.main(), /did not stop/);
  assert(writes.has('/tmp/fake-appimage-proof/application.log'));
  assert(!writes.has('/tmp/fake-appimage-proof/result.json'));
});
