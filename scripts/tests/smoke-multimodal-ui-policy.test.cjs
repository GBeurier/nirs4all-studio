const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { resolvePerformancePolicy } = require('../qualification-performance.cjs');

function harness(t, { importDuration = 10, importError, exported = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multimodal-policy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const calls = [], logs = [], cleanup = [], warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  const locator = label => new Proxy({ label }, { get(target, key) {
    if (key === 'label') return target.label;
    if (['click', 'fill', 'setInputFiles', 'selectOption'].includes(key)) return async () => {};
    if (key === 'getAttribute') return async () => 'captured-multimodal-model';
    return (...args) => locator(`${label}/${key}:${JSON.stringify(args)}`);
  } });
  const page = new Proxy({}, { get(target, key) {
    if (key === 'reload') return async () => {};
    return (...args) => locator(`${key}:${JSON.stringify(args)}`);
  } });
  const expect = target => ({
    toBeHidden: async options => {
      calls.push({ method: 'hidden', label: target.label, options });
      if (target.label.includes('Import multimodal dataset')) {
        if (importError) throw new Error(importError);
        if (importDuration > options.timeout) throw new Error('Import remains visible at the functional deadline');
        clock += importDuration;
      }
    },
    toBeVisible: async options => calls.push({ method: 'visible', label: target.label, options }),
    toContainText: async (text, options) => calls.push({ method: 'text', label: target.label, text, options }),
    toHaveCount: async (count, options) => calls.push({ method: 'count', count, options }),
  });
  expect.poll = (callback, options) => ({ toBe: async expected => {
    calls.push({ method: 'poll', options });
    assert.equal(await callback(), expected);
  } });
  let launchOptions;
  const ui = { sanitizeDiagnostic: value => String(value), main: async options => {
    launchOptions = options;
    const context = { page, env: {
      NIRS4ALL_NATIVE_SIDECAR_PORT: '18443', NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: 'test-session',
    } };
    if (options.inspectProfile) await options.inspectProfile(context);
    await options.journeys(context);
  } };
  const script = path.resolve(__dirname, '../smoke-multimodal-ui.cjs');
  const module = { exports: {} };
  const localRequire = name => {
    if (name === '@playwright/test') return { expect };
    if (name === './smoke-first-launch-ui.cjs') return ui;
    if (name === './smoke-archive-standalone.cjs') return { cleanupSandboxRoot: async profile => cleanup.push(profile) };
    if (name === 'node:os') return { tmpdir: () => root };
    if (name.startsWith('./')) return require(path.resolve(path.dirname(script), name));
    return require(name);
  };
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), { require: localRequire, module,
    __dirname: path.dirname(script), process, AbortSignal,
    console: { log: value => logs.push(value), error: value => logs.push(value) },
    fetch: async (url, options) => {
      assert.equal(options.headers['X-Nirs4all-Session'], 'test-session');
      if (url.endsWith('/workspace/create')) {
        const workspace = JSON.parse(options.body).path;
        fs.mkdirSync(path.join(workspace, 'exports'), { recursive: true });
        if (exported) fs.writeFileSync(path.join(workspace, 'exports', 'captured.n4a'), 'mock archive');
      }
      return { ok: true, json: async () => ({ runs: [{ status: 'completed' }] }) };
    },
  }, { filename: script });
  return { main: module.exports.main, calls, logs, cleanup, warnings,
    launchOptions: () => launchOptions, root };
}

function hostedProof() {
  return { timings: [], performance_policy: resolvePerformancePolicy({
    NIRS4ALL_QUALIFICATION_PERFORMANCE_POLICY: 'github-observational',
    GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  }) };
}

test('caller-owned multimodal profile is used, inspected and retained after success', async t => {
  const h = harness(t); const profile = path.join(h.root, 'caller-owned'); fs.mkdirSync(profile);
  let inspected = false;
  await h.main({ sandboxRoot: profile }, { timings: [], performance_policy: resolvePerformancePolicy({}) }, async () => { inspected = true; });
  assert.equal(inspected, true); assert.equal(h.launchOptions().sandboxRoot, profile);
  assert.equal(h.cleanup.length, 0); assert(fs.existsSync(profile));
});

test('failed owned-workspace inspection blocks import and retains its profile', async t => {
  const h = harness(t); const profile = path.join(h.root, 'caller-owned'); fs.mkdirSync(profile);
  await assert.rejects(h.main({ sandboxRoot: profile }, { timings: [], performance_policy: resolvePerformancePolicy({}) },
    async () => { throw new Error('active workspace escaped'); }), /active workspace escaped/);
  assert.equal(h.calls.length, 0); assert.equal(h.cleanup.length, 0); assert(fs.existsSync(profile));
});

test('actual multimodal helper records an observed import overrun and retains all functional guards', async t => {
  const h = harness(t, { importDuration: 6001 });
  const proof = hostedProof();
  assert.equal(await h.main({ installed: true }, proof), proof);
  const importTiming = proof.timings.find(item => item.phase === 'multimodal_import_completed');
  assert.equal(importTiming.duration_ms, 6001);
  assert.equal(importTiming.budget_ms, 5000);
  assert.equal(importTiming.over_budget, true);
  assert.equal(h.warnings.length, 1);
  assert.equal(proof.timings.length, 9);
  assert.equal(h.launchOptions().performancePolicy, proof.performance_policy);
  assert.equal(h.launchOptions().timings, proof.timings);
  assert.equal(h.calls.find(call => call.method === 'hidden').options.timeout, 120000);
  assert.equal(h.calls.find(call => call.method === 'poll').options.timeout, 180000);
  assert.equal(h.calls.find(call => call.method === 'count').options.timeout, 30000);
  assert.equal(h.calls.find(call => call.text === 'captured REFIT, no training').options.timeout, 120000);
  assert.match(h.logs.join('\n'), /4 predictions no fit/);
  assert.equal(h.cleanup.length, 1);
});

test('local import still has a five-second strict deadline and preserves a failed profile', async t => {
  const h = harness(t, { importDuration: 6001 });
  const proof = { timings: [], performance_policy: resolvePerformancePolicy({}) };
  await assert.rejects(h.main({}, proof), /functional deadline/);
  assert.equal(h.calls.find(call => call.method === 'hidden').options.timeout, 5000);
  assert.equal(h.cleanup.length, 0);
  assert.match(h.logs.join('\n'), /profile retained/);
  assert.equal(h.calls.some(call => call.method === 'poll'), false);
});

test('observational imports fail on actual functional errors instead of continuing the journey', async t => {
  const h = harness(t, { importError: 'Dataset import rejected' });
  await assert.rejects(h.main({}, hostedProof()), /Dataset import rejected/);
  assert.equal(h.cleanup.length, 0);
  assert.equal(h.calls.some(call => call.method === 'poll'), false);
});

test('an observed import cannot bypass the actual archive-export assertion', async t => {
  const h = harness(t, { exported: false });
  await assert.rejects(h.main({}, hostedProof()), /did not export a multimodal archive/);
  assert.equal(h.cleanup.length, 0);
  assert.equal(h.calls.some(call => call.text === 'captured REFIT, no training'), false);
});
