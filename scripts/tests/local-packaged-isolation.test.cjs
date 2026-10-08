const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { sha256File } = require('../finalize-release-assets.cjs');
const source = fs.readFileSync(path.join(__dirname, '../qualify-local-packaged.cjs'), 'utf8');

function windowsPaths() {
  const win = path.win32, nodes = new Map(), calls = [];
  const ordinary = value => value.slice(0, 8).toLowerCase() === '\\\\?\\unc\\' ? `\\\\${value.slice(8)}`
    : value.startsWith('\\\\?\\') ? value.slice(4) : value;
  const key = value => win.normalize(ordinary(value)).toLowerCase();
  function add(value, options = {}) {
    nodes.set(key(value), { path: value, ...options });
    const parent = win.dirname(value); if (parent !== value && !nodes.has(key(parent))) add(parent);
  }
  for (const value of ['D:\\owned\\profile\\startup-workspace', 'D:\\outside', 'D:\\owned-evil\\profile',
    'E:\\outside', '\\\\server\\share\\owned\\profile', '\\\\server\\elsewhere\\outside']) add(value);
  add('D:\\owned\\link', { link: true, target: 'D:\\outside' });
  add('D:\\owned\\inside-link', { link: true, target: 'D:\\owned\\profile' });
  add('D:\\owned\\link\\child', { target: 'D:\\outside' });
  add(`D:\\owned\\${'long-name'.repeat(40)}`);
  const fakeFs = {
    lstatSync: value => {
      calls.push({ lstat: value });
      // Reproduce the actual Windows Node failure on an extended root.
      if (/^\\\\\?\\[A-Za-z]:\\$/.test(value)) throw new Error('EISDIR extended drive root');
      const node = nodes.get(key(value)); assert(node, `Missing fake filesystem member: ${value}`);
      return { isSymbolicLink: () => Boolean(node.link) };
    },
    realpathSync: value => {
      calls.push({ realpath: value });
      if (/^\\\\\?\\[A-Za-z]:\\/.test(value)) throw new Error('EISDIR JS realpath extended drive member');
      const node = nodes.get(key(value)); assert(node, `Missing fake filesystem member: ${value}`);
      return node.target || node.path;
    },
  };
  fakeFs.realpathSync.native = value => {
    calls.push({ native_realpath: value });
    const node = nodes.get(key(value)); assert(node, `Missing fake filesystem member: ${value}`);
    return node.target || node.path;
  };
  const module = { exports: {} }, mocks = { 'node:path': win, 'node:fs': fakeFs,
    '@electron/asar': {}, './smoke-archive-standalone.cjs': {}, './smoke-first-launch-ui.cjs': {},
    './qualify-scientific-journey.cjs': {}, './qualify-installer.cjs': {},
    './finalize-release-assets.cjs': {}, './qualification-performance.cjs': {}, './verify-runtime-cohort.cjs': {} };
  vm.runInNewContext(source, { module, exports: module.exports, __dirname: 'D:\\source\\scripts',
    process: { platform: 'win32', env: {} }, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name) });
  return { harness: module.exports, calls, win };
}

test('Windows DOS and namespace paths share confinement and ordinary drive-root checks', () => {
  const f = windowsPaths(), child = 'D:\\owned\\profile\\startup-workspace';
  for (const parent of ['D:\\owned', f.win.toNamespacedPath('D:\\owned')]) {
    for (const member of [child, f.win.toNamespacedPath(child)]) {
      f.harness.contained(parent, member); f.harness.plainAncestors(member);
    }
  }
  assert(f.calls.some(call => call.lstat === 'D:\\'));
  assert(!f.calls.some(call => call.lstat === '\\\\?\\D:\\'));
  assert(f.calls.some(call => call.lstat === f.win.toNamespacedPath(child)));
});
test('Windows canonical paths use the native resolver for the actual extended-member JS failure', () => {
  const f = windowsPaths(), child = 'D:\\owned\\profile\\startup-workspace';
  assert.equal(f.harness.canonicalPath(child), f.harness.canonicalPath(f.win.toNamespacedPath(child)));
  assert(f.calls.some(call => call.native_realpath === f.win.toNamespacedPath(child)));
  assert.equal(f.calls.filter(call => call.realpath).length, 0);
});
test('Windows UNC namespace paths retain the share root and long members remain extended', () => {
  const f = windowsPaths(), parent = '\\\\server\\share\\owned', child = `${parent}\\profile`;
  f.harness.contained(parent, f.win.toNamespacedPath(child));
  f.harness.contained(parent, f.win.toNamespacedPath(child).replace('UNC', 'unc'));
  f.harness.plainAncestors(f.win.toNamespacedPath(child));
  assert(f.calls.some(call => call.lstat === '\\\\server\\share\\'));
  const long = `D:\\owned\\${'long-name'.repeat(40)}`;
  f.harness.plainAncestors(f.win.toNamespacedPath(long));
  assert(f.calls.some(call => call.lstat === f.win.toNamespacedPath(long)));
});
test('Windows namespace aliases cannot hide outside, equal-root, drive or share escapes', () => {
  const f = windowsPaths();
  for (const outside of ['D:\\outside', 'D:\\owned-evil\\profile', 'D:\\owned', 'E:\\outside', 'D:\\owned\\link']) {
    assert.throws(() => f.harness.contained('D:\\owned', f.win.toNamespacedPath(outside)), /escapes owned root/);
  }
  assert.throws(() => f.harness.contained('D:\\owned',
    f.win.toNamespacedPath('D:\\owned\\link\\child')), /escapes owned root/);
  assert.throws(() => f.harness.contained('\\\\server\\share\\owned',
    f.win.toNamespacedPath('\\\\server\\elsewhere\\outside')), /escapes owned root/);
  assert.throws(() => f.harness.contained('D:\\owned', '\\\\?\\D:\\owned\\..\\outside'), /escapes owned root/);
});
test('Windows namespace guards still reject links and unrecognized device namespaces', () => {
  const f = windowsPaths();
  for (const link of ['D:\\owned\\link', 'D:\\owned\\inside-link', 'D:\\owned\\link\\child']) {
    assert.throws(() => f.harness.plainAncestors(f.win.toNamespacedPath(link)), /Link in local qualification path/);
  }
  for (const unsupported of ['\\\\.\\pipe\\arbitrary', '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1',
    '\\\\?\\Volume{abc}\\owned', '\\\\?\\D:relative', '\\\\?\\UNC\\server']) {
    assert.throws(() => f.harness.plainAncestors(unsupported), /Device paths|Unsupported Windows namespace/);
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-isolation-unit-'));
  const owned = path.join(root, 'owned'), profile = path.join(owned, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const env = { NIRS4ALL_CONFIG: 'previous-config', NIRS4ALL_BACKEND_DATA_DIR: 'previous-data',
    PORTABLE_EXECUTABLE_FILE: 'external-portable.exe', NIRS4ALL_PORTABLE_ROOT: 'external-portable-data' };
  const calls = []; let active;
  const module = { exports: {} };
  const processMock = { env, platform: 'linux', arch: 'x64', version: process.version };
  const mocks = {
    './smoke-archive-standalone.cjs': { buildSandboxEnv: (_platform, _profile, port) => ({ ...env,
      NIRS4ALL_NATIVE_SIDECAR_PORT: String(port), NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: 'fresh-test-token' }) },
    './smoke-first-launch-ui.cjs': { sanitizeDiagnostic: String },
    './qualify-scientific-journey.cjs': {}, './qualify-installer.cjs': {},
    './qualification-performance.cjs': {}, './verify-runtime-cohort.cjs': {}, '@electron/asar': {},
    './finalize-release-assets.cjs': { sha256File },
    'node:net': { createServer: () => {
      const server = new EventEmitter();
      server.listen = (_port, _host, callback) => callback();
      server.address = () => ({ port: 43123 });
      server.close = callback => callback();
      return server;
    } },
    'node:child_process': { spawn: (binary, args, options) => {
      calls.push({ binary, args, options }); const child = new EventEmitter();
      child.kill = signal => { calls.push({ signal }); child.emit('close', 0, signal); return true; };
      return child;
    } },
  };
  const fetch = async (url, options) => {
    calls.push({ route: new URL(url).pathname, options });
    assert.equal(options.headers['X-Nirs4all-Session'], 'fresh-test-token');
    const route = new URL(url).pathname;
    if (route === '/api/workspace/create') {
      active = JSON.parse(options.body).path; fs.mkdirSync(active);
    }
    return { ok: true, json: async () => route === '/api/workspace' ? { workspace: { path: active } } : {} };
  };
  const context = { module, exports: module.exports, __dirname: path.join(root, 'scripts'), process: processMock,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), fetch,
    console, setTimeout, clearTimeout, AbortSignal };
  vm.runInNewContext(source, context);
  return { root, owned, profile, env, calls, context, mocks, harness: module.exports, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('observed CV score vector is preserved without filtering valid values', () => {
  const f = fixture();
  try {
    const scores = [0.25, 0, -0.5];
    assert.equal(f.harness.checkedCvScores(scores), scores);
  } finally { f.cleanup(); }
});
test('one invalid score refuses the entire observed CV vector', () => {
  const f = fixture();
  try {
    for (const invalid of [null, NaN, Infinity, -Infinity, undefined, '0.5', true]) {
      assert.throws(() => f.harness.checkedCvScores([0.25, invalid]), /Every observed CV score/);
    }
    assert.throws(() => f.harness.checkedCvScores([0.25, , 0.5]), /Every observed CV score/);
  } finally { f.cleanup(); }
});
test('empty or non-array CV observations cannot qualify', () => {
  const f = fixture();
  try {
    for (const invalid of [[], null, undefined, {}, 0.25, '0.25']) {
      assert.throws(() => f.harness.checkedCvScores(invalid), /nonempty array/);
    }
  } finally { f.cleanup(); }
});
test('explicit owned profile environment is restored even after a failed journey', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.harness.withOwnedProfile(f.profile, async () => {
      assert.equal(f.env.NIRS4ALL_CONFIG, path.join(f.profile, 'config'));
      assert.equal(f.env.NIRS4ALL_BACKEND_DATA_DIR, path.join(f.profile, 'backend-data'));
      assert.equal(f.env.PORTABLE_EXECUTABLE_FILE, undefined);
      throw new Error('real journey failure');
    }), /real journey failure/);
    assert.equal(f.env.NIRS4ALL_CONFIG, 'previous-config');
    assert.equal(f.env.NIRS4ALL_BACKEND_DATA_DIR, 'previous-data');
    assert.equal(f.env.NIRS4ALL_BACKEND_LOG_DIR, undefined);
    assert.equal(f.env.PORTABLE_EXECUTABLE_FILE, 'external-portable.exe');
    assert.equal(f.env.NIRS4ALL_PORTABLE_ROOT, 'external-portable-data');
  } finally { f.cleanup(); }
});
test('real bootstrap protocol creates/selects an owned workspace and stops before Electron', async () => {
  const f = fixture();
  try {
    await f.harness.withOwnedProfile(f.profile, () => f.harness.bootstrapOwnedWorkspace(
      { nativeSidecarPath: '/verified/sidecar', appRoot: f.owned }, f.profile, f.owned));
    assert.deepEqual(f.calls.filter(call => call.route).map(call => call.route),
      ['/api/health', '/api/workspace/create', '/api/workspace/select', '/api/workspace']);
    assert.equal(f.calls[0].options.env.NIRS4ALL_STUDIO_SESSION_TOKEN, 'fresh-test-token');
    assert.equal(f.calls[0].options.env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN, undefined);
    assert.equal(f.calls.at(-1).signal, 'SIGTERM');
    assert(fs.existsSync(path.join(f.profile, 'startup-workspace')));
  } finally { f.cleanup(); }
});
test('workspace escape fails and terminates the bootstrap; no scientific process is launched', async () => {
  const f = fixture();
  try {
    f.context.fetch = async url => ({ ok: true, json: async () => new URL(url).pathname === '/api/workspace'
      ? { workspace: { path: f.root } } : {} });
    await assert.rejects(f.harness.withOwnedProfile(f.profile, () => f.harness.bootstrapOwnedWorkspace(
      { nativeSidecarPath: '/verified/sidecar', appRoot: f.owned }, f.profile, f.owned)), /escapes owned root/);
    assert.equal(f.calls.filter(call => call.binary).length, 1);
    assert.equal(f.calls.at(-1).signal, 'SIGTERM');
  } finally { f.cleanup(); }
});
test('bootstrap rejects inherited real-user configuration before starting a process', async () => {
  const f = fixture();
  try {
    f.env.NIRS4ALL_CONFIG = f.root;
    f.env.NIRS4ALL_BACKEND_DATA_DIR = f.root;
    f.env.NIRS4ALL_BACKEND_LOG_DIR = f.root;
    await assert.rejects(f.harness.bootstrapOwnedWorkspace({ nativeSidecarPath: '/verified/sidecar', appRoot: f.owned },
      f.profile, f.owned), /escapes owned root/);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});
test('linked profile is refused before process launch', async () => {
  const f = fixture();
  try {
    const link = path.join(f.owned, 'linked-profile'); fs.symlinkSync(f.profile, link, 'dir');
    await assert.rejects(f.harness.bootstrapOwnedWorkspace({ nativeSidecarPath: '/verified/sidecar', appRoot: f.owned },
      link, f.owned), /Link in local qualification path/);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});
test('hosted full qualification fails before reading config or launching binaries', () => {
  const f = fixture();
  try {
    f.env.GITHUB_ACTIONS = 'true';
    assert.throws(() => f.harness.prepare('/missing/config.json', 'packaged-journeys'), /Full journeys run locally/);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});
test('profile environment is restored when an owned directory cannot be created', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.profile, 'backend-data'), 'not a directory');
    await assert.rejects(f.harness.withOwnedProfile(f.profile, async () => assert.fail('must not launch')));
    assert.equal(f.env.NIRS4ALL_CONFIG, 'previous-config');
    assert.equal(f.env.PORTABLE_EXECUTABLE_FILE, 'external-portable.exe');
  } finally { f.cleanup(); }
});
test('synchronous sidecar launch failure closes its retained log descriptor', async () => {
  const f = fixture();
  try {
    const opened = [], closed = [];
    f.mocks['node:fs'] = { ...fs,
      openSync: (...args) => { const fd = fs.openSync(...args); opened.push(fd); return fd; },
      closeSync: fd => { closed.push(fd); fs.closeSync(fd); } };
    f.mocks['node:child_process'].spawn = () => { throw new Error('synchronous launch failure'); };
    const module = { exports: {} };
    vm.runInNewContext(source, { ...f.context, module, exports: module.exports });
    await assert.rejects(module.exports.withOwnedProfile(f.profile, () => module.exports.bootstrapOwnedWorkspace(
      { nativeSidecarPath: '/verified/sidecar', appRoot: f.owned }, f.profile, f.owned)), /synchronous launch failure/);
    assert.equal(opened.length, 1); assert.deepEqual(closed, opened);
  } finally { f.cleanup(); }
});
